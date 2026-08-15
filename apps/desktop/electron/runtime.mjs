import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import {
  isComputerUseMcpEnabled,
  resolveComputerUseRuntimeCommand,
  writeComputerUseRuntimeConfig,
} from "./computer-use-runtime-config.mjs";
import {
  resolveLocalExpertsRoot,
  resolveLocalManagedToolsBinRoot,
  resolveLocalSkillsRoot,
} from "./config-profile-paths.mjs";
import {
  chooseOpencodeBinary,
  chooseProductRuntimeBinary,
} from "./opencode-binary-policy.mjs";
import { prepareOnMyAgentOpencodeConfigDir } from "./opencode-config-dir.mjs";
import {
  applyOpencodeSandboxEnv,
  prepareOpencodeSandboxHome,
} from "./opencode-sandbox-home.mjs";
import { resolveExpertSessionRuntimeRoot } from "./expert-session-runtime-path.mjs";
import { createRuntimeSandbox } from "./runtime-sandbox.mjs";
export {
  createDesktopPersonalRuntimeServices,
  wrapChannelApiForLazyInit,
} from "./personal-runtime-services.mjs";

import {
  DIRECT_RUNTIME,
  nowMs,
  createEngineState,
  snapshotEngineState,
  createOnMyAgentServerState,
  snapshotOnMyAgentServerState,
  assertOnMyAgentServerReady,
  createOrchestratorState,
  buildConnectUrls,
} from "./runtime-engine-state.mjs";
import {
  appendOutput,
  cleanupPackagedSidecars as cleanupPackagedSidecarsImpl,
  ensureOpencodeConfig as ensureOpencodeConfigImpl,
  spawnManagedChild,
  stopChild as stopChildImpl,
} from "./runtime-opencode-lifecycle.mjs";
import {
  BUNDLED_PLUGINS_RESOURCE_DIR,
  BUNDLED_SKILLS_RESOURCE_DIR,
  OPENCODE_BIN_ENV_KEYS,
  buildBundledResourceCandidates,
  buildLocalOpencodeBinaryCandidates,
  buildSoftwareEnvironmentInfo,
  collectDockerCandidatePaths,
  envForcedBinaryPath,
  firstExisting,
  normalizeWorkspaceKey,
  parseManagedContainerNames,
  productRuntimeBinaryEnvKeys,
  productRuntimeBinaryNames,
  productRuntimeBinaryRelativePath,
  prioritizeWorkspacePaths,
  selectBestLocalOpencodeFromProbed,
  shouldSkipLocalOpencodeCandidate,
} from "./runtime-helpers.mjs";

export { snapshotOnMyAgentServerState, DIRECT_RUNTIME, ORCHESTRATOR_RUNTIME } from "./runtime-engine-state.mjs";
export { prioritizeWorkspacePaths, normalizeWorkspaceKey } from "./runtime-helpers.mjs";

const __runtimeDir = path.dirname(fileURLToPath(import.meta.url));

const ONMYAGENT_SERVER_PORT_RANGE_START = 48_000;
const ONMYAGENT_SERVER_PORT_RANGE_END = 51_000;

/** @returns {string | null} */
function bundledSkillsRootPath() {
  const found = firstExisting(
    buildBundledResourceCandidates(__runtimeDir, BUNDLED_SKILLS_RESOURCE_DIR, process.resourcesPath),
    existsSync,
  );
  return found == null ? null : String(found);
}

