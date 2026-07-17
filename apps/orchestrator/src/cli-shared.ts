import {
  type ChildProcess,
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  access,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { homedir, hostname, networkInterfaces, platform, tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { once } from "node:events";

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  parseArgs,
  parseList,
  readBinarySource,
  readBool,
  readFlag,
  readLogFormat,
  readNumber,
  readOpencodeHotReload,
  readOptionalBool,
  readSandboxMode,
  type BinarySourcePreference,
  type LogFormat,
  type OpencodeHotReload,
  type ParsedArgs,
  type SandboxMode,
} from "./cli-args.js";
import { resolveRouterDataDir } from "./data-dir.js";
import { opencodeBrowserNodeReplToolSource } from "./browser-tool-source.js";
import { loadUserEnvFile } from "./env-paths.js";
import {
  assertManagedOpencodeAuth,
  encodeBasicAuth,
  isLoopbackHost,
  resolveManagedOpencodeCredentials,
  resolveManagedOpencodeHost,
} from "./runtime-auth.js";
import {
  fetchOpenCodeRouterHealth,
  fetchOpenCodeRouterHealthViaOnMyAgent,
  waitForHealthy,
  waitForHealthyViaProxy,
  waitForOpenCodeRouterHealthy,
  waitForOpenCodeRouterHealthyViaOnMyAgent,
  waitForOpencodeHealthy,
  waitForRouterHealthy,
  type OpenCodeRouterHealthSnapshot,
} from "./runtime-health.js";
import {
  mergeResourceAttributes,
  prefixStream,
  resolveBinCommand,
  spawnProcess,
  startOpenCodeRouter,
  startOpencode,
  startOnMyAgentServer,
  stopChild,
} from "./runtime-services.js";
import {
  addEnvPassThroughArgs,
  ensureAppleContainerSystemReady,
  isExecutable,
  probeCommand,
  resolveDockerCommand,
  resolveSandboxMode,
  sandboxEnvPassThroughNames,
  shQuote,
  stopAppleContainer,
  stopDockerContainer,
  type ResolvedSandboxMode,
} from "./runtime-sandbox.js";
import {
  resolveSandboxSidecarTarget,
  resolveSidecarConfig,
  resolveSidecarConfigForTarget,
  resolveSidecarTarget,
  type SidecarConfig,
  type SidecarTarget,
} from "./sidecar-config.js";
import {
  resolveHostOpencodeGlobalConfigDir,
  resolveHostOpencodeGlobalDataDir,
  resolveSandboxExtraMounts,
  type SandboxMount,
} from "./sandbox-mounts.js";
import type { TuiHandle } from "./tui/app.js";
import {
  readVersionManifest,
  type VersionInfo,
  type VersionManifest,
} from "./version-manifest.js";

import {
  type LogAttributes,
  type LogEvent,
  type LogLevel,
  type Logger,
  type LoggerChild,
} from "./cli-logging.js";
import { ensureExecutable } from "./cli-binary-resolve.js";

export type ApprovalMode = "manual" | "auto";

export const FALLBACK_VERSION = "0.1.0";

declare const __ONMYAGENT_ORCHESTRATOR_VERSION__: string | undefined;
declare const __ONMYAGENT_PINNED_OPENCODE_VERSION__: string | undefined;
export const DEFAULT_ONMYAGENT_PORT = 8787;
export const DEFAULT_APPROVAL_TIMEOUT = 30000;
export const DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS = 700;
export const DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS = 1500;
export const DEFAULT_ACTIVITY_WINDOW_MS = 5 * 60_000;
export const DEFAULT_ACTIVITY_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export const SANDBOX_INTERNAL_OPENCODE_PORT = 4096;
export const SANDBOX_INTERNAL_ONMYAGENT_PORT = DEFAULT_ONMYAGENT_PORT;
// OpenCodeRouter defaults its health server to 3005 when not overridden. In sandbox
// mode we keep the *internal* port stable and only vary the published host
// port to avoid collisions.
export const SANDBOX_INTERNAL_OPENCODE_ROUTER_HEALTH_PORT = 3005;
export const ONMYAGENT_DEV_DATA_DIR = "onmyagent-dev-data";

export const SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH =
  "/persist/.config/opencode";
export const SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH =
  "/persist/.onmyagent-host-opencode-data";
export const CLI_SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
export const ORCHESTRATOR_ROOT_DIR = resolve(CLI_SOURCE_DIR, "..");
export const REPO_ROOT_DIR = resolve(ORCHESTRATOR_ROOT_DIR, "..", "..");

export type ChildHandle = {
  name: string;
  child: ChildProcess;
};

export type SidecarName = "onmyagent-server" | "opencode-router" | "opencode";

export type RemoteSidecarAsset = {
  asset?: string;
  url?: string;
  sha256?: string;
  size?: number;
};

export type RemoteSidecarEntry = {
  version: string;
  targets: Record<string, RemoteSidecarAsset>;
};

export type RemoteSidecarManifest = {
  version: string;
  generatedAt?: string;
  entries: Record<string, RemoteSidecarEntry>;
};

export type BinarySource = "bundled" | "external" | "downloaded";

export type ResolvedBinary = {
  bin: string;
  source: BinarySource;
  expectedVersion?: string;
};

export type BinaryDiagnostics = {
  path: string;
  source: BinarySource;
  expectedVersion?: string;
  actualVersion?: string;
};

export type RuntimeServiceName = "onmyagent-server" | "opencode" | "opencode-router";

export type RuntimeServiceSnapshot = {
  name: RuntimeServiceName;
  enabled: boolean;
  running: boolean;
  source?: BinarySource;
  path?: string;
  targetVersion?: string;
  actualVersion?: string;
  upgradeAvailable: boolean;
};

export type RuntimeUpgradeState = {
  status: "idle" | "running" | "failed";
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  operationId: string | null;
  services: RuntimeServiceName[];
};

export type SidecarDiagnostics = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
  source: BinarySourcePreference;
  opencodeSource: BinarySourcePreference;
  allowExternal: boolean;
};

export type WorkerActivityHeartbeatConfig = {
  enabled: boolean;
  workerId: string;
  url: string;
  token: string;
  intervalMs: number;
  activeWindowMs: number;
};

export type RouterWorkspaceType = "local" | "remote";

export type RouterWorkspace = {
  id: string;
  name: string;
  path: string;
  workspaceType: RouterWorkspaceType;
  baseUrl?: string;
  directory?: string;
  createdAt: number;
  lastUsedAt?: number;
};

export type RouterDaemonState = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: number;
};

export type RouterOpencodeState = {
  pid: number;
  port: number;
  baseUrl: string;
  startedAt: number;
};

export type RouterBinaryInfo = {
  path: string;
  source: BinarySource;
  expectedVersion?: string;
  actualVersion?: string;
};

export type RouterBinaryState = {
  opencode?: RouterBinaryInfo;
};

export type RouterSidecarState = {
  dir: string;
  baseUrl: string;
  manifestUrl: string;
  target: SidecarTarget | null;
  source: BinarySourcePreference;
  opencodeSource: BinarySourcePreference;
  allowExternal: boolean;
};

export type RouterState = {
  version: number;
  daemon?: RouterDaemonState;
  opencode?: RouterOpencodeState;
  cliVersion?: string;
  sidecar?: RouterSidecarState;
  binaries?: RouterBinaryState;
  activeId: string;
  workspaces: RouterWorkspace[];
};

export type OpencodeStateLayout = {
  devMode: boolean;
  rootDir: string;
  configDir: string;
  env: NodeJS.ProcessEnv;
  importConfigDir?: string;
  importDataDir?: string;
};

export type FieldsResult<T> = {
  data?: T;
  error?: unknown;
  request?: Request;
  response?: Response;
};


export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function resolveCliVersion(): Promise<string> {
  if (
    typeof __ONMYAGENT_ORCHESTRATOR_VERSION__ === "string" &&
    __ONMYAGENT_ORCHESTRATOR_VERSION__.trim()
  ) {
    return __ONMYAGENT_ORCHESTRATOR_VERSION__.trim();
  }
  const candidates = [
    join(dirname(process.execPath), "..", "package.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      try {
        const raw = await readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        if (parsed.version) return parsed.version;
      } catch {
        // ignore
      }
    }
  }

  return FALLBACK_VERSION;
}

export async function readPinnedOpencodeVersion(): Promise<string | undefined> {
  if (
    typeof __ONMYAGENT_PINNED_OPENCODE_VERSION__ === "string" &&
    __ONMYAGENT_PINNED_OPENCODE_VERSION__.trim()
  ) {
    return __ONMYAGENT_PINNED_OPENCODE_VERSION__.trim();
  }

  const candidates = [
    join(dirname(process.execPath), "..", "constants.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "constants.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "constants.json"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      try {
        const raw = await readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as { opencodeVersion?: unknown };
        const value =
          typeof parsed.opencodeVersion === "string"
            ? parsed.opencodeVersion.trim()
            : "";
        if (!value) continue;
        return value.startsWith("v") ? value.slice(1) : value;
      } catch {
        // ignore
      }
    }
  }

  return undefined;
}


