import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import { createMessagingChannelServices } from "./channel-runtime.mjs";
import { createPersonalAgentHeartbeatScheduler } from "./personal-agent-runtime/heartbeat-scheduler.mjs";
import { createPersonalAgentRuntime } from "./personal-agent-runtime/index.mjs";
import { createPersonalAgentLegacyHarness } from "./personal-agent-runtime/legacy-harness.mjs";
import { createPersonalAgentNativeSessionBridge } from "./personal-agent-runtime/native-sessions.mjs";
import {
  ARTIFACT_PLUGIN_SKILL_IDS,
  artifactPluginEnablementPath,
  materializeEnabledArtifactSkills,
  materializeLegacySkillLinks,
  readArtifactPluginEnablementSnapshot,
  scanBundledArtifactPlugins,
} from "./artifact-plugin-runtime.mjs";
import {
  resolveComputerUseRuntimeCommand,
  writeComputerUseRuntimeConfig,
} from "./computer-use-runtime-config.mjs";

const __runtimeDir = path.dirname(fileURLToPath(import.meta.url));

const DIRECT_RUNTIME = "direct";
const ORCHESTRATOR_RUNTIME = "onmyagent-orchestrator";
const ONMYAGENT_SERVER_PORT_RANGE_START = 48_000;
const ONMYAGENT_SERVER_PORT_RANGE_END = 51_000;
const BUNDLED_SKILLS_RESOURCE_DIR = "bundled-skills";
const BUNDLED_PLUGINS_RESOURCE_DIR = "bundled-plugins";
const BUNDLED_EXTENSIONS_RESOURCE_DIR = "onmyagent-extensions";