/** @returns {string | null} */
export function bundledPluginsRootPath() {
  const found = firstExisting(
    buildBundledResourceCandidates(__runtimeDir, BUNDLED_PLUGINS_RESOURCE_DIR, process.resourcesPath),
    existsSync,
  );
  return found == null ? null : String(found);
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

import {
  targetTriple,
  binaryFileNames,
  enrichedPath,
  portAvailable,
  findFreePort,
  waitForHttpOk,
  fetchJson,
  loadUserEnvFile,
} from "./runtime-path-env.mjs";

export function createRuntimeManager({
  app,
  desktopRoot,
  listLocalWorkspacePaths,
  runtimeEnvironment = () => ({}),
  homeDir,
}) {
  const engineState = createEngineState(), onmyagentServerState = createOnMyAgentServerState(), orchestratorState = createOrchestratorState();
  // Serialize engine lifecycle operations. Without this, concurrent renderer
  // invocations of engineStart/engineStop/engineRestart race: each call's
  // stopAllRuntimeChildren kills the previous call's freshly-spawned
  // orchestrator daemon, and the prior call then times out its /health probe.
  let runtimeLifecycleQueue = Promise.resolve();
  let lifecycleState = "idle", activeOpencodeConfigDir = null;
  function withRuntimeLifecycle(fn) {
    const next = runtimeLifecycleQueue.then(fn, fn);
    runtimeLifecycleQueue = next.catch(() => {});
    return next;
  }

  const userDataDir = app.getPath("userData"), sidecarDirs = [
    path.join(desktopRoot, "resources", "sidecars"),
    process.resourcesPath ? path.join(process.resourcesPath, "sidecars") : null,
    path.join(path.dirname(app.getPath("exe")), "sidecars"),
  ].filter(Boolean);
  const resolvedHomeDir = homeDir ?? app.getPath("home");
  const managedToolsBinRoot = resolveLocalManagedToolsBinRoot(resolvedHomeDir);
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
      ? [
          path.join(runtimeRoot, "bin"),
          path.join(runtimeRoot, "node"),
          path.join(runtimeRoot, "python"),
        ]
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
  const artifactRuntimeRoot = [
    process.resourcesPath
      ? path.join(process.resourcesPath, "artifact-runtime")
      : null,
    path.resolve(desktopRoot, "..", "..", "packages", "artifact-runtime"),
  ].filter(Boolean).find((candidate) => existsSync(candidate)) ?? null;
  if (artifactRuntimeRoot) {
    process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT = artifactRuntimeRoot;
    const nodeModules = path.join(artifactRuntimeRoot, "node_modules");
    process.env.NODE_PATH = [nodeModules, process.env.NODE_PATH]
      .filter(Boolean)
      .join(path.delimiter);
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

  function onmyagentServerTokenStorePath() { return path.join(userDataDir, "onmyagent-server-tokens.json"); }

  function onmyagentServerStatePath() { return path.join(userDataDir, "onmyagent-server-state.json"); }

  function managedOpencodeWorkdir() {
    return path.join(userDataDir, "managed-opencode-workdir");
  }

  function onmyagentOpencodeConfigDir() {
    return path.join(userDataDir, "opencode");
  }

  function onmyagentUserSkillsRoot() {
    // Dual-read / post-migrate profile path (same resolve as desktop-paths).
    return resolveLocalSkillsRoot(resolvedHomeDir);
  }

  async function prepareManagedOpencodeConfigDir(configDir) {
    activeOpencodeConfigDir = configDir;
    return prepareOnMyAgentOpencodeConfigDir(configDir, {
      resolveOpencodeVersion: () => {
        const opencodeDecision = resolveOpencodeBinaryDecision(null);
        return opencodeDecision?.bundledVersion || opencodeDecision?.localVersion;
      },
      bundledSkillsRootPath,
      onmyagentUserSkillsRoot,
      bundledPluginsRootPath,
    });
  }

  async function refreshSkillLinks() {
    const devConfigDir = !activeOpencodeConfigDir && process.env.ONMYAGENT_DEV_MODE === "1"
      ? (await ensureDevModePaths()).opencodeConfigDir : null;
    const configDir = activeOpencodeConfigDir || (devConfigDir && (process.env.OPENCODE_CONFIG_DIR?.trim()
      || resolveLocalOpencodeConfigDir() || devConfigDir)) || onmyagentOpencodeConfigDir();
    return prepareManagedOpencodeConfigDir(configDir);
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
    // win. See apps/server/src/services/env-file.ts; both loaders must agree
    // on path and reserved-keys policy.
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
    const pathEntries = String(pathEnv ?? "")
      .split(path.delimiter)
      .filter((entry) => entry && entry !== managedToolsBinRoot);
    env[pathKey] = [managedToolsBinRoot, ...pathEntries].join(path.delimiter);
    if (process.env.ONMYAGENT_DEV_MODE === "1") {
      const devPaths = await ensureDevModePaths();
      env.ONMYAGENT_DEV_MODE = "1";
      // Placeholders only; sandbox apply below overwrites HOME / XDG / config dir.
      env.HOME = env.HOME?.trim() ? env.HOME : devPaths.homeDir;
      env.USERPROFILE = env.USERPROFILE?.trim() ? env.USERPROFILE : devPaths.homeDir;
      env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME?.trim() ? env.XDG_CONFIG_HOME : devPaths.xdgConfigHome;
      env.XDG_DATA_HOME = env.XDG_DATA_HOME?.trim() ? env.XDG_DATA_HOME : devPaths.xdgDataHome;
      env.XDG_CACHE_HOME = env.XDG_CACHE_HOME?.trim() ? env.XDG_CACHE_HOME : devPaths.xdgCacheHome;
      env.XDG_STATE_HOME = env.XDG_STATE_HOME?.trim() ? env.XDG_STATE_HOME : devPaths.xdgStateHome;
      env.OPENCODE_TEST_HOME = env.OPENCODE_TEST_HOME?.trim() ? env.OPENCODE_TEST_HOME : devPaths.homeDir;
    }

    // Always stamp the real user home so in-process server features
    // (session-archive discovery of Claude/Codex/Grok/…) never scan the
    // OpenCode sandbox HOME after isolation below.
    env.ONMYAGENT_REAL_HOME = env.ONMYAGENT_REAL_HOME?.trim()
      ? env.ONMYAGENT_REAL_HOME
      : resolvedHomeDir;
    if (!process.env.ONMYAGENT_REAL_HOME?.trim()) {
      process.env.ONMYAGENT_REAL_HOME = resolvedHomeDir;
    }

    // Path B: isolate OpenCode from the real user HOME so ~/.opencode plugins
    // (Sisyphus) and ~/.claude|~/.agents skill catalogs never enter product
    // sessions. Providers/auth are mirrored into the sandbox.
    // Opt out: ONMYAGENT_OPENCODE_USE_REAL_HOME=1 (debug only).
    if (process.env.ONMYAGENT_OPENCODE_USE_REAL_HOME !== "1") {
      const sandbox = await prepareOpencodeSandboxHome({
        userDataDir,
        realHomeDir: resolvedHomeDir,
      });
      applyOpencodeSandboxEnv(env, sandbox);
    } else if (!env.OPENCODE_CONFIG_DIR?.trim()) {
      env.OPENCODE_CONFIG_DIR =
        resolveLocalOpencodeConfigDir() || onmyagentOpencodeConfigDir();
    }
    const configDir = env.OPENCODE_CONFIG_DIR?.trim() || onmyagentOpencodeConfigDir();
    env.OPENCODE_CONFIG_DIR = await prepareManagedOpencodeConfigDir(configDir);
    if (!env.OPENCODE_CONFIG?.trim()) {
      const computerUsePlatform = process.platform;
      const computerUseCommand = resolveComputerUseRuntimeCommand({
        platform: computerUsePlatform,
        desktopRoot,
        resourcesPath: process.resourcesPath,
        explicitBinary: process.env.ONMYAGENT_COMPUTER_USE_BINARY,
        devMode: process.env.ONMYAGENT_DEV_MODE === "1",
      });
      if (computerUseCommand) {
        env.OPENCODE_CONFIG = await writeComputerUseRuntimeConfig(
          env.OPENCODE_CONFIG_DIR,
          computerUseCommand,
          {
            enabled: isComputerUseMcpEnabled({
              platform: computerUsePlatform,
              userDataDir,
            }),
          },
        );
      }
    }
    return env;
  }

  // Normal OpenCode sessions and expert/detached sessions must inherit the
  // same managed-tool PATH and prepared OpenCode skill directory. Keep this
  // as the single runtime boundary so optional tools such as OfficeCLI are
  // available consistently in both session modes.
  async function resolveChildEnvironment(extra = {}, options = {}) {
    return buildChildEnv(extra, options);
  }

  function envForcedOpencodeBinaryPath() {
    return envForcedBinaryPath(process.env, OPENCODE_BIN_ENV_KEYS, existsSync);
  }

  function localOpencodeBinaryCandidates() {
    return buildLocalOpencodeBinaryCandidates({
      platform: process.platform,
      homeDir: app.getPath("home"),
      pathEnv: enrichedPath([], process.env.PATH) ?? "",
      env: process.env,
    });
  }

  /**
   * Scan machine-local OpenCode installs and pick the newest one that meets
   * the bundled pin. Avoids PATH order traps (e.g. stale /usr/local 1.14.x
   * before Homebrew 1.17.x) that reintroduce plugin hook failures.
   */
  function findBestLocalOpencodeBinary(bundledPath, bundledVersion) {
    const bundledResolved = bundledPath ? path.resolve(bundledPath) : null;
    const probed = [];
    for (const candidate of localOpencodeBinaryCandidates()) {
      if (!existsSync(candidate)) continue;
      if (shouldSkipLocalOpencodeCandidate(candidate, bundledResolved)) continue;
      probed.push({ path: candidate, version: probeVersion(candidate) });
    }
    return selectBestLocalOpencodeFromProbed(probed, bundledVersion);
  }

  /**
   * Resolve OpenCode with product-owned version gate:
   * bundled by default; local only when a compatible version is found.
   */
  function resolveOpencodeBinaryDecision(opencodeBinPath) {
    const explicitPath = typeof opencodeBinPath === "string" ? opencodeBinPath.trim() : "";
    const envForcedPath = explicitPath ? null : envForcedOpencodeBinaryPath();
    const bundled = resolveBundledBinaryInfo("opencode");
    const bundledVersion = bundled?.path ? probeVersion(bundled.path) : null;

    let localPath = null;
    let localVersion = null;
    if (!explicitPath && !envForcedPath) {
      const { bestCompatible, firstExisting } = findBestLocalOpencodeBinary(
        bundled?.path ?? null,
        bundledVersion,
      );
      if (bestCompatible) {
        localPath = bestCompatible.path;
        localVersion = bestCompatible.version;
      } else if (firstExisting) {
        // Feed an incompatible/unknown local into the policy so notices fire.
        localPath = firstExisting.path;
        localVersion = firstExisting.version;
      }
    } else if (envForcedPath) {
      localVersion = probeVersion(envForcedPath);
    }

    const decision = chooseOpencodeBinary({
      explicitPath: explicitPath || null,
      envForcedPath,
      localPath,
      localVersion,
      bundledPath: bundled?.path ?? null,
      bundledVersion,
    });

    if (decision.notice) {
      console.warn(`[runtime] OpenCode binary policy: ${decision.notice}`);
    } else if (decision.path) {
      console.info(
        `[runtime] OpenCode binary policy: using ${decision.source} (${decision.reason}) -> ${decision.path}`,
      );
    }

    if (!decision.path) return null;
    return {
      path: decision.path,
      source: decision.source,
      reason: decision.reason,
      notice: decision.notice,
      localVersion: decision.localVersion,
      bundledVersion: decision.bundledVersion,
    };
  }

  function resolveBinaryInfo(baseName, extraPaths = []) {
    if (baseName === "opencode") {
      return resolveOpencodeBinaryDecision(null);
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
    const relative = productRuntimeBinaryRelativePath(tool, process.platform);
    return relative ? path.join(runtimeRoot, relative) : null;
  }

  function envForcedRuntimeBinaryPath(tool) {
    return envForcedBinaryPath(process.env, productRuntimeBinaryEnvKeys(tool), existsSync);
  }

  function findPathRuntimeBinary(tool) {
    const names = productRuntimeBinaryNames(tool, process.platform);
    // Search the original process PATH without our runtimeBinDirs prepend so
    // we can tell "true machine local" from product-bundled copies.
    const rawPath = process.env.PATH ?? process.env.Path ?? process.env.path ?? "";
    const pathEntries = rawPath.split(path.delimiter).filter(Boolean);
    const bundledDirs = new Set(runtimeBinDirs.map((dir) => path.resolve(dir)));
    for (const entry of pathEntries) {
      if (bundledDirs.has(path.resolve(entry))) continue;
      for (const name of names) {
        const candidate = path.join(entry, name);
        if (existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  /**
   * Product-owned Node / Python: bundled wins whenever present.
   */
  function resolveProductRuntimeBinaryDecision(tool) {
    const toolLabel = tool === "node" ? "Node" : tool === "python" ? "Python" : tool;
    const bundledPath = bundledRuntimeBinary(tool);
    const bundledExists = bundledPath && existsSync(bundledPath) ? bundledPath : null;
    const envForcedPath = envForcedRuntimeBinaryPath(tool);
    const localPath = envForcedPath || bundledExists ? null : findPathRuntimeBinary(tool);

    const decision = chooseProductRuntimeBinary({
      toolLabel,
      envForcedPath,
      localPath,
      bundledPath: bundledExists,
      bundledVersion: bundledExists ? probeVersion(bundledExists) : null,
      localVersion: localPath || envForcedPath ? probeVersion(localPath ?? envForcedPath) : null,
    });

    if (decision.notice) {
      console.warn(`[runtime] ${toolLabel} binary policy: ${decision.notice}`);
    }

    if (!decision.path) return null;
    return {
      path: decision.path,
      source: decision.source,
      reason: decision.reason,
      notice: decision.notice,
      localVersion: decision.localVersion,
      bundledVersion: decision.bundledVersion,
    };
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
    return resolveOpencodeBinaryDecision(opencodeBinPath);
  }

  function resolveDockerCandidates() {
    return collectDockerCandidatePaths({
      platform: process.platform,
      env: process.env,
    }).filter((candidate) => existsSync(candidate));
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

  async function listOnMyAgentManagedContainers() {
    const result = runDockerCommandDetailed(["ps", "-a", "--format", "{{.Names}}"], 8000);
    if (result.status !== 0) {
      const combined = `${result.stdout.trim()}\n${result.stderr.trim()}`.trim();
      throw new Error(combined || `docker ps -a failed (status ${result.status})`);
    }
    return parseManagedContainerNames(result.stdout);
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
      // "local" covers PATH / homebrew / ~/.opencode discoveries.
      inPath: resolved.source === "local",
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

  async function cleanupPackagedSidecars() {
    // First ask the previously recorded orchestrator daemon to shut itself and
    // its OpenCode child down. This handles the happy path without relying on
    // process-list parsing.
    await cleanupPackagedSidecarsImpl({
      isPackaged: app.isPackaged,
      sidecarDirs,
      requestShutdown: () => requestOrchestratorShutdown(orchestratorState.dataDir || orchestratorDataDir()),
    });
  }

  async function stopChild(state, options = {}) {
    return stopChildImpl(state, options);
  }

  async function ensureOpencodeConfig(projectDir) {
    return ensureOpencodeConfigImpl(projectDir, {
      fileExists,
      mkdir,
      writeFile,
      pathJoin: path.join,
    });
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
    const serverEnv = await resolveChildEnvironment(
      {
        ONMYAGENT_BUNDLED_SKILLS_DIR: bundledSkillsRootPath() ?? undefined,
        ONMYAGENT_BUNDLED_PLUGINS_DIR: bundledPluginsRootPath() ?? undefined,
        ONMYAGENT_EXPERTS_DIR: resolveLocalExpertsRoot(resolvedHomeDir, "experts"),
        ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT: resolveExpertSessionRuntimeRoot(userDataDir),
        ONMYAGENT_WORKBUDDY_EXPERTS_DIR: path.join(
          resolvedHomeDir,
          ".workbuddy",
          "plugins",
          "marketplaces",
          "experts",
          "plugins",
        ),
        // Server install/list root (profile). Managed OpenCode child strips
        // this so Expert sessions only see <session>/.opencode/skills.
        OPENCODE_GLOBAL_SKILLS_DIR: onmyagentUserSkillsRoot(),
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
      onGlobalSkillsChanged: refreshSkillLinks,
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

  async function stopAllRuntimeChildren() {
    // Stop the in-process server (and its managed OpenCode child) if running.
    if (inProcessServer) {
      try { await inProcessServer.stop(); } catch { /* ignore */ }
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
    const wasManagingOpencode = Boolean(
      onmyagentServerState.managedOpencodeBinPath || engineState.opencodeBinPath,
    );
    const shouldManageOpencode =
      options.manageOpencode === true ||
      (options.manageOpencode !== false && wasManagingOpencode);
    // Always re-resolve the OpenCode binary on restart. Reusing the previous
    // managed path as opencodeBinPath treats it as an explicit override and can
    // permanently pin a stale PATH install (e.g. /usr/local 1.14.x) after the
    // product pin moves to a newer bundled binary.
    const explicitOverride =
      typeof options.opencodeBinPath === "string" && options.opencodeBinPath.trim()
        ? options.opencodeBinPath.trim()
        : null;
    return startOnMyAgentServer({
      workspacePaths,
      opencodeBaseUrl: shouldManageOpencode ? null : engineState.baseUrl,
      opencodeUsername: shouldManageOpencode ? null : engineState.opencodeUsername,
      opencodePassword: shouldManageOpencode ? null : engineState.opencodePassword,
      remoteAccessEnabled: options.remoteAccessEnabled === true,
      manageOpencode: shouldManageOpencode,
      opencodeBinPath: explicitOverride,
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
    return buildSoftwareEnvironmentInfo(
      resolveProductRuntimeBinaryDecision("node"),
      resolveProductRuntimeBinaryDecision("python"),
      resolveOpencodeBinaryDecision(null),
      probeVersion,
    );
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
      env: await resolveChildEnvironment(),
      timeoutMs: 120_000,
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const sandbox = createRuntimeSandbox({ resolveBinary, resolveChildEnvironment, issueOwnerToken });
  const sandboxDoctor = sandbox.sandboxDoctor;
  const sandboxStop = sandbox.sandboxStop;
  const sandboxCleanupOnMyAgentContainers = sandbox.sandboxCleanupOnMyAgentContainers;
  const orchestratorStartDetached = sandbox.orchestratorStartDetached;
  const sandboxDebugProbe = sandbox.sandboxDebugProbe;

  return {
    engineStart: (projectDir, options) => withRuntimeLifecycle(() => engineStart(projectDir, options)),
    engineStop: () => withRuntimeLifecycle(() => engineStop()),
    engineRestart: (options) => withRuntimeLifecycle(() => engineRestart(options)), refreshSkillLinks: () => withRuntimeLifecycle(() => refreshSkillLinks()),
    prepareFreshRuntime: () => withRuntimeLifecycle(() => prepareFreshRuntime()),
    dispose: () => withRuntimeLifecycle(() => stopAllRuntimeChildren()),
    runtimeStatus,
    engineInfo,
    engineDoctor,
    engineInstall,
    softwareEnvironmentInfo,
    runtimePathEntries: () => [...runtimeBinDirs],
    resolveChildEnvironment: (extra, options) =>
      withRuntimeLifecycle(() => resolveChildEnvironment(extra, options)),
    onmyagentServerInfo,
    onmyagentServerRestart,
    orchestratorStatus,
    orchestratorWorkspaceActivate,
    orchestratorInstanceDispose,
    orchestratorStartDetached,
    opencodeMcpAuth,
    /** Config dir last prepared for the desktop OpenCode session. */
    getActiveOpencodeConfigDir: () => activeOpencodeConfigDir,
    resolveLocalOpencodeConfigDir,
    onmyagentOpencodeConfigDir,
    sandboxDoctor,
    sandboxStop,
    sandboxCleanupOnMyAgentContainers,
    sandboxDebugProbe,
  };
}