export async function resolveLocalOpencodeBin(): Promise<string | undefined> {
  const binaryName = platform() === "win32" ? "opencode.exe" : "opencode";
  const candidates = [
    process.env.OPENCODE_BIN?.trim(),
    process.env.ONMYAGENT_OPENCODE_BIN?.trim(),
    process.env.ONMYAGENT_LOCAL_OPENCODE_BIN?.trim(),
    ...String(process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((entry) => join(entry, binaryName)),
  ];

  if (platform() !== "win32") {
    candidates.push(
      join(homedir(), ".opencode", "bin", "opencode"),
      "/opt/homebrew/bin/opencode",
      "/usr/local/bin/opencode",
      "/usr/bin/opencode",
    );
  }

  const uniqueCandidates = [...new Set(candidates)].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0,
  );
  for (const candidate of uniqueCandidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

export async function resolveLocalOpencodeConfigDir(): Promise<string | undefined> {
  const explicit = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (explicit) return explicit;

  const candidates = [
    join(homedir(), ".config", "opencode"),
    process.env.XDG_CONFIG_HOME?.trim()
      ? join(process.env.XDG_CONFIG_HOME.trim(), "opencode")
      : undefined,
  ].filter(Boolean) as string[];

  for (const candidate of [...new Set(candidates)]) {
    if (
      (await fileExists(join(candidate, "opencode.json"))) ||
      (await fileExists(join(candidate, "opencode.jsonc")))
    ) {
      return candidate;
    }
  }
  return undefined;
}


export async function ensureWorkspace(workspace: string): Promise<string> {
  const resolved = resolve(workspace);
  await mkdir(resolved, { recursive: true });

  const configPathJsonc = join(resolved, "opencode.jsonc");
  const configPathJson = join(resolved, "opencode.json");
  const hasJsonc = await fileExists(configPathJsonc);
  const hasJson = await fileExists(configPathJson);

  if (!hasJsonc && !hasJson) {
    const payload = JSON.stringify(
      { $schema: "https://opencode.ai/config.json" },
      null,
      2,
    );
    await writeFile(configPathJsonc, `${payload}\n`, "utf8");
  }

  return resolved;
}

export async function canBind(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => {
      server.close();
      resolve(false);
    });
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", (err) => reject(err));
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate free port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

export async function resolvePort(
  preferred: number | undefined,
  host: string,
  fallback?: number,
): Promise<number> {
  if (preferred && (await canBind(host, preferred))) {
    return preferred;
  }
  if (fallback && fallback !== preferred && (await canBind(host, fallback))) {
    return fallback;
  }
  return findFreePort(host);
}

export function isCompiledBunBinary(): boolean {
  try {
    const entryPath = fileURLToPath(import.meta.url);
    return entryPath.startsWith("/$bunfs/");
  } catch {
    return false;
  }
}

export function resolveLanIp(): string | null {
  const interfaces = networkInterfaces();
  for (const key of Object.keys(interfaces)) {
    const entries = interfaces[key];
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      return entry.address;
    }
  }
  return null;
}

export function resolveConnectUrl(
  port: number,
  overrideHost?: string,
): { connectUrl?: string; lanUrl?: string; mdnsUrl?: string } {
  if (overrideHost) {
    const trimmed = overrideHost.trim();
    if (trimmed) {
      const url = `http://${trimmed}:${port}`;
      return { connectUrl: url, lanUrl: url };
    }
  }

  const host = hostname().trim();
  const mdnsUrl = host
    ? `http://${host.replace(/\.local$/, "")}.local:${port}`
    : undefined;
  const lanIp = resolveLanIp();
  const lanUrl = lanIp ? `http://${lanIp}:${port}` : undefined;
  const connectUrl = lanUrl ?? mdnsUrl;
  return { connectUrl, lanUrl, mdnsUrl };
}

export const OPENCODE_LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

export function resolveOpencodeLogLevel(requested?: string): string | undefined {
  const trimmed = requested?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.toUpperCase();
  if (!(OPENCODE_LOG_LEVELS as readonly string[]).includes(normalized)) {
    throw new Error(
      `Unsupported --opencode-log-level value: ${requested}. Expected one of: ${OPENCODE_LOG_LEVELS.join(", ")}.`,
    );
  }
  return normalized;
}

export function resolveOnMyAgentRemoteAccess(args: ParsedArgs): boolean {
  const explicitHost =
    readFlag(args.flags, "onmyagent-host") ?? process.env.ONMYAGENT_HOST;
  const remoteAccessRequested =
    readBool(args.flags, "remote-access", false, "ONMYAGENT_REMOTE_ACCESS") ||
    explicitHost?.trim() === "0.0.0.0";

  if (explicitHost) {
    const normalized = explicitHost.trim();
    if (!normalized) return remoteAccessRequested;
    if (normalized === "0.0.0.0") return true;
    if (!isLoopbackHost(normalized)) {
      throw new Error(
        `Unsupported --onmyagent-host value: ${normalized}. Use loopback by default or --remote-access for shared access.`,
      );
    }
  }

  return remoteAccessRequested;
}

export function unwrap<T>(result: FieldsResult<T>): T {
  if (result.data !== undefined) {
    return result.data;
  }
  const message =
    result.error instanceof Error
      ? result.error.message
      : typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error);
  throw new Error(message || "Unknown error");
}

export function parsePositiveNumberEnv(
  value: string | undefined,
  fallback: number,
): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function parseSessionActivityAt(session: unknown): number | null {
  if (!session || typeof session !== "object") return null;
  const record = session as {
    time?: { updated?: number; created?: number };
  };
  const updated = record.time?.updated;
  if (typeof updated === "number" && Number.isFinite(updated) && updated > 0) {
    return updated;
  }
  const created = record.time?.created;
  if (typeof created === "number" && Number.isFinite(created) && created > 0) {
    return created;
  }
  return null;
}

export function resolveWorkerActivityHeartbeatConfig(): WorkerActivityHeartbeatConfig {
  const enabled = (process.env.DEN_ACTIVITY_HEARTBEAT_ENABLED ?? "")
    .trim()
    .toLowerCase();
  const provider = (process.env.DEN_RUNTIME_PROVIDER ?? "").trim().toLowerCase();
  const workerId = (process.env.DEN_WORKER_ID ?? "").trim();
  const url = (process.env.DEN_ACTIVITY_HEARTBEAT_URL ?? "").trim();
  const token = (process.env.DEN_ACTIVITY_HEARTBEAT_TOKEN ?? "").trim();

  const featureEnabled =
    enabled === "1" || enabled === "true" || enabled === "yes";

  if (!featureEnabled || provider !== "daytona" || !workerId || !url || !token) {
    return {
      enabled: false,
      workerId: "",
      url: "",
      token: "",
      intervalMs: DEFAULT_ACTIVITY_HEARTBEAT_INTERVAL_MS,
      activeWindowMs: DEFAULT_ACTIVITY_WINDOW_MS,
    };
  }

  const intervalSeconds = parsePositiveNumberEnv(
    process.env.DEN_ACTIVITY_HEARTBEAT_INTERVAL_SECONDS,
    DEFAULT_ACTIVITY_HEARTBEAT_INTERVAL_MS / 1000,
  );
  const activeWindowSeconds = parsePositiveNumberEnv(
    process.env.DEN_ACTIVITY_WINDOW_SECONDS,
    DEFAULT_ACTIVITY_WINDOW_MS / 1000,
  );

  return {
    enabled: true,
    workerId,
    url,
    token,
    intervalMs: Math.round(intervalSeconds * 1000),
    activeWindowMs: Math.round(activeWindowSeconds * 1000),
  };
}

export async function postWorkerActivityHeartbeat(input: {
  config: WorkerActivityHeartbeatConfig;
  opencodeClient: ReturnType<typeof createOpencodeClient>;
  logger: Logger;
}) {
  if (!input.config.enabled) return;

  const sessions = unwrap(await input.opencodeClient.session.list({ limit: 200 }));
  let latestActivityAt = 0;
  for (const session of sessions) {
    const ts = parseSessionActivityAt(session);
    if (ts && ts > latestActivityAt) {
      latestActivityAt = ts;
    }
  }

  const now = Date.now();
  const isActiveRecently =
    latestActivityAt > 0 && now - latestActivityAt <= input.config.activeWindowMs;

  const payload = {
    sentAt: new Date(now).toISOString(),
    isActiveRecently,
    lastActivityAt:
      latestActivityAt > 0 ? new Date(latestActivityAt).toISOString() : null,
    openSessionCount: sessions.length,
  };

  const response = await fetch(input.config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.config.token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`heartbeat_failed:${response.status}`);
  }

  input.logger.debug(
    "Worker activity heartbeat sent",
    {
      workerId: input.config.workerId,
      isActiveRecently,
      lastActivityAt: payload.lastActivityAt,
      openSessionCount: payload.openSessionCount,
    },
    "onmyagent-orchestrator",
  );
}