function bundledSkillsRootPath() {
  const candidates = [
    process.resourcesPath
      ? path.resolve(process.resourcesPath, BUNDLED_SKILLS_RESOURCE_DIR)
      : null,
    path.resolve(__runtimeDir, "..", "resources", BUNDLED_SKILLS_RESOURCE_DIR),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function bundledPluginsRootPath() {
  const candidates = [
    process.resourcesPath
      ? path.resolve(process.resourcesPath, BUNDLED_PLUGINS_RESOURCE_DIR)
      : null,
    path.resolve(__runtimeDir, "..", "resources", BUNDLED_PLUGINS_RESOURCE_DIR),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function bundledExtensionRootPaths() {
  const candidates = [
    process.resourcesPath
      ? path.resolve(process.resourcesPath, BUNDLED_EXTENSIONS_RESOURCE_DIR)
      : null,
    path.resolve(__runtimeDir, "..", "resources", BUNDLED_EXTENSIONS_RESOURCE_DIR),
  ].filter(Boolean);
  return candidates.filter((candidate) => existsSync(candidate));
}

function truncateOutput(value, limit = 8000) {
  const text = String(value ?? "");
  return text.length <= limit ? text : text.slice(text.length - limit);
}

/**
 * Create a directory link (symlink on POSIX, junction on Windows). If the
 * link cannot be created (typically Windows without symlink privilege, or a
 * cross-volume junction target), fall back to recursively copying the
 * directory so the destination is usable.
 */
async function linkOrCopyDir(sourceDir, targetPath) {
  const type = process.platform === "win32" ? "junction" : "dir";
  try {
    await symlink(sourceDir, targetPath, type);
    return { mode: "symlink" };
  } catch (linkError) {
    if (linkError && linkError.code === "EEXIST") {
      return { mode: "existing" };
    }
    try {
      await copyDirRecursive(sourceDir, targetPath);
      return { mode: "copy" };
    } catch (copyError) {
      const detail = linkError?.message ?? String(linkError);
      const nested = copyError?.message ?? String(copyError);
      throw new Error(
        `Failed to mirror ${sourceDir} to ${targetPath}: link=${detail} copy=${nested}`,
      );
    }
  }
}

async function copyDirRecursive(sourceDir, targetPath) {
  await mkdir(targetPath, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(src, dst);
    } else if (entry.isSymbolicLink()) {
      const linkTarget = await stat(src).then(() => src).catch(() => null);
      if (linkTarget) await copyFile(src, dst);
    } else if (entry.isFile()) {
      await copyFile(src, dst);
    }
  }
}

function appendOutput(state, key, chunk) {
  const next = `${state[key] ?? ""}${String(chunk ?? "")}`;
  state[key] = truncateOutput(next);
}

function normalizeWorkspaceKey(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return path.resolve(trimmed).replace(/\\/g, "/").toLowerCase();
}

export function prioritizeWorkspacePaths(preferredPath, workspacePaths = []) {
  const preferred = String(preferredPath ?? "").trim();
  const paths = [];
  const seen = new Set();
  const add = (value) => {
    const workspacePath = String(value ?? "").trim();
    const key = normalizeWorkspaceKey(workspacePath);
    if (!workspacePath || !key || seen.has(key)) return;
    paths.push(workspacePath);
    seen.add(key);
  };
  add(preferred);
  for (const workspacePath of workspacePaths) add(workspacePath);
  return paths;
}

export function createDesktopPersonalRuntimeServices(options = {}) {
  const app = options.app;
  const runtimeManager = options.runtimeManager;
  const readWorkspaceState = options.readWorkspaceState;
  if (!app || typeof app.getPath !== "function") throw new Error("app with getPath is required");
  if (!runtimeManager) throw new Error("runtimeManager is required");
  if (typeof readWorkspaceState !== "function") throw new Error("readWorkspaceState is required");

  const personalAgentLegacyHarness = createPersonalAgentLegacyHarness({
    runtimePathEntries: () => runtimeManager.runtimePathEntries(),
  });
  const personalAgentRuntime = createPersonalAgentRuntime({
    userDataDir: app.getPath("userData"),
    engineInfo: () => runtimeManager.engineInfo(),
    onmyagentServerInfo: () => runtimeManager.onmyagentServerInfo(),
    legacy: personalAgentLegacyHarness,
    bundledExtensionRoots: bundledExtensionRootPaths(),
  });
  const personalAgentHeartbeatScheduler = createPersonalAgentHeartbeatScheduler({
    personalAgentRuntime,
    listWorkspaceRoots: async () =>
      (await readWorkspaceState()).workspaces
        .filter((entry) => entry?.workspaceType !== "remote")
        .map((entry) => String(entry?.path ?? "").trim())
        .filter(Boolean),
  });
  const personalAgentNativeSessions = createPersonalAgentNativeSessionBridge({
    detectPersonalLocalAgent: personalAgentLegacyHarness.detectAgent,
    runCommandCapture: personalAgentLegacyHarness.runCommandCapture,
    claudeProjectsRoot: options.claudeProjectsRoot,
  });
  const channels = createMessagingChannelServices({
    userDataDir: app.getPath("userData"),
    personalAgentRuntime,
  });

  // Initialize channel infrastructure asynchronously
  // We don't await here to avoid blocking app startup
  channels.initialize().catch((error) => {
    console.error("[runtime] Failed to initialize channel infrastructure:", error);
  });

  return {
    personalAgentLegacyHarness,
    personalAgentRuntime,
    personalAgentHeartbeatScheduler,
    personalAgentNativeSessions,
    weixinService: channels.weixinService,
    feishuService: channels.feishuService,
    telegramService: channels.telegramService,
    discordService: channels.discordService,
    channelInfrastructureApi: channels.channelInfrastructureApi,
    channelInfrastructure: channels,
  };
}

function nowMs() {
  return Date.now();
}

function createEngineState() {
  return {
    child: null,
    childExited: true,
    runtime: DIRECT_RUNTIME,
    projectDir: null,
    hostname: null,
    port: null,
    baseUrl: null,
    opencodeUsername: null,
    opencodePassword: null,
    opencodeBinPath: null,
    opencodeBinSource: null,
    lastStdout: null,
    lastStderr: null,
  };
}

function snapshotEngineState(state) {
  const child = state.childExited ? null : state.child;
  return {
    running: Boolean(child && child.exitCode === null && !child.killed),
    runtime: state.runtime,
    baseUrl: state.baseUrl,
    projectDir: state.projectDir,
    hostname: state.hostname,
    port: state.port,
    opencodeUsername: state.opencodeUsername,
    opencodePassword: state.opencodePassword,
    opencodeBinPath: state.opencodeBinPath,
    opencodeBinSource: state.opencodeBinSource,
    pid: child?.pid ?? null,
    lastStdout: state.lastStdout,
    lastStderr: state.lastStderr,
  };
}

function createOnMyAgentServerState() {
  return {
    child: null,
    childExited: true,
    inProcess: false,
    remoteAccessEnabled: false,
    host: null,
    port: null,
    baseUrl: null,
    connectUrl: null,
    mdnsUrl: null,
    lanUrl: null,
    clientToken: null,
    ownerToken: null,
    hostToken: null,
    managedOpencodeBinPath: null,
    managedOpencodeBinSource: null,
    lastStdout: null,
    lastStderr: null,
  };
}

export function snapshotOnMyAgentServerState(state, options = {}) {
  const child = state.childExited ? null : state.child;
  const reachable = options.reachable !== false;
  const running = reachable && (state.inProcess || Boolean(child && child.exitCode === null && !child.killed));
  return {
    running,
    remoteAccessEnabled: state.remoteAccessEnabled,
    host: state.host,
    port: state.port,
    baseUrl: state.baseUrl,
    connectUrl: state.connectUrl,
    mdnsUrl: state.mdnsUrl,
    lanUrl: state.lanUrl,
    clientToken: state.clientToken,
    ownerToken: state.ownerToken,
    hostToken: state.hostToken,
    managedOpencodeBinPath: state.managedOpencodeBinPath,
    managedOpencodeBinSource: state.managedOpencodeBinSource,
    pid: child?.pid ?? null,
    lastStdout: state.lastStdout,
    lastStderr: state.lastStderr,
  };
}

function assertOnMyAgentServerReady(snapshot) {
  if (!snapshot?.running) {
    throw new Error("OnMyAgent server did not stay running after startup.");
  }
  if (!snapshot.baseUrl) {
    throw new Error("OnMyAgent server did not report a base URL after startup.");
  }
  if (!snapshot.ownerToken && !snapshot.clientToken) {
    throw new Error("OnMyAgent server did not report an access token after startup.");
  }
  return snapshot;
}

function createOrchestratorState() {
  return {
    child: null,
    childExited: true,
    dataDir: null,
    baseUrl: null,
    daemonPort: null,
    lastStdout: null,
    lastStderr: null,
  };
}

async function fileExists(targetPath) {
  try {
    await readFile(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(targetPath, fallback) {
  try {
    const raw = await readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function selectLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry && entry.family === "IPv4" && entry.internal === false) {
        return entry.address;
      }
    }
  }
  return null;
}

function buildConnectUrls(port) {
  const hostname = os.hostname().trim();
  const mdnsUrl = hostname ? `http://${hostname.replace(/\.local$/i, "")}.local:${port}` : null;
  const lan = selectLanAddress();
  const lanUrl = lan ? `http://${lan}:${port}` : null;
  return {
    connectUrl: lanUrl ?? mdnsUrl,
    mdnsUrl,
    lanUrl,
  };
}

function targetTriple() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  return null;
}

function binaryFileNames(baseName) {
  const ext = process.platform === "win32" ? ".exe" : "";
  const triple = targetTriple();
  return [
    triple ? `${baseName}-${triple}${ext}` : null,
    `${baseName}${ext}`,
  ].filter(Boolean);
}

function isDirectory(targetPath) {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function nvmVersionBinPaths(home) {
  const base = path.join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(base, entry.name, "bin"))
      .filter(isDirectory)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function pathHelperEntries() {
  if (process.platform !== "darwin") return [];
  const result = spawnSync("/usr/libexec/path_helper", ["-s"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return [];
  const stdout = String(result.stdout ?? "");
  const match = stdout.match(/PATH="([^"]+)"/) ?? stdout.match(/PATH=([^;\n]+)/);
  return match?.[1]?.split(path.delimiter).filter(Boolean) ?? [];
}

function extraPathEntries() {
  const home = os.homedir();
  const candidates = [];

  if (process.platform === "darwin") {
    candidates.push(
      ...pathHelperEntries(),
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      path.join(home, ".nvm", "current", "bin"),
      ...nvmVersionBinPaths(home),
      path.join(home, ".fnm", "current", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, "Library", "pnpm"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".cargo", "bin"),
      path.join(home, ".pyenv", "shims"),
      path.join(home, ".local", "bin"),
    );
  }

  if (process.platform === "linux") {
    candidates.push(
      "/usr/local/bin",
      "/usr/local/sbin",
      path.join(home, ".nvm", "current", "bin"),
      ...nvmVersionBinPaths(home),
      path.join(home, ".fnm", "current", "bin"),
      path.join(home, ".volta", "bin"),
      path.join(home, ".local", "share", "pnpm"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".cargo", "bin"),
      path.join(home, ".pyenv", "shims"),
      path.join(home, ".local", "bin"),
    );
  }

  if (process.platform === "win32") {
    candidates.push(
      path.join(home, ".volta", "bin"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".cargo", "bin"),
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "pnpm") : null,
      process.env.ProgramFiles
        ? path.join(process.env.ProgramFiles, "Docker", "Docker", "resources", "bin")
        : null,
      process.env["ProgramFiles(x86)"]
        ? path.join(process.env["ProgramFiles(x86)"], "Docker", "Docker", "resources", "bin")
        : null,
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "Programs", "Docker", "Docker", "resources", "bin")
        : null,
    );
  }

  return candidates.filter((entry) => entry && isDirectory(entry));
}

function enrichedPath(sidecarDirs, currentPath) {
  const entries = [
    ...sidecarDirs.filter(isDirectory),
    ...extraPathEntries(),
    ...String(currentPath ?? "").split(path.delimiter).filter(Boolean),
  ];
  const deduped = entries.filter((entry, index) => entries.indexOf(entry) === index);
  return deduped.length > 0 ? deduped.join(path.delimiter) : null;
}

async function portAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host, port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a free port.")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttpOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "Request did not succeed.";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(lastError);
}

async function fetchJson(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Resolves ~/.config/onmyagent/env.json (or %APPDATA%\onmyagent\env.json on
// Windows) — must agree with apps/server/src/env-file.ts. Honor
// ONMYAGENT_ENV_STORE override.
function resolveUserEnvFilePath() {
  const override = String(process.env.ONMYAGENT_ENV_STORE ?? "").trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const appData = String(process.env.APPDATA ?? "").trim();
    const root = appData || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(root, "onmyagent", "env.json");
  }
  return path.join(os.homedir(), ".config", "onmyagent", "env.json");
}

const USER_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const USER_ENV_RESERVED_PREFIXES = ["ONMYAGENT_", "OPENCODE_"];

// Synchronous, best-effort; absent or malformed returns {}. Reserved prefixes
// are stripped so a tampered file can never shadow ONMYAGENT_* / OPENCODE_*.
function loadUserEnvFile() {
  try {
    const raw = readFileSync(resolveUserEnvFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.variables)) return {};
    const out = {};
    for (const entry of parsed.variables) {
      if (!entry || typeof entry !== "object") continue;
      const { key, value } = entry;
      if (typeof key !== "string" || typeof value !== "string") continue;
      if (!USER_ENV_KEY_PATTERN.test(key)) continue;
      if (USER_ENV_RESERVED_PREFIXES.some((p) => key.startsWith(p))) continue;
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function createRuntimeManager({
  app,
  desktopRoot,
  listLocalWorkspacePaths,
  runtimeEnvironment = () => ({}),
}) {
  const engineState = createEngineState();
  const onmyagentServerState = createOnMyAgentServerState();
  const orchestratorState = createOrchestratorState();

  // Serialize engine lifecycle operations. Without this, concurrent renderer
  // invocations of engineStart/engineStop/engineRestart race: each call's
  // stopAllRuntimeChildren kills the previous call's freshly-spawned
  // orchestrator daemon, and the prior call then times out its /health probe.
  let runtimeLifecycleQueue = Promise.resolve();
  let lifecycleState = "idle";
  function withRuntimeLifecycle(fn) {
    const next = runtimeLifecycleQueue.then(fn, fn);
    runtimeLifecycleQueue = next.catch(() => {});
    return next;
  }

  const userDataDir = app.getPath("userData");
  const sidecarDirs = [
    path.join(desktopRoot, "resources", "sidecars"),
    process.resourcesPath ? path.join(process.resourcesPath, "sidecars") : null,
    path.join(path.dirname(app.getPath("exe")), "sidecars"),
  ].filter(Boolean);
  const runtimeRoot = [
    process.resourcesPath && targetTriple()
      ? path.join(process.resourcesPath, "runtimes", targetTriple())
      : null,
    targetTriple()
      ? path.join(desktopRoot, "resources", "runtimes", targetTriple())
      : null,
  ].filter(Boolean).find((candidate) => existsSync(candidate)) ?? null;
  const runtimeBinDirs = runtimeRoot
    ? process.platform === "win32"
      ? [path.join(runtimeRoot, "bin"), path.join(runtimeRoot, "node"), path.join(runtimeRoot, "python")]
      : [
          path.join(runtimeRoot, "bin"),
          path.join(runtimeRoot, "node", "bin"),
          path.join(runtimeRoot, "python", "bin"),
        ]
    : [];
  if (runtimeBinDirs.length > 0) {
    const currentPath =
      process.env.PATH ?? process.env.Path ?? process.env.path ?? "";
    const nextPath = [...runtimeBinDirs, currentPath]
      .filter(Boolean)
      .join(path.delimiter);
    process.env.PATH = nextPath;
    process.env.Path = nextPath;
    process.env.path = nextPath;
  }

  function resolveLocalOpencodeConfigDir() {
    const explicit = process.env.OPENCODE_CONFIG_DIR?.trim();
    if (explicit) return explicit;

    const candidates = [
      path.join(app.getPath("home"), ".config", "opencode"),
      process.env.XDG_CONFIG_HOME?.trim()
        ? path.join(process.env.XDG_CONFIG_HOME.trim(), "opencode")
        : null,
      path.join(os.homedir(), ".config", "opencode"),
    ].filter(Boolean);

    for (const candidate of [...new Set(candidates)]) {
      if (existsSync(path.join(candidate, "opencode.json")) || existsSync(path.join(candidate, "opencode.jsonc"))) {
        return candidate;
      }
    }
    return null;
  }

  function onmyagentServerTokenStorePath() {
    return path.join(userDataDir, "onmyagent-server-tokens.json");
  }

  function onmyagentServerStatePath() {
    return path.join(userDataDir, "onmyagent-server-state.json");
  }

  function managedOpencodeWorkdir() {
    return path.join(userDataDir, "managed-opencode-workdir");
  }

  function onmyagentOpencodeConfigDir() {
    return path.join(userDataDir, "opencode");
  }

  function onmyagentUserSkillsRoot() {
    return path.join(os.homedir(), ".onmyagent", "skills");
  }

  function collectSkillDirs(root) {
    if (!root || !existsSync(root)) return [];
    const dirs = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const direct = path.join(root, entry.name);
      if (existsSync(path.join(direct, "SKILL.md"))) {
        dirs.push(direct);
        continue;
      }
      let nestedEntries = [];
      try {
        nestedEntries = readdirSync(direct, { withFileTypes: true });
      } catch {
        nestedEntries = [];
      }
      for (const nested of nestedEntries) {
        if (!nested.isDirectory() && !nested.isSymbolicLink()) continue;
        const nestedDir = path.join(direct, nested.name);
        if (existsSync(path.join(nestedDir, "SKILL.md"))) {
          dirs.push(nestedDir);
        }
      }
    }
    return dirs;
  }

  async function prepareOnMyAgentOpencodeConfigDir(configDir) {
    const skillsDir = path.join(configDir, "skills");
    await mkdir(skillsDir, { recursive: true });

    const artifactSkillIds = new Set(ARTIFACT_PLUGIN_SKILL_IDS);
    const pluginRoot = bundledPluginsRootPath();
    if (pluginRoot) {
      const catalog = await scanBundledArtifactPlugins(pluginRoot);
      for (const plugin of catalog.items) {
        for (const skill of plugin.skills) artifactSkillIds.add(skill.id);
      }
      const snapshot = await readArtifactPluginEnablementSnapshot({
        enablementPath: artifactPluginEnablementPath(
          process.env.ONMYAGENT_SERVER_CONFIG?.trim() || undefined,
        ),
        catalog,
      });
      const materialized = await materializeEnabledArtifactSkills({
        pluginRoot,
        managedSkillsRoot: skillsDir,
        enabledSkillIds: snapshot.enabledSkillIds,
      });
      for (const diagnostic of [
        ...snapshot.diagnostics,
        ...materialized.diagnostics,
      ]) {
        console.warn("[runtime] Artifact plugin skill diagnostic:", diagnostic);
      }
    }

    const roots = [bundledSkillsRootPath(), onmyagentUserSkillsRoot()].filter(
      Boolean,
    );
    const legacySkillDirs = [];
    for (const root of roots) {
      for (const skillDir of collectSkillDirs(root)) {
        legacySkillDirs.push(skillDir);
      }
    }
    await materializeLegacySkillLinks({
      skillDirs: legacySkillDirs,
      managedSkillsRoot: skillsDir,
      reservedSkillIds: artifactSkillIds,
    });
    return configDir;
  }

  function orchestratorDataDir() {
    const envDir = process.env.ONMYAGENT_DATA_DIR?.trim();
    if (envDir) return envDir;
    return path.join(app.getPath("home"), ".onmyagent", "onmyagent-orchestrator");
  }

  function orchestratorStatePath(dataDir) {
    return path.join(dataDir, "onmyagent-orchestrator-state.json");
  }

  function orchestratorAuthPath(dataDir) {
    return path.join(dataDir, "onmyagent-orchestrator-auth.json");
  }

  async function readOrchestratorStateFile(dataDir) {
    return readJsonFile(orchestratorStatePath(dataDir), null);
  }

  async function readOrchestratorAuthFile(dataDir) {
    return readJsonFile(orchestratorAuthPath(dataDir), null);
  }

  async function writeOrchestratorAuthFile(dataDir, auth) {
    const filePath = orchestratorAuthPath(dataDir);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ ...auth, updatedAt: nowMs() }, null, 2)}\n`, "utf8");
  }

  async function clearOrchestratorAuthFile(dataDir) {
    await rm(orchestratorAuthPath(dataDir), { force: true });
  }

  async function requestOrchestratorShutdown(dataDir) {
    const state = await readOrchestratorStateFile(dataDir);
    const baseUrl = state?.daemon?.baseUrl?.trim();
    if (!baseUrl) return false;
    try {
      await fetch(`${baseUrl.replace(/\/+$/, "")}/shutdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return true;
    } catch {
      return false;
    }
  }

  async function loadTokenStore() {
    return readJsonFile(onmyagentServerTokenStorePath(), { version: 1, workspaces: {} });
  }

  async function saveTokenStore(store) {
    const filePath = onmyagentServerTokenStorePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  async function loadPortState() {
    return readJsonFile(onmyagentServerStatePath(), {
      version: 3,
      workspacePorts: {},
      preferredPort: null,
    });
  }

  async function savePortState(state) {
    const filePath = onmyagentServerStatePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async function loadOrCreateWorkspaceTokens(workspaceKey) {
    const store = await loadTokenStore();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    if (store.workspaces?.[normalized]) {
      return store.workspaces[normalized];
    }
    const next = {
      clientToken: randomUUID(),
      hostToken: randomUUID(),
      ownerToken: null,
      updatedAt: nowMs(),
    };
    store.workspaces ??= {};
    store.workspaces[normalized] = next;
    await saveTokenStore(store);
    return next;
  }

  async function persistWorkspaceOwnerToken(workspaceKey, ownerToken) {
    const store = await loadTokenStore();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    if (!store.workspaces?.[normalized]) return;
    store.workspaces[normalized].ownerToken = ownerToken;
    store.workspaces[normalized].updatedAt = nowMs();
    await saveTokenStore(store);
  }

  async function readPreferredOnMyAgentPort(workspaceKey) {
    const state = await loadPortState();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    if (normalized && state.workspacePorts?.[normalized]) {
      return state.workspacePorts[normalized];
    }
    return state.preferredPort ?? null;
  }

  async function persistPreferredOnMyAgentPort(workspaceKey, port) {
    const state = await loadPortState();
    const normalized = normalizeWorkspaceKey(workspaceKey);
    state.version = 3;
    state.workspacePorts ??= {};
    if (normalized) {
      state.workspacePorts[normalized] = port;
      state.preferredPort = null;
    } else {
      state.preferredPort = port;
    }
    await savePortState(state);
  }

  async function resolveOnMyAgentPort(host, workspaceKey) {
    const preferredPort = await readPreferredOnMyAgentPort(workspaceKey);
    if (preferredPort && (await portAvailable(host, preferredPort))) {
      return preferredPort;
    }
    return findFreePort(host);
  }

  async function ensureDevModePaths() {
    const root = path.join(userDataDir, "onmyagent-dev-data");
    const paths = {
      homeDir: path.join(root, "home"),
      xdgConfigHome: path.join(root, "xdg", "config"),
      xdgDataHome: path.join(root, "xdg", "data"),
      xdgCacheHome: path.join(root, "xdg", "cache"),
      xdgStateHome: path.join(root, "xdg", "state"),
      opencodeConfigDir: path.join(root, "config", "opencode"),
    };

    for (const dir of Object.values(paths)) {
      await mkdir(dir, { recursive: true });
    }
    await mkdir(path.join(paths.xdgDataHome, "opencode"), { recursive: true });
    return paths;
  }

  async function buildChildEnv(extra = {}, options = {}) {
    /** @type {NodeJS.ProcessEnv} */
    // User env is layered first so process.env + any caller overrides always
    // win. See apps/server/src/env-file.ts; both loaders must agree on path
    // and reserved-keys policy.
    const env = {
      ...loadUserEnvFile(),
      ...process.env,
      BUN_CONFIG_DNS_RESULT_ORDER: "verbatim",
      ...runtimeEnvironment(),
      ...extra,
    };
    const pathKey =
      Object.prototype.hasOwnProperty.call(env, "PATH") ||
      !Object.prototype.hasOwnProperty.call(env, "Path")
        ? "PATH"
        : "Path";
    const pathEnv = enrichedPath(
      [...runtimeBinDirs, ...sidecarDirs],
      env[pathKey],
    );
    if (pathEnv) {
      env[pathKey] = pathEnv;
    }
    if (process.env.ONMYAGENT_DEV_MODE === "1") {
      const devPaths = await ensureDevModePaths();
      const localOpencodeConfigDir = resolveLocalOpencodeConfigDir();
      env.ONMYAGENT_DEV_MODE = "1";
      env.HOME = env.HOME?.trim() ? env.HOME : devPaths.homeDir;
      env.USERPROFILE = env.USERPROFILE?.trim() ? env.USERPROFILE : devPaths.homeDir;
      env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME?.trim() ? env.XDG_CONFIG_HOME : devPaths.xdgConfigHome;
      env.XDG_DATA_HOME = env.XDG_DATA_HOME?.trim() ? env.XDG_DATA_HOME : devPaths.xdgDataHome;
      env.XDG_CACHE_HOME = env.XDG_CACHE_HOME?.trim() ? env.XDG_CACHE_HOME : devPaths.xdgCacheHome;
      env.XDG_STATE_HOME = env.XDG_STATE_HOME?.trim() ? env.XDG_STATE_HOME : devPaths.xdgStateHome;
      env.OPENCODE_CONFIG_DIR = env.OPENCODE_CONFIG_DIR?.trim()
        ? env.OPENCODE_CONFIG_DIR
        : localOpencodeConfigDir ?? devPaths.opencodeConfigDir;
      env.OPENCODE_TEST_HOME = env.OPENCODE_TEST_HOME?.trim() ? env.OPENCODE_TEST_HOME : devPaths.homeDir;
    } else {
      const localOpencodeConfigDir = resolveLocalOpencodeConfigDir();
      if (localOpencodeConfigDir && !env.OPENCODE_CONFIG_DIR?.trim()) {
        env.OPENCODE_CONFIG_DIR = localOpencodeConfigDir;
      }
    }
    const configDir =
      process.env.ONMYAGENT_DEV_MODE === "1"
        ? env.OPENCODE_CONFIG_DIR
        : onmyagentOpencodeConfigDir();
    env.OPENCODE_CONFIG_DIR = await prepareOnMyAgentOpencodeConfigDir(configDir);
    if (!env.OPENCODE_CONFIG?.trim()) {
      const computerUseCommand = resolveComputerUseRuntimeCommand({
        platform: process.platform,
        desktopRoot,
        resourcesPath: process.resourcesPath,
        explicitBinary: process.env.ONMYAGENT_COMPUTER_USE_BINARY,
        devMode: process.env.ONMYAGENT_DEV_MODE === "1",
      });
      if (computerUseCommand) {
        env.OPENCODE_CONFIG = await writeComputerUseRuntimeConfig(
          env.OPENCODE_CONFIG_DIR,
          computerUseCommand,
        );
      }
    }
    return env;
  }

  function localOpencodeBinaryCandidates() {
    const binaryName = process.platform === "win32" ? "opencode.exe" : "opencode";
    const candidates = [
      process.env.OPENCODE_BIN?.trim(),
      process.env.ONMYAGENT_OPENCODE_BIN?.trim(),
      process.env.ONMYAGENT_LOCAL_OPENCODE_BIN?.trim(),
    ];

    const pathEntries = (enrichedPath([], process.env.PATH) ?? "")
      .split(path.delimiter)
      .filter(Boolean);
    for (const entry of pathEntries) {
      candidates.push(path.join(entry, binaryName));
    }

    if (process.platform !== "win32") {
      candidates.push(
        path.join(app.getPath("home"), ".opencode", "bin", "opencode"),
        "/opt/homebrew/bin/opencode",
        "/usr/local/bin/opencode",
        "/usr/bin/opencode",
      );
    } else {
      if (process.env.LOCALAPPDATA) {
        candidates.push(
          path.join(process.env.LOCALAPPDATA, "opencode", "bin", "opencode.exe"),
          path.join(process.env.LOCALAPPDATA, "Programs", "opencode", "opencode.exe"),
        );
      }
      candidates.push(path.join(app.getPath("home"), ".opencode", "bin", "opencode.exe"));
    }

    return [...new Set(candidates.filter(Boolean))];
  }

  function resolveBinaryInfo(baseName, extraPaths = []) {
    if (baseName === "opencode") {
      for (const candidate of localOpencodeBinaryCandidates()) {
        if (existsSync(candidate)) {
          return { path: candidate, source: "local" };
        }
      }
    }

    for (const directory of [...sidecarDirs, ...extraPaths]) {
      for (const fileName of binaryFileNames(baseName)) {
        const candidate = path.join(directory, fileName);
        if (existsSync(candidate)) {
          return { path: candidate, source: "bundled" };
        }
      }
    }

    const pathEntries = (enrichedPath([], process.env.PATH) ?? "")
      .split(path.delimiter)
      .filter(Boolean);
    for (const entry of pathEntries) {
      for (const fileName of binaryFileNames(baseName)) {
        const candidate = path.join(entry, fileName);
        if (existsSync(candidate)) {
          return { path: candidate, source: "path" };
        }
      }
    }

    return null;
  }

  function resolveBundledBinaryInfo(baseName) {
    for (const directory of sidecarDirs) {
      for (const fileName of binaryFileNames(baseName)) {
        const candidate = path.join(directory, fileName);
        if (existsSync(candidate)) {
          return { path: candidate, source: "bundled" };
        }
      }
    }
    return null;
  }

  function bundledRuntimeBinary(tool) {
    if (!runtimeRoot) return null;
    if (tool === "node") {
      return path.join(runtimeRoot, "node", process.platform === "win32" ? "node.exe" : "bin/node");
    }
    if (tool === "python") {
      return path.join(runtimeRoot, "python", process.platform === "win32" ? "python.exe" : "bin/python3");
    }
    return null;
  }

  function probeVersion(binary) {
    if (!binary || !existsSync(binary)) return null;
    const result = spawnSync(binary, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) return null;
    return String(result.stdout || result.stderr || "").trim() || null;
  }

  function resolveBinary(baseName, extraPaths = []) {
    return resolveBinaryInfo(baseName, extraPaths)?.path ?? null;
  }

  function resolveOpencodeBinary(opencodeBinPath) {
    const explicitPath = typeof opencodeBinPath === "string" ? opencodeBinPath.trim() : "";
    return explicitPath ? { path: explicitPath, source: "custom" } : resolveBinaryInfo("opencode");
  }

  function resolveDockerCandidates() {
    const candidates = [];
    const seen = new Set();

    for (const key of ["ONMYAGENT_DOCKER_BIN", "OPENWRK_DOCKER_BIN" /* legacy */, "DOCKER_BIN"]) {
      const value = process.env[key]?.trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        candidates.push(value);
      }
    }

    for (const entry of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
      const candidate = path.join(entry, process.platform === "win32" ? "docker.exe" : "docker");
      if (!seen.has(candidate)) {
        seen.add(candidate);
        candidates.push(candidate);
      }
    }

    const platformDefaults =
      process.platform === "win32"
        ? [
            process.env.ProgramFiles
              ? path.join(process.env.ProgramFiles, "Docker", "Docker", "resources", "bin", "docker.exe")
              : null,
            process.env["ProgramFiles(x86)"]
              ? path.join(
                  process.env["ProgramFiles(x86)"],
                  "Docker",
                  "Docker",
                  "resources",
                  "bin",
                  "docker.exe",
                )
              : null,
            process.env.LOCALAPPDATA
              ? path.join(process.env.LOCALAPPDATA, "Programs", "Docker", "Docker", "resources", "bin", "docker.exe")
              : null,
          ].filter(Boolean)
        : [
            "/opt/homebrew/bin/docker",
            "/usr/local/bin/docker",
            "/Applications/Docker.app/Contents/Resources/bin/docker",
          ];
    for (const candidate of platformDefaults) {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        candidates.push(candidate);
      }
    }

    return candidates.filter((candidate) => existsSync(candidate));
  }

  function runDockerCommandDetailed(args, timeoutMs = 8000) {
    const tried = [...resolveDockerCandidates(), process.platform === "win32" ? "docker.exe" : "docker"];
    const errors = [];

    for (const program of tried) {
      try {
        const result = spawnSync(program, args, {
          encoding: "utf8",
          timeout: timeoutMs,
          windowsHide: true,
        });
        return {
          program,
          status: typeof result.status === "number" ? result.status : -1,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
        };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(
      `Failed to run docker: ${errors.join("; ")} (Set ONMYAGENT_DOCKER_BIN to your docker binary if needed)`,
    );
  }

  function parseDockerClientVersion(stdout) {
    const line = String(stdout ?? "").split(/\r?\n/)[0]?.trim() ?? "";
    return line.toLowerCase().startsWith("docker version") ? line : null;
  }

  function parseDockerServerVersion(stdout) {
    for (const line of String(stdout ?? "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("Server Version:")) {
        return trimmed.slice("Server Version:".length).trim() || null;
      }
    }
    return null;
  }

  function deriveOrchestratorContainerName(runId) {
    const sanitized = String(runId ?? "")
      .replace(/[^a-zA-Z0-9_.-]+/g, "-")
      .slice(0, 24);
    return `onmyagent-orchestrator-${sanitized}`;
  }

  async function listOnMyAgentManagedContainers() {
    const result = runDockerCommandDetailed(["ps", "-a", "--format", "{{.Names}}"], 8000);
    if (result.status !== 0) {
      const combined = `${result.stdout.trim()}\n${result.stderr.trim()}`.trim();
      throw new Error(combined || `docker ps -a failed (status ${result.status})`);
    }
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((name) => name && (name.startsWith("onmyagent-orchestrator-") || name.startsWith("onmyagent-dev-") || name.startsWith("openwrk-")))
      .sort();
  }

  async function runShellCommand(program, args, options = {}) {
    const result = spawnSync(program, args, {
      encoding: "utf8",
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      timeout: options.timeoutMs,
    });
    return {
      status: typeof result.status === "number" ? result.status : -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  function engineDoctor(options = {}) {
    const resolved = resolveOpencodeBinary(options?.opencodeBinPath);
    if (!resolved?.path) {
      return {
        found: false,
        inPath: false,
        resolvedPath: null,
        resolvedSource: null,
        version: null,
        supportsServe: false,
        notes: ["OpenCode binary not found in bundled sidecars or PATH."],
        serveHelpStatus: null,
        serveHelpStdout: null,
        serveHelpStderr: null,
      };
    }

    const versionResult = spawnSync(resolved.path, ["--version"], { encoding: "utf8" });
    const helpResult = spawnSync(resolved.path, ["serve", "--help"], { encoding: "utf8" });
    const notes = [`Using ${resolved.source}: ${resolved.path}`];
    if (versionResult.status !== 0) {
      notes.push("OpenCode version probe failed.");
    }
    if (helpResult.status !== 0) {
      notes.push("OpenCode serve --help probe failed.");
    }

    return {
      found: true,
      inPath: resolved.source === "path",
      resolvedPath: resolved.path,
      resolvedSource: resolved.source,
      version: versionResult.stdout?.trim() || versionResult.stderr?.trim() || null,
      supportsServe: helpResult.status === 0,
      notes,
      serveHelpStatus: typeof helpResult.status === "number" ? helpResult.status : null,
      serveHelpStdout: helpResult.stdout?.trim() || null,
      serveHelpStderr: helpResult.stderr?.trim() || null,
    };
  }

  function spawnManagedChild(state, program, args, options = {}) {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    state.child = child;
    state.childExited = false;
    state.lastStdout = null;
    state.lastStderr = null;

    child.stdout?.on("data", (chunk) => appendOutput(state, "lastStdout", chunk.toString()));
    child.stderr?.on("data", (chunk) => appendOutput(state, "lastStderr", chunk.toString()));
    child.on("exit", (code) => {
      state.childExited = true;
      if (code != null && code !== 0) {
        appendOutput(state, "lastStderr", `Process exited with code ${code}.\n`);
      }
      options.onExit?.(code);
    });
    child.on("error", (error) => {
      state.childExited = true;
      appendOutput(state, "lastStderr", `${error instanceof Error ? error.message : String(error)}\n`);
    });

    return child;
  }

  function processMatchesSidecar(command) {
    const value = String(command ?? "");
    return sidecarDirs.some((dir) => value.includes(dir)) &&
      (
        value.includes("onmyagent-orchestrator") ||
        value.includes("onmyagent-server") ||
        value.includes("opencode serve")
      );
  }

  function killProcessId(pid, signal = "SIGTERM") {
    if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return;
    try {
      process.kill(pid, signal);
    } catch {
      // Process already exited or is not ours.
    }
  }

  async function cleanupPackagedSidecars() {
    if (!app.isPackaged) return;

    // First ask the previously recorded orchestrator daemon to shut itself and
    // its OpenCode child down. This handles the happy path without relying on
    // process-list parsing.
    await requestOrchestratorShutdown(orchestratorState.dataDir || orchestratorDataDir()).catch(() => false);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Safety net: an unclean Electron quit can orphan sidecars. Packaged builds
    // should always own a fresh runtime per app launch, so remove any leftover
    // sidecars from this app bundle before choosing ports for the new runtime.
    const result = spawnSync("ps", ["-Ao", "pid=,command="], { encoding: "utf8" });
    const rows = String(result.stdout ?? "").split(/\r?\n/);
    const pids = [];
    for (const row of rows) {
      const match = row.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const command = match[2] ?? "";
      if (processMatchesSidecar(command)) pids.push(pid);
    }
    for (const pid of pids) killProcessId(pid, "SIGTERM");
    if (pids.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      for (const pid of pids) killProcessId(pid, "SIGKILL");
    }
  }

  async function stopChild(state, options = {}) {
    const child = state.child;
    state.child = null;
    state.childExited = true;
    if (!child || child.exitCode != null || child.killed) return;

    if (options.requestShutdown) {
      try {
        const shutdownRequested = await options.requestShutdown();
        if (shutdownRequested) {
          await new Promise((resolve) => setTimeout(resolve, 750));
        }
      } catch {
        // ignore
      }
    }

    if (child.exitCode == null && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (child.exitCode == null && !child.killed) {
        child.kill("SIGKILL");
      }
    }
  }

  async function ensureOpencodeConfig(projectDir) {
    const jsoncPath = path.join(projectDir, "opencode.jsonc");
    const jsonPath = path.join(projectDir, "opencode.json");
    if ((await fileExists(jsoncPath)) || (await fileExists(jsonPath))) return;
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      jsoncPath,
      `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`,
      "utf8",
    );
  }

  function generateManagedCredentials() {
    return [randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""), randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")];
  }

  async function issueOwnerToken(baseUrl, hostToken) {
    const payload = await fetchJson(
      `${baseUrl.replace(/\/+$/, "")}/tokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OnMyAgent-Host-Token": hostToken,
        },
        body: JSON.stringify({ scope: "owner", label: "OnMyAgent desktop owner token" }),
      },
      5000,
    );
    const token = typeof payload?.token === "string" ? payload.token.trim() : "";
    return token || null;
  }

  // In-process server handle. Kept alive across restarts so we can stop it.
  let inProcessServer = null;

  async function startOnMyAgentServer(options) {
    // Stop any previously running in-process server
    if (inProcessServer) {
      try { await inProcessServer.stop(); } catch { /* ignore */ }
      inProcessServer = null;
    }
    await stopChild(onmyagentServerState);

    const workspacePaths = options.workspacePaths.filter((value) => value.trim().length > 0);
    const activeWorkspace = workspacePaths[0] ?? "";
    const host = options.remoteAccessEnabled ? "0.0.0.0" : "127.0.0.1";
    const port = await resolveOnMyAgentPort(host, activeWorkspace);
    const tokens = await loadOrCreateWorkspaceTokens(activeWorkspace);

    const managedOpencode = options.manageOpencode ? resolveOpencodeBinary(options.opencodeBinPath) : null;
    onmyagentServerState.managedOpencodeBinPath = managedOpencode?.path ?? null;
    onmyagentServerState.managedOpencodeBinSource = managedOpencode?.source ?? null;
    if (options.manageOpencode) {
      engineState.opencodeBinPath = managedOpencode?.path ?? null;
      engineState.opencodeBinSource = managedOpencode?.source ?? null;
    }

    // Inject user env vars so the server and managed OpenCode inherit them.
    const serverEnv = await buildChildEnv(
      {
        ONMYAGENT_BUNDLED_SKILLS_DIR: bundledSkillsRootPath() ?? undefined,
        ONMYAGENT_BUNDLED_PLUGINS_DIR: bundledPluginsRootPath() ?? undefined,
      },
      { workspaceRoot: activeWorkspace },
    );
    Object.assign(process.env, serverEnv);

    // One call: resolve config, spawn managed OpenCode, start HTTP server.
    // Dev must prefer apps/server/dist; build output also stages a packaged
    // copy under apps/desktop/server for electron-builder.
    const devPath = path.resolve(__runtimeDir, "..", "..", "server", "dist", "embedded.js");
    const packagedPaths = [
      path.resolve(__runtimeDir, "..", "server", "dist", "embedded.js"),
      ...(process.resourcesPath ? [path.resolve(process.resourcesPath, "server", "dist", "embedded.js")] : []),
    ];
    const candidates = process.env.ONMYAGENT_DEV_MODE === "1"
      ? [devPath, ...packagedPaths]
      : [...packagedPaths, devPath];
    const embeddedPath = candidates.find((candidate) => existsSync(candidate));
    if (!embeddedPath) {
      throw new Error(`Cannot find OnMyAgent embedded server bundle. Checked: ${candidates.join(", ")}`);
    }
    const embeddedUrl = pathToFileURL(embeddedPath);
    if (process.env.ONMYAGENT_DEV_MODE === "1") {
      try {
        const info = await stat(embeddedPath);
        embeddedUrl.searchParams.set("mtime", String(info.mtimeMs));
      } catch {
        embeddedUrl.searchParams.set("mtime", String(Date.now()));
      }
    }
    const { startEmbeddedServer } = await import(embeddedUrl.href);
    const handle = await startEmbeddedServer({
      host,
      port,
      corsOrigins: ["*"],
      approvalMode: "auto",
      workspaces: workspacePaths,
      token: tokens.clientToken,
      hostToken: tokens.hostToken,
      opencodeBaseUrl: options.opencodeBaseUrl ?? undefined,
      opencodeDirectory: activeWorkspace || undefined,
      manageOpencode: options.manageOpencode === true,
      opencodeBin: managedOpencode?.path ?? undefined,
      opencodeCwd: managedOpencodeWorkdir(),
    });
    inProcessServer = handle;

    const boundPort = handle.port;
    const baseUrl = handle.url;

    onmyagentServerState.inProcess = true;
    onmyagentServerState.remoteAccessEnabled = options.remoteAccessEnabled;
    onmyagentServerState.host = host;
    onmyagentServerState.port = boundPort;
    onmyagentServerState.baseUrl = baseUrl;
    onmyagentServerState.clientToken = tokens.clientToken;
    onmyagentServerState.hostToken = tokens.hostToken;

    const connectUrls = options.remoteAccessEnabled ? buildConnectUrls(boundPort) : { connectUrl: null, mdnsUrl: null, lanUrl: null };
    onmyagentServerState.connectUrl = connectUrls.connectUrl;
    onmyagentServerState.mdnsUrl = connectUrls.mdnsUrl;
    onmyagentServerState.lanUrl = connectUrls.lanUrl;

    // No health check needed -- startServer() resolves only after the listener is bound.
    let workspaceList = null;
    let ownerToken = tokens.ownerToken?.trim() || null;
    if (ownerToken) {
      try {
        workspaceList = await fetchJson(`${baseUrl}/workspaces`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        }, 5000);
      } catch {
        ownerToken = null;
      }
    }
    ownerToken ||= await issueOwnerToken(baseUrl, tokens.hostToken);
    onmyagentServerState.ownerToken = ownerToken;
    if (ownerToken) {
      await persistWorkspaceOwnerToken(activeWorkspace, ownerToken);
    }
    if (ownerToken) {
      try {
        const list = workspaceList ?? await fetchJson(`${baseUrl}/workspaces`, {
          headers: { Authorization: `Bearer ${ownerToken}` },
        }, 5000);
        const first = Array.isArray(list?.items) ? list.items[0] : undefined;
        const opencode = first?.opencode;
        if (opencode?.baseUrl) {
          engineState.runtime = DIRECT_RUNTIME;
          engineState.projectDir = opencode.directory ?? activeWorkspace ?? null;
          engineState.hostname = new URL(opencode.baseUrl).hostname;
          engineState.port = Number(new URL(opencode.baseUrl).port) || null;
          engineState.baseUrl = opencode.baseUrl;
          engineState.opencodeUsername = opencode.username ?? null;
          engineState.opencodePassword = opencode.password ?? null;
          engineState.child = null;
          engineState.childExited = false;
        }
      } catch (error) {
        appendOutput(onmyagentServerState, "lastStderr", `OnMyAgent server workspace probe: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    await persistPreferredOnMyAgentPort(activeWorkspace, boundPort);
    return snapshotOnMyAgentServerState(onmyagentServerState);
  }

  async function resolveOrchestratorBaseUrl() {
    if (orchestratorState.baseUrl) {
      return orchestratorState.baseUrl;
    }
    const stateFile = await readOrchestratorStateFile(orchestratorState.dataDir || orchestratorDataDir());
    const baseUrl = stateFile?.daemon?.baseUrl?.trim();
    if (!baseUrl) {
      throw new Error("orchestrator daemon is not running");
    }
    return baseUrl;
  }

  async function startOrchestratorRuntime(projectDir, options = {}) {
    const dataDir = orchestratorDataDir();
    await mkdir(dataDir, { recursive: true });
    const daemonPort = await findFreePort("127.0.0.1");
    const opencodePort = await findFreePort("127.0.0.1");
    const [username, password] = generateManagedCredentials();

    const orchestratorProgram = resolveBinary("onmyagent-orchestrator") ?? resolveBinary("onmyagent");
    if (!orchestratorProgram) {
      throw new Error("Failed to locate onmyagent-orchestrator.");
    }

    const opencodeBinary = resolveOpencodeBinary(options.opencodeBinPath);
    if (!opencodeBinary?.path) {
      throw new Error("Failed to locate opencode.");
    }

    const env = await buildChildEnv(
      {
        ONMYAGENT_INTERNAL_ALLOW_OPENCODE_CREDENTIALS: "1",
        ONMYAGENT_OPENCODE_USERNAME: username,
        ONMYAGENT_OPENCODE_PASSWORD: password,
        ...(options.opencodeEnableExa !== false ? { OPENCODE_ENABLE_EXA: "1" } : {}),
      },
      { workspaceRoot: projectDir },
    );

    const args = [
      "daemon",
      "run",
      "--data-dir",
      dataDir,
      "--daemon-host",
      "127.0.0.1",
      "--daemon-port",
      String(daemonPort),
      "--opencode-bin",
      opencodeBinary.path,
      "--opencode-host",
      "127.0.0.1",
      "--opencode-workdir",
      projectDir,
      "--opencode-port",
      String(opencodePort),
      "--allow-external",
      "--cors",
      "*",
    ];

    spawnManagedChild(orchestratorState, orchestratorProgram, args, { env });
    orchestratorState.dataDir = dataDir;
    orchestratorState.daemonPort = daemonPort;
    orchestratorState.baseUrl = `http://127.0.0.1:${daemonPort}`;

    await writeOrchestratorAuthFile(dataDir, {
      opencodeUsername: username,
      opencodePassword: password,
      projectDir,
    });

    const health = await waitForHttpOk(`${orchestratorState.baseUrl}/health`, 180_000).then((response) => response.json());
    const opencode = health?.opencode;
    if (!opencode?.port) {
      throw new Error("Orchestrator did not report OpenCode status.");
    }

    engineState.runtime = ORCHESTRATOR_RUNTIME;
    engineState.projectDir = projectDir;
    engineState.hostname = "127.0.0.1";
    engineState.port = opencode.port;
    engineState.baseUrl = `http://127.0.0.1:${opencode.port}`;
    engineState.opencodeUsername = username;
    engineState.opencodePassword = password;
    engineState.opencodeBinPath = opencodeBinary.path;
    engineState.opencodeBinSource = opencodeBinary.source;

    return snapshotEngineState(engineState);
  }

  async function startDirectRuntime(projectDir, options = {}) {
    const opencodeBinary = resolveOpencodeBinary(options.opencodeBinPath);
    if (!opencodeBinary?.path) {
      throw new Error("Failed to locate opencode.");
    }

    const port = await findFreePort("127.0.0.1");
    const [username, password] = generateManagedCredentials();
    const env = await buildChildEnv(
      {
        OPENCODE_SERVER_USERNAME: username,
        OPENCODE_SERVER_PASSWORD: password,
      },
      { workspaceRoot: projectDir },
    );

    spawnManagedChild(
      engineState,
      opencodeBinary.path,
      ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--cors", "*"],
      {
        cwd: projectDir,
        env,
      },
    );

    engineState.runtime = DIRECT_RUNTIME;
    engineState.projectDir = projectDir;
    engineState.hostname = "127.0.0.1";
    engineState.port = port;
    engineState.baseUrl = `http://127.0.0.1:${port}`;
    engineState.opencodeUsername = username;
    engineState.opencodePassword = password;
    engineState.opencodeBinPath = opencodeBinary.path;
    engineState.opencodeBinSource = opencodeBinary.source;

    await waitForHttpOk(`${engineState.baseUrl}/health`, 10_000).catch(() => undefined);
    return snapshotEngineState(engineState);
  }

  async function stopAllRuntimeChildren() {
    // Stop the in-process server (and its managed OpenCode child) if running.
    if (inProcessServer) {
      try { inProcessServer.stop(); } catch { /* ignore */ }
      inProcessServer = null;
    }
    await stopChild(onmyagentServerState);
    await stopChild(orchestratorState, {
      requestShutdown: () => requestOrchestratorShutdown(orchestratorState.dataDir || orchestratorDataDir()),
    });
    await clearOrchestratorAuthFile(orchestratorState.dataDir || orchestratorDataDir()).catch(() => undefined);
    await stopChild(engineState);

    Object.assign(engineState, createEngineState());
    Object.assign(onmyagentServerState, createOnMyAgentServerState());
    Object.assign(orchestratorState, createOrchestratorState());
  }

  async function prepareFreshRuntime() {
    lifecycleState = "cleaning";
    await stopAllRuntimeChildren();
    await cleanupPackagedSidecars();
    lifecycleState = "idle";
  }

  async function ensureOnMyAgent(options) {
    let onmyagentServer;
    try {
      onmyagentServer = await startOnMyAgentServer({
        workspacePaths: options.workspacePaths,
        opencodeBaseUrl: engineState.baseUrl,
        opencodeUsername: engineState.opencodeUsername,
        opencodePassword: engineState.opencodePassword,
        remoteAccessEnabled: options.remoteAccessEnabled,
        manageOpencode: options.manageOpencode === true,
        opencodeBinPath: options.opencodeBinPath,
      });
    } catch (error) {
      appendOutput(engineState, "lastStderr", `OnMyAgent server: ${error instanceof Error ? error.message : String(error)}\n`);
      throw error;
    }

    assertOnMyAgentServerReady(onmyagentServer);
  }

  async function engineStart(projectDir, options = {}) {
    const safeProjectDir = String(projectDir ?? "").trim();
    if (!safeProjectDir) {
      throw new Error("projectDir is required");
    }
    await mkdir(safeProjectDir, { recursive: true });
    await ensureOpencodeConfig(safeProjectDir);
    await prepareFreshRuntime();

    const workspacePaths = [safeProjectDir, ...((options.workspacePaths ?? []).filter(Boolean))].filter(
      (value, index, list) => list.indexOf(value) === index,
    );
    const runtime = DIRECT_RUNTIME;

    try {
      lifecycleState = "starting";
      engineState.runtime = runtime;
      engineState.projectDir = safeProjectDir;
      engineState.child = null;
      engineState.childExited = true;

      await ensureOnMyAgent({
        projectDir: safeProjectDir,
        workspacePaths,
        remoteAccessEnabled: options.onmyagentRemoteAccess === true,
        manageOpencode: true,
        opencodeBinPath: options.opencodeBinPath,
      });

      lifecycleState = "healthy";
      return snapshotEngineState(engineState);
    } catch (error) {
      lifecycleState = "error";
      throw error;
    }
  }

  async function engineStop() {
    lifecycleState = "stopping";
    await stopAllRuntimeChildren();
    lifecycleState = "idle";
    return snapshotEngineState(engineState);
  }

  async function engineRestart(options = {}) {
    const projectDir = engineState.projectDir;
    if (!projectDir) {
      throw new Error("OpenCode is not configured for a local workspace");
    }
    return engineStart(projectDir, {
      runtime: engineState.runtime,
      workspacePaths: [projectDir],
      opencodeEnableExa: options.opencodeEnableExa,
      onmyagentRemoteAccess: options.onmyagentRemoteAccess,
    });
  }

  async function engineInfo() {
    return { ...snapshotEngineState(engineState), lifecycleState };
  }

  async function runtimeStatus() {
    return {
      lifecycleState,
      engine: await engineInfo(),
      onmyagentServer: await verifiedOnMyAgentServerSnapshot(),
    };
  }

  async function verifiedOnMyAgentServerSnapshot() {
    const snapshot = snapshotOnMyAgentServerState(onmyagentServerState);
    if (!snapshot.running || !snapshot.baseUrl) return snapshot;
    try {
      await waitForHttpOk(`${snapshot.baseUrl.replace(/\/+$/, "")}/health`, 1200);
      return snapshot;
    } catch (error) {
      appendOutput(
        onmyagentServerState,
        "lastStderr",
        `OnMyAgent server health probe failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return snapshotOnMyAgentServerState(onmyagentServerState, { reachable: false });
    }
  }

  async function onmyagentServerInfo() {
    return verifiedOnMyAgentServerSnapshot();
  }

  async function onmyagentServerRestart(options = {}) {
    const workspacePaths = prioritizeWorkspacePaths(engineState.projectDir, await listLocalWorkspacePaths());
    const shouldManageOpencode = Boolean(
      onmyagentServerState.managedOpencodeBinPath || engineState.opencodeBinPath,
    );
    return startOnMyAgentServer({
      workspacePaths,
      opencodeBaseUrl: shouldManageOpencode ? null : engineState.baseUrl,
      opencodeUsername: shouldManageOpencode ? null : engineState.opencodeUsername,
      opencodePassword: shouldManageOpencode ? null : engineState.opencodePassword,
      remoteAccessEnabled: options.remoteAccessEnabled === true,
      manageOpencode: shouldManageOpencode,
      opencodeBinPath: engineState.opencodeBinPath ?? onmyagentServerState.managedOpencodeBinPath,
    });
  }

  async function orchestratorStatus() {
    const engine = snapshotEngineState(engineState);
    const onmyagentServer = await verifiedOnMyAgentServerSnapshot();
    const workspaces = engine.projectDir
      ? [{ id: normalizeWorkspaceKey(engine.projectDir), path: engine.projectDir, name: path.basename(engine.projectDir) || "Workspace" }]
      : [];
    return {
      running: engine.running,
      dataDir: null,
      daemon: onmyagentServer.running
        ? { baseUrl: onmyagentServer.baseUrl, port: onmyagentServer.port, pid: onmyagentServer.pid, runtime: "direct" }
        : null,
      opencode: engine.running
        ? { baseUrl: engine.baseUrl, port: engine.port, pid: engine.pid, projectDir: engine.projectDir, runtime: "direct" }
        : null,
      cliVersion: null,
      sidecar: null,
      binaries: null,
      activeId: workspaces[0]?.id ?? null,
      workspaceCount: workspaces.length,
      workspaces,
      lastError: engine.lastStderr,
    };
  }

  async function orchestratorWorkspaceActivate(input) {
    const workspacePath = String(input?.workspacePath ?? "").trim();
    if (!workspacePath) {
      throw new Error("workspacePath is required");
    }
    const resolved = path.resolve(workspacePath);
    if (normalizeWorkspaceKey(engineState.projectDir) !== normalizeWorkspaceKey(resolved)) {
      await engineStart(resolved, {
        runtime: DIRECT_RUNTIME,
        workspacePaths: [resolved],
      });
    }
    return {
      id: normalizeWorkspaceKey(resolved),
      path: resolved,
      name: input?.name ?? (path.basename(resolved) || "Workspace"),
    };
  }

  async function orchestratorInstanceDispose(workspacePath) {
    if (normalizeWorkspaceKey(engineState.projectDir) === normalizeWorkspaceKey(workspacePath)) {
      return true;
    }
    return true;
  }

  async function engineInstall(onProgress) {
    onProgress?.({ progress: 10, phase: "preparing", message: "正在准备 OpenCode CLI…" });
    const bundled = resolveBundledBinaryInfo("opencode");
    if (!bundled?.path) {
      return {
        ok: false,
        status: -1,
        stdout: "",
        stderr: "The bundled OpenCode CLI is missing from this OnMyAgent installation.",
      };
    }
    onProgress?.({ progress: 35, phase: "locating", message: "已找到安装包内置的 OpenCode CLI" });
    const installDir = path.join(app.getPath("home"), ".opencode", "bin");
    const target = path.join(
      installDir,
      process.platform === "win32" ? "opencode.exe" : "opencode",
    );
    await mkdir(installDir, { recursive: true });
    onProgress?.({ progress: 65, phase: "installing", message: "正在安装 OpenCode CLI…" });
    await copyFile(bundled.path, target);
    if (process.platform !== "win32") {
      await chmod(target, 0o755);
    }
    onProgress?.({ progress: 90, phase: "verifying", message: "正在验证 OpenCode CLI…" });
    const version = probeVersion(target);
    const ok = Boolean(version);
    onProgress?.({
      progress: ok ? 100 : 90,
      phase: ok ? "complete" : "error",
      message: ok ? `OpenCode CLI ${version} 安装完成` : "OpenCode CLI 验证失败",
    });
    return {
      ok,
      status: ok ? 0 : 1,
      stdout: version ?? "",
      stderr: ok ? "" : "OpenCode CLI verification failed after installation.",
      path: target,
      version,
    };
  }

  function softwareEnvironmentInfo() {
    const bundledOpencode = resolveBundledBinaryInfo("opencode");
    const nodePath = bundledRuntimeBinary("node");
    const pythonPath = bundledRuntimeBinary("python");
    const nodeVersion = probeVersion(nodePath);
    const pythonVersion = probeVersion(pythonPath);
    const opencodeVersion = probeVersion(bundledOpencode?.path);
    const opencodeInstalled = Boolean(opencodeVersion);
    return {
      node: Boolean(nodeVersion),
      python: Boolean(pythonVersion),
      opencode: opencodeInstalled,
      details: {
        node: {
          installed: Boolean(nodeVersion),
          bundled: true,
          path: nodePath,
          version: nodeVersion,
        },
        python: {
          installed: Boolean(pythonVersion),
          bundled: true,
          path: pythonPath,
          version: pythonVersion,
        },
        opencode: {
          installed: opencodeInstalled,
          bundled: true,
          path: bundledOpencode?.path ?? null,
          version: opencodeVersion,
        },
      },
    };
  }

  async function opencodeMcpAuth(projectDir, serverName) {
    const safeProjectDir = String(projectDir ?? "").trim();
    const safeServerName = String(serverName ?? "").trim();
    if (!safeProjectDir) {
      throw new Error("project_dir is required");
    }
    if (!safeServerName) {
      throw new Error("server_name is required");
    }

    const program = resolveBinary("opencode");
    if (!program) {
      throw new Error("Failed to locate opencode.");
    }

    const result = await runShellCommand(program, ["mcp", "auth", safeServerName], {
      cwd: safeProjectDir,
      env: await buildChildEnv(),
      timeoutMs: 120_000,
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async function sandboxDoctor() {
    const candidates = resolveDockerCandidates();
    const debug = {
      candidates,
      selectedBin: null,
      versionCommand: null,
      infoCommand: null,
    };

    let version;
    try {
      version = runDockerCommandDetailed(["--version"], 2000);
    } catch (error) {
      return {
        installed: false,
        daemonRunning: false,
        permissionOk: false,
        ready: false,
        clientVersion: null,
        serverVersion: null,
        error: error instanceof Error ? error.message : String(error),
        debug,
      };
    }

    debug.selectedBin = version.program;
    debug.versionCommand = {
      status: version.status,
      stdout: truncateOutput(version.stdout, 1200),
      stderr: truncateOutput(version.stderr, 1200),
    };

    const clientVersion = parseDockerClientVersion(version.stdout);
    if (version.status !== 0) {
      return {
        installed: false,
        daemonRunning: false,
        permissionOk: false,
        ready: false,
        clientVersion: null,
        serverVersion: null,
        error: `docker --version failed (status ${version.status}): ${version.stderr.trim()}`,
        debug,
      };
    }

    let info;
    try {
      info = runDockerCommandDetailed(["info"], 8000);
    } catch (error) {
      return {
        installed: true,
        daemonRunning: false,
        permissionOk: false,
        ready: false,
        clientVersion,
        serverVersion: null,
        error: error instanceof Error ? error.message : String(error),
        debug,
      };
    }

    debug.infoCommand = {
      status: info.status,
      stdout: truncateOutput(info.stdout, 1200),
      stderr: truncateOutput(info.stderr, 1200),
    };

    if (info.status === 0) {
      return {
        installed: true,
        daemonRunning: true,
        permissionOk: true,
        ready: true,
        clientVersion,
        serverVersion: parseDockerServerVersion(info.stdout),
        error: null,
        debug,
      };
    }

    const combined = `${info.stdout.trim()}\n${info.stderr.trim()}`.trim().toLowerCase();
    const permissionOk = !combined.includes("permission denied") && !combined.includes("access is denied");
    const daemonRunning = !combined.includes("cannot connect to the docker daemon") && !combined.includes("is the docker daemon running") && !combined.includes("connection refused") && !combined.includes("no such file or directory");

    return {
      installed: true,
      daemonRunning,
      permissionOk,
      ready: false,
      clientVersion,
      serverVersion: null,
      error: `${info.stdout.trim()}\n${info.stderr.trim()}`.trim() || `docker info failed (status ${info.status})`,
      debug,
    };
  }

  async function sandboxStop(containerName) {
    const name = String(containerName ?? "").trim();
    if (!name) {
      throw new Error("containerName is required");
    }
    if (!name.startsWith("onmyagent-orchestrator-")) {
      throw new Error("Refusing to stop container: expected name starting with 'onmyagent-orchestrator-'");
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      throw new Error("containerName contains invalid characters");
    }
    const result = runDockerCommandDetailed(["stop", name], 15_000);
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async function sandboxCleanupOnMyAgentContainers() {
    const candidates = await listOnMyAgentManagedContainers().catch((error) => {
      throw error;
    });
    const removed = [];
    const errors = [];

    for (const name of candidates) {
      try {
        const result = runDockerCommandDetailed(["rm", "-f", name], 20_000);
        if (result.status === 0) {
          removed.push(name);
        } else {
          errors.push(`${name}: exit ${result.status}: ${(result.stdout + "\n" + result.stderr).trim()}`);
        }
      } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { candidates, removed, errors };
  }

  async function orchestratorStartDetached(options = {}) {
    const workspacePath = String(options.workspacePath ?? "").trim();
    if (!workspacePath) {
      throw new Error("workspacePath is required");
    }

    const sandboxBackend = String(options.sandboxBackend ?? "none").trim().toLowerCase();
    if (!["none", "docker", "microsandbox"].includes(sandboxBackend)) {
      throw new Error("sandboxBackend must be one of: none, docker, microsandbox");
    }

    const wantsDockerSandbox = sandboxBackend === "docker" || sandboxBackend === "microsandbox";
    const runId = String(options.runId ?? randomUUID()).trim();
    const containerName = wantsDockerSandbox ? deriveOrchestratorContainerName(runId) : null;
    const port = await findFreePort("127.0.0.1");
    const token = String(options.onmyagentToken ?? randomUUID()).trim();
    const hostToken = String(options.onmyagentHostToken ?? randomUUID()).trim();
    const onmyagentUrl = `http://127.0.0.1:${port}`;
    const program = resolveBinary("onmyagent-orchestrator") ?? resolveBinary("onmyagent");
    if (!program) {
      throw new Error("Failed to locate onmyagent orchestrator.");
    }

    const args = [
      "start",
      "--workspace",
      workspacePath,
      "--approval",
      "auto",
      "--detach",
      "--onmyagent-port",
      String(port),
      "--run-id",
      runId,
      ...(wantsDockerSandbox ? ["--sandbox", "docker"] : []),
      ...(options.sandboxImageRef ? ["--sandbox-image", String(options.sandboxImageRef)] : []),
    ];

    const child = spawn(program, args, {
      env: { ...(await buildChildEnv()), ONMYAGENT_TOKEN: token, ONMYAGENT_HOST_TOKEN: hostToken },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();

    await waitForHttpOk(`${onmyagentUrl}/health`, wantsDockerSandbox ? 90_000 : 12_000);
    const ownerToken = await issueOwnerToken(onmyagentUrl, hostToken).catch(() => null);

    return {
      onmyagentUrl,
      token,
      ownerToken,
      hostToken,
      port,
      sandboxBackend: wantsDockerSandbox ? sandboxBackend : null,
      sandboxRunId: wantsDockerSandbox ? runId : null,
      sandboxContainerName: containerName,
    };
  }

  async function sandboxDebugProbe() {
    const startedAt = nowMs();
    const runId = `probe-${randomUUID()}`;
    const workspacePath = path.join(os.tmpdir(), `onmyagent-sandbox-probe-${randomUUID()}`);
    await mkdir(workspacePath, { recursive: true });

    const doctor = await sandboxDoctor();
    let detachedHost = null;
    let dockerInspect = null;
    let dockerLogs = null;
    let error = null;
    const cleanupErrors = [];
    let containerRemoved = false;
    let workspaceRemoved = false;
    let removeResult = null;

    if (doctor.ready) {
      try {
        detachedHost = await orchestratorStartDetached({
          workspacePath,
          sandboxBackend: "docker",
          runId,
        });
        const containerName = detachedHost.sandboxContainerName ?? deriveOrchestratorContainerName(runId);
        try {
          const inspectResult = runDockerCommandDetailed(["inspect", containerName], 6000);
          dockerInspect = {
            status: inspectResult.status,
            stdout: truncateOutput(inspectResult.stdout, 48000),
            stderr: truncateOutput(inspectResult.stderr, 48000),
          };
        } catch (inspectError) {
          cleanupErrors.push(`docker inspect failed: ${inspectError instanceof Error ? inspectError.message : String(inspectError)}`);
        }
        try {
          const logsResult = runDockerCommandDetailed(["logs", "--timestamps", "--tail", "400", containerName], 8000);
          dockerLogs = {
            status: logsResult.status,
            stdout: truncateOutput(logsResult.stdout, 48000),
            stderr: truncateOutput(logsResult.stderr, 48000),
          };
        } catch (logsError) {
          cleanupErrors.push(`docker logs failed: ${logsError instanceof Error ? logsError.message : String(logsError)}`);
        }

        try {
          const rmResult = runDockerCommandDetailed(["rm", "-f", containerName], 20_000);
          containerRemoved = rmResult.status === 0;
          removeResult = {
            status: rmResult.status,
            stdout: truncateOutput(rmResult.stdout, 48000),
            stderr: truncateOutput(rmResult.stderr, 48000),
          };
        } catch (removeError) {
          cleanupErrors.push(`docker rm -f ${containerName} failed: ${removeError instanceof Error ? removeError.message : String(removeError)}`);
        }
      } catch (probeError) {
        error = `Sandbox probe failed to start: ${probeError instanceof Error ? probeError.message : String(probeError)}`;
      }
    } else {
      error = doctor.error ?? "Docker is not ready for sandbox creation";
    }

    try {
      await rm(workspacePath, { recursive: true, force: true });
      workspaceRemoved = true;
    } catch (workspaceError) {
      cleanupErrors.push(`Failed to remove probe workspace: ${workspaceError instanceof Error ? workspaceError.message : String(workspaceError)}`);
    }

    return {
      startedAt,
      finishedAt: nowMs(),
      runId,
      workspacePath,
      ready: doctor.ready && !error,
      doctor,
      detachedHost,
      dockerInspect,
      dockerLogs,
      cleanup: {
        containerName: detachedHost?.sandboxContainerName ?? null,
        containerRemoved,
        removeResult,
        workspaceRemoved,
        errors: cleanupErrors,
      },
      error,
    };
  }

  return {
    engineStart: (projectDir, options) => withRuntimeLifecycle(() => engineStart(projectDir, options)),
    engineStop: () => withRuntimeLifecycle(() => engineStop()),
    engineRestart: (options) => withRuntimeLifecycle(() => engineRestart(options)),
    prepareFreshRuntime: () => withRuntimeLifecycle(() => prepareFreshRuntime()),
    dispose: () => withRuntimeLifecycle(() => stopAllRuntimeChildren()),
    runtimeStatus,
    engineInfo,
    engineDoctor,
    engineInstall,
    softwareEnvironmentInfo,
    runtimePathEntries: () => [...runtimeBinDirs],
    onmyagentServerInfo,
    onmyagentServerRestart,
    orchestratorStatus,
    orchestratorWorkspaceActivate,
    orchestratorInstanceDispose,
    orchestratorStartDetached,
    opencodeMcpAuth,
    sandboxDoctor,
    sandboxStop,
    sandboxCleanupOnMyAgentContainers,
    sandboxDebugProbe,
  };
}
