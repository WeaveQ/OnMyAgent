import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unwatchFile,
  watchFile,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAppshotController,
  isComputerUseAppshotSupported,
  sanitizeAppshotFileName,
} from "./computer-use-appshot.mjs";
import {
  isComputerUseMcpEnabled,
  resolveComputerUseRuntimeCommand,
  resolveWindowsCuaDriver,
  writeComputerUseMcpPrefsEnabled,
  writeComputerUseRuntimeConfig,
} from "./computer-use-runtime-config.mjs";

export { isComputerUseAppshotSupported, sanitizeAppshotFileName };

const COMPUTER_USE_HELPER_APP_NAME = "OnMyAgent Computer Use.app";
const COMPUTER_USE_HELPER_EXECUTABLE = "ComputerUse";

/** Product version for Computer Use UI (not Electron runtime version). */
export function resolveOnMyAgentProductVersion(app) {
  try {
    const fromApp = String(app?.getVersion?.() ?? "").trim();
    // Electron majors are typically large (>= 20); product is 0.x / 1.x style.
    if (fromApp && /^\d+\.\d+\.\d+/.test(fromApp)) {
      const major = Number(fromApp.split(".")[0]);
      if (Number.isFinite(major) && major < 20) return fromApp;
    }
  } catch {
    // fall through to package.json
  }
  try {
    const pkgPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (typeof pkg.version === "string" && pkg.version.trim()) {
      return pkg.version.trim();
    }
  } catch {
    // leave undefined
  }
  return undefined;
}

export function parseComputerUseStatus(stdout) {
  try {
    const parsed = JSON.parse(String(stdout ?? "").trim());
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.ok !== "boolean" ||
      typeof parsed.accessibility !== "boolean" ||
      typeof parsed.screenRecording !== "boolean"
    ) {
      return null;
    }
    return {
      ok: parsed.ok,
      accessibility: parsed.accessibility,
      screenRecording: parsed.screenRecording,
      ...(typeof parsed.helperVersion === "string"
        ? { helperVersion: parsed.helperVersion }
        : {}),
      ...(Number.isInteger(parsed.protocolVersion)
        ? { protocolVersion: parsed.protocolVersion }
        : {}),
      ...(typeof parsed.activity === "object" && parsed.activity !== null
        ? { activity: parsed.activity }
        : {}),
      ...(typeof parsed.skysight === "object" && parsed.skysight !== null
        ? { skysight: parsed.skysight }
        : {}),
      ...(typeof parsed.appAuthorizations === "object" &&
      parsed.appAuthorizations !== null &&
      Array.isArray(parsed.appAuthorizations.allowedBundleIdentifiers) &&
      parsed.appAuthorizations.allowedBundleIdentifiers.every(
        (identifier) => typeof identifier === "string",
      )
        ? { appAuthorizations: parsed.appAuthorizations }
        : {}),
    };
  } catch {
    return null;
  }
}

