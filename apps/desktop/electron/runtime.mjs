import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  resolveLocalExpertsRoot,
  resolveLocalManagedToolsBinRoot,
  resolveLocalSkillsRoot,
} from "./config-profile-paths.mjs";
import { prepareOnMyAgentOpencodeConfigDir } from "./opencode-config-dir.mjs";
import { resolveExpertSessionRuntimeRoot } from "./expert-session-runtime-path.mjs";
import { createRuntimeBinaryResolver } from "./runtime-binaries.mjs";
import { createRuntimeChildEnv } from "./runtime-child-env.mjs";
import { createRuntimeSandbox } from "./runtime-sandbox.mjs";
import { createRuntimeTokenPortStore } from "./runtime-token-port.mjs";
import { createPrimaryRuntimeMcpProjectionProvider, resolveDesktopPrimaryRuntimePolicy } from "./primary-runtime-policy.mjs";
export {
  createDesktopPersonalRuntimeServices,
  wrapChannelApiForLazyInit,
} from "./personal-runtime-services.mjs";
import {
  DIRECT_RUNTIME,
  resolveShippedEngineRuntime,
  createEngineState,
  clearInProcessRuntimeFlags,
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
  stopChild as stopChildImpl,
} from "./runtime-opencode-lifecycle.mjs";
import {
  BUNDLED_PLUGINS_RESOURCE_DIR,
  BUNDLED_SKILLS_RESOURCE_DIR,
  buildBundledResourceCandidates,
  buildSoftwareEnvironmentInfo,
  firstExisting,
  normalizeWorkspaceKey,
  prioritizeWorkspacePaths,
} from "./runtime-helpers.mjs";
import {
  targetTriple,
  waitForHttpOk,
  fetchJson,
} from "./runtime-path-env.mjs";

export { snapshotOnMyAgentServerState, DIRECT_RUNTIME, ORCHESTRATOR_RUNTIME } from "./runtime-engine-state.mjs";
export { prioritizeWorkspacePaths, normalizeWorkspaceKey } from "./runtime-helpers.mjs";
const __runtimeDir = path.dirname(fileURLToPath(import.meta.url));

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
  let lifecycleState = "idle", activeOpencodeConfigDir = null; const primaryRuntimeMcp = createPrimaryRuntimeMcpProjectionProvider();
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

  const {
    resolveOpencodeBinaryDecision,
    resolveBundledBinaryInfo,
    resolveProductRuntimeBinaryDecision,
    probeVersion,
    resolveBinary,
    resolveOpencodeBinary,
    runShellCommand,
  } = createRuntimeBinaryResolver({
    app,
    sidecarDirs,
    runtimeRoot,
    runtimeBinDirs,
  });

  const {
    loadOrCreateWorkspaceTokens,
    persistWorkspaceOwnerToken,
    persistPreferredOnMyAgentPort,
    resolveOnMyAgentPort,
  } = createRuntimeTokenPortStore({ userDataDir, readJsonFile });

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

  const {
    resolveLocalOpencodeConfigDir,
    ensureDevModePaths,
    resolveChildEnvironment,
  } = createRuntimeChildEnv({
    app,
    userDataDir,
    resolvedHomeDir,
    desktopRoot,
    runtimeBinDirs,
    sidecarDirs,
    managedToolsBinRoot,
    runtimeEnvironment,
    prepareManagedOpencodeConfigDir,
    onmyagentOpencodeConfigDir,
  });

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

  let inProcessServer = null;

  async function stopInProcessServer() {
    try { await inProcessServer?.stop(); } catch { /* ignore */ }
    inProcessServer = null;
    clearInProcessRuntimeFlags(engineState, onmyagentServerState);
  }

  async function startOnMyAgentServer(options) {
    await stopInProcessServer();
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
    const primaryRuntimePolicy = resolveDesktopPrimaryRuntimePolicy({ serverEnv, homeDir: resolvedHomeDir, userDataDir, resolveBinary, resolveBundledBinaryInfo, probeVersion });
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
      ...primaryRuntimePolicy, readConnectorMcpProjection: primaryRuntimeMcp.read,
      onGlobalSkillsChanged: refreshSkillLinks,
    });
    inProcessServer = handle;

    const boundPort = handle.port;
    const baseUrl = handle.url;

    onmyagentServerState.inProcess = true;
    engineState.inProcess = true;
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
    await stopInProcessServer();
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
    const runtime = resolveShippedEngineRuntime(options.runtime);

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
    onmyagentOpencodeConfigDir, setPrimaryRuntimeMcpProjectionProvider: primaryRuntimeMcp.set,
    sandboxDoctor,
    sandboxStop,
    sandboxCleanupOnMyAgentContainers,
    sandboxDebugProbe,
  };
}
