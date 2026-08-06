/**
 * Orchestrate local lark-cli config + OAuth (device flow) for desktop onboarding.
 * No server; secrets never logged or returned to the renderer.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveLarkCliManagedRoot } from "../config-profile-paths.mjs";
import { codedError, nonEmptyString } from "./managed-cli/index.mjs";

const SCOPES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "lark-cli-recommended-scopes.json",
);

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Parse first JSON object from CLI stdout/stderr blob.
 * @param {string} text
 */
export function parseCliJsonBlob(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // CLI sometimes prints plain OK lines then JSON.
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Extract https verification URL from mixed CLI output.
 * @param {string} text
 */
export function extractVerificationUrl(text) {
  const blob = parseCliJsonBlob(text);
  const record = asRecord(blob);
  if (record) {
    for (const key of [
      "verification_url",
      "verificationUrl",
      "verification_uri_complete",
      "verificationUriComplete",
      "url",
    ]) {
      const value = nonEmptyString(record[key]);
      if (value && /^https:\/\//i.test(value)) return value;
    }
    const data = asRecord(record.data);
    if (data) {
      for (const key of [
        "verification_url",
        "verificationUrl",
        "verification_uri_complete",
        "url",
      ]) {
        const value = nonEmptyString(data[key]);
        if (value && /^https:\/\//i.test(value)) return value;
      }
    }
  }
  const match = String(text).match(/https:\/\/[^\s"'<>]+/i);
  return match ? match[0].replace(/[),.;]+$/, "") : null;
}

/**
 * @param {string} text
 */
export function extractDeviceCode(text) {
  const blob = parseCliJsonBlob(text);
  const record = asRecord(blob);
  if (!record) return null;
  const direct = nonEmptyString(record.device_code) || nonEmptyString(record.deviceCode);
  if (direct) return direct;
  const data = asRecord(record.data);
  if (!data) return null;
  return nonEmptyString(data.device_code) || nonEmptyString(data.deviceCode);
}

/**
 * @param {{ homeDir?: string, runCli?: Function, onProgress?: Function, now?: () => number }} [options]
 */
export function createLarkCliAuthService(options = {}) {
  const homeDir = options.homeDir ?? os.homedir();
  const now = options.now ?? (() => Date.now());
  const emitProgress = options.onProgress ?? (() => undefined);
  /** @type {Map<string, { deviceCode: string, createdAt: number }>} */
  const loginSessions = new Map();
  /** @type {import('node:child_process').ChildProcess | null} */
  let configInitChild = null;

  async function pathExists(target) {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }

  async function resolveBinaryPath() {
    const managedRoot = resolveLarkCliManagedRoot(homeDir);
    const statePath = path.join(managedRoot, "state.json");
    if (!(await pathExists(statePath))) return null;
    let state;
    try {
      state = JSON.parse(await readFile(statePath, "utf8"));
    } catch {
      return null;
    }
    const version = nonEmptyString(state?.activeVersion);
    const platform = nonEmptyString(state?.platform);
    if (!version || !platform) return null;
    const binaryName = process.platform === "win32" ? "lark-cli.exe" : "lark-cli";
    const binaryPath = path.join(
      managedRoot,
      "releases",
      version,
      platform,
      binaryName,
    );
    if (!(await pathExists(binaryPath))) return null;
    return { binaryPath, installedVersion: version, managedRoot };
  }

  /**
   * @param {string[]} args
   * @param {{ stdinText?: string, timeoutMs?: number, cwd?: string }} [opts]
   */
  async function runCli(args, opts = {}) {
    if (typeof options.runCli === "function") {
      return options.runCli(args, opts);
    }
    const resolved = await resolveBinaryPath();
    if (!resolved) {
      throw codedError("lark-cli is not installed", "not_installed");
    }
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const cwd = opts.cwd ?? os.tmpdir();
    const env = {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
    };
    // Avoid agent-workspace guards that block config init.
    delete env.OPENCLAW_HOME;
    delete env.HERMES_HOME;

    return new Promise((resolve, reject) => {
      const child = spawn(resolved.binaryPath, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(codedError(`lark-cli timed out: ${args.join(" ")}`, "network_timeout"));
      }, timeoutMs);
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
          combined: `${stdout}\n${stderr}`,
          binaryPath: resolved.binaryPath,
          installedVersion: resolved.installedVersion,
        });
      });
      if (opts.stdinText != null) {
        child.stdin?.write(opts.stdinText);
      }
      child.stdin?.end();
    });
  }

  function emptyStatus(partial = {}) {
    return {
      phase: "not_installed",
      installed: false,
      installedVersion: null,
      appId: null,
      brand: null,
      userName: null,
      userOpenId: null,
      userTokenValid: false,
      botReady: false,
      message: null,
      errorCode: null,
      errorMessage: null,
      lastCheckedAt: now(),
      ...partial,
    };
  }

  /**
   * @param {string} combined
   */
  function parseAuthStatusEnvelope(combined) {
    const blob = parseCliJsonBlob(combined);
    const record = asRecord(blob);
    if (!record) return { kind: "unknown" };
    if (record.ok === false) {
      const error = asRecord(record.error);
      const subtype = nonEmptyString(error?.subtype) || "error";
      return {
        kind: "error",
        subtype,
        message: nonEmptyString(error?.message),
        code: nonEmptyString(error?.type),
      };
    }
    // auth status --json success shapes vary; support identities map.
    const identities = asRecord(record.identities) || asRecord(asRecord(record.data)?.identities);
    const user = asRecord(identities?.user);
    const bot = asRecord(identities?.bot);
    const appId =
      nonEmptyString(record.appId) ||
      nonEmptyString(record.app_id) ||
      nonEmptyString(asRecord(record.data)?.appId);
    const brandRaw =
      nonEmptyString(record.brand) || nonEmptyString(asRecord(record.data)?.brand);
    const brand = brandRaw === "lark" || brandRaw === "feishu" ? brandRaw : null;
    const userStatus = nonEmptyString(user?.status)?.toLowerCase() ?? "";
    const tokenStatus = nonEmptyString(user?.tokenStatus)?.toLowerCase() ?? "";
    const userReady =
      user?.available === true ||
      userStatus === "ready" ||
      tokenStatus === "valid" ||
      tokenStatus === "ready";
    const botReady =
      bot?.available === true || nonEmptyString(bot?.status)?.toLowerCase() === "ready";
    return {
      kind: "ok",
      appId,
      brand,
      userName:
        nonEmptyString(user?.userName) ||
        nonEmptyString(user?.name) ||
        nonEmptyString(user?.user_name),
      userOpenId:
        nonEmptyString(user?.openId) ||
        nonEmptyString(user?.open_id) ||
        nonEmptyString(user?.userOpenId),
      userTokenValid: Boolean(userReady),
      botReady: Boolean(botReady),
      note: nonEmptyString(record.note),
    };
  }

  async function getConnectionStatus() {
    const resolved = await resolveBinaryPath();
    const installedVersion = resolved?.installedVersion ?? null;
    if (!resolved && typeof options.runCli !== "function") {
      return emptyStatus({
        phase: "not_installed",
        message: "lark-cli is not installed",
      });
    }

    let result;
    try {
      result = await runCli(["auth", "status", "--json"], { timeoutMs: 20_000 });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "not_installed"
      ) {
        return emptyStatus({
          phase: "not_installed",
          message: "lark-cli is not installed",
        });
      }
      return emptyStatus({
        phase: "error",
        installed: true,
        installedVersion,
        errorCode:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "lark_cli_error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    const parsed = parseAuthStatusEnvelope(result.combined);
    if (parsed.kind === "error") {
      if (
        parsed.subtype === "not_configured" ||
        parsed.subtype === "invalid_config" ||
        /not configured/i.test(parsed.message ?? "")
      ) {
        return emptyStatus({
          phase: "installed_disconnected",
          installed: true,
          installedVersion,
          message: parsed.message || "not configured",
        });
      }
      // invalid_client still means app id was written
      if (parsed.subtype === "invalid_client") {
        return emptyStatus({
          phase: "connected_not_logged_in",
          installed: true,
          installedVersion,
          message: parsed.message,
          errorCode: parsed.subtype,
          errorMessage: parsed.message,
        });
      }
    }

    // Prefer config show for appId when auth status lacks it
    let appId = parsed.kind === "ok" ? parsed.appId : null;
    let brand = parsed.kind === "ok" ? parsed.brand : null;
    try {
      const show = await runCli(["config", "show"], { timeoutMs: 15_000 });
      const showJson = parseCliJsonBlob(show.combined);
      const showRec = asRecord(showJson);
      if (showRec && showRec.ok !== false) {
        appId = appId || nonEmptyString(showRec.appId) || nonEmptyString(showRec.app_id);
        const b = nonEmptyString(showRec.brand);
        if (b === "feishu" || b === "lark") brand = b;
      }
    } catch {
      // ignore
    }

    if (!appId && parsed.kind !== "ok") {
      return emptyStatus({
        phase: "installed_disconnected",
        installed: true,
        installedVersion,
        message: parsed.message || "not configured",
        errorCode: parsed.subtype || null,
        errorMessage: parsed.message || null,
      });
    }

    const userTokenValid = parsed.kind === "ok" ? parsed.userTokenValid : false;
    const phase = userTokenValid
      ? "connected_logged_in"
      : appId
        ? "connected_not_logged_in"
        : "installed_disconnected";

    return emptyStatus({
      phase,
      installed: true,
      installedVersion,
      appId,
      brand,
      userName: parsed.kind === "ok" ? parsed.userName : null,
      userOpenId: parsed.kind === "ok" ? parsed.userOpenId : null,
      userTokenValid,
      botReady: parsed.kind === "ok" ? parsed.botReady : Boolean(appId),
      message: parsed.kind === "ok" ? parsed.note : null,
    });
  }

  async function getRecommendedScopesJson() {
    const text = await readFile(SCOPES_PATH, "utf8");
    // Validate JSON
    JSON.parse(text);
    return text.trim() + "\n";
  }

  /**
   * @param {{ appId: string, appSecret: string, brand?: string }} input
   */
  async function submitManualCredentials(input) {
    const appId = nonEmptyString(input?.appId);
    const appSecret = nonEmptyString(input?.appSecret);
    if (!appId || !appSecret) {
      throw codedError("App ID and App Secret are required", "invalid_argument");
    }
    if (!/^cli_[A-Za-z0-9]+$/.test(appId) && !/^cli_[A-Za-z0-9_]+$/.test(appId)) {
      // Feishu app ids are typically cli_*; keep soft — still pass through if starts with cli_
      if (!appId.startsWith("cli_")) {
        throw codedError("App ID should look like cli_xxxxxxxx", "invalid_argument");
      }
    }
    const brand = input?.brand === "lark" ? "lark" : "feishu";
    emitProgress({
      operation: "manual_credentials",
      phase: "starting",
    });
    const result = await runCli(
      ["config", "init", "--app-id", appId, "--app-secret-stdin", "--brand", brand],
      { stdinText: `${appSecret}\n`, timeoutMs: 30_000 },
    );
    // CLI may print OK then a validation error if app is invalid; config may still be saved.
    const status = await getConnectionStatus();
    if (
      status.phase === "installed_disconnected" &&
      result.code !== 0
    ) {
      const err = parseCliJsonBlob(result.combined);
      const error = asRecord(asRecord(err)?.error);
      emitProgress({
        operation: "manual_credentials",
        phase: "error",
        errorCode: nonEmptyString(error?.subtype) || "config_failed",
        errorMessage: nonEmptyString(error?.message) || result.stderr || "config failed",
      });
      throw codedError(
        nonEmptyString(error?.message) || "Failed to save app credentials",
        nonEmptyString(error?.subtype) || "config_failed",
      );
    }
    emitProgress({ operation: "manual_credentials", phase: "complete" });
    return status;
  }

  async function generateQrcodeDataUrl(verificationUrl) {
    const url = nonEmptyString(verificationUrl);
    if (!url) return null;
    const tmp = await mkdtemp(path.join(os.tmpdir(), "oma-lark-qr-"));
    try {
      // qrcode requires relative output path within cwd
      const rel = "qr.png";
      const result = await runCli(["auth", "qrcode", url, "--output", rel], {
        cwd: tmp,
        timeoutMs: 20_000,
      });
      if (result.code !== 0) {
        // Fallback ASCII not used in UI; return null
        return null;
      }
      const pngPath = path.join(tmp, rel);
      const bytes = await readFile(pngPath);
      return `data:image/png;base64,${bytes.toString("base64")}`;
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async function startUserLogin() {
    emitProgress({ operation: "user_login", phase: "starting" });
    const result = await runCli(
      ["auth", "login", "--recommend", "--no-wait", "--json"],
      { timeoutMs: 30_000 },
    );
    const verificationUrl = extractVerificationUrl(result.combined);
    const deviceCode = extractDeviceCode(result.combined);
    if (!verificationUrl || !deviceCode) {
      emitProgress({
        operation: "user_login",
        phase: "error",
        errorCode: "login_start_failed",
        errorMessage: "Could not start device authorization",
      });
      throw codedError(
        "Could not start user login (missing verification URL or device code)",
        "login_start_failed",
      );
    }
    const sessionId = randomUUID();
    loginSessions.set(sessionId, { deviceCode, createdAt: now() });
    const qrcodeDataUrl = await generateQrcodeDataUrl(verificationUrl);
    emitProgress({
      operation: "user_login",
      phase: "waiting_user",
      verificationUrl,
      qrcodeDataUrl: qrcodeDataUrl ?? undefined,
    });
    return { sessionId, verificationUrl, qrcodeDataUrl };
  }

  /**
   * @param {string} sessionId
   */
  async function completeUserLogin(sessionId) {
    const id = nonEmptyString(sessionId);
    const session = id ? loginSessions.get(id) : null;
    if (!session) {
      throw codedError("Login session expired or missing", "login_session_missing");
    }
    emitProgress({ operation: "user_login", phase: "polling" });
    const result = await runCli(
      ["auth", "login", "--device-code", session.deviceCode],
      { timeoutMs: 120_000 },
    );
    loginSessions.delete(id);
    if (result.code !== 0) {
      const err = parseCliJsonBlob(result.combined);
      const error = asRecord(asRecord(err)?.error);
      emitProgress({
        operation: "user_login",
        phase: "error",
        errorCode: nonEmptyString(error?.subtype) || "login_failed",
        errorMessage: nonEmptyString(error?.message) || "login failed",
      });
      throw codedError(
        nonEmptyString(error?.message) || "User login failed",
        nonEmptyString(error?.subtype) || "login_failed",
      );
    }
    emitProgress({ operation: "user_login", phase: "complete" });
    return getConnectionStatus();
  }

  /**
   * Start config init --new; returns when URL is known or process ends.
   * Long-running: keeps child until complete/cancel.
   */
  async function startConfigInit() {
    if (configInitChild) {
      throw codedError("Config init already running", "busy");
    }
    if (typeof options.runCli === "function") {
      // Test mode: single-shot mock
      emitProgress({ operation: "config_init", phase: "starting" });
      const result = await options.runCli(["config", "init", "--new"], {});
      const verificationUrl = extractVerificationUrl(result.combined);
      const qrcodeDataUrl = verificationUrl
        ? await generateQrcodeDataUrl(verificationUrl)
        : null;
      if (verificationUrl) {
        emitProgress({
          operation: "config_init",
          phase: "waiting_user",
          verificationUrl,
          qrcodeDataUrl: qrcodeDataUrl ?? undefined,
        });
      }
      return {
        verificationUrl,
        qrcodeDataUrl,
        pending: result.code === 0 ? false : Boolean(verificationUrl),
      };
    }

    const resolved = await resolveBinaryPath();
    if (!resolved) throw codedError("lark-cli is not installed", "not_installed");

    emitProgress({ operation: "config_init", phase: "starting" });
    const env = {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
    };
    delete env.OPENCLAW_HOME;
    delete env.HERMES_HOME;

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let urlEmitted = false;
      const child = spawn(resolved.binaryPath, ["config", "init", "--new"], {
        cwd: os.tmpdir(),
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      configInitChild = child;

      const maybeEmitUrl = async () => {
        if (urlEmitted) return;
        const verificationUrl = extractVerificationUrl(`${stdout}\n${stderr}`);
        if (!verificationUrl) return;
        urlEmitted = true;
        const qrcodeDataUrl = await generateQrcodeDataUrl(verificationUrl);
        emitProgress({
          operation: "config_init",
          phase: "waiting_user",
          verificationUrl,
          qrcodeDataUrl: qrcodeDataUrl ?? undefined,
        });
        if (!settled) {
          settled = true;
          resolve({
            verificationUrl,
            qrcodeDataUrl,
            pending: true,
          });
        }
      };

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
        void maybeEmitUrl();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        void maybeEmitUrl();
      });
      child.on("error", (error) => {
        configInitChild = null;
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on("close", (code) => {
        configInitChild = null;
        if (code === 0) {
          emitProgress({ operation: "config_init", phase: "complete" });
        } else if (code != null) {
          emitProgress({
            operation: "config_init",
            phase: "error",
            errorCode: "config_init_failed",
            errorMessage: `config init exited with ${code}`,
          });
        }
        if (!settled) {
          settled = true;
          const verificationUrl = extractVerificationUrl(`${stdout}\n${stderr}`);
          resolve({
            verificationUrl,
            qrcodeDataUrl: null,
            pending: false,
            exitCode: code ?? 1,
          });
        }
      });
    });
  }

  async function cancelConfigInit() {
    if (configInitChild) {
      configInitChild.kill();
      configInitChild = null;
      emitProgress({ operation: "config_init", phase: "cancelled" });
    }
    return { ok: true };
  }

  /**
   * @param {{ clearCredentials?: boolean }} [input]
   */
  async function disconnect(input = {}) {
    emitProgress({ operation: "disconnect", phase: "starting" });
    try {
      await runCli(["auth", "logout", "--json"], { timeoutMs: 20_000 });
    } catch {
      // continue
    }
    if (input.clearCredentials !== false) {
      try {
        await runCli(["config", "remove"], { timeoutMs: 20_000 });
      } catch {
        // continue
      }
    }
    loginSessions.clear();
    emitProgress({ operation: "disconnect", phase: "complete" });
    return getConnectionStatus();
  }

  return {
    getConnectionStatus,
    getRecommendedScopesJson,
    submitManualCredentials,
    startUserLogin,
    completeUserLogin,
    startConfigInit,
    cancelConfigInit,
    disconnect,
    generateQrcodeDataUrl,
    /** @internal tests */
    _loginSessions: loginSessions,
  };
}