export function parseComputerUseActivity(value) {
  if (typeof value !== "object" || value === null) return null;
  if (
    value.phase !== "inactive" &&
    value.phase !== "ready" &&
    value.phase !== "running" &&
    value.phase !== "paused" &&
    value.phase !== "errored"
  ) {
    return null;
  }
  return {
    phase: value.phase,
    ...(typeof value.app === "string" ? { app: value.app } : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
}

export function createComputerUseDesktopHelpers(input) {
  const { app, shell, dialog, systemPreferences, dirname } = input;
  /** Optional; used to surface the app in Screen Recording privacy list. */
  const desktopCapturer = input.desktopCapturer ?? null;
  const spawnProcess = input.spawnProcess ?? spawn;
  const readFile = input.readFile ?? readFileSync;
  const resolveComputerUseExecutableOverride = input.resolveComputerUseExecutable;
  let skysightRecorder = null;
  let watchedActivityFile = null;

  // Appshot is a separate controller (capture / hotkey monitor / event watch).
  let appshot = null;
  const getAppshot = () => {
    if (!appshot) {
      appshot = createAppshotController({
        app,
        systemPreferences,
        desktopCapturer,
        screen: input.screen ?? null,
        readFile,
        writeFile: input.writeFile,
      });
    }
    return appshot;
  };

function desktopRootPath() {
  return path.resolve(dirname, "..");
}

function computerUseHelperExecutablePath() {
  const appPath = computerUseHelperAppPath();
  const explicitBinary = process.env.ONMYAGENT_COMPUTER_USE_BINARY?.trim();
  const candidates = [
    explicitBinary,
    appPath
      ? path.join(appPath, "Contents", "MacOS", COMPUTER_USE_HELPER_EXECUTABLE)
      : null,
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function computerUseHelperAppPath() {
  const explicitApp = process.env.ONMYAGENT_COMPUTER_USE_APP?.trim();
  const candidates = [
    explicitApp,
    process.resourcesPath
      ? path.join(
          process.resourcesPath,
          "helpers",
          COMPUTER_USE_HELPER_APP_NAME,
        )
      : null,
    path.resolve(
      dirname,
      "..",
      "resources",
      "helpers",
      COMPUTER_USE_HELPER_APP_NAME,
    ),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getComputerUseMcpCommand() {
  const command = resolveComputerUseRuntimeCommand({
    platform: process.platform,
    desktopRoot: desktopRootPath(),
    resourcesPath: process.resourcesPath,
    explicitBinary: process.env.ONMYAGENT_COMPUTER_USE_BINARY,
    devMode:
      process.env.ONMYAGENT_DEV_MODE === "1" || app.isPackaged === false,
  });
  if (command) return command;

  if (process.platform === "win32") {
    throw new Error(
      app.isPackaged
        ? "Cua Driver is missing from this OnMyAgent build. Reinstall the app."
        : "Cua Driver not staged. Run: node apps/desktop/scripts/prepare-cua-helper.mjs --force-target",
    );
  }

  if (app.isPackaged) {
    throw new Error(
      "OnMyAgent Computer Use is missing from this OnMyAgent build.",
    );
  }

  if (process.env.ONMYAGENT_DEV_MODE === "1") {
    return [
      "node",
      path.resolve(
        dirname,
        "../../..",
        "packages/handsfree/bin/onmyagent-handsfree-computer-use.mjs",
      ),
      "mcp",
    ];
  }
  return ["npx", "-y", "@onmyagent/handsfree", "mcp"];
}

function resolveMcpEnabledForPlatform() {
  let userDataDir;
  try {
    userDataDir = app.getPath("userData");
  } catch {
    userDataDir = undefined;
  }
  return isComputerUseMcpEnabled({
    platform: process.platform,
    userDataDir,
  });
}

/**
 * Persist MCP enable preference and refresh OpenCode overlay when possible.
 * @param {boolean} enabled
 */
async function setComputerUseMcpEnabled(enabled) {
  if (typeof enabled !== "boolean") {
    throw new Error("Computer Use MCP enabled state must be a boolean.");
  }
  let userDataDir;
  try {
    userDataDir = app.getPath("userData");
  } catch {
    throw new Error("Cannot resolve userData for Computer Use preferences.");
  }
  writeComputerUseMcpPrefsEnabled(userDataDir, enabled);

  // Keep managed OpenCode overlay in sync when we own computer-use config.
  try {
    const command = getComputerUseMcpCommand();
    const configDir =
      process.env.OPENCODE_CONFIG_DIR?.trim() ||
      path.join(userDataDir, "opencode");
    await writeComputerUseRuntimeConfig(configDir, command, { enabled });
  } catch (error) {
    console.warn(
      "[ComputerUse] could not rewrite OpenCode overlay:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return checkComputerUsePermissions();
}

// ---------------------------------------------------------------------------
// Permission checks — spawn the binary with --check, read stdout, done.
// Fresh process = fresh TCC read = always accurate. No HTTP server needed.
// ---------------------------------------------------------------------------

function resolveComputerUseExecutable() {
  if (typeof resolveComputerUseExecutableOverride === "function") {
    return resolveComputerUseExecutableOverride();
  }
  // 1. Explicit env override.
  const explicit = process.env.ONMYAGENT_COMPUTER_USE_BINARY?.trim();
  if (explicit && existsSync(explicit)) return explicit;

  // 2. .app bundle (packaged builds + pnpm dev).
  const appPath = computerUseHelperAppPath();
  if (appPath) {
    const bin = path.join(
      appPath,
      "Contents",
      "MacOS",
      COMPUTER_USE_HELPER_EXECUTABLE,
    );
    if (existsSync(bin)) return bin;
  }

  // 3. Dev fallback — raw Swift build output.
  if (!app.isPackaged) {
    const swiftPkg = path.resolve(
      dirname,
      "../../..",
      "packages/handsfree/native/HandsFree",
    );
    const devCandidates = [
      path.join(swiftPkg, ".build", "release", "HandsFreeComputerUse"),
      path.join(
        swiftPkg,
        ".build",
        "arm64-apple-macosx",
        "release",
        "HandsFreeComputerUse",
      ),
      path.join(swiftPkg, ".build", "debug", "HandsFreeComputerUse"),
      path.join(
        swiftPkg,
        ".build",
        "arm64-apple-macosx",
        "debug",
        "HandsFreeComputerUse",
      ),
    ];
    for (const c of devCandidates) {
      if (existsSync(c)) return c;
    }
  }

  return null;
}

async function checkComputerUsePermissions() {
  const desktopVersion = resolveOnMyAgentProductVersion(app);
  const mcpEnabled = resolveMcpEnabledForPlatform();

  // Windows: Cua Driver stage check (no HandsFree --status / TCC).
  if (process.platform === "win32") {
    const cua = resolveWindowsCuaDriver({
      desktopRoot: desktopRootPath(),
      resourcesPath: process.resourcesPath,
      explicitBinary: process.env.ONMYAGENT_COMPUTER_USE_BINARY,
    });
    const present = Boolean(cua);
    return {
      ok: present,
      accessibility: present,
      screenRecording: present,
      backend: present ? "cua" : "none",
      mcpEnabled,
      helperVersion: present ? "cua-driver" : undefined,
      // protocolVersion 1 keeps settings "runtime compatible" UI green when staged.
      protocolVersion: present ? 1 : undefined,
      desktopVersion,
      error: present
        ? undefined
        : "Cua Driver not staged. Run prepare-cua-helper or reinstall OnMyAgent.",
    };
  }

  // macOS: Spawn HandsFree --status → read JSON from stdout → exit.
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    return {
      ok: false,
      accessibility: false,
      screenRecording: false,
      backend: "none",
      mcpEnabled,
      desktopVersion,
      error: "Helper binary not found. Run pnpm dev to build it.",
    };
  }
  const status = await spawnCheckPermissions(bin);
  return {
    ...status,
    backend: "handsfree",
    mcpEnabled,
    desktopVersion,
    ...(status.skysight
      ? {
          skysight: {
            ...status.skysight,
            recording:
              status.skysight.recording === true || isSkysightRecorderRunning(),
          },
        }
      : {}),
  };
}

function isSkysightRecorderRunning() {
  return skysightRecorder !== null && skysightRecorder.exitCode === null;
}

function startSkysightRecorder(bin) {
  if (isSkysightRecorderRunning()) return;
  const child = spawnProcess(bin, ["skysight", "record"], {
    stdio: "ignore",
  });
  skysightRecorder = child;
  child.on("error", (error) => {
    console.warn("[ComputerUse] Skysight recorder failed:", error.message);
  });
  child.on("exit", () => {
    if (skysightRecorder === child) skysightRecorder = null;
  });
}

function stopSkysightRecorder() {
  if (!isSkysightRecorderRunning()) {
    skysightRecorder = null;
    return;
  }
  skysightRecorder.kill("SIGTERM");
  skysightRecorder = null;
}

function runComputerUseCommand(bin, args) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const child = spawnProcess(bin, args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 5_000,
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Computer Use helper exited with code ${code}.`));
    });
  });
}

function runComputerUseJSONCommand(bin, args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawnProcess(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Computer Use helper exited with code ${code}.`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error("Computer Use helper returned invalid JSON."));
      }
    });
  });
}

async function captureComputerUseAppshot() {
  return getAppshot().captureComputerUseAppshot();
}

function startAppshotMonitor() {
  getAppshot().startAppshotMonitor();
}

function stopAppshotMonitor() {
  getAppshot().stopAppshotMonitor();
}

async function setComputerUseSkysightEnabled(enabled) {
  if (typeof enabled !== "boolean") {
    throw new Error("Skysight enabled state must be a boolean.");
  }
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  await runComputerUseCommand(bin, ["skysight", enabled ? "enable" : "disable"]);
  if (enabled) startSkysightRecorder(bin);
  else stopSkysightRecorder();
  return checkComputerUsePermissions();
}

async function setComputerUseSkysightPaused(paused) {
  if (typeof paused !== "boolean") {
    throw new Error("Skysight paused state must be a boolean.");
  }
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  await runComputerUseCommand(bin, ["skysight", paused ? "pause" : "resume"]);
  return checkComputerUsePermissions();
}

async function updateComputerUseSkysightExclusion(operation, scope, value) {
  if (operation !== "add" && operation !== "remove") {
    throw new Error("Skysight exclusion operation must be add or remove.");
  }
  if (scope !== "app" && scope !== "website" && scope !== "private_browsing") {
    throw new Error("Skysight exclusion scope is invalid.");
  }
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  if (scope !== "private_browsing" && !normalizedValue) {
    throw new Error("Skysight app and website exclusions require a value.");
  }
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  const command = ["skysight", "exclude", operation, scope];
  if (normalizedValue) command.push(normalizedValue);
  await runComputerUseCommand(bin, command);
  return checkComputerUsePermissions();
}

async function clearComputerUseSkysightData() {
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  await runComputerUseCommand(bin, ["skysight", "clear"]);
  return { ok: true };
}

async function revokeComputerUseAppAuthorization(bundleIdentifier) {
  if (typeof bundleIdentifier !== "string" || !bundleIdentifier.trim()) {
    throw new Error("A Computer Use bundle identifier is required.");
  }
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  await runComputerUseCommand(bin, [
    "authorization",
    "revoke",
    bundleIdentifier.trim(),
  ]);
  return checkComputerUsePermissions();
}

async function clearComputerUseAppAuthorizations() {
  const bin = resolveComputerUseExecutable();
  if (!bin) {
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  }
  await runComputerUseCommand(bin, ["authorization", "clear"]);
  return checkComputerUsePermissions();
}

async function restoreComputerUseServices() {
  const bin = resolveComputerUseExecutable();
  if (bin) {
    const status = await spawnCheckPermissions(bin);
    if (status.skysight?.enabled === true) startSkysightRecorder(bin);
  }
}

function disposeComputerUseServices() {
  stopSkysightRecorder();
  getAppshot().disposeAppshot();
  if (watchedActivityFile) {
    unwatchFile(watchedActivityFile);
    watchedActivityFile = null;
  }
}

function watchComputerUseAppshots(onAppshot) {
  return getAppshot().watchComputerUseAppshots(onAppshot);
}

function watchComputerUseActivity(onActivity) {
  if (watchedActivityFile) unwatchFile(watchedActivityFile);
  const activityFile = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "OnMyAgent",
    "ComputerUse",
    "activity.json",
  );
  watchedActivityFile = activityFile;
  watchFile(activityFile, { interval: 250 }, (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs || !existsSync(activityFile)) return;
    try {
      const activity = parseComputerUseActivity(
        JSON.parse(readFileSync(activityFile, "utf8")),
      );
      if (activity) onActivity(activity);
    } catch {
      // A writer may still be replacing the atomic state file; the next
      // modification delivers the complete snapshot.
    }
  });
  return () => {
    if (watchedActivityFile === activityFile) watchedActivityFile = null;
    unwatchFile(activityFile);
  };
}