export async function runCommand(
  command: string,
  args: string[],
  cwd?: string,
): Promise<void> {
  const child = spawnProcess(command, args, { cwd, stdio: "inherit" });
  const result = await Promise.race([
    once(child, "exit").then(([code]) => ({ type: "exit" as const, code })),
    once(child, "error").then(([error]) => ({ type: "error" as const, error })),
  ]);
  if (result.type === "error") {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}: ${String(result.error)}`,
    );
  }
  if (result.code !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}


export async function readPackageVersion(path: string): Promise<string | undefined> {
  try {
    const payload = await readFile(path, "utf8");
    const parsed = JSON.parse(payload) as { version?: string };
    if (typeof parsed.version === "string") return parsed.version;
    return undefined;
  } catch {
    return undefined;
  }
}

export async function resolveExpectedVersion(
  manifest: VersionManifest | null,
  name: SidecarName,
): Promise<string | undefined> {
  if (name !== "opencode") {
    const manifestVersion = manifest?.entries[name]?.version;
    if (manifestVersion) return manifestVersion;
  }

  try {
    const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
    if (name === "onmyagent-server") {
      const localPath = join(root, "..", "server", "package.json");
      const localVersion = await readPackageVersion(localPath);
      if (localVersion) return localVersion;
    }
    if (name === "opencode") {
      const pinnedVersion = await readPinnedOpencodeVersion();
      if (pinnedVersion) return pinnedVersion;
    }
  } catch {
    // ignore
  }

  const require = createRequire(import.meta.url);
  if (name === "onmyagent-server") {
    try {
      const pkgPath = require.resolve("onmyagent-server/package.json");
      const version = await readPackageVersion(pkgPath);
      if (version) return version;
    } catch {
      // ignore
    }
  }
  return undefined;
}

export function parseVersion(output: string): string | undefined {
  const match = output.match(/\d+\.\d+\.\d+(?:-[\w.-]+)?/);
  return match?.[0];
}

export async function readCliVersion(
  bin: string,
  timeoutMs = 4000,
): Promise<string | undefined> {
  const resolved = resolveBinCommand(bin);
  const child = spawnProcess(
    resolved.command,
    [...resolved.prefixArgs, "--version"],
    {
      // Avoid picking up a local bunfig.toml preload from the caller's cwd.
      // (Notably, packages/orchestrator/bunfig.toml preloads @opentui/solid/preload which
      // breaks running bun-compiled binaries like opencodeRouter during version checks.)
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  const result = await Promise.race([
    once(child, "close").then(() => "close"),
    once(child, "error").then(() => "error"),
    new Promise((resolve) => setTimeout(resolve, timeoutMs, "timeout")),
  ]);

  if (result === "timeout") {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    return undefined;
  }

  if (result === "error") {
    return undefined;
  }

  return parseVersion(output.trim());
}

export async function captureCommandOutput(
  bin: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<string> {
  const resolved = resolveBinCommand(bin);
  const child = spawnProcess(
    resolved.command,
    [...resolved.prefixArgs, ...args],
    {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
      env: options?.env ?? process.env,
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  type CaptureResult =
    | "timeout"
    | "error"
    | {
        type: "close";
        code: number | null;
        signal: NodeJS.Signals | null;
      };

  const timeoutMs = options?.timeoutMs ?? 30_000;
  const result = await Promise.race<CaptureResult>([
    once(child, "close").then(([code, signal]) => ({
      type: "close" as const,
      code: (code ?? null) as number | null,
      signal: (signal ?? null) as NodeJS.Signals | null,
    })),
    once(child, "error").then(() => "error" as const),
    new Promise<CaptureResult>((resolve) =>
      setTimeout(resolve, timeoutMs, "timeout"),
    ),
  ]);

  if (result === "timeout") {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    throw new Error("Command timed out");
  }

  if (result === "error") {
    throw new Error("Command failed to run");
  }

  const code = result.code;
  if (code !== 0) {
    const suffix = output.trim() ? `\n${output.trim()}` : "";
    throw new Error(`Command failed: ${bin} ${args.join(" ")}${suffix}`);
  }

  return output.trim();
}

export function assertVersionMatch(
  name: string,
  expected: string | undefined,
  actual: string | undefined,
  context: string,
): void {
  if (!expected) return;
  if (!actual) {
    throw new Error(
      `Unable to determine ${name} version from ${context}. Expected ${expected}.`,
    );
  }
  if (expected !== actual) {
    throw new Error(
      `${name} version mismatch: expected ${expected}, got ${actual}.`,
    );
  }
}


export function resolveWorkspaceOnMyAgentConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "onmyagent.json");
}

export function resolveOpencodeRouterConfigPath(): string {
  const override = process.env.OPENCODE_ROUTER_CONFIG_PATH?.trim();
  if (override) return resolve(override.replace(/^~\//, `${homedir()}/`));
  const dataDir =
    process.env.OPENCODE_ROUTER_DATA_DIR?.trim() ||
    join(homedir(), ".onmyagent", "opencode-router");
  const expanded = dataDir.replace(/^~\//, `${homedir()}/`);
  return join(resolve(expanded), "opencode-router.json");
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readMessagingEnabledFromOnMyAgentConfig(
  onmyagentConfig: Record<string, unknown>,
): boolean | undefined {
  const messaging = asRecord(onmyagentConfig.messaging);
  return readOptionalBool(messaging.enabled);
}

export function hasConfiguredMessagingServices(routerConfig: Record<string, unknown>): boolean {
  const channels = asRecord(routerConfig.channels);

  const telegram = asRecord(channels.telegram);
  const legacyTelegramToken =
    typeof telegram.token === "string" ? telegram.token.trim() : "";
  if (legacyTelegramToken) return true;
  const telegramBots = Array.isArray(telegram.bots) ? telegram.bots : [];
  if (
    telegramBots.some((bot) => {
      const record = asRecord(bot);
      return (
        typeof record.token === "string" && record.token.trim().length > 0
      );
    })
  ) {
    return true;
  }

  const slack = asRecord(channels.slack);
  const legacySlackBotToken =
    typeof slack.botToken === "string" ? slack.botToken.trim() : "";
  const legacySlackAppToken =
    typeof slack.appToken === "string" ? slack.appToken.trim() : "";
  if (legacySlackBotToken && legacySlackAppToken) return true;
  const slackApps = Array.isArray(slack.apps) ? slack.apps : [];
  if (
    slackApps.some((app) => {
      const record = asRecord(app);
      const botToken =
        typeof record.botToken === "string" ? record.botToken.trim() : "";
      const appToken =
        typeof record.appToken === "string" ? record.appToken.trim() : "";
      return Boolean(botToken && appToken);
    })
  ) {
    return true;
  }

  return false;
}

export async function resolveOpencodeRouterEnabled(
  flags: Map<string, string | boolean>,
  workspaceRoot: string,
  logger: Logger,
): Promise<{
  enabled: boolean;
  source: "flag" | "env" | "workspace-config" | "inferred";
}> {
  const flagValue = flags.get("opencode-router");
  const parsedFlag = readOptionalBool(flagValue);
  if (parsedFlag !== undefined) {
    return { enabled: parsedFlag, source: "flag" };
  }

  const envValue = readOptionalBool(
    process.env.ONMYAGENT_OPENCODE_ROUTER,
  );
  if (envValue !== undefined) {
    return { enabled: envValue, source: "env" };
  }

  const onmyagentConfigPath = resolveWorkspaceOnMyAgentConfigPath(workspaceRoot);
  let onmyagentConfig: Record<string, unknown> = {};
  try {
    const raw = await readFile(onmyagentConfigPath, "utf8");
    onmyagentConfig = asRecord(JSON.parse(raw));
  } catch {
    onmyagentConfig = {};
  }

  const configured = readMessagingEnabledFromOnMyAgentConfig(onmyagentConfig);
  if (configured !== undefined) {
    return { enabled: configured, source: "workspace-config" };
  }

  let inferredEnabled = false;
  const routerConfigPath = resolveOpencodeRouterConfigPath();
  try {
    const raw = await readFile(routerConfigPath, "utf8");
    inferredEnabled = hasConfiguredMessagingServices(asRecord(JSON.parse(raw)));
  } catch {
    inferredEnabled = false;
  }

  const nextOnMyAgentConfig: Record<string, unknown> = {
    ...onmyagentConfig,
    messaging: {
      ...asRecord(onmyagentConfig.messaging),
      enabled: inferredEnabled,
    },
  };

  try {
    await mkdir(dirname(onmyagentConfigPath), { recursive: true });
    await writeFile(
      onmyagentConfigPath,
      `${JSON.stringify(nextOnMyAgentConfig, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    logger.warn(
      "Failed to persist messaging enabled default",
      {
        path: onmyagentConfigPath,
        error: error instanceof Error ? error.message : String(error),
      },
      "onmyagent-orchestrator",
    );
  }

  return { enabled: inferredEnabled, source: "inferred" };
}

export function resolveInternalDevMode(flags: Map<string, string | boolean>): boolean {
  return readBool(flags, "internal-dev-mode", false, "ONMYAGENT_DEV_MODE");
}

export function internalDevModeFromEnv(): boolean {
  const value = process.env.ONMYAGENT_DEV_MODE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export async function resolveOpencodeStateLayout(options: {
  dataDir: string;
  workspace: string;
  devMode: boolean;
}): Promise<OpencodeStateLayout> {
  const localConfigDir = await resolveLocalOpencodeConfigDir();
  if (!options.devMode) {
    const configDir = localConfigDir ?? join(options.dataDir, "opencode-config");
    return {
      devMode: false,
      rootDir: configDir,
      configDir,
      env: localConfigDir ? { OPENCODE_CONFIG_DIR: localConfigDir } : {},
    };
  }

  const rootDir = join(options.dataDir, ONMYAGENT_DEV_DATA_DIR);
  const homeDir = join(rootDir, "home");
  const xdgConfigHome = join(rootDir, "xdg", "config");
  const xdgDataHome = join(rootDir, "xdg", "data");
  const xdgCacheHome = join(rootDir, "xdg", "cache");
  const xdgStateHome = join(rootDir, "xdg", "state");
  const configDir = localConfigDir ?? join(rootDir, "config", "opencode");

  return {
    devMode: true,
    rootDir,
    configDir,
    importConfigDir:
      process.env.ONMYAGENT_DEV_OPENCODE_IMPORT_CONFIG_DIR?.trim() || undefined,
    importDataDir:
      process.env.ONMYAGENT_DEV_OPENCODE_IMPORT_DATA_DIR?.trim() || undefined,
    env: {
      ONMYAGENT_DEV_MODE: "1",
      OPENCODE_TEST_HOME: homeDir,
      HOME: homeDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_STATE_HOME: xdgStateHome,
      OPENCODE_CONFIG_DIR: configDir,
    },
  };
}

export async function ensureOpencodeStateLayout(
  layout: OpencodeStateLayout,
): Promise<void> {
  await mkdir(layout.configDir, { recursive: true });
  if (!layout.devMode) return;

  const homeDir = layout.env.HOME;
  const xdgConfigHome = layout.env.XDG_CONFIG_HOME;
  const xdgDataHome = layout.env.XDG_DATA_HOME;
  const xdgCacheHome = layout.env.XDG_CACHE_HOME;
  const xdgStateHome = layout.env.XDG_STATE_HOME;
  const opencodeDataDir = xdgDataHome
    ? join(xdgDataHome, "opencode")
    : undefined;

  for (const dir of [
    layout.rootDir,
    homeDir,
    xdgConfigHome,
    xdgDataHome,
    xdgCacheHome,
    xdgStateHome,
    opencodeDataDir,
  ]) {
    if (!dir) continue;
    await mkdir(dir, { recursive: true });
  }

  if (layout.importConfigDir && (await isDir(layout.importConfigDir))) {
    const entries = await readdir(layout.configDir).catch(() => [] as string[]);
    if (entries.length === 0) {
      await cp(layout.importConfigDir, layout.configDir, {
        recursive: true,
        force: false,
      }).catch(() => undefined);
    }
  }

  if (
    layout.importDataDir &&
    opencodeDataDir &&
    (await isDir(layout.importDataDir))
  ) {
    for (const file of ["auth.json", "mcp-auth.json"]) {
      const dest = join(opencodeDataDir, file);
      if (await fileExists(dest)) continue;
      const source = join(layout.importDataDir, file);
      if (await fileExists(source)) {
        await copyFile(source, dest).catch(() => undefined);
      }
    }
  }
}

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

export function opencodeRouterSendToolSource(): string {
  return [
    'import { tool } from "@opencode-ai/plugin"',
    "",
    "const redactTarget = (value) => {",
    "  const text = String(value || '').trim()",
    "  if (!text) return ''",
    "  if (text.length <= 6) return 'hidden'",
    "  return `${text.slice(0, 2)}…${text.slice(-2)}`",
    "}",
    "",
    "const buildGuidance = (result) => {",
    "  const sent = Number(result?.sent || 0)",
    "  const attempted = Number(result?.attempted || 0)",
    "  const reason = String(result?.reason || '')",
    "  const failures = Array.isArray(result?.failures) ? result.failures : []",
    "",
    "  if (sent > 0 && failures.length === 0) return 'Delivered successfully.'",
    "  if (sent > 0) return 'Delivered to at least one conversation, but some targets failed.'",
    "",
    "  const chatNotFound = failures.some((item) => /chat not found/i.test(String(item?.error || '')))",
    "  if (chatNotFound) {",
    "    return 'Delivery failed because the recipient has not started a chat with the bot yet. Ask them to send /start, then retry.'",
    "  }",
    "",
    "  if (/No bound conversations/i.test(reason)) {",
    "    return 'No linked conversation found for this workspace yet. Ask the recipient to message the bot first, then retry.'",
    "  }",
    "",
    "  if (attempted === 0) return 'No eligible delivery target found.'",
    "  return 'Delivery failed. Retry after confirming the recipient and bot linkage.'",
    "}",
    "",
    "export default tool({",
    '  description: "Send a message via opencodeRouter (Telegram/Slack) to a peer or directory bindings.",',
    "  args: {",
    '    text: tool.schema.string().describe("Message text to send"),',
    '    channel: tool.schema.enum(["telegram", "slack"]).optional().describe("Channel to send on (default: telegram)"),',
    '    identityId: tool.schema.string().optional().describe("OpenCodeRouter identity id (default: all identities)"),',
    '    directory: tool.schema.string().optional().describe("Directory to target for fan-out (default: current session directory)"),',
    '    peerId: tool.schema.string().optional().describe("Direct destination peer id (chat/thread id)"),',
    '    autoBind: tool.schema.boolean().optional().describe("When direct sending, bind peerId to directory if provided"),',
    "  },",
    "  async execute(args, context) {",
    '    const rawPort = (process.env.OPENCODE_ROUTER_HEALTH_PORT || "3005").trim()',
    "    const port = Number(rawPort)",
    "    if (!Number.isFinite(port) || port <= 0) {",
    "      throw new Error(`Invalid OPENCODE_ROUTER_HEALTH_PORT: ${rawPort}`)",
    "    }",
    '    const channel = (args.channel || "telegram").trim()',
    '    if (channel !== "telegram" && channel !== "slack") {',
    '      throw new Error("channel must be telegram or slack")',
    "    }",
    '    const text = String(args.text || "")',
    '    if (!text.trim()) throw new Error("text is required")',
    '    const directory = (args.directory || context.directory || "").trim()',
    '    const peerId = String(args.peerId || "").trim()',
    '    if (!directory && !peerId) throw new Error("Either directory or peerId is required")',
    "    const payload = {",
    "      channel,",
    "      text,",
    "      ...(args.identityId ? { identityId: String(args.identityId) } : {}),",
    "      ...(directory ? { directory } : {}),",
    "      ...(peerId ? { peerId } : {}),",
    "      ...(args.autoBind === true ? { autoBind: true } : {}),",
    "    }",
    "    const response = await fetch(`http://127.0.0.1:${port}/send`, {",
    '      method: "POST",',
    '      headers: { "Content-Type": "application/json" },',
    "      body: JSON.stringify(payload),",
    "    })",
    "    const body = await response.text()",
    "    let json = null",
    "    try {",
    "      json = JSON.parse(body)",
    "    } catch {",
    "      json = null",
    "    }",
    "    if (!response.ok) {",
    "      throw new Error(`opencodeRouter /send failed (${response.status}): ${body}`)",
    "    }",
    "",
    "    const sent = Number(json?.sent || 0)",
    "    const attempted = Number(json?.attempted || 0)",
    "    const reason = typeof json?.reason === 'string' ? json.reason : ''",
    "    const failuresRaw = Array.isArray(json?.failures) ? json.failures : []",
    "    const failures = failuresRaw.map((item) => ({",
    "      identityId: String(item?.identityId || ''),",
    "      error: String(item?.error || 'delivery failed'),",
    "      ...(item?.peerId ? { target: redactTarget(item.peerId) } : {}),",
    "    }))",
    "",
    "    const result = {",
    "      ok: true,",
    "      channel,",
    "      sent,",
    "      attempted,",
    "      guidance: buildGuidance({ sent, attempted, reason, failures }),",
    "      ...(reason ? { reason } : {}),",
    "      ...(failures.length ? { failures } : {}),",
    "    }",
    "    return JSON.stringify(result, null, 2)",
    "  },",
    "})",
    "",
  ].join("\n");
}

export function opencodeRouterStatusToolSource(): string {
  return [
    'import { tool } from "@opencode-ai/plugin"',
    "",
    "const redactTarget = (value) => {",
    "  const text = String(value || '').trim()",
    "  if (!text) return ''",
    "  if (text.length <= 6) return 'hidden'",
    "  return `${text.slice(0, 2)}…${text.slice(-2)}`",
    "}",
    "",
    "const isNumericTelegramPeerId = (value) => /^-?\\d+$/.test(String(value || '').trim())",
    "",
    "export default tool({",
    '  description: "Check opencodeRouter messaging readiness (health, identities, bindings).",',
    "  args: {",
    '    channel: tool.schema.enum(["telegram", "slack"]).optional().describe("Channel to inspect (default: telegram)"),',
    '    identityId: tool.schema.string().optional().describe("Identity id to scope checks"),',
    '    directory: tool.schema.string().optional().describe("Directory to inspect bindings for (default: current session directory)"),',
    '    peerId: tool.schema.string().optional().describe("Peer id to inspect bindings for"),',
    '    includeBindings: tool.schema.boolean().optional().describe("Include binding details (default: false)"),',
    "  },",
    "  async execute(args, context) {",
    '    const rawPort = (process.env.OPENCODE_ROUTER_HEALTH_PORT || "3005").trim()',
    "    const port = Number(rawPort)",
    "    if (!Number.isFinite(port) || port <= 0) {",
    "      throw new Error(`Invalid OPENCODE_ROUTER_HEALTH_PORT: ${rawPort}`)",
    "    }",
    '    const channel = (args.channel || "telegram").trim()',
    '    if (channel !== "telegram" && channel !== "slack") {',
    '      throw new Error("channel must be telegram or slack")',
    "    }",
    '    const identityId = String(args.identityId || "").trim()',
    '    const directory = (args.directory || context.directory || "").trim()',
    '    const peerId = String(args.peerId || "").trim()',
    "    const targetValid = channel !== 'telegram' || !peerId || isNumericTelegramPeerId(peerId)",
    "    const includeBindings = args.includeBindings === true",
    "",
    "    const fetchJson = async (path) => {",
    "      const response = await fetch(`http://127.0.0.1:${port}${path}`)",
    "      const body = await response.text()",
    "      let json = null",
    "      try {",
    "        json = JSON.parse(body)",
    "      } catch {",
    "        json = null",
    "      }",
    "      if (!response.ok) {",
    '        return { ok: false, status: response.status, json, error: typeof json?.error === "string" ? json.error : body }',
    "      }",
    "      return { ok: true, status: response.status, json }",
    "    }",
    "",
    "    const health = await fetchJson('/health')",
    "    const identities = await fetchJson(`/identities/${channel}`)",
    "    let bindings = null",
    "    if (includeBindings) {",
    "      const search = new URLSearchParams()",
    "      search.set('channel', channel)",
    "      if (identityId) search.set('identityId', identityId)",
    "      bindings = await fetchJson(`/bindings?${search.toString()}`)",
    "    }",
    "",
    "    const identityItems = Array.isArray(identities?.json?.items) ? identities.json.items : []",
    "    const scopedIdentityItems = identityId",
    "      ? identityItems.filter((item) => String(item?.id || '').trim() === identityId)",
    "      : identityItems",
    "    const runningItems = scopedIdentityItems.filter((item) => item && item.enabled === true && item.running === true)",
    "    const enabledItems = scopedIdentityItems.filter((item) => item && item.enabled === true)",
    "",
    "    const bindingItems = Array.isArray(bindings?.json?.items) ? bindings.json.items : []",
    "    const filteredBindings = bindingItems.filter((item) => {",
    "      if (!item || typeof item !== 'object') return false",
    "      if (directory && String(item.directory || '').trim() !== directory) return false",
    "      if (peerId && String(item.peerId || '').trim() !== peerId) return false",
    "      return true",
    "    })",
    "    const publicBindings = filteredBindings.map((item) => ({",
    "      channel: String(item.channel || channel),",
    "      identityId: String(item.identityId || ''),",
    "      directory: String(item.directory || ''),",
    "      ...(item?.peerId ? { target: redactTarget(item.peerId) } : {}),",
    "      updatedAt: item?.updatedAt,",
    "    }))",
    "",
    "    let ready = false",
    "    let guidance = ''",
    "    let nextAction = ''",
    "    if (!health.ok) {",
    "      guidance = 'OpenCode Router health endpoint is unavailable'",
    "      nextAction = 'check_router_health'",
    "    } else if (!identities.ok) {",
    "      guidance = `Identity lookup failed for ${channel}`",
    "      nextAction = 'check_identity_config'",
    "    } else if (runningItems.length === 0) {",
    "      guidance = `No running ${channel} identity`",
    "      nextAction = 'start_identity'",
    "    } else if (!targetValid) {",
    "      guidance = 'Telegram direct targets must be numeric chat IDs. Prefer linked conversations over asking users for raw IDs.'",
    "      nextAction = 'use_linked_conversation'",
    "    } else if (peerId) {",
    "      ready = true",
    "      guidance = 'Ready for direct send'",
    "      nextAction = 'send_direct'",
    "    } else if (directory) {",
    "      ready = filteredBindings.length > 0",
    "      guidance = ready",
    "        ? 'Ready for directory fan-out send'",
    "        : channel === 'telegram'",
    "          ? 'No linked Telegram conversations yet. Ask the recipient to message your bot (for example /start), then retry.'",
    "          : 'No linked conversations found for this directory yet'",
    "      nextAction = ready ? 'send_directory' : channel === 'telegram' ? 'wait_for_recipient_start' : 'link_conversation'",
    "    } else {",
    "      ready = true",
    "      guidance = 'Ready. Provide a message target (peer or directory).'",
    "      nextAction = 'choose_target'",
    "    }",
    "",
    "    const result = {",
    "      ok: health.ok && identities.ok && (!bindings || bindings.ok),",
    "      ready,",
    "      guidance,",
    "      nextAction,",
    "      channel,",
    "      ...(identityId ? { identityId } : {}),",
    "      ...(directory ? { directory } : {}),",
    "      ...(peerId ? { targetProvided: true } : {}),",
    "      ...(peerId ? { targetValid } : {}),",
    "      health: {",
    "        ok: health.ok,",
    "        status: health.status,",
    "        error: health.ok ? undefined : health.error,",
    "        snapshot: health.ok ? health.json : undefined,",
    "      },",
    "      identities: {",
    "        ok: identities.ok,",
    "        status: identities.status,",
    "        error: identities.ok ? undefined : identities.error,",
    "        configured: scopedIdentityItems.length,",
    "        enabled: enabledItems.length,",
    "        running: runningItems.length,",
    "        items: scopedIdentityItems,",
    "      },",
    "      ...(includeBindings",
    "        ? {",
    "            bindings: {",
    "              ok: Boolean(bindings?.ok),",
    "              status: bindings?.status,",
    "              error: bindings?.ok ? undefined : bindings?.error,",
    "              count: filteredBindings.length,",
    "              items: publicBindings,",
    "            },",
    "          }",
    "        : {}),",
    "    }",
    "    return JSON.stringify(result, null, 2)",
    "  },",
    "})",
    "",
  ].join("\n");
}

export async function ensureOpencodeManagedTools(configDir: string): Promise<void> {
  const toolsDir = join(configDir, "tools");
  await mkdir(toolsDir, { recursive: true });
  const writeManagedTool = async (name: string, source: string) => {
    const toolPath = join(toolsDir, name);
    const content = `${source}\n`;
    try {
      const existing = await readFile(toolPath, "utf8");
      if (existing === content) return;
    } catch {
      // ignore
    }
    await writeFile(toolPath, content, "utf8");
  };

  await writeManagedTool(
    "opencode_router_send.ts",
    opencodeRouterSendToolSource(),
  );
  await writeManagedTool(
    "opencode_router_status.ts",
    opencodeRouterStatusToolSource(),
  );
  await writeManagedTool(
    "onmyagent_browser_node_repl.ts",
    opencodeBrowserNodeReplToolSource(),
  );
}

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

export function isProcessAlive(pid?: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function resolveSelfCommand(): { command: string; prefixArgs: string[] } {
  const arg1 = process.argv[1];
  if (!arg1) return { command: process.argv[0], prefixArgs: [] };
  if (arg1.endsWith(".js") || arg1.endsWith(".ts")) {
    return { command: process.argv[0], prefixArgs: [arg1] };
  }
  return { command: process.argv[0], prefixArgs: [] };
}


export async function stageSandboxRuntime(options: {
  persistDir: string;
  containerName: string;
  sidecars: {
    opencode: string;
    onmyagentServer: string;
    opencodeRouter?: string | null;
  };
  detach: boolean;
}): Promise<{
  baseDir: string;
  rootInContainer: string;
  entrypointHostPath: string;
  cleanup: () => Promise<void>;
}> {
  const baseDir = join(
    options.persistDir,
    "onmyagent-orchestrator-sandbox",
    options.containerName,
  );
  await mkdir(baseDir, { recursive: true });

  const sidecarsDir = join(baseDir, "sidecars");
  await mkdir(sidecarsDir, { recursive: true });
  const entrypointHostPath = join(baseDir, "entrypoint.sh");

  const stagedOpencode = join(sidecarsDir, "opencode");
  const stagedOnMyAgent = join(sidecarsDir, "onmyagent-server");
  await copyFile(options.sidecars.opencode, stagedOpencode);
  await copyFile(options.sidecars.onmyagentServer, stagedOnMyAgent);
  await ensureExecutable(stagedOpencode);
  await ensureExecutable(stagedOnMyAgent);

  if (options.sidecars.opencodeRouter) {
    const stagedOpenCodeRouter = join(sidecarsDir, "opencode-router");
    await copyFile(options.sidecars.opencodeRouter, stagedOpenCodeRouter);
    await ensureExecutable(stagedOpenCodeRouter);
  }

  const rootInContainer = `/persist/onmyagent-orchestrator-sandbox/${options.containerName}`;
  const cleanup = async () => {
    if (options.detach) return;
    try {
      await rm(baseDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  return { baseDir, rootInContainer, entrypointHostPath, cleanup };
}

export async function writeSandboxEntrypoint(options: {
  entrypointHostPath: string;
  rootInContainer: string;
  opencodeConfigDirInContainer: string;
  backend: "docker" | "container";
  opencode: {
    corsOrigins: string[];
    username?: string;
    password?: string;
    hotReload: OpencodeHotReload;
    logLevel?: string;
  };
  onmyagent: {
    token: string;
    hostToken: string;
    approvalMode: ApprovalMode;
    approvalTimeoutMs: number;
    readOnly: boolean;
    corsOrigins: string[];
    opencodeUsername?: string;
    opencodePassword?: string;
    logFormat: LogFormat;
    opencodeRouterEnabled: boolean;
  };
  runId: string;
  logFormat: LogFormat;
}): Promise<void> {
  const opencodeBin = `${options.rootInContainer}/sidecars/opencode`;
  const onmyagentBin = `${options.rootInContainer}/sidecars/onmyagent-server`;
  const opencodeRouterBin = `${options.rootInContainer}/sidecars/opencode-router`;
  const workspaceDir = "/workspace";
  const opencodeConfigDir = options.opencodeConfigDirInContainer;
  const hostOpencodeConfigDir = SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH;
  const hostOpencodeDataDir =
    SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH;

  const opencodeCors = options.opencode.corsOrigins
    .map((origin) => `--cors ${shQuote(origin)}`)
    .join(" ");

  const opencodeLogLevelArg = options.opencode.logLevel
    ? `--log-level ${shQuote(options.opencode.logLevel)}`
    : "";

  const onmyagentCors = options.onmyagent.corsOrigins.length
    ? `--cors ${shQuote(options.onmyagent.corsOrigins.join(","))}`
    : "";

  const requiredSecretEnv = [
    ': "${ONMYAGENT_TOKEN:?ONMYAGENT_TOKEN is required}"',
    ': "${ONMYAGENT_HOST_TOKEN:?ONMYAGENT_HOST_TOKEN is required}"',
    options.opencode.username
      ? ': "${OPENCODE_SERVER_USERNAME:?OPENCODE_SERVER_USERNAME is required}"'
      : "",
    options.opencode.password
      ? ': "${OPENCODE_SERVER_PASSWORD:?OPENCODE_SERVER_PASSWORD is required}"'
      : "",
    options.onmyagent.opencodeUsername
      ? ': "${ONMYAGENT_OPENCODE_USERNAME:?ONMYAGENT_OPENCODE_USERNAME is required}"'
      : "",
    options.onmyagent.opencodePassword
      ? ': "${ONMYAGENT_OPENCODE_PASSWORD:?ONMYAGENT_OPENCODE_PASSWORD is required}"'
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const opencodeRouterEnv = options.onmyagent.opencodeRouterEnabled
    ? `export OPENCODE_ROUTER_HEALTH_PORT=${shQuote(String(SANDBOX_INTERNAL_OPENCODE_ROUTER_HEALTH_PORT))}`
    : "";
  const onmyagentDevMode = (process.env.ONMYAGENT_DEV_MODE ?? "").trim() === "1";
  const sandboxHomeDir = onmyagentDevMode ? "/persist/onmyagent-dev-data/home" : "/persist";

  const script = [
    "set -eu",
    `export HOME=${shQuote(sandboxHomeDir)}`,
    `export OPENCODE_TEST_HOME=${shQuote(sandboxHomeDir)}`,
    'export XDG_CONFIG_HOME="$HOME/.config"',
    'export XDG_CACHE_HOME="$HOME/.cache"',
    'export XDG_DATA_HOME="$HOME/.local/share"',
    'export XDG_STATE_HOME="$HOME/.local/state"',
    `export PATH=${shQuote(`${options.rootInContainer}/sidecars`)}:"\${PATH:-}"`,
    'mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"',
    // Do not `cd` into the mounted workspace: bun-compiled sidecars read bunfig.toml
    // from cwd, and user workspaces may include preloads that break startup.
    `cd ${shQuote("/persist")}`,
    `export OPENCODE_DIRECTORY=${shQuote(workspaceDir)}`,
    `export OPENCODE_CONFIG_DIR=${shQuote(opencodeConfigDir)}`,
    `mkdir -p ${shQuote(opencodeConfigDir)}`,
    `if [ -d ${shQuote(hostOpencodeConfigDir)} ]; then cp -R ${shQuote(`${hostOpencodeConfigDir}/.`)} ${shQuote(opencodeConfigDir)} 2>/dev/null || true; fi`,
    'mkdir -p "$XDG_DATA_HOME/opencode"',
    `if [ -d ${shQuote(hostOpencodeDataDir)} ]; then cp ${shQuote(`${hostOpencodeDataDir}/auth.json`)} \"$XDG_DATA_HOME/opencode/auth.json\" 2>/dev/null || true; cp ${shQuote(`${hostOpencodeDataDir}/mcp-auth.json`)} \"$XDG_DATA_HOME/opencode/mcp-auth.json\" 2>/dev/null || true; fi`,
    `export OPENCODE_URL=${shQuote(`http://127.0.0.1:${SANDBOX_INTERNAL_OPENCODE_PORT}`)}`,
    `export OPENCODE_CLIENT=onmyagent-orchestrator`,
    `export OPENCODE_HOT_RELOAD=${shQuote(options.opencode.hotReload.enabled ? "1" : "0")}`,
    `export OPENCODE_HOT_RELOAD_DEBOUNCE_MS=${shQuote(String(options.opencode.hotReload.debounceMs))}`,
    `export OPENCODE_HOT_RELOAD_COOLDOWN_MS=${shQuote(String(options.opencode.hotReload.cooldownMs))}`,
    `export ONMYAGENT=1`,
    `export ONMYAGENT_DEV_MODE=${shQuote(onmyagentDevMode ? "1" : "0")}`,
    `export ONMYAGENT_RUN_ID=${shQuote(options.runId)}`,
    `export ONMYAGENT_LOG_FORMAT=${shQuote(options.logFormat)}`,
    `export ONMYAGENT_SANDBOX_ENABLED=1`,
    `export ONMYAGENT_SANDBOX_BACKEND=${shQuote(options.backend)}`,
    opencodeRouterEnv,
    requiredSecretEnv,
    'opencode_pid=""',
    'opencodeRouter_pid=""',
    "cleanup() {",
    '  if [ -n "$opencodeRouter_pid" ]; then kill "$opencodeRouter_pid" 2>/dev/null || true; fi',
    '  if [ -n "$opencode_pid" ]; then kill "$opencode_pid" 2>/dev/null || true; fi',
    "}",
    "trap cleanup INT TERM",
    `${shQuote(opencodeBin)} serve --hostname 127.0.0.1 --port ${shQuote(String(SANDBOX_INTERNAL_OPENCODE_PORT))}${opencodeLogLevelArg ? ` ${opencodeLogLevelArg}` : ""} ${opencodeCors} &`,
    "opencode_pid=$!",
    options.onmyagent.opencodeRouterEnabled
      ? `${shQuote(opencodeRouterBin)} serve ${shQuote(workspaceDir)} &`
      : "",
    options.onmyagent.opencodeRouterEnabled ? "opencodeRouter_pid=$!" : "",
    `exec ${shQuote(onmyagentBin)} --host 0.0.0.0 --port ${shQuote(String(SANDBOX_INTERNAL_ONMYAGENT_PORT))}` +
      ` --workspace ${shQuote(workspaceDir)}` +
      ` --approval ${shQuote(options.onmyagent.approvalMode)}` +
      ` --approval-timeout ${shQuote(String(options.onmyagent.approvalTimeoutMs))}` +
      (options.onmyagent.readOnly ? " --read-only" : "") +
      ` --opencode-base-url ${shQuote(`http://127.0.0.1:${SANDBOX_INTERNAL_OPENCODE_PORT}`)}` +
      ` --opencode-directory ${shQuote(workspaceDir)}` +
      ` --log-format ${shQuote(options.onmyagent.logFormat)}` +
      (options.onmyagent.opencodeRouterEnabled
        ? ` --opencode-router-health-port ${shQuote(String(SANDBOX_INTERNAL_OPENCODE_ROUTER_HEALTH_PORT))}`
        : "") +
      (onmyagentCors ? ` ${onmyagentCors}` : ""),
  ]
    .filter(Boolean)
    .join("\n");

  await writeFile(options.entrypointHostPath, `${script}\n`, "utf8");
}

export async function startDockerSandbox(options: {
  image: string;
  dockerCommand: string;
  containerName: string;
  workspace: string;
  persistDir: string;
  opencodeConfigDir: string;
  extraMounts: SandboxMount[];
  sidecars: {
    opencode: string;
    onmyagentServer: string;
    opencodeRouter?: string | null;
  };
  ports: { onmyagent: number; opencodeRouterHealth?: number | null };
  opencode: {
    corsOrigins: string[];
    username?: string;
    password?: string;
    hotReload: OpencodeHotReload;
    logLevel?: string;
  };
  onmyagent: {
    token: string;
    hostToken: string;
    approvalMode: ApprovalMode;
    approvalTimeoutMs: number;
    readOnly: boolean;
    corsOrigins: string[];
    opencodeUsername?: string;
    opencodePassword?: string;
    logFormat: LogFormat;
  };
  runId: string;
  logFormat: LogFormat;
  detach: boolean;
  devMode: boolean;
  logger: Logger;
}): Promise<{ child: ChildProcess; cleanup: () => Promise<void> }> {
  const staged = await stageSandboxRuntime({
    persistDir: options.persistDir,
    containerName: options.containerName,
    sidecars: options.sidecars,
    detach: options.detach,
  });

  await writeSandboxEntrypoint({
    entrypointHostPath: staged.entrypointHostPath,
    rootInContainer: staged.rootInContainer,
    opencodeConfigDirInContainer: "/opencode-config",
    backend: "docker",
    opencode: options.opencode,
    onmyagent: {
      token: options.onmyagent.token,
      hostToken: options.onmyagent.hostToken,
      approvalMode: options.onmyagent.approvalMode,
      approvalTimeoutMs: options.onmyagent.approvalTimeoutMs,
      readOnly: options.onmyagent.readOnly,
      corsOrigins: options.onmyagent.corsOrigins,
      opencodeUsername: options.onmyagent.opencodeUsername,
      opencodePassword: options.onmyagent.opencodePassword,
      logFormat: options.onmyagent.logFormat,
      opencodeRouterEnabled: !!options.sidecars.opencodeRouter,
    },
    runId: options.runId,
    logFormat: options.logFormat,
  });

  const args: string[] = [
    "run",
    "--rm",
    "--name",
    options.containerName,
    "-p",
    `127.0.0.1:${options.ports.onmyagent}:${SANDBOX_INTERNAL_ONMYAGENT_PORT}`,
    "-v",
    `${options.workspace}:/workspace`,
    "-v",
    `${options.persistDir}:/persist`,
    "-v",
    `${options.opencodeConfigDir}:/opencode-config`,
  ];

  const hostOpencodeConfig = await resolveHostOpencodeGlobalConfigDir({
    devMode: options.devMode,
  });
  const hasOpencodeConfigMount = options.extraMounts.some(
    (mount) =>
      mount.containerPath === SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH,
  );
  if (hostOpencodeConfig && !hasOpencodeConfigMount) {
    args.push(
      "-v",
      `${hostOpencodeConfig}:${SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH}:ro`,
    );
    options.logger.debug("sandbox: mounted host opencode config", {
      hostPath: hostOpencodeConfig,
      containerPath: SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH,
    });
  }

  const hostOpencodeData = await resolveHostOpencodeGlobalDataDir({
    devMode: options.devMode,
  });
  const hasOpencodeDataMount = options.extraMounts.some(
    (mount) =>
      mount.containerPath ===
      SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH,
  );
  if (hostOpencodeData && !hasOpencodeDataMount) {
    args.push(
      "-v",
      `${hostOpencodeData}:${SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH}:ro`,
    );
    options.logger.debug("sandbox: mounted host opencode data", {
      hostPath: hostOpencodeData,
      containerPath: SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH,
    });
  }

  if (options.sidecars.opencodeRouter && options.ports.opencodeRouterHealth) {
    args.push(
      "-p",
      `127.0.0.1:${options.ports.opencodeRouterHealth}:${SANDBOX_INTERNAL_OPENCODE_ROUTER_HEALTH_PORT}`,
    );
  }

  const userEnv = loadUserEnvFile();
  addEnvPassThroughArgs(args, sandboxEnvPassThroughNames(userEnv));

  for (const mount of options.extraMounts) {
    const suffix = mount.readonly ? ":ro" : "";
    args.push("-v", `${mount.hostPath}:${mount.containerPath}${suffix}`);
  }

  if (options.detach) {
    args.push("-d");
  }

  const scriptInContainer = `${staged.rootInContainer}/entrypoint.sh`;
  args.push(options.image, "sh", scriptInContainer);

  options.logger.debug("sandbox: docker run", {
    dockerCommand: options.dockerCommand,
    args,
    containerName: options.containerName,
    workspace: options.workspace,
    persistDir: options.persistDir,
  });

  const child = spawnProcess(options.dockerCommand, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...userEnv,
      ...process.env,
      ONMYAGENT_TOKEN: options.onmyagent.token,
      ONMYAGENT_HOST_TOKEN: options.onmyagent.hostToken,
      ...(options.opencode.username
        ? { OPENCODE_SERVER_USERNAME: options.opencode.username }
        : {}),
      ...(options.opencode.password
        ? { OPENCODE_SERVER_PASSWORD: options.opencode.password }
        : {}),
      ...(options.onmyagent.opencodeUsername
        ? { ONMYAGENT_OPENCODE_USERNAME: options.onmyagent.opencodeUsername }
        : {}),
      ...(options.onmyagent.opencodePassword
        ? { ONMYAGENT_OPENCODE_PASSWORD: options.onmyagent.opencodePassword }
        : {}),
    },
  });
  prefixStream(
    child.stdout,
    "sandbox",
    "stdout",
    options.logger,
    child.pid ?? undefined,
  );
  prefixStream(
    child.stderr,
    "sandbox",
    "stderr",
    options.logger,
    child.pid ?? undefined,
  );

  return { child, cleanup: staged.cleanup };
}

export async function startAppleContainerSandbox(options: {
  image: string;
  containerName: string;
  workspace: string;
  persistDir: string;
  opencodeConfigDir: string;
  extraMounts: SandboxMount[];
  sidecars: {
    opencode: string;
    onmyagentServer: string;
    opencodeRouter?: string | null;
  };
  ports: { onmyagent: number; opencodeRouterHealth?: number | null };
  opencode: {
    corsOrigins: string[];
    username?: string;
    password?: string;
    hotReload: OpencodeHotReload;
    logLevel?: string;
  };
  onmyagent: {
    token: string;
    hostToken: string;
    approvalMode: ApprovalMode;
    approvalTimeoutMs: number;
    readOnly: boolean;
    corsOrigins: string[];
    opencodeUsername?: string;
    opencodePassword?: string;
    logFormat: LogFormat;
  };
  runId: string;
  logFormat: LogFormat;
  detach: boolean;
  devMode: boolean;
  logger: Logger;
}): Promise<{ child: ChildProcess; cleanup: () => Promise<void> }> {
  await ensureAppleContainerSystemReady();

  const staged = await stageSandboxRuntime({
    persistDir: options.persistDir,
    containerName: options.containerName,
    sidecars: options.sidecars,
    detach: options.detach,
  });

  await writeSandboxEntrypoint({
    entrypointHostPath: staged.entrypointHostPath,
    rootInContainer: staged.rootInContainer,
    opencodeConfigDirInContainer: "/opencode-config",
    backend: "container",
    opencode: options.opencode,
    onmyagent: {
      token: options.onmyagent.token,
      hostToken: options.onmyagent.hostToken,
      approvalMode: options.onmyagent.approvalMode,
      approvalTimeoutMs: options.onmyagent.approvalTimeoutMs,
      readOnly: options.onmyagent.readOnly,
      corsOrigins: options.onmyagent.corsOrigins,
      opencodeUsername: options.onmyagent.opencodeUsername,
      opencodePassword: options.onmyagent.opencodePassword,
      logFormat: options.onmyagent.logFormat,
      opencodeRouterEnabled: !!options.sidecars.opencodeRouter,
    },
    runId: options.runId,
    logFormat: options.logFormat,
  });

  const args: string[] = [
    "run",
    "--rm",
    "--name",
    options.containerName,
    "-p",
    `127.0.0.1:${options.ports.onmyagent}:${SANDBOX_INTERNAL_ONMYAGENT_PORT}`,
    "-v",
    `${options.workspace}:/workspace`,
    "-v",
    `${options.persistDir}:/persist`,
    "-v",
    `${options.opencodeConfigDir}:/opencode-config`,
  ];

  const hostOpencodeConfig = await resolveHostOpencodeGlobalConfigDir({
    devMode: options.devMode,
  });
  const hasOpencodeConfigMount = options.extraMounts.some(
    (mount) =>
      mount.containerPath === SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH,
  );
  if (hostOpencodeConfig && !hasOpencodeConfigMount) {
    args.push(
      "--mount",
      `type=bind,source=${hostOpencodeConfig},target=${SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH},readonly`,
    );
    options.logger.debug("sandbox: mounted host opencode config", {
      hostPath: hostOpencodeConfig,
      containerPath: SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH,
    });
  }

  const hostOpencodeData = await resolveHostOpencodeGlobalDataDir({
    devMode: options.devMode,
  });
  const hasOpencodeDataMount = options.extraMounts.some(
    (mount) =>
      mount.containerPath ===
      SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH,
  );
  if (hostOpencodeData && !hasOpencodeDataMount) {
    args.push(
      "--mount",
      `type=bind,source=${hostOpencodeData},target=${SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH},readonly`,
    );
    options.logger.debug("sandbox: mounted host opencode data", {
      hostPath: hostOpencodeData,
      containerPath: SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH,
    });
  }

  if (options.sidecars.opencodeRouter && options.ports.opencodeRouterHealth) {
    args.push(
      "-p",
      `127.0.0.1:${options.ports.opencodeRouterHealth}:${SANDBOX_INTERNAL_OPENCODE_ROUTER_HEALTH_PORT}`,
    );
  }

  const userEnv = loadUserEnvFile();
  addEnvPassThroughArgs(args, sandboxEnvPassThroughNames(userEnv));

  for (const mount of options.extraMounts) {
    if (mount.readonly) {
      args.push(
        "--mount",
        `type=bind,source=${mount.hostPath},target=${mount.containerPath},readonly`,
      );
    } else {
      args.push("-v", `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  if (options.detach) {
    args.push("-d");
  }

  const scriptInContainer = `${staged.rootInContainer}/entrypoint.sh`;
  args.push(options.image, "sh", scriptInContainer);

  const child = spawnProcess("container", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...userEnv,
      ...process.env,
      ONMYAGENT_TOKEN: options.onmyagent.token,
      ONMYAGENT_HOST_TOKEN: options.onmyagent.hostToken,
      ...(options.opencode.username
        ? { OPENCODE_SERVER_USERNAME: options.opencode.username }
        : {}),
      ...(options.opencode.password
        ? { OPENCODE_SERVER_PASSWORD: options.opencode.password }
        : {}),
      ...(options.onmyagent.opencodeUsername
        ? { ONMYAGENT_OPENCODE_USERNAME: options.onmyagent.opencodeUsername }
        : {}),
      ...(options.onmyagent.opencodePassword
        ? { ONMYAGENT_OPENCODE_PASSWORD: options.onmyagent.opencodePassword }
        : {}),
    },
  });
  prefixStream(
    child.stdout,
    "sandbox",
    "stdout",
    options.logger,
    child.pid ?? undefined,
  );
  prefixStream(
    child.stderr,
    "sandbox",
    "stderr",
    options.logger,
    child.pid ?? undefined,
  );

  return { child, cleanup: staged.cleanup };
}

export async function verifyOpenCodeRouterVersion(
  binary: ResolvedBinary,
): Promise<string | undefined> {
  if (binary.source !== "external") {
    return binary.expectedVersion;
  }
  const actual = await readCliVersion(binary.bin);
  assertVersionMatch(
    "opencode-router",
    binary.expectedVersion,
    actual,
    binary.bin,
  );
  return actual;
}

export async function verifyOpencodeVersion(
  binary: ResolvedBinary,
): Promise<string | undefined> {
  const actual = await readCliVersion(binary.bin);
  // When the binary was explicitly provided via --opencode-bin (source "external"),
  // a strict version check would break desktop app users whenever a new opencode
  // release ships on GitHub before OnMyAgent updates its bundled binary. Log a
  // warning instead of throwing so the caller can still proceed.
  if (
    binary.source === "external" &&
    binary.expectedVersion &&
    actual &&
    binary.expectedVersion !== actual
  ) {
    process.stderr.write(
      `[onmyagent-orchestrator] Warning: opencode version mismatch (expected ${binary.expectedVersion}, got ${actual}). Proceeding with ${binary.bin}.\n`,
    );
    return actual;
  }
  assertVersionMatch("opencode", binary.expectedVersion, actual, binary.bin);
  return actual;
}

export async function verifyOnMyAgentServer(input: {
  baseUrl: string;
  token: string;
  hostToken: string;
  expectedVersion?: string;
  expectedWorkspace: string;
  expectedOpencodeBaseUrl?: string;
  expectedOpencodeDirectory?: string;
  expectedOpencodeUsername?: string;
  expectedOpencodePassword?: string;
}): Promise<string | undefined> {
  const health = await fetchJson(`${input.baseUrl}/health`);
  const actualVersion =
    typeof health?.version === "string" ? health.version : undefined;
  assertVersionMatch(
    "onmyagent-server",
    input.expectedVersion,
    actualVersion,
    `${input.baseUrl}/health`,
  );

  const headers = { Authorization: `Bearer ${input.token}` };
  const workspaces = await fetchJson(`${input.baseUrl}/workspaces`, {
    headers,
  });
  const items = Array.isArray(workspaces?.items)
    ? (workspaces.items as Array<Record<string, unknown>>)
    : [];
  if (!items.length) {
    throw new Error("OnMyAgent server returned no workspaces");
  }

  const expectedPath = normalizeWorkspacePath(input.expectedWorkspace);
  const matched = items.find((item) => {
    const candidate = item as { path?: string };
    const path = typeof candidate.path === "string" ? candidate.path : "";
    return path && normalizeWorkspacePath(path) === expectedPath;
  }) as
    | {
        id?: string;
        path?: string;
        opencode?: {
          baseUrl?: string;
          directory?: string;
          username?: string;
          password?: string;
        };
      }
    | undefined;

  if (!matched) {
    throw new Error(
      `OnMyAgent server workspace mismatch. Expected ${expectedPath}.`,
    );
  }

  const opencode = matched.opencode;
  if (
    input.expectedOpencodeBaseUrl &&
    opencode?.baseUrl !== input.expectedOpencodeBaseUrl
  ) {
    throw new Error(
      `OnMyAgent server OpenCode base URL mismatch: expected ${input.expectedOpencodeBaseUrl}, got ${opencode?.baseUrl ?? "<missing>"}.`,
    );
  }
  if (
    input.expectedOpencodeDirectory &&
    opencode?.directory !== input.expectedOpencodeDirectory
  ) {
    throw new Error(
      `OnMyAgent server OpenCode directory mismatch: expected ${input.expectedOpencodeDirectory}, got ${opencode?.directory ?? "<missing>"}.`,
    );
  }
  if (
    input.expectedOpencodeUsername &&
    opencode?.username !== input.expectedOpencodeUsername
  ) {
    throw new Error("OnMyAgent server OpenCode username mismatch.");
  }
  if (
    input.expectedOpencodePassword &&
    opencode?.password !== input.expectedOpencodePassword
  ) {
    throw new Error("OnMyAgent server OpenCode password mismatch.");
  }

  const hostHeaders = { "X-OnMyAgent-Host-Token": input.hostToken };
  await fetchJson(`${input.baseUrl}/approvals`, { headers: hostHeaders });

  return actualVersion;
}

export async function installGlobalPackages(packages: string[]): Promise<void> {
  if (!packages.length) return;
  await captureCommandOutput("npm", ["install", "-g", ...packages], {
    timeoutMs: 5 * 60_000,
  });
}

export function buildRuntimeServiceSnapshot(input: {
  name: RuntimeServiceName;
  enabled: boolean;
  running: boolean;
  binary?: ResolvedBinary | null;
  actualVersion?: string;
}): RuntimeServiceSnapshot {
  const targetVersion = input.binary?.expectedVersion;
  const actualVersion = input.actualVersion;
  return {
    name: input.name,
    enabled: input.enabled,
    running: input.enabled ? input.running : false,
    source: input.binary?.source,
    path: input.binary?.bin,
    targetVersion,
    actualVersion,
    upgradeAvailable: Boolean(
      input.enabled &&
      targetVersion &&
      actualVersion &&
      targetVersion !== actualVersion,
    ),
  };
}

export async function runChecks(input: {
  opencodeClient: ReturnType<typeof createOpencodeClient>;
  onmyagentUrl: string;
  onmyagentToken: string;
  hostToken: string;
  checkEvents: boolean;
}) {
  const baseUrl = input.onmyagentUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${input.onmyagentToken}` };
  const hostHeaders = { "X-OnMyAgent-Host-Token": input.hostToken };
  const workspaces = await fetchJson(`${baseUrl}/workspaces`, { headers });
  if (!workspaces?.items?.length) {
    throw new Error("OnMyAgent server returned no workspaces");
  }

  const workspaceId = workspaces.items[0].id as string;
  await fetchJson(`${baseUrl}/workspace/${workspaceId}/config`, { headers });

  // Smoke test: mounted opencodeRouter proxy and auth behavior.
  // - /w/:id/opencode-router/health is client-readable
  // - other /w/:id/opencode-router/* requires host/owner auth
  const owMountBase = `${baseUrl}/w/${encodeURIComponent(workspaceId)}/opencode-router`;
  const owHealthRes = await fetch(`${owMountBase}/health`, {
    headers,
    signal: AbortSignal.timeout(3000),
  });
  if (owHealthRes.status >= 500) {
    throw new Error(
      `opencodeRouter mount proxy returned ${owHealthRes.status}`,
    );
  }
  const owConfigured = owHealthRes.status !== 404;
  if (owConfigured) {
    const clientRes = await fetch(`${owMountBase}/config/groups`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (clientRes.status === 200) {
      throw new Error(
        "opencodeRouter mount proxy /config/groups should require host auth",
      );
    }
    if (clientRes.status !== 401 && clientRes.status !== 403) {
      throw new Error(
        `opencodeRouter mount proxy /config/groups unexpected status: ${clientRes.status}`,
      );
    }

    const hostRes = await fetch(`${owMountBase}/config/groups`, {
      headers: hostHeaders,
      signal: AbortSignal.timeout(3000),
    });
    if (hostRes.status >= 500) {
      throw new Error(
        `opencodeRouter mount proxy (host auth) returned ${hostRes.status}`,
      );
    }
    if (hostRes.status === 401 || hostRes.status === 403) {
      throw new Error(
        "opencodeRouter mount proxy /config/groups rejected host auth",
      );
    }
  }

  const created = await input.opencodeClient.session.create({
    title: "OnMyAgent headless check",
  });
  const createdSession = unwrap(created);
  unwrap(
    await input.opencodeClient.session.messages({
      sessionID: createdSession.id,
      limit: 10,
    }),
  );

  if (input.checkEvents) {
    const events: { type: string }[] = [];
    const controller = new AbortController();
    const subscription = await input.opencodeClient.event.subscribe(undefined, {
      signal: controller.signal,
    });
    const reader = (async () => {
      try {
        for await (const raw of subscription.stream) {
          const normalized = normalizeEvent(raw);
          if (!normalized) continue;
          events.push(normalized);
          if (events.length >= 10) break;
        }
      } catch {
        // ignore
      }
    })();

    unwrap(
      await input.opencodeClient.session.create({
        title: "OnMyAgent headless check events",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    controller.abort();
    await Promise.race([
      reader,
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);

    if (!events.length) {
      throw new Error("No SSE events observed during check");
    }
  }
}

/**
 * Lighter check suite for sandbox mode.  Uses only raw HTTP against the
 * onmyagent-server endpoints — no OpenCode SDK calls that rely on Bearer
 * auth through the proxy (since the released server binary may predate our
 * token/proxy changes).
 */
export async function runSandboxChecks(input: {
  onmyagentUrl: string;
  onmyagentToken: string;
  hostToken: string;
}) {
  const baseUrl = input.onmyagentUrl.replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${input.onmyagentToken}` };
  const hostHeaders = { "X-OnMyAgent-Host-Token": input.hostToken };

  // 1. Server health
  const health = await fetchJson(`${baseUrl}/health`);
  if (!health || typeof health !== "object") {
    throw new Error("onmyagent-server /health returned invalid payload");
  }

  // 2. Workspaces list
  const workspaces = await fetchJson(`${baseUrl}/workspaces`, { headers });
  if (!workspaces?.items?.length) {
    throw new Error("onmyagent-server returned no workspaces");
  }
  const workspaceId = workspaces.items[0].id as string;

  // 3. Workspace config
  await fetchJson(`${baseUrl}/workspace/${workspaceId}/config`, { headers });

  // 4. Approvals endpoint (host auth)
  await fetchJson(`${baseUrl}/approvals`, { headers: hostHeaders });

  // 5. Proxy is reachable (even if auth is rejected — non-5xx proves the
  //    server is proxying to a running opencode)
  const proxyRes = await fetch(`${baseUrl}/opencode/health`, {
    headers,
    signal: AbortSignal.timeout(3000),
  });
  if (proxyRes.status >= 500) {
    throw new Error(`opencode proxy returned ${proxyRes.status}`);
  }

  // 6. opencodeRouter proxy is reachable (if configured)
  const owRes = await fetch(`${baseUrl}/opencode-router/health`, {
    headers,
    signal: AbortSignal.timeout(3000),
  });
  if (owRes.status >= 500) {
    throw new Error(`opencodeRouter proxy returned ${owRes.status}`);
  }

  // 7. Mounted opencodeRouter proxy + auth behavior (if configured)
  if (owRes.status !== 404) {
    const owMountBase = `${baseUrl}/w/${encodeURIComponent(workspaceId)}/opencode-router`;
    const mountHealth = await fetch(`${owMountBase}/health`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (mountHealth.status >= 500) {
      throw new Error(
        `opencodeRouter mount proxy returned ${mountHealth.status}`,
      );
    }
    const mountClient = await fetch(`${owMountBase}/config/groups`, {
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (mountClient.status === 200) {
      throw new Error(
        "opencodeRouter mount proxy /config/groups should require host auth",
      );
    }
    if (mountClient.status !== 401 && mountClient.status !== 403) {
      throw new Error(
        `opencodeRouter mount proxy /config/groups unexpected status: ${mountClient.status}`,
      );
    }
    const mountHost = await fetch(`${owMountBase}/config/groups`, {
      headers: hostHeaders,
      signal: AbortSignal.timeout(3000),
    });
    if (mountHost.status >= 500) {
      throw new Error(
        `opencodeRouter mount proxy (host auth) returned ${mountHost.status}`,
      );
    }
    if (mountHost.status === 401 || mountHost.status === 403) {
      throw new Error(
        "opencodeRouter mount proxy /config/groups rejected host auth",
      );
    }
  }
}

export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof (payload as { message?: unknown }).message === "string"
        ? ` ${(payload as { message: string }).message}`
        : "";
    throw new Error(`HTTP ${response.status}${message}`);
  }
  return payload as T;
}

export async function issueOnMyAgentOwnerToken(
  baseUrl: string,
  hostToken: string,
  label = "OnMyAgent owner token",
): Promise<string> {
  const payload = await fetchJson(`${baseUrl.replace(/\/$/, "")}/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OnMyAgent-Host-Token": hostToken,
    },
    body: JSON.stringify({ scope: "owner", label }),
  });
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  if (!token) {
    throw new Error("OnMyAgent server did not return an owner token");
  }
  return token;
}

export function normalizeEvent(raw: unknown): { type: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.type === "string") return { type: record.type };
  const payload = record.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload.type === "string")
    return { type: payload.type };
  return null;
}


export function outputResult(payload: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (typeof payload === "string") {
    console.log(payload);
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

export function outputError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    return;
  }
  console.error(message);
}

export function createVerboseLogger(
  enabled: boolean,
  logger?: Logger,
  component = "onmyagent-orchestrator",
) {
  return (message: string) => {
    if (!enabled) return;
    if (logger) {
      logger.debug(message, undefined, component);
      return;
    }
    console.log(`[${component}] ${message}`);
  };
}

export function buildAttachCommand(input: {
  url: string;
  workspace: string;
  username?: string;
  password?: string;
}): string {
  const parts: string[] = [];
  if (input.username && input.password) {
    parts.push(`OPENCODE_SERVER_USERNAME=${input.username}`);
  }
  if (input.password) {
    parts.push(`OPENCODE_SERVER_PASSWORD=${input.password}`);
  }
  parts.push("opencode", "attach", input.url, "--dir", input.workspace);
  return parts.join(" ");
}

export async function runClipboardCommand(
  command: string,
  args: string[],
  text: string,
): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawnProcess(command, args, {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => resolve(false));
    child.stdin?.write(text);
    child.stdin?.end();
    child.on("exit", (code) => resolve(code === 0));
  });
}

export async function copyToClipboard(
  text: string,
): Promise<{ copied: boolean; error?: string }> {
  const platform = process.platform;
  const commands: Array<{ command: string; args: string[] }> = [];
  if (platform === "darwin") {
    commands.push({ command: "pbcopy", args: [] });
  } else if (platform === "win32") {
    commands.push({ command: "clip", args: [] });
  } else {
    commands.push({ command: "wl-copy", args: [] });
    commands.push({ command: "xclip", args: ["-selection", "clipboard"] });
    commands.push({ command: "xsel", args: ["--clipboard", "--input"] });
  }
  for (const entry of commands) {
    try {
      const ok = await runClipboardCommand(entry.command, entry.args, text);
      if (ok) return { copied: true };
    } catch {
      // ignore
    }
  }
  return { copied: false, error: "Clipboard unavailable" };
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

export function readOnMyAgentClientAuth(args: ParsedArgs): {
  onmyagentUrl: string;
  token: string;
} {
  const onmyagentUrl =
    readFlag(args.flags, "onmyagent-url") ??
    process.env.ONMYAGENT_URL ??
    process.env.ONMYAGENT_SERVER_URL ??
    "";
  const token =
    readFlag(args.flags, "token") ??
    readFlag(args.flags, "onmyagent-token") ??
    process.env.ONMYAGENT_TOKEN ??
    "";

  if (!onmyagentUrl || !token) {
    throw new Error("onmyagent-url and token are required");
  }

  return { onmyagentUrl, token };
}

export function readSessionId(args: ParsedArgs, fallbackIndex: number): string {
  const sessionId =
    readFlag(args.flags, "session-id") ?? args.positionals[fallbackIndex] ?? "";
  const trimmed = sessionId.trim();
  if (!trimmed) {
    throw new Error("session-id is required");
  }
  return trimmed;
}

// Binary resolution helpers (extracted module; re-exported for compat).
export {
  remoteManifestCache,
  fetchRemoteManifest,
  resolveAssetUrl,
  resolveAssetName,
  downloadToPath,
  ensureExecutable,
  downloadSidecarBinary,
  resolveOpencodeAsset,
  resolveOpencodeDownload,
  sha256File,
  verifyBinary,
  resolveBundledBinary,
  resolveBinPath,
  isPathLikeBinary,
  assertSandboxBinaryFile,
  resolveOnMyAgentServerBin,
  resolveOpencodeBin,
  resolveOpenCodeRouterBin,
} from "./cli-binary-resolve.js";
