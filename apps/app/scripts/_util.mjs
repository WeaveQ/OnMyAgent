import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { realpathSync, statSync } from "node:fs";

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const DEFAULT_HEALTH_TIMEOUT_MS = isCi ? 45_000 : 15_000;
const HEALTH_ATTEMPT_TIMEOUT_MS = 2_500;

function resolveBasicAuthHeader() {
  const password = process.env.OPENCODE_SERVER_PASSWORD?.trim() ?? "";
  if (!password) return undefined;
  const username = process.env.OPENCODE_SERVER_USERNAME?.trim() || "opencode";
  const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

export function makeClient({ baseUrl, directory }) {
  const authorization = resolveBasicAuthHeader();
  return createOpencodeClient({
    baseUrl,
    directory,
    headers: authorization ? { Authorization: authorization } : undefined,
    responseStyle: "data",
    throwOnError: true,
  });
}

export async function findFreePort() {
  const server = net.createServer();
  server.unref();

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();

  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("Failed to allocate a free port");
  }

  const port = addr.port;
  server.close();
  return port;
}

export async function spawnOpencodeServe({
  directory,
  hostname = "127.0.0.1",
  port,
  corsOrigins = [],
}) {
  assert.ok(directory && directory.trim(), "directory is required");
  assert.ok(Number.isInteger(port) && port > 0, "port must be a positive integer");

  const cwd = realpathSync(directory);
  const bin = process.env.OPENCODE_BIN?.trim() || "opencode";
  const args = ["serve", "--hostname", hostname, "--port", String(port)];
  for (const origin of corsOrigins) {
    args.push("--cors", origin);
  }

  const child = spawn(bin, args, {
    cwd,
    // Capture both streams so early failures are visible in CI logs.
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // Make it explicit we're a non-TUI client.
      OPENCODE_CLIENT: "onmyagent-test",
    },
  });

  const baseUrl = `http://${hostname}:${port}`;

  let stderr = "";
  let stdout = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });

  let spawnError = null;
  child.on("error", (error) => {
    spawnError = error;
  });

  async function waitForExit(ms) {
    return Promise.race([
      once(child, "exit").then(() => true),
      new Promise((r) => setTimeout(() => r(false), ms)),
    ]);
  }

  return {
    cwd,
    baseUrl,
    child,
    bin,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }

      const exited = await waitForExit(2500);
      if (exited) {
        return;
      }

      // Force kill.
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }

      await waitForExit(2500);
    },
    getStderr() {
      const parts = [];
      if (spawnError) {
        parts.push(`spawn error: ${spawnError.message}`);
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        parts.push(
          `process exited code=${child.exitCode} signal=${child.signalCode}`,
        );
      }
      if (stdout.trim()) {
        parts.push(`stdout:\n${stdout.trim()}`);
      }
      if (stderr.trim()) {
        parts.push(`stderr:\n${stderr.trim()}`);
      }
      return parts.join("\n");
    },
    isAlive() {
      return child.exitCode === null && child.signalCode === null && !spawnError;
    },
  };
}

export async function waitForHealthy(
  client,
  { timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS, pollMs = 250, server } = {},
) {
  const start = Date.now();
  let lastError;

  while (Date.now() - start < timeoutMs) {
    if (server && typeof server.isAlive === "function" && !server.isAlive()) {
      const detail = typeof server.getStderr === "function" ? server.getStderr() : "";
      throw new Error(
        `OpenCode process exited before becoming healthy${detail ? `: ${detail}` : ""}`,
      );
    }

    try {
      const health = await withTimeout(
        client.global.health(),
        HEALTH_ATTEMPT_TIMEOUT_MS,
        "health check",
      );
      assert.equal(health.healthy, true);
      assert.ok(typeof health.version === "string");
      return health;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  const detail =
    server && typeof server.getStderr === "function" && server.getStderr()
      ? `; process: ${server.getStderr()}`
      : "";
  throw new Error(`Timed out waiting for /global/health: ${msg}${detail}`);
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  if (typeof raw.type === "string") {
    return { type: raw.type, properties: raw.properties };
  }

  if (raw.payload && typeof raw.payload === "object" && typeof raw.payload.type === "string") {
    return { type: raw.payload.type, properties: raw.payload.properties };
  }

  return null;
}

export function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    args.set(key, value);
  }
  return args;
}

export function canWriteWorkspace(directory) {
  try {
    const stat = statSync(directory);
    return stat && stat.isDirectory();
  } catch {
    return false;
  }
}
