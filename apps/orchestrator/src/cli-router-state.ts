/**
 * Orchestrator router state + daemon spawn/request helpers.
 * Extracted from cli-shared.ts (mechanical split; re-exported for compat).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  type ParsedArgs,
  readBool,
  readFlag,
  readNumber,
} from "./cli-args.js";
import { resolveRouterDataDir } from "./data-dir.js";
import { fetchJson } from "./cli-http-output.js";
import { resolveOpencodeLogLevel } from "./cli-version.js";
import type { RouterState, RouterWorkspace } from "./cli-types.js";
import { resolvePort } from "./cli-network.js";
import {
  assertManagedOpencodeAuth,
  resolveManagedOpencodeCredentials,
  resolveManagedOpencodeHost,
} from "./runtime-auth.js";
import { waitForRouterHealthy } from "./runtime-health.js";
import { spawnProcess } from "./runtime-services.js";
import { isProcessAlive, resolveSelfCommand } from "./runtime-spawn.js";

export function routerStatePath(dataDir: string): string {
  return join(dataDir, "onmyagent-orchestrator-state.json");
}

export function nowMs(): number {
  return Date.now();
}

export async function loadRouterState(path: string): Promise<RouterState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as RouterState;
    if (!parsed.workspaces) parsed.workspaces = [];
    if (!parsed.activeId) parsed.activeId = "";
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch {
    return {
      version: 1,
      daemon: undefined,
      opencode: undefined,
      cliVersion: undefined,
      sidecar: undefined,
      binaries: undefined,
      activeId: "",
      workspaces: [],
    };
  }
}

export async function saveRouterState(
  path: string,
  state: RouterState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = JSON.stringify(state, null, 2);
  await writeFile(path, `${payload}\n`, "utf8");
}

export function normalizeWorkspacePath(input: string): string {
  return resolve(input).replace(/[\\/]+$/, "");
}

export function workspaceIdForLocal(path: string): string {
  return `ws-${createHash("sha1").update(path).digest("hex").slice(0, 12)}`;
}

export function workspaceIdForRemote(
  baseUrl: string,
  directory?: string | null,
): string {
  const key = directory ? `${baseUrl}::${directory}` : baseUrl;
  return `ws-${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

// OpenCode router tool sources (extracted module; re-exported for compat).
export {
  opencodeRouterSendToolSource,
  opencodeRouterStatusToolSource,
  ensureOpencodeManagedTools,
} from "./cli-router-tools.js";

export function findWorkspace(
  state: RouterState,
  input: string,
): RouterWorkspace | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const direct = state.workspaces.find(
    (entry) => entry.id === trimmed || entry.name === trimmed,
  );
  if (direct) return direct;
  const normalized = normalizeWorkspacePath(trimmed);
  return state.workspaces.find(
    (entry) => entry.path && normalizeWorkspacePath(entry.path) === normalized,
  );
}

export async function spawnRouterDaemon(
  args: ParsedArgs,
  dataDir: string,
  host: string,
  port: number,
) {
  const self = resolveSelfCommand();
  const commandArgs = [
    ...self.prefixArgs,
    "daemon",
    "run",
    "--data-dir",
    dataDir,
    "--daemon-host",
    host,
    "--daemon-port",
    String(port),
  ];

  const opencodeBin =
    readFlag(args.flags, "opencode-bin") ?? process.env.ONMYAGENT_OPENCODE_BIN;
  assertManagedOpencodeAuth(args);
  const opencodeHost = resolveManagedOpencodeHost(
    readFlag(args.flags, "opencode-host") ?? process.env.ONMYAGENT_OPENCODE_HOST,
  );
  const opencodePort =
    readFlag(args.flags, "opencode-port") ?? process.env.ONMYAGENT_OPENCODE_PORT;
  const opencodeWorkdir =
    readFlag(args.flags, "opencode-workdir") ??
    process.env.ONMYAGENT_OPENCODE_WORKDIR;
  const opencodeLogLevel = resolveOpencodeLogLevel(
    readFlag(args.flags, "opencode-log-level") ??
      process.env.ONMYAGENT_OPENCODE_LOG_LEVEL,
  );
  const opencodeHotReload =
    readFlag(args.flags, "opencode-hot-reload") ??
    process.env.ONMYAGENT_OPENCODE_HOT_RELOAD;
  const opencodeHotReloadDebounceMs =
    readFlag(args.flags, "opencode-hot-reload-debounce-ms") ??
    process.env.ONMYAGENT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS;
  const opencodeHotReloadCooldownMs =
    readFlag(args.flags, "opencode-hot-reload-cooldown-ms") ??
    process.env.ONMYAGENT_OPENCODE_HOT_RELOAD_COOLDOWN_MS;
  const opencodeCredentials = resolveManagedOpencodeCredentials(args);
  const opencodeUsername = opencodeCredentials.username;
  const opencodePassword = opencodeCredentials.password;
  const corsValue =
    readFlag(args.flags, "cors") ?? process.env.ONMYAGENT_OPENCODE_CORS;
  const allowExternal = readBool(
    args.flags,
    "allow-external",
    false,
    "ONMYAGENT_ALLOW_EXTERNAL",
  );
  const sidecarSource =
    readFlag(args.flags, "sidecar-source") ??
    process.env.ONMYAGENT_SIDECAR_SOURCE;
  const opencodeSource =
    readFlag(args.flags, "opencode-source") ??
    process.env.ONMYAGENT_OPENCODE_SOURCE;
  const verbose = readBool(args.flags, "verbose", false, "ONMYAGENT_VERBOSE");
  const logFormat =
    readFlag(args.flags, "log-format") ?? process.env.ONMYAGENT_LOG_FORMAT;
  const runId = readFlag(args.flags, "run-id") ?? process.env.ONMYAGENT_RUN_ID;

  if (opencodeBin) commandArgs.push("--opencode-bin", opencodeBin);
  if (opencodeHost) commandArgs.push("--opencode-host", opencodeHost);
  if (opencodePort) commandArgs.push("--opencode-port", String(opencodePort));
  if (opencodeWorkdir) commandArgs.push("--opencode-workdir", opencodeWorkdir);
  if (opencodeLogLevel)
    commandArgs.push("--opencode-log-level", opencodeLogLevel);
  if (opencodeHotReload)
    commandArgs.push("--opencode-hot-reload", opencodeHotReload);
  if (opencodeHotReloadDebounceMs)
    commandArgs.push(
      "--opencode-hot-reload-debounce-ms",
      String(opencodeHotReloadDebounceMs),
    );
  if (opencodeHotReloadCooldownMs)
    commandArgs.push(
      "--opencode-hot-reload-cooldown-ms",
      String(opencodeHotReloadCooldownMs),
    );
  if (corsValue) commandArgs.push("--cors", corsValue);
  if (allowExternal) commandArgs.push("--allow-external");
  if (sidecarSource) commandArgs.push("--sidecar-source", sidecarSource);
  if (opencodeSource) commandArgs.push("--opencode-source", opencodeSource);
  if (verbose) commandArgs.push("--verbose");
  if (logFormat) commandArgs.push("--log-format", String(logFormat));
  if (runId) commandArgs.push("--run-id", String(runId));

  const child = spawnProcess(self.command, commandArgs, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ONMYAGENT_OPENCODE_USERNAME: opencodeUsername,
      ONMYAGENT_OPENCODE_PASSWORD: opencodePassword,
    },
  });
  child.unref();
}

export async function ensureRouterDaemon(
  args: ParsedArgs,
  autoStart = true,
): Promise<{ baseUrl: string; dataDir: string }> {
  const dataDir = resolveRouterDataDir(args.flags, readFlag);
  const statePath = routerStatePath(dataDir);
  const state = await loadRouterState(statePath);
  const existing = state.daemon;
  if (existing && existing.baseUrl && isProcessAlive(existing.pid)) {
    try {
      await waitForRouterHealthy(existing.baseUrl, 1500, 150);
      return { baseUrl: existing.baseUrl, dataDir };
    } catch {
      // fallthrough
    }
  }

  if (!autoStart) {
    throw new Error("orchestrator daemon is not running");
  }

  const host = readFlag(args.flags, "daemon-host") ?? "127.0.0.1";
  const port = await resolvePort(
    readNumber(args.flags, "daemon-port", undefined, "ONMYAGENT_DAEMON_PORT"),
    "127.0.0.1",
  );
  const baseUrl = `http://${host}:${port}`;
  await spawnRouterDaemon(args, dataDir, host, port);
  await waitForRouterHealthy(baseUrl, 10_000, 250);
  return { baseUrl, dataDir };
}

export async function requestRouter(
  args: ParsedArgs,
  method: string,
  path: string,
  body?: unknown,
  autoStart = true,
) {
  const { baseUrl } = await ensureRouterDaemon(args, autoStart);
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  return fetchJson(url, {
    method,
    headers,
    body: payload,
  });
}