// ─── System permissions ───────────────────────────────────────────────────────

/** @type {"granted"|"denied"|"unknown"|null} */
let automationStatusCache = null;
/** @type {number} */
let automationStatusCacheAt = 0;
const AUTOMATION_CACHE_MS = 15_000;

function mediaStatusToPermission(status) {
  if (status === "granted") return "granted";
  if (status === "denied" || status === "restricted") return "denied";
  // "not-determined" | "unknown" | …
  return "unknown";
}

/**
 * Probe Calendar via osascript. On modern macOS the *parent* (Electron /
 * OnMyAgent) is the Automation client, so -1743 means our app is denied.
 * System Events is avoided (first-party tools often always pass).
 * @returns {"granted"|"denied"|"unknown"}
 */
function probeAutomationPermission() {
  if (process.platform !== "darwin") return "unknown";
  const now = Date.now();
  if (
    automationStatusCache &&
    now - automationStatusCacheAt < AUTOMATION_CACHE_MS
  ) {
    return automationStatusCache;
  }

  try {
    const result = spawnSync(
      "osascript",
      [
        "-e",
        [
          'try',
          '  tell application "Calendar" to get name',
          '  return "granted"',
          "on error errMsg number errNum",
          // -1743 not authorized to send Apple events
          // -600 application not running (still means we could send — treat as unknown)
          '  if errNum is -1743 then',
          '    return "denied"',
          "  else",
          '    return "unknown:" & errNum',
          "  end if",
          "end try",
        ].join("\n"),
      ],
      {
        encoding: "utf8",
        timeout: 8_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const out = String(result.stdout || "").trim();
    const err = String(result.stderr || "").trim();
    if (out === "granted") {
      automationStatusCache = "granted";
    } else if (out === "denied" || /not authorized|-1743/i.test(err)) {
      automationStatusCache = "denied";
    } else if (out.startsWith("unknown:")) {
      // Calendar missing / other AE errors — not a clear deny
      automationStatusCache = "unknown";
    } else if (result.status === 0 && out) {
      automationStatusCache = "granted";
    } else {
      automationStatusCache = "unknown";
    }
  } catch (error) {
    console.warn(
      "[Automation] probe failed:",
      error instanceof Error ? error.message : String(error),
    );
    automationStatusCache = "unknown";
  }
  automationStatusCacheAt = now;
  return automationStatusCache;
}

function checkFullDiskAccess() {
  const protectedDirs = [
    path.join(os.homedir(), "Library", "Mail"),
    path.join(os.homedir(), "Library", "Messages"),
    path.join(os.homedir(), "Library", "Safari"),
  ];
  for (const dir of protectedDirs) {
    try {
      readdirSync(dir);
      return "granted";
    } catch (err) {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") {
        // Directory not present (e.g. Mail never used) — try next.
        continue;
      }
      // EACCES / EPERM / other open-time errors → FDA not granted.
      return "denied";
    }
  }
  // No TCC-protected dirs exist on this machine — cannot conclude denied.
  return "unknown";
}

function checkSystemPermissions() {
  console.log(
    "[checkSystemPermissions] Function called, platform:",
    process.platform,
  );
  const platform = process.platform;

  // Windows / Linux: never fake "granted".
  if (platform !== "darwin") {
    const permissions = {
      "full-disk-access": "unknown",
      accessibility: "unknown",
      automation: "unknown",
      notifications: "unknown",
      "screen-recording": "unknown",
      microphone: "unknown",
    };
    try {
      if (typeof systemPreferences?.getMediaAccessStatus === "function") {
        permissions.microphone = mediaStatusToPermission(
          systemPreferences.getMediaAccessStatus("microphone"),
        );
        try {
          permissions["screen-recording"] = mediaStatusToPermission(
            systemPreferences.getMediaAccessStatus("screen"),
          );
        } catch {
          permissions["screen-recording"] = "unknown";
        }
      }
    } catch (err) {
      console.warn(
        "[checkSystemPermissions] non-darwin media check failed",
        err,
      );
    }
    return {
      platform:
        platform === "win32"
          ? "windows"
          : platform === "linux"
            ? "linux"
            : "unknown",
      permissions,
    };
  }

  const permissions = {
    "full-disk-access": "unknown",
    accessibility: "unknown",
    automation: "unknown",
    notifications: "unknown",
    "screen-recording": "unknown",
    microphone: "unknown",
  };

  try {
    const isAccessible = systemPreferences.isTrustedAccessibilityClient(false);
    permissions.accessibility = isAccessible === true ? "granted" : "denied";
  } catch (err) {
    console.error("[checkSystemPermissions] Accessibility check failed:", err);
    permissions.accessibility = "unknown";
  }

  try {
    permissions["full-disk-access"] = checkFullDiskAccess();
  } catch (err) {
    console.error("[checkSystemPermissions] FDA check failed:", err);
    permissions["full-disk-access"] = "unknown";
  }

  permissions.automation = probeAutomationPermission();

  // Notifications: renderer overlays with Notification.permission (more accurate).
  // Best-effort main-process hint when Electron exposes it.
  try {
    if (typeof systemPreferences?.getNotificationSettings === "function") {
      const ns = systemPreferences.getNotificationSettings();
      // Electron shape varies; treat authorizationStatus if present.
      const status =
        ns?.authorizationStatus ?? ns?.authStatus ?? ns?.status ?? null;
      if (status === "authorized" || status === "provisional") {
        permissions.notifications = "granted";
      } else if (status === "denied") {
        permissions.notifications = "denied";
      } else {
        permissions.notifications = "unknown";
      }
    } else {
      permissions.notifications = "unknown";
    }
  } catch {
    permissions.notifications = "unknown";
  }

  try {
    if (typeof systemPreferences?.getMediaAccessStatus === "function") {
      permissions["screen-recording"] = mediaStatusToPermission(
        systemPreferences.getMediaAccessStatus("screen"),
      );
      permissions.microphone = mediaStatusToPermission(
        systemPreferences.getMediaAccessStatus("microphone"),
      );
    }
  } catch (err) {
    console.warn("[checkSystemPermissions] media status failed", err);
  }

  return {
    platform: "macos",
    permissions,
  };
}

/**
 * macOS Privacy → Automation only lists processes that have already attempted
 * to send Apple Events to another app. Opening the Settings pane alone never
 * adds OnMyAgent. Probe Calendar / Reminders / Notes (not System Events —
 * osascript is a first-party tool already allowed to talk to System Events,
 * which made earlier "status" checks always look granted).
 *
 * On modern macOS the responsible parent (Electron / OnMyAgent) is usually
 * what appears in the Automation list when a child osascript is spawned.
 */
function triggerAutomationPermissionPrompt() {
  if (process.platform !== "darwin") return;
  // Targets match settings.permission_automation_desc copy.
  const probes = [
    'tell application "Calendar" to get name',
    'tell application "Reminders" to get name',
    'tell application "Notes" to get name',
  ];
  for (const source of probes) {
    try {
      const result = spawnSync(
        "osascript",
        ["-e", source],
        {
          encoding: "utf8",
          timeout: 12_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      // -1743 / "not allowed" still registers the parent in Automation.
      if (result.error) {
        console.warn(
          `[Automation] probe failed (${source}):`,
          result.error.message,
        );
        continue;
      }
      const stderr = (result.stderr || "").trim();
      if (stderr) {
        console.log(`[Automation] probe response: ${stderr.slice(0, 200)}`);
      } else {
        console.log(`[Automation] probe ok: ${source}`);
      }
      // One successful registration attempt is enough to open Settings.
      break;
    } catch (error) {
      console.warn(
        `[Automation] probe threw:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

async function openSystemPermissionSettings(type) {
  // Windows: open real settings panes; do not no-op success.
  if (process.platform === "win32") {
    const winUrls = {
      notifications: "ms-settings:notifications",
      microphone: "ms-settings:privacy-microphone",
      // Closest system surface for capture-related privacy.
      "screen-recording": "ms-settings:privacy-graphicscaptureprogrammatic",
    };
    const url = winUrls[type];
    if (!url) {
      return {
        success: false,
        error: `Permission type not applicable on Windows: ${type ?? "(none)"}`,
      };
    }
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  if (process.platform !== "darwin") {
    return {
      success: false,
      error: `Opening system permission settings is not supported on ${process.platform}`,
    };
  }

  // Full Disk Access: touch protected dirs so the app appears in the list.
  if (type === "full-disk-access") {
    try {
      const protectedPaths = [
        path.join(os.homedir(), "Library", "Mail"),
        path.join(os.homedir(), "Library", "Messages"),
        path.join(os.homedir(), "Library", "Safari"),
      ];
      for (const protectedPath of protectedPaths) {
        if (!existsSync(protectedPath)) continue;
        try {
          readdirSync(protectedPath);
        } catch {
          console.log(`[FDA] Triggered request by accessing: ${protectedPath}`);
          break;
        }
      }
    } catch (e) {
      console.warn(`[FDA] Failed to trigger request:`, e.message);
    }
  }

  // Accessibility: prompt via system API.
  if (type === "accessibility") {
    try {
      systemPreferences.isTrustedAccessibilityClient(true);
    } catch (e) {
      console.warn(`[Accessibility] prompt failed:`, e.message);
    }
  }

  // Microphone: system dialog when not determined; skip Settings if already granted.
  if (type === "microphone") {
    try {
      if (typeof systemPreferences?.askForMediaAccess === "function") {
        const granted = await systemPreferences.askForMediaAccess("microphone");
        if (granted === true) {
          return {
            success: true,
            hint: null,
          };
        }
      }
    } catch (e) {
      console.warn(`[Microphone] askForMediaAccess failed:`, e.message);
    }
  }

  // Screen recording: touch desktopCapturer so the app appears in the list,
  // then open Privacy → Screen Recording (no askForMediaAccess for screen).
  if (type === "screen-recording") {
    await getAppshot().primeScreenRecordingPermission();
  }

  // Automation: register in Privacy → Automation list, then re-probe cache.
  if (type === "automation") {
    triggerAutomationPermissionPrompt();
    automationStatusCache = null;
    automationStatusCacheAt = 0;
    try {
      probeAutomationPermission();
    } catch {
      // ignore
    }
  }

  const appName = app.getName();
  const isDevMode = process.defaultApp || app.isPackaged === false;
  const listName = isDevMode ? "Electron" : appName;

  const urlMap = {
    "full-disk-access":
      "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    accessibility:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    automation:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    notifications:
      "x-apple.systempreferences:com.apple.preference.notifications",
    "screen-recording":
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    microphone:
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  };

  const url = urlMap[type];
  if (!url) {
    return { success: false, error: `Unknown permission type: ${type}` };
  }

  try {
    await shell.openExternal(url);
    const listHint = isDevMode
      ? `开发模式提示：系统设置中请找 “Electron”，而不是 “${appName}”。若列表仍没有，请先点系统弹窗里的“好/允许”，再返回本页刷新；也可点左下角锁后用“+”手动添加 Electron。`
      : `若列表中没有 “${listName}”，请先处理系统弹出的授权对话框，再返回本页点刷新。仍没有时可解锁后用“+”手动添加 ${listName}。`;

    const hint =
      type === "full-disk-access" ||
      type === "automation" ||
      type === "accessibility" ||
      type === "screen-recording"
        ? listHint
        : type === "notifications"
          ? "授权系统通知后返回本页点刷新。"
          : type === "microphone"
            ? "在系统弹窗中允许麦克风，或到「隐私与安全性 → 麦克风」中开启，然后返回本页刷新。"
            : null;

    return {
      success: true,
      hint,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function spawnCheckPermissions(bin) {
  return new Promise((resolve) => {
    let stdout = "";
    const child = spawnProcess(bin, ["--status"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", () =>
      resolve({
        ok: false,
        accessibility: false,
        screenRecording: false,
        error: "Failed to run permission check.",
      }),
    );
    child.on("close", () => {
      const parsed = parseComputerUseStatus(stdout);
      if (parsed) {
        resolve(parsed);
      } else {
        resolve({
          ok: false,
          accessibility: false,
          screenRecording: false,
          error: "Permission check returned invalid output.",
        });
      }
    });
  });
}

async function openComputerUseSetupApp() {
  // Windows: no HandsFree setup GUI — open accessibility-related settings.
  if (process.platform === "win32") {
    try {
      await shell.openExternal("ms-settings:easeofaccess-mouse");
    } catch (error) {
      console.warn(
        "[ComputerUse] open Windows settings failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    return;
  }

  // Open the GUI. Use the .app bundle if available so macOS shows it as
  // a real app with its own dock icon and permission identity.
  const appPath = computerUseHelperAppPath();
  if (appPath) {
    const result = await shell.openPath(appPath);
    if (result) console.error("[ComputerUse] shell.openPath error:", result);
    return;
  }

  // Fallback: spawn the raw binary (opens the same GUI).
  const bin = resolveComputerUseExecutable();
  if (!bin)
    throw new Error("Helper binary not found. Run pnpm dev to build it.");
  const child = spawnProcess(bin, [], { detached: true, stdio: "ignore" });
  child.unref();
}


  return {
    getComputerUseMcpCommand,
    checkComputerUsePermissions,
    setComputerUseMcpEnabled,
    setComputerUseSkysightEnabled,
    setComputerUseSkysightPaused,
    updateComputerUseSkysightExclusion,
    clearComputerUseSkysightData,
    captureComputerUseAppshot,
    isComputerUseAppshotSupported,
    sanitizeAppshotFileName,
    revokeComputerUseAppAuthorization,
    clearComputerUseAppAuthorizations,
    restoreComputerUseServices,
    disposeComputerUseServices,
    watchComputerUseActivity,
    watchComputerUseAppshots,
    checkSystemPermissions,
    openSystemPermissionSettings,
    openComputerUseSetupApp,
  };
}
