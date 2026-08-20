/**
 * Desktop e2e helper: spawn pinned/PATH OpenCode serve without a live model.
 * Used by electron/e2e/*.e2e.test.mjs (wired into pnpm test:runtime).
 */
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

import { OPENCODE_BIN_ENV_KEYS } from "../runtime-helpers.mjs";

export const KNOWLEDGE_TOOL_IDS = Object.freeze([
  "knowledge_search",
  "knowledge_read",
  "knowledge_create",
  "knowledge_append",
  "knowledge_property_set",
]);

export const PLUGIN_LOAD_FAILURE_RE =
  /Plugin export is not a function|failed to load plugin/i;

export function isCi() {
  return process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
}

export function resolveOpencodeBin() {
  for (const key of OPENCODE_BIN_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value && existsSync(value)) return value;
  }
  const sidecarRoot = join(dirname(fileURLToPath(import.meta.url)), "../../resources/sidecars");
  const sidecar = [
    join(sidecarRoot, "opencode"),
    join(sidecarRoot, "opencode-aarch64-apple-darwin"),
    join(sidecarRoot, "opencode-x64-osx"),
    join(sidecarRoot, "opencode.exe"),
  ].find((candidate) => existsSync(candidate));
  if (sidecar) return sidecar;
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const probed = spawnSync(whichCmd, ["opencode"], { encoding: "utf8" });
  const candidate = String(probed.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && existsSync(line));
  return candidate || null;
}

export async function findFreePort() {
  const server = net.createServer();
  server.unref();
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("Failed to allocate a free port");
  }
  const port = addr.port;
  server.close();
  return port;
}

/**
 * @param {{
 *   bin: string,
 *   cwd: string,
 *   env: NodeJS.ProcessEnv,
 *   hostname?: string,
 *   port: number,
 * }} input
 */
export function spawnOpencodeServe(input) {
  const hostname = input.hostname ?? "127.0.0.1";
  const child = spawn(
    input.bin,
    ["serve", "--hostname", hostname, "--port", String(input.port), "--cors", "*"],
    {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...input.env,
        OPENCODE_CLIENT: input.env.OPENCODE_CLIENT || "onmyagent-desktop-e2e",
      },
    },
  );

  let stderr = "";
  let stdout = "";
  let spawnError = null;
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  child.on("error", (error) => {
    spawnError = error;
  });

  async function waitForExit(ms) {
    return Promise.race([
      once(child, "exit").then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), ms)),
    ]);
  }

  return {
    baseUrl: `http://${hostname}:${input.port}`,
    child,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      if (await waitForExit(2500)) return;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      await waitForExit(2500);
    },
    getOutput() {
      const parts = [];
      if (spawnError) parts.push(`spawn error: ${spawnError.message}`);
      if (child.exitCode !== null || child.signalCode !== null) {
        parts.push(`process exited code=${child.exitCode} signal=${child.signalCode}`);
      }
      if (stdout.trim()) parts.push(`stdout:\n${stdout.trim()}`);
      if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`);
      return parts.join("\n");
    },
    getStderr() {
      return stderr;
    },
    isAlive() {
      return child.exitCode === null && child.signalCode === null && !spawnError;
    },
  };
}

/**
 * @param {string} baseUrl
 * @param {string} pathname
 * @param {{
 *   directory?: string,
 *   timeoutMs?: number,
 *   method?: string,
 *   query?: Record<string, string | number | undefined>,
 *   body?: unknown,
 * }} [opts]
 */
let directoryRequestTail = Promise.resolve();

export async function requestOpencodeJson(baseUrl, pathname, opts = {}) {
  if (opts.directory) {
    const previous = directoryRequestTail;
    let release = () => {};
    directoryRequestTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await requestOpencodeJsonUnlocked(baseUrl, pathname, opts);
    } finally {
      release();
    }
  }
  return requestOpencodeJsonUnlocked(baseUrl, pathname, opts);
}

async function requestOpencodeJsonUnlocked(baseUrl, pathname, opts = {}) {
  const url = new URL(pathname, baseUrl);
  if (opts.directory) url.searchParams.set("directory", opts.directory);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  const headers = new Headers({ Accept: "application/json" });
  if (opts.directory) headers.set("x-opencode-directory", opts.directory);
  const method = (opts.method ?? "GET").toUpperCase();
  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
  };
  if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(opts.body);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

/**
 * @param {string} baseUrl
 * @param {string} pathname
 * @param {{ directory?: string, timeoutMs?: number, query?: Record<string, string | number | undefined> }} [opts]
 */
export async function fetchOpencodeJson(baseUrl, pathname, opts = {}) {
  return requestOpencodeJson(baseUrl, pathname, opts);
}

/**
 * @param {ReturnType<typeof spawnOpencodeServe>} server
 * @param {{ timeoutMs?: number, pollMs?: number }} [opts]
 */
export async function waitForHealthy(server, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? (isCi() ? 45_000 : 20_000);
  const pollMs = opts.pollMs ?? 250;
  const start = Date.now();
  let lastError = "";
  while (Date.now() - start < timeoutMs) {
    if (!server.isAlive()) {
      throw new Error(`OpenCode exited before healthy: ${server.getOutput()}`);
    }
    try {
      const health = await fetchOpencodeJson(server.baseUrl, "/global/health");
      if (health.ok && health.body && health.body.healthy === true) {
        return health.body;
      }
      lastError = `status=${health.status} body=${JSON.stringify(health.body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(
    `Timed out waiting for /global/health (${lastError}); process: ${server.getOutput()}`,
  );
}
