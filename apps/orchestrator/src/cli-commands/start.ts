import {
  type ChildProcess,
} from "node:child_process";

import {
  randomUUID,
} from "node:crypto";

import {
  mkdir,
  access,
} from "node:fs/promises";

import {
  createServer as createHttpServer,
} from "node:http";

import {
  platform,
} from "node:os";

import {
  join,
  resolve,
} from "node:path";

import {
  once,
} from "node:events";

import {
  createOpencodeClient,
} from "@opencode-ai/sdk/v2/client";

import {
  assertManagedOpencodeAuth,
  encodeBasicAuth,
  resolveManagedOpencodeCredentials,
  resolveManagedOpencodeHost,
} from "../runtime-auth.js";

import {
  fetchOpenCodeRouterHealthViaOnMyAgent,
  waitForHealthy,
  waitForHealthyViaProxy,
  waitForOpenCodeRouterHealthy,
  waitForOpenCodeRouterHealthyViaOnMyAgent,
  waitForOpencodeHealthy,
} from "../runtime-health.js";

import {
  startOpenCodeRouter,
  startOpencode,
  startOnMyAgentServer,
  stopChild,
} from "../runtime-services.js";

import {
  probeCommand,
  resolveDockerCommand,
  resolveSandboxMode,
  stopAppleContainer,
  stopDockerContainer,
} from "../runtime-sandbox.js";

import {
  resolveSandboxSidecarTarget,
  resolveSidecarConfigForTarget,
} from "../sidecar-config.js";

import {
  resolveRouterDataDir,
} from "../data-dir.js";

import {
  resolveSandboxExtraMounts,
} from "../sandbox-mounts.js";

import {
  readVersionManifest,
} from "../version-manifest.js";

import {
  type TuiHandle,
} from "../tui/app.js";

import {
  createLogger,
  redactSensitiveString,
  type LogEvent,
} from "../cli-logging.js";

import {
  type ParsedArgs,
  parseList,
  readBinarySource,
  readBool,
  readFlag,
  readLogFormat,
  readNumber,
  readOpencodeHotReload,
  readSandboxMode,
} from "../cli-args.js";

import {
  type ApprovalMode,
  type BinaryDiagnostics,
  type ChildHandle,
  type RuntimeServiceName,
  type RuntimeUpgradeState,
  type SidecarDiagnostics,
  DEFAULT_APPROVAL_TIMEOUT,
  DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS,
  DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS,
  SANDBOX_INTERNAL_OPENCODE_PORT,
  assertSandboxBinaryFile,
  buildAttachCommand,
  buildRuntimeServiceSnapshot,
  copyToClipboard,
  createVerboseLogger,
  ensureOpencodeManagedTools,
  ensureOpencodeStateLayout,
  ensureWorkspace,
  fetchJson,
  installGlobalPackages,
  isCompiledBunBinary,
  isProcessAlive,
  issueOnMyAgentOwnerToken,
  postWorkerActivityHeartbeat,
  resolveCliVersion,
  resolveConnectUrl,
  resolveInternalDevMode,
  resolveOnMyAgentRemoteAccess,
  resolveOnMyAgentServerBin,
  resolveOpenCodeRouterBin,
  resolveOpencodeBin,
  resolveOpencodeLogLevel,
  resolveOpencodeRouterEnabled,
  resolveOpencodeStateLayout,
  resolvePort,
  resolveWorkerActivityHeartbeatConfig,
  runChecks,
  runSandboxChecks,
  startAppleContainerSandbox,
  startDockerSandbox,
  verifyOnMyAgentServer,
  verifyOpenCodeRouterVersion,
  verifyOpencodeVersion,
  workspaceIdForLocal,
} from "../cli-shared.js";

export async function runStart(args: ParsedArgs) {
  const outputJson = readBool(args.flags, "json", false);
  const checkOnly = readBool(args.flags, "check", false);
  const checkEvents = readBool(args.flags, "check-events", false);
  const verbose = readBool(args.flags, "verbose", false, "ONMYAGENT_VERBOSE");
  const logFormat = readLogFormat(
    args.flags,
    "log-format",
    "pretty",
    "ONMYAGENT_LOG_FORMAT",
  );
  const detachRequested = readBool(
    args.flags,
    "detach",
    false,
    "ONMYAGENT_DETACH",
  );
  const defaultTui =
    process.stdout.isTTY && !outputJson && !checkOnly && !checkEvents;
  const tuiRequested = readBool(args.flags, "tui", defaultTui);
  let useTui =
    tuiRequested &&
    !detachRequested &&
    !outputJson &&
    !checkOnly &&
    !checkEvents &&
    logFormat === "pretty";
  const colorPreferred =
    readBool(args.flags, "color", process.stdout.isTTY, "ONMYAGENT_COLOR") &&
    !process.env.NO_COLOR;
  const runId =
    readFlag(args.flags, "run-id") ??
    process.env.ONMYAGENT_RUN_ID ??
    randomUUID();
  const cliVersion = await resolveCliVersion();
  const compiledBinary = isCompiledBunBinary();
  let tui: TuiHandle | undefined;
  let restoreConsoleError: (() => void) | undefined;
  const baseLoggerOptions = {
    format: logFormat,
    runId,
    serviceName: "onmyagent-orchestrator",
    serviceVersion: cliVersion,
    onLog: (event: LogEvent) => {
      if (!tui) return;
      const component = event.component ?? "onmyagent-orchestrator";
      const tuiComponent =
        component === "opencode-router" ? "router" : component;
      tui.pushLog({
        time: event.time,
        level: event.level,
        component: tuiComponent,
        message: event.message,
      });
    },
  };
  let logger = createLogger({
    ...baseLoggerOptions,
    output: useTui ? "silent" : "stdout",
    color: useTui ? false : colorPreferred,
  });
  let logVerbose = createVerboseLogger(
    verbose && !outputJson,
    logger,
    "onmyagent-orchestrator",
  );
  const switchToPlainOutput = (error: string) => {
    if (!useTui) return;
    useTui = false;
    restoreConsoleError?.();
    restoreConsoleError = undefined;
    tui?.stop();
    tui = undefined;
    logger = createLogger({
      ...baseLoggerOptions,
      output: "stdout",
      color: colorPreferred,
    });
    logVerbose = createVerboseLogger(
      verbose && !outputJson,
      logger,
      "onmyagent-orchestrator",
    );
    logger.warn(
      "TUI failed to start; falling back to plain output. Use `onmyagent serve` for explicit non-TUI mode.",
      { error },
      "onmyagent-orchestrator",
    );
  };
  const sidecarSourceInput = readBinarySource(
    args.flags,
    "sidecar-source",
    "auto",
    "ONMYAGENT_SIDECAR_SOURCE",
  );
  const opencodeSourceInput = readBinarySource(
    args.flags,
    "opencode-source",
    "auto",
    "ONMYAGENT_OPENCODE_SOURCE",
  );

  const workspace =
    readFlag(args.flags, "workspace") ??
    process.env.ONMYAGENT_WORKSPACE ??
    process.cwd();
  const resolvedWorkspace = await ensureWorkspace(workspace);
  logger.info(
    "Run starting",
    { workspace: resolvedWorkspace, logFormat, runId },
    "onmyagent-orchestrator",
  );

  const sandboxRequested = readSandboxMode(
    args.flags,
    "sandbox",
    "none",
    "ONMYAGENT_SANDBOX",
  );
  const sandboxMode = await resolveSandboxMode(sandboxRequested);
  const sandboxImage =
    readFlag(args.flags, "sandbox-image") ??
    process.env.ONMYAGENT_SANDBOX_IMAGE ??
    "debian:bookworm-slim";
  const sandboxPersistOverride =
    readFlag(args.flags, "sandbox-persist-dir") ??
    process.env.ONMYAGENT_SANDBOX_PERSIST_DIR;
  const dataDir = resolveRouterDataDir(args.flags, readFlag);
  const devMode = resolveInternalDevMode(args.flags);
  const opencodeStateLayout = await resolveOpencodeStateLayout({
    dataDir,
    workspace: resolvedWorkspace,
    devMode,
  });
  const opencodeConfigDir = opencodeStateLayout.configDir;
  await ensureOpencodeStateLayout(opencodeStateLayout);
  await ensureOpencodeManagedTools(opencodeConfigDir);
  const opencodeRouterDataDir =
    sandboxMode === "none"
      ? join(dataDir, "opencode-router", workspaceIdForLocal(resolvedWorkspace))
      : null;
  if (opencodeRouterDataDir) {
    await mkdir(opencodeRouterDataDir, { recursive: true });
  }
  const sandboxPersistDir = resolve(
    sandboxPersistOverride?.trim()
      ? sandboxPersistOverride.trim()
      : join(dataDir, "sandbox", workspaceIdForLocal(resolvedWorkspace)),
  );
  if (sandboxMode !== "none") {
    await mkdir(sandboxPersistDir, { recursive: true });
  }

  const sandboxMountValue =
    readFlag(args.flags, "sandbox-mount") ?? process.env.ONMYAGENT_SANDBOX_MOUNT;
  const sandboxMountSpecs = parseList(sandboxMountValue);
  const sandboxExtraMounts =
    sandboxMode !== "none" && sandboxMountSpecs.length
      ? await resolveSandboxExtraMounts(sandboxMountSpecs, sandboxMode)
      : [];

  const explicitOpencodeBin =
    readFlag(args.flags, "opencode-bin") ?? process.env.ONMYAGENT_OPENCODE_BIN;
  const explicitOnMyAgentServerBin =
    readFlag(args.flags, "onmyagent-server-bin") ??
    process.env.ONMYAGENT_SERVER_BIN;
  const explicitOpenCodeRouterBin =
    readFlag(args.flags, "opencode-router-bin") ??
    process.env.OPENCODE_ROUTER_BIN;
  assertManagedOpencodeAuth(args);
  const opencodeBindHost = resolveManagedOpencodeHost(
    readFlag(args.flags, "opencode-host") ??
      process.env.ONMYAGENT_OPENCODE_BIND_HOST,
  );
  const opencodePort =
    sandboxMode !== "none"
      ? SANDBOX_INTERNAL_OPENCODE_PORT
      : await resolvePort(
          readNumber(
            args.flags,
            "opencode-port",
            undefined,
            "ONMYAGENT_OPENCODE_PORT",
          ),
          "127.0.0.1",
        );
  const opencodeLogLevel = resolveOpencodeLogLevel(
    readFlag(args.flags, "opencode-log-level") ??
      process.env.ONMYAGENT_OPENCODE_LOG_LEVEL,
  );
  const opencodeHotReload = readOpencodeHotReload(
    args.flags,
    {
      enabled: true,
      debounceMs: DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS,
      cooldownMs: DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS,
    },
    {
      enabled: "ONMYAGENT_OPENCODE_HOT_RELOAD",
      debounceMs: "ONMYAGENT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS",
      cooldownMs: "ONMYAGENT_OPENCODE_HOT_RELOAD_COOLDOWN_MS",
    },
  );
  const opencodeCredentials = resolveManagedOpencodeCredentials(args);
  const opencodeUsername = opencodeCredentials.username;
  const opencodePassword = opencodeCredentials.password;

  const remoteAccessEnabled = resolveOnMyAgentRemoteAccess(args);
  const onmyagentHost = remoteAccessEnabled ? "0.0.0.0" : "127.0.0.1";
  const onmyagentPort = await resolvePort(
    readNumber(args.flags, "onmyagent-port", undefined, "ONMYAGENT_PORT"),
    "127.0.0.1",
  );
  // Always choose a free opencodeRouter health port by default (avoid conflicts with
  // other local processes using 3005).
  const opencodeRouterHealthPort = await resolvePort(
    readNumber(
      args.flags,
      "opencode-router-health-port",
      undefined,
      "OPENCODE_ROUTER_HEALTH_PORT",
    ),
    "127.0.0.1",
  );
  const onmyagentToken =
    readFlag(args.flags, "onmyagent-token") ??
    process.env.ONMYAGENT_TOKEN ??
    randomUUID();
  const onmyagentHostToken =
    readFlag(args.flags, "onmyagent-host-token") ??
    process.env.ONMYAGENT_HOST_TOKEN ??
    randomUUID();
  const approvalMode =
    (readFlag(args.flags, "approval") as ApprovalMode | undefined) ??
    (process.env.ONMYAGENT_APPROVAL_MODE as ApprovalMode | undefined) ??
    "manual";
  const approvalTimeoutMs = readNumber(
    args.flags,
    "approval-timeout",
    DEFAULT_APPROVAL_TIMEOUT,
    "ONMYAGENT_APPROVAL_TIMEOUT_MS",
  ) as number;
  const readOnly = readBool(
    args.flags,
    "read-only",
    false,
    "ONMYAGENT_READONLY",
  );
  const corsValue =
    readFlag(args.flags, "cors") ?? process.env.ONMYAGENT_CORS_ORIGINS ?? "*";
  const corsOrigins = parseList(corsValue);
  const connectHost = readFlag(args.flags, "connect-host");

  const manifest = await readVersionManifest();
  const allowExternal = readBool(
    args.flags,
    "allow-external",
    false,
    "ONMYAGENT_ALLOW_EXTERNAL",
  );
  const sidecarTarget = resolveSandboxSidecarTarget(sandboxMode);
  const sidecar = resolveSidecarConfigForTarget(
    args.flags,
    cliVersion,
    sidecarTarget,
    readFlag,
  );

  let sidecarSource = sidecarSourceInput;
  let opencodeSource = opencodeSourceInput;
  if (sandboxMode !== "none") {
    if (sidecarSourceInput === "bundled") {
      throw new Error("Sandbox mode does not support --sidecar-source bundled");
    }
    if (opencodeSourceInput === "bundled") {
      throw new Error(
        "Sandbox mode does not support --opencode-source bundled",
      );
    }
    // In sandbox mode, we must run Linux binaries inside the container. When
    // custom *-bin paths are provided, treat the source as external so we don't
    // accidentally pick host (darwin) bundled binaries.
    if (sidecarSourceInput === "auto") {
      sidecarSource =
        explicitOnMyAgentServerBin || explicitOpenCodeRouterBin
          ? "external"
          : "downloaded";
    }
    if (opencodeSourceInput === "auto") {
      opencodeSource = explicitOpencodeBin ? "external" : "downloaded";
    }
  }
  const dockerCommand =
    sandboxMode === "docker" ? await resolveDockerCommand() : null;
  logVerbose(`cli version: ${cliVersion}`);
  logVerbose(`sandbox: ${sandboxMode}`);
  if (dockerCommand) {
    logVerbose(`docker bin: ${dockerCommand}`);
  }
  if (sandboxMode !== "none") {
    logVerbose(`sandbox image: ${sandboxImage}`);
    logVerbose(`sandbox persist dir: ${sandboxPersistDir}`);
    if (sandboxExtraMounts.length) {
      logVerbose(`sandbox mounts: ${sandboxExtraMounts.length}`);
    }
  }
  logVerbose(`sidecar target: ${sidecar.target ?? "unknown"}`);
  logVerbose(`sidecar dir: ${sidecar.dir}`);
  logVerbose(`sidecar base URL: ${sidecar.baseUrl}`);
  logVerbose(`sidecar manifest: ${sidecar.manifestUrl}`);
  logVerbose(`sidecar source: ${sidecarSource}`);
  logVerbose(`opencode source: ${opencodeSource}`);
  logVerbose(
    `opencode hot reload: ${opencodeHotReload.enabled ? "on" : "off"} (debounce=${opencodeHotReload.debounceMs}ms cooldown=${opencodeHotReload.cooldownMs}ms)`,
  );
  logVerbose(`allow external: ${allowExternal ? "true" : "false"}`);
  let opencodeBinary = await resolveOpencodeBin({
    explicit: explicitOpencodeBin,
    manifest,
    allowExternal,
    sidecar,
    source: opencodeSource,
  });

  if (sandboxMode !== "none") {
    if (sandboxMode === "docker") {
      if (!(await probeCommand(dockerCommand ?? "docker", ["version"]))) {
        throw new Error(
          `Docker is required for --sandbox docker. Install Docker Desktop and ensure '${dockerCommand ?? "docker"}' is available.`,
        );
      }
    }
    if (sandboxMode === "container") {
      if (process.platform !== "darwin") {
        throw new Error("Apple container backend is only supported on macOS");
      }
      if (process.arch !== "arm64") {
        throw new Error(
          "Apple container backend requires Apple silicon (arm64)",
        );
      }
      if (!(await probeCommand("container", ["--version"]))) {
        throw new Error(
          "Apple container CLI not found. Install https://github.com/apple/container",
        );
      }
    }
  }
  const opencodeRouterMode = await resolveOpencodeRouterEnabled(
    args.flags,
    resolvedWorkspace,
    logger,
  );
  const opencodeRouterEnabled = opencodeRouterMode.enabled;
  const opencodeRouterRequired = readBool(
    args.flags,
    "opencode-router-required",
    false,
    "ONMYAGENT_OPENCODE_ROUTER_REQUIRED",
  );
  logVerbose(
    `opencodeRouter enabled: ${opencodeRouterEnabled ? "true" : "false"} (${opencodeRouterMode.source})`,
  );
  let onmyagentServerBinary = await resolveOnMyAgentServerBin({
    explicit: explicitOnMyAgentServerBin,
    manifest,
    allowExternal,
    sidecar,
    source: sidecarSource,
  });
  let opencodeRouterBinary = opencodeRouterEnabled
    ? await resolveOpenCodeRouterBin({
        explicit: explicitOpenCodeRouterBin,
        manifest,
        allowExternal,
        sidecar,
        source: sidecarSource,
      })
    : null;

  if (sandboxMode !== "none") {
    // Ensure the binaries we stage into the container are actual files.
    await assertSandboxBinaryFile("opencode", opencodeBinary.bin);
    await assertSandboxBinaryFile("onmyagent-server", onmyagentServerBinary.bin);
    if (opencodeRouterBinary) {
      await assertSandboxBinaryFile(
        "opencode-router",
        opencodeRouterBinary.bin,
      );
    }
  }
  let opencodeRouterActualVersion: string | undefined;
  logVerbose(`opencode bin: ${opencodeBinary.bin} (${opencodeBinary.source})`);
  logVerbose(
    `onmyagent-server bin: ${onmyagentServerBinary.bin} (${onmyagentServerBinary.source})`,
  );
  if (opencodeRouterBinary) {
    logVerbose(
      `opencodeRouter bin: ${opencodeRouterBinary.bin} (${opencodeRouterBinary.source})`,
    );
  }

  const onmyagentBaseUrl = `http://127.0.0.1:${onmyagentPort}`;
  const onmyagentConnect = remoteAccessEnabled
    ? resolveConnectUrl(onmyagentPort, connectHost)
    : {};
  const onmyagentConnectUrl = onmyagentConnect.connectUrl ?? onmyagentBaseUrl;

  const opencodeBaseUrl =
    sandboxMode !== "none"
      ? `${onmyagentBaseUrl}/opencode`
      : `http://127.0.0.1:${opencodePort}`;
  const opencodeConnectUrl =
    sandboxMode !== "none"
      ? `${onmyagentConnectUrl.replace(/\/$/, "")}/opencode`
      : opencodeBaseUrl;

  const attachCommand =
    sandboxMode !== "none"
      ? `OpenCode is proxied via ${opencodeConnectUrl} (requires OnMyAgent token)`
      : buildAttachCommand({
          url: opencodeConnectUrl,
          workspace: resolvedWorkspace,
          username: opencodeUsername,
          password: opencodeCredentials.password,
        });

  const opencodeRouterHealthUrl = `http://127.0.0.1:${opencodeRouterHealthPort}`;
  const opencodeRouterEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_DIRECTORY: resolvedWorkspace,
    OPENCODE_URL: opencodeConnectUrl,
    ...(opencodeUsername ? { OPENCODE_SERVER_USERNAME: opencodeUsername } : {}),
    ...(opencodePassword ? { OPENCODE_SERVER_PASSWORD: opencodePassword } : {}),
    ...(opencodeRouterEnabled
      ? { OPENCODE_ROUTER_HEALTH_PORT: String(opencodeRouterHealthPort) }
      : {}),
  };

  const children: ChildHandle[] = [];
  let shuttingDown = false;
  let detached = false;
  let sandboxContainerName: string | null = null;
  let sandboxStop: ((name: string) => Promise<void>) | null = null;
  let sandboxStopCommand: string | null = null;
  let sandboxCleanup: (() => Promise<void>) | null = null;
  let opencodeChild: ChildProcess | null = null;
  let onmyagentChild: ChildProcess | null = null;
  let opencodeRouterChild: ChildProcess | null = null;
  let controlServer: ReturnType<typeof createHttpServer> | null = null;
  const controlPort = await resolvePort(undefined, "127.0.0.1");
  const controlToken = randomUUID();
  const controlBaseUrl = `http://127.0.0.1:${controlPort}`;
  let opencodeActualVersion: string | undefined;
  let onmyagentActualVersion: string | undefined;
  let onmyagentOwnerToken: string | undefined;
  const startedAt = Date.now();
  let opencodeRouterHealthInterval: NodeJS.Timeout | null = null;
  const workerActivityHeartbeat = resolveWorkerActivityHeartbeatConfig();
  let workerActivityHeartbeatInterval: NodeJS.Timeout | null = null;
  const restartingServices = new Set<string>();
  const runtimeUpgradeState: RuntimeUpgradeState = {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    error: null,
    operationId: null,
    services: [],
  };
  const removeChildHandle = (name: string) => {
    const index = children.findIndex((handle) => handle.name === name);
    if (index >= 0) children.splice(index, 1);
  };
  const getRuntimeSnapshot = () => {
    const services = [
      buildRuntimeServiceSnapshot({
        name: "onmyagent-server",
        enabled: true,
        running: Boolean(onmyagentChild && isProcessAlive(onmyagentChild.pid)),
        binary: onmyagentServerBinary,
        actualVersion: onmyagentActualVersion,
      }),
      buildRuntimeServiceSnapshot({
        name: "opencode",
        enabled: true,
        running: Boolean(opencodeChild && isProcessAlive(opencodeChild.pid)),
        binary: opencodeBinary,
        actualVersion: opencodeActualVersion,
      }),
      buildRuntimeServiceSnapshot({
        name: "opencode-router",
        enabled: Boolean(opencodeRouterEnabled && opencodeRouterBinary),
        running: Boolean(
          opencodeRouterChild && isProcessAlive(opencodeRouterChild.pid),
        ),
        binary: opencodeRouterBinary,
        actualVersion: opencodeRouterActualVersion,
      }),
    ];
    return {
      ok: true,
      orchestrator: {
        version: cliVersion,
        startedAt,
      },
      worker: {
        workspace: resolvedWorkspace,
        sandboxMode,
      },
      upgrade: {
        ...runtimeUpgradeState,
      },
      services,
    };
  };
  const restartOpencode = async () => {
    if (sandboxMode !== "none") {
      throw new Error(
        "Runtime upgrade is not supported while sandbox mode is enabled",
      );
    }
    if (opencodeChild) {
      restartingServices.add("opencode");
      removeChildHandle("opencode");
      await stopChild(opencodeChild);
      opencodeChild = null;
    }
    opencodeActualVersion = await verifyOpencodeVersion(opencodeBinary);
    const child = await startOpencode({
      bin: opencodeBinary.bin,
      workspace: resolvedWorkspace,
      stateLayout: opencodeStateLayout,
      hotReload: opencodeHotReload,
      bindHost: opencodeBindHost,
      port: opencodePort,
      username: opencodeUsername,
      password: opencodePassword,
      corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
      logger,
      runId,
      logFormat,
      logLevel: opencodeLogLevel,
      opencodeRouterHealthPort: opencodeRouterEnabled
        ? opencodeRouterHealthPort
        : undefined,
    });
    opencodeChild = child;
    children.push({ name: "opencode", child });
    logger.info(
      "Process spawned",
      { pid: child.pid ?? 0, cause: "runtime-upgrade" },
      "opencode",
    );
    child.on("exit", (code, signal) => handleExit("opencode", code, signal));
    child.on("error", (error) => handleSpawnError("opencode", error));
    await waitForOpencodeHealthy(
      createOpencodeClient({
        baseUrl: opencodeBaseUrl,
        directory: resolvedWorkspace,
        headers:
          opencodeUsername && opencodePassword
            ? {
          Authorization: `Basic ${encodeBasicAuth(opencodeCredentials.username, opencodeCredentials.password)}`,
              }
            : undefined,
      }),
    );
  };
  const restartOnMyAgentServer = async () => {
    if (sandboxMode !== "none") {
      throw new Error(
        "Runtime upgrade is not supported while sandbox mode is enabled",
      );
    }
    if (onmyagentChild) {
      restartingServices.add("onmyagent-server");
      removeChildHandle("onmyagent-server");
      await stopChild(onmyagentChild);
      onmyagentChild = null;
    }
    const child = await startOnMyAgentServer({
      bin: onmyagentServerBinary.bin,
      host: onmyagentHost,
      port: onmyagentPort,
      workspace: resolvedWorkspace,
      token: onmyagentToken,
      hostToken: onmyagentHostToken,
      approvalMode: approvalMode === "auto" ? "auto" : "manual",
      approvalTimeoutMs,
      readOnly,
      corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
      opencodeBaseUrl: opencodeConnectUrl,
      opencodeDirectory: resolvedWorkspace,
      opencodeUsername,
      opencodePassword,
      opencodeRouterHealthPort: opencodeRouterEnabled
        ? opencodeRouterHealthPort
        : undefined,
      opencodeRouterDataDir: opencodeRouterEnabled
        ? (opencodeRouterDataDir ?? undefined)
        : undefined,
      logger,
      runId,
      logFormat,
      controlBaseUrl,
      controlToken,
    });
    onmyagentChild = child;
    children.push({ name: "onmyagent-server", child });
    logger.info(
      "Process spawned",
      { pid: child.pid ?? 0, cause: "runtime-upgrade" },
      "onmyagent-server",
    );
    child.on("exit", (code, signal) =>
      handleExit("onmyagent-server", code, signal),
    );
    child.on("error", (error) => handleSpawnError("onmyagent-server", error));
    await waitForHealthy(onmyagentBaseUrl);
    onmyagentActualVersion = await verifyOnMyAgentServer({
      baseUrl: onmyagentBaseUrl,
      token: onmyagentToken,
      hostToken: onmyagentHostToken,
      expectedVersion: onmyagentServerBinary.expectedVersion,
      expectedWorkspace: resolvedWorkspace,
      expectedOpencodeBaseUrl: opencodeConnectUrl,
      expectedOpencodeDirectory: resolvedWorkspace,
      expectedOpencodeUsername: opencodeUsername,
      expectedOpencodePassword: opencodePassword,
    });
  };
  const restartOpenCodeRouter = async () => {
    if (
      !opencodeRouterEnabled ||
      !opencodeRouterBinary ||
      sandboxMode !== "none"
    ) {
      return;
    }
    if (opencodeRouterChild) {
      restartingServices.add("opencode-router");
      removeChildHandle("opencode-router");
      await stopChild(opencodeRouterChild);
      opencodeRouterChild = null;
    }
    opencodeRouterActualVersion =
      await verifyOpenCodeRouterVersion(opencodeRouterBinary);
    opencodeRouterChild = await startOpenCodeRouter({
      bin: opencodeRouterBinary.bin,
      workspace: resolvedWorkspace,
      opencodeUrl: opencodeConnectUrl,
      opencodeUsername,
      opencodePassword,
      opencodeRouterHealthPort,
      opencodeRouterDataDir: opencodeRouterDataDir ?? undefined,
      logger,
      runId,
      logFormat,
    });
    children.push({ name: "opencode-router", child: opencodeRouterChild });
    opencodeRouterChild.on("exit", (code, signal) =>
      handleExit("opencode-router", code, signal),
    );
    opencodeRouterChild.on("error", (error) =>
      handleSpawnError("opencode-router", error),
    );
    await waitForOpenCodeRouterHealthy(
      `http://127.0.0.1:${opencodeRouterHealthPort}`,
      10_000,
      400,
    );
  };
  const performRuntimeUpgrade = async (services: RuntimeServiceName[]) => {
    const opId = randomUUID();
    runtimeUpgradeState.status = "running";
    runtimeUpgradeState.startedAt = Date.now();
    runtimeUpgradeState.finishedAt = null;
    runtimeUpgradeState.error = null;
    runtimeUpgradeState.operationId = opId;
    runtimeUpgradeState.services = services;
    try {
      if (sandboxMode !== "none") {
        throw new Error(
          "Runtime upgrade is only supported for non-sandbox workers",
        );
      }
      if (
        services.includes("onmyagent-server") &&
        onmyagentServerBinary.source === "external" &&
        onmyagentServerBinary.expectedVersion
      ) {
        await installGlobalPackages([
          `onmyagent-server@${onmyagentServerBinary.expectedVersion}`,
        ]);
      }
      if (
        services.includes("opencode-router") &&
        opencodeRouterBinary?.source === "external" &&
        opencodeRouterBinary.expectedVersion
      ) {
        await installGlobalPackages([
          `opencode-router@${opencodeRouterBinary.expectedVersion}`,
        ]);
      }
      if (services.includes("onmyagent-server")) {
        onmyagentServerBinary = await resolveOnMyAgentServerBin({
          explicit: explicitOnMyAgentServerBin,
          manifest,
          allowExternal,
          sidecar,
          source: sidecarSource,
        });
      }
      if (services.includes("opencode")) {
        opencodeBinary = await resolveOpencodeBin({
          explicit: explicitOpencodeBin,
          manifest,
          allowExternal,
          sidecar,
          source: opencodeSource,
        });
      }
      if (services.includes("opencode-router") && opencodeRouterEnabled) {
        opencodeRouterBinary = await resolveOpenCodeRouterBin({
          explicit: explicitOpenCodeRouterBin,
          manifest,
          allowExternal,
          sidecar,
          source: sidecarSource,
        });
      }
      if (services.includes("opencode")) {
        await restartOpencode();
      }
      if (services.includes("opencode-router")) {
        await restartOpenCodeRouter();
      }
      if (
        services.includes("onmyagent-server") ||
        services.includes("opencode")
      ) {
        await restartOnMyAgentServer();
      }
      runtimeUpgradeState.status = "idle";
      runtimeUpgradeState.finishedAt = Date.now();
    } catch (error) {
      runtimeUpgradeState.status = "failed";
      runtimeUpgradeState.finishedAt = Date.now();
      runtimeUpgradeState.error =
        error instanceof Error ? error.message : String(error);
      logger.error(
        "Runtime upgrade failed",
        { error: runtimeUpgradeState.error, services },
        "onmyagent-orchestrator",
      );
    }
  };
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    restoreConsoleError?.();
    restoreConsoleError = undefined;
    if (opencodeRouterHealthInterval) {
      clearInterval(opencodeRouterHealthInterval);
      opencodeRouterHealthInterval = null;
    }
    if (workerActivityHeartbeatInterval) {
      clearInterval(workerActivityHeartbeatInterval);
      workerActivityHeartbeatInterval = null;
    }
    if (controlServer) {
      await new Promise<void>((resolve) =>
        controlServer?.close(() => resolve()),
      );
      controlServer = null;
    }
    logger.info(
      "Shutting down",
      { children: children.map((handle) => handle.name) },
      "onmyagent-orchestrator",
    );
    if (sandboxContainerName && sandboxStop) {
      await sandboxStop(sandboxContainerName);
    }
    await Promise.all(children.map((handle) => stopChild(handle.child)));
    if (sandboxCleanup) {
      await sandboxCleanup();
      sandboxCleanup = null;
    }
  };

  const detachChildren = () => {
    detached = true;
    for (const handle of children) {
      try {
        handle.child.unref();
      } catch {
        // ignore
      }
      handle.child.stdout?.removeAllListeners();
      handle.child.stderr?.removeAllListeners();
      handle.child.stdout?.destroy();
      handle.child.stderr?.destroy();
    }
  };

  const handleQuit = async () => {
    tui?.stop();
    await shutdown();
    process.exit(0);
  };

  const handleDetach = async () => {
    if (detached) return;
    restoreConsoleError?.();
    restoreConsoleError = undefined;
    if (opencodeRouterHealthInterval) {
      clearInterval(opencodeRouterHealthInterval);
      opencodeRouterHealthInterval = null;
    }
    if (workerActivityHeartbeatInterval) {
      clearInterval(workerActivityHeartbeatInterval);
      workerActivityHeartbeatInterval = null;
    }
    tui?.stop();
    detachChildren();
    const summary = [
      "Detached. Services still running:",
      ...children.map(
        (handle) => `- ${handle.name} (pid ${handle.child.pid ?? "unknown"})`,
      ),
      ...(sandboxContainerName && sandboxStopCommand
        ? [
            `- sandbox (${sandboxStopCommand.split(" ")[0]} container ${sandboxContainerName})`,
            `Stop: ${sandboxStopCommand} ${sandboxContainerName}`,
          ]
        : []),
      `OnMyAgent URL: ${onmyagentConnectUrl}`,
      "Credentials withheld from detached stdout.",
      ...(onmyagentOwnerToken ? ["OnMyAgent owner token issued."] : []),
      `OpenCode URL: ${opencodeConnectUrl}`,
      `Attach: ${redactSensitiveString(attachCommand)}`,
      "Use `--json` only when you explicitly need the raw tokens or passwords in command output.",
    ].join("\n");
    process.stdout.write(`${summary}\n`);
    process.exit(0);
  };

  if (useTui) {
    if (compiledBinary) {
      const originalConsoleError = console.error.bind(console);
      restoreConsoleError = () => {
        console.error = originalConsoleError;
      };
      console.error = (...items: unknown[]) => {
        const text = items
          .map((item) => {
            if (typeof item === "string") return item;
            if (item instanceof Error) return `${item.name}: ${item.message}`;
            return String(item);
          })
          .join(" ");
        if (
          text.includes("React is not defined") ||
          text.includes("/$bunfs/root/onmyagent-orchestrator") ||
          text.includes("/$bunfs/root/onmyagent")
        ) {
          switchToPlainOutput(text);
        }
        originalConsoleError(...items);
      };
    }
    try {
      const { startOrchestratorTui } = await import("../tui/app.js");
      tui = startOrchestratorTui({
        version: cliVersion,
        connect: {
          runId,
          workspace: resolvedWorkspace,
          onmyagentUrl: onmyagentConnectUrl,
          onmyagentToken,
          ownerToken: onmyagentOwnerToken,
          hostToken: onmyagentHostToken,
          opencodeUrl: opencodeConnectUrl,
          opencodePassword:
            sandboxMode !== "none"
              ? undefined
              : (opencodePassword ?? undefined),
          opencodeUsername:
            sandboxMode !== "none"
              ? undefined
              : (opencodeUsername ?? undefined),
          attachCommand,
        },
        services: [
          {
            name: "opencode",
            label: "opencode",
            status: "starting",
            port: opencodePort,
          },
          {
            name: "onmyagent-server",
            label: "onmyagent-server",
            status: "starting",
            port: onmyagentPort,
          },
          {
            name: "router",
            label: "opencode-router",
            status: opencodeRouterEnabled ? "starting" : "disabled",
            port: sandboxMode !== "none" ? undefined : opencodeRouterHealthPort,
          },
        ],
        onQuit: handleQuit,
        onDetach: handleDetach,
        onCopyAttach: async () => {
          const result = await copyToClipboard(attachCommand);
          return { command: attachCommand, ...result };
        },
        onCopySelection: async (text) => copyToClipboard(text),
        onRouterHealth: async () =>
          fetchOpenCodeRouterHealthViaOnMyAgent(onmyagentBaseUrl, onmyagentToken),
        onRouterTelegramIdentities: async () => {
          const url = `${onmyagentBaseUrl.replace(/\/$/, "")}/opencode-router/identities/telegram`;
          const result = await fetchJson(url, {
            headers: {
              "X-OnMyAgent-Host-Token": onmyagentHostToken,
            },
          });
          const items = Array.isArray(result?.items) ? result.items : [];
          return { items };
        },
        onRouterSlackIdentities: async () => {
          const url = `${onmyagentBaseUrl.replace(/\/$/, "")}/opencode-router/identities/slack`;
          const result = await fetchJson(url, {
            headers: {
              "X-OnMyAgent-Host-Token": onmyagentHostToken,
            },
          });
          const items = Array.isArray(result?.items) ? result.items : [];
          return { items };
        },
        onRouterSetGroupsEnabled: async (enabled) => {
          try {
            const url = `${onmyagentBaseUrl.replace(/\/$/, "")}/opencode-router/config/groups`;
            await fetchJson(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-OnMyAgent-Host-Token": onmyagentHostToken,
              },
              body: JSON.stringify({ enabled }),
            });
            return { ok: true };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
        onRouterSetTelegramToken: async (token) => {
          try {
            const url = `${onmyagentBaseUrl.replace(/\/$/, "")}/opencode-router/identities/telegram`;
            await fetchJson(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-OnMyAgent-Host-Token": onmyagentHostToken,
              },
              body: JSON.stringify({ id: "default", token, enabled: true }),
            });
            return { ok: true };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
        onRouterSetSlackTokens: async (botToken, appToken) => {
          try {
            const url = `${onmyagentBaseUrl.replace(/\/$/, "")}/opencode-router/identities/slack`;
            await fetchJson(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-OnMyAgent-Host-Token": onmyagentHostToken,
              },
              body: JSON.stringify({
                id: "default",
                botToken,
                appToken,
                enabled: true,
              }),
            });
            return { ok: true };
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });
      tui.setUptimeStart(startedAt);
    } catch (error) {
      switchToPlainOutput(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const tuiServiceName = (name: string) =>
    name === "opencode-router" ? "router" : name;

  const handleExit = (
    name: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => {
    if (shuttingDown || detached) return;
    if (restartingServices.has(name)) {
      restartingServices.delete(name);
      return;
    }
    const reason =
      code !== null ? `code ${code}` : signal ? `signal ${signal}` : "unknown";
    const services =
      name === "sandbox"
        ? ["opencode", "onmyagent-server", "router"]
        : [tuiServiceName(name)];
    for (const service of services) {
      tui?.updateService(service, { status: "stopped", message: reason });
    }
    logger.error("Process exited", { reason, code, signal }, name);
    void shutdown().then(() => process.exit(code ?? 1));
  };

  const handleSpawnError = (name: string, error: unknown) => {
    if (shuttingDown || detached) return;
    tui?.updateService(tuiServiceName(name), {
      status: "error",
      message: String(error),
    });
    logger.error("Process failed to start", { error: String(error) }, name);
    void shutdown().then(() => process.exit(1));
  };

  try {
    opencodeActualVersion =
      sandboxMode !== "none"
        ? opencodeBinary.expectedVersion
        : await verifyOpencodeVersion(opencodeBinary);
    let opencodeClient: ReturnType<typeof createOpencodeClient>;

    controlServer = createHttpServer(async (req, res) => {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", controlBaseUrl);
      res.setHeader("Content-Type", "application/json");
      const authHeader = req.headers.authorization ?? "";
      if (authHeader !== `Bearer ${controlToken}`) {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }
      if (method === "GET" && url.pathname === "/runtime/versions") {
        res.statusCode = 200;
        res.end(JSON.stringify(getRuntimeSnapshot()));
        return;
      }
      if (method === "POST" && url.pathname === "/runtime/upgrade") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        let body: { services?: RuntimeServiceName[] } | null = null;
        try {
          body = chunks.length
            ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                services?: RuntimeServiceName[];
              })
            : null;
        } catch {
          body = null;
        }
        const requested = Array.isArray(body?.services)
          ? body.services
          : ["onmyagent-server", "opencode"];
        const services = Array.from(
          new Set(
            requested.filter(
              (item): item is RuntimeServiceName =>
                item === "onmyagent-server" ||
                item === "opencode" ||
                item === "opencode-router",
            ),
          ),
        );
        if (!services.length) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: "invalid_services" }));
          return;
        }
        if (runtimeUpgradeState.status === "running") {
          res.statusCode = 409;
          res.end(
            JSON.stringify({
              ok: false,
              error: "upgrade_in_progress",
              upgrade: runtimeUpgradeState,
            }),
          );
          return;
        }
        res.statusCode = 202;
        res.end(
          JSON.stringify({
            ok: true,
            started: true,
            services,
            upgrade: { ...runtimeUpgradeState, status: "running" },
          }),
        );
        void performRuntimeUpgrade(services);
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
    });
    await new Promise<void>((resolve, reject) => {
      controlServer?.once("error", reject);
      controlServer?.listen(controlPort, "127.0.0.1", () => resolve());
    });

    if (sandboxMode !== "none") {
      const containerName = `onmyagent-orchestrator-${runId.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 24)}`;
      sandboxContainerName = containerName;

      sandboxStop =
        sandboxMode === "container"
          ? stopAppleContainer
          : (name: string) =>
              stopDockerContainer(name, dockerCommand ?? "docker");
      sandboxStopCommand =
        sandboxMode === "container" ? "container stop" : "docker stop";
      const opencodeInternalBaseUrl = `http://127.0.0.1:${SANDBOX_INTERNAL_OPENCODE_PORT}`;

      const sandboxChild =
        sandboxMode === "container"
          ? await startAppleContainerSandbox({
              image: sandboxImage,
              containerName,
              workspace: resolvedWorkspace,
              persistDir: sandboxPersistDir,
              opencodeConfigDir,
              extraMounts: sandboxExtraMounts,
              sidecars: {
                opencode: opencodeBinary.bin,
                onmyagentServer: onmyagentServerBinary.bin,
                opencodeRouter: opencodeRouterEnabled
                  ? (opencodeRouterBinary?.bin ?? null)
                  : null,
              },
              ports: {
                onmyagent: onmyagentPort,
                // In sandbox mode, opencodeRouter is only reachable via onmyagent-server
                // proxy (/opencode-router/*). Do not publish a separate host port.
                opencodeRouterHealth: null,
              },
              opencode: {
                corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
                username: opencodeUsername,
                password: opencodePassword,
                hotReload: opencodeHotReload,
                logLevel: opencodeLogLevel,
              },
              onmyagent: {
                token: onmyagentToken,
                hostToken: onmyagentHostToken,
                approvalMode: approvalMode === "auto" ? "auto" : "manual",
                approvalTimeoutMs,
                readOnly,
                corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
                opencodeUsername,
                opencodePassword,
                logFormat,
              },
              runId,
              logFormat,
              detach: detachRequested,
              devMode,
              logger,
            })
          : await startDockerSandbox({
              image: sandboxImage,
              dockerCommand: dockerCommand ?? "docker",
              containerName,
              workspace: resolvedWorkspace,
              persistDir: sandboxPersistDir,
              opencodeConfigDir,
              extraMounts: sandboxExtraMounts,
              sidecars: {
                opencode: opencodeBinary.bin,
                onmyagentServer: onmyagentServerBinary.bin,
                opencodeRouter: opencodeRouterEnabled
                  ? (opencodeRouterBinary?.bin ?? null)
                  : null,
              },
              ports: {
                onmyagent: onmyagentPort,
                // In sandbox mode, opencodeRouter is only reachable via onmyagent-server
                // proxy (/opencode-router/*). Do not publish a separate host port.
                opencodeRouterHealth: null,
              },
              opencode: {
                corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
                username: opencodeUsername,
                password: opencodePassword,
                hotReload: opencodeHotReload,
                logLevel: opencodeLogLevel,
              },
              onmyagent: {
                token: onmyagentToken,
                hostToken: onmyagentHostToken,
                approvalMode: approvalMode === "auto" ? "auto" : "manual",
                approvalTimeoutMs,
                readOnly,
                corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
                opencodeUsername,
                opencodePassword,
                logFormat,
              },
              runId,
              logFormat,
              detach: detachRequested,
              devMode,
              logger,
            });

      sandboxCleanup = sandboxChild.cleanup;
      tui?.updateService("opencode", {
        status: "running",
        port: SANDBOX_INTERNAL_OPENCODE_PORT,
      });
      tui?.updateService("onmyagent-server", {
        status: "running",
        port: onmyagentPort,
      });
      if (opencodeRouterEnabled) {
        tui?.updateService("router", { status: "running", port: undefined });
      }

      if (!detachRequested) {
        children.push({ name: "sandbox", child: sandboxChild.child });
        logger.info(
          "Process spawned",
          { pid: sandboxChild.child.pid ?? 0, containerName },
          "sandbox",
        );
        sandboxChild.child.on("exit", (code, signal) =>
          handleExit("sandbox", code, signal),
        );
        sandboxChild.child.on("error", (error) =>
          handleSpawnError("sandbox", error),
        );
      } else {
        // docker run -d exits quickly; the container continues to run.
        logger.info("Sandbox detached", { containerName }, "sandbox");
      }

      logger.info(
        "Waiting for health",
        { url: onmyagentBaseUrl },
        "onmyagent-server",
      );
      await waitForHealthy(onmyagentBaseUrl);
      logger.info("Healthy", { url: onmyagentBaseUrl }, "onmyagent-server");
      tui?.updateService("onmyagent-server", { status: "healthy" });

      opencodeClient = createOpencodeClient({
        baseUrl: `${onmyagentBaseUrl.replace(/\/$/, "")}/opencode`,
        headers: { Authorization: `Bearer ${onmyagentToken}` },
      });

      // In sandbox mode, the released onmyagent-server binary may not have our
      // latest proxy/auth changes yet.  Instead of using the OpenCode SDK client
      // (which relies on the proxy handling Bearer tokens), do a direct health
      // check against the onmyagent-server's own /opencode proxy path.  If the
      // server is healthy *and* is proxying to a healthy opencode, we're good.
      logger.info(
        "Waiting for health (proxy)",
        { url: `${onmyagentBaseUrl}/opencode` },
        "opencode",
      );
      await waitForHealthyViaProxy(
        `${onmyagentBaseUrl.replace(/\/$/, "")}/opencode`,
        onmyagentToken,
      );
      logger.info(
        "Healthy (proxy)",
        { url: `${onmyagentBaseUrl}/opencode` },
        "opencode",
      );
      tui?.updateService("opencode", { status: "healthy" });

      try {
        onmyagentActualVersion = await verifyOnMyAgentServer({
          baseUrl: onmyagentBaseUrl,
          token: onmyagentToken,
          hostToken: onmyagentHostToken,
          expectedVersion: onmyagentServerBinary.expectedVersion,
          expectedWorkspace: "/workspace",
          expectedOpencodeBaseUrl: opencodeInternalBaseUrl,
          expectedOpencodeDirectory: "/workspace",
          expectedOpencodeUsername: opencodeUsername,
          expectedOpencodePassword: opencodePassword,
        });
      } catch (verifyError) {
        // In sandbox mode the released server binary may differ from the
        // expected version or lack capabilities we just added locally.  Log
        // the mismatch but don't abort — the health checks above already
        // proved the server is running and proxying correctly.
        logger.warn(
          "Sandbox server verification warning (non-fatal)",
          { error: String(verifyError) },
          "onmyagent-server",
        );
      }
      onmyagentOwnerToken = await issueOnMyAgentOwnerToken(
        onmyagentBaseUrl,
        onmyagentHostToken,
        "OnMyAgent sandbox owner token",
      );
      tui?.setConnectInfo({ ownerToken: onmyagentOwnerToken });
      logVerbose(
        `onmyagent-server version: ${onmyagentActualVersion ?? "unknown"}`,
      );
    } else {
      const startedOpencodeChild = await startOpencode({
        bin: opencodeBinary.bin,
        workspace: resolvedWorkspace,
        stateLayout: opencodeStateLayout,
        hotReload: opencodeHotReload,
        bindHost: opencodeBindHost,
        port: opencodePort,
        username: opencodeUsername,
        password: opencodePassword,
        corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
        logger,
        runId,
        logFormat,
        logLevel: opencodeLogLevel,
        opencodeRouterHealthPort: opencodeRouterEnabled
          ? opencodeRouterHealthPort
          : undefined,
      });
      opencodeChild = startedOpencodeChild;
      children.push({ name: "opencode", child: startedOpencodeChild });
      tui?.updateService("opencode", {
        status: "running",
        pid: startedOpencodeChild.pid ?? undefined,
        port: opencodePort,
      });
      logger.info(
        "Process spawned",
        { pid: startedOpencodeChild.pid ?? 0 },
        "opencode",
      );
      startedOpencodeChild.on("exit", (code, signal) =>
        handleExit("opencode", code, signal),
      );
      startedOpencodeChild.on("error", (error) =>
        handleSpawnError("opencode", error),
      );

      const authHeaders: Record<string, string> = {};
      if (opencodeUsername && opencodePassword) {
        authHeaders.Authorization = `Basic ${encodeBasicAuth(opencodeUsername, opencodePassword)}`;
      }
      opencodeClient = createOpencodeClient({
        baseUrl: opencodeBaseUrl,
        directory: resolvedWorkspace,
        headers: Object.keys(authHeaders).length ? authHeaders : undefined,
      });

      logger.info("Waiting for health", { url: opencodeBaseUrl }, "opencode");
      await waitForOpencodeHealthy(opencodeClient);
      logger.info("Healthy", { url: opencodeBaseUrl }, "opencode");
      tui?.updateService("opencode", { status: "healthy" });

      let opencodeRouterReady = false;
      if (opencodeRouterEnabled) {
        if (!opencodeRouterBinary) {
          throw new Error("OpenCodeRouter binary missing.");
        }
        opencodeRouterActualVersion =
          await verifyOpenCodeRouterVersion(opencodeRouterBinary);
        logVerbose(
          `opencodeRouter version: ${opencodeRouterActualVersion ?? "unknown"}`,
        );

        try {
          const startedOpenCodeRouterChild = await startOpenCodeRouter({
            bin: opencodeRouterBinary.bin,
            workspace: resolvedWorkspace,
            opencodeUrl: opencodeConnectUrl,
            opencodeUsername,
            opencodePassword,
            opencodeRouterHealthPort,
            opencodeRouterDataDir: opencodeRouterDataDir ?? undefined,
            logger,
            runId,
            logFormat,
          });
          opencodeRouterChild = startedOpenCodeRouterChild;
          children.push({
            name: "opencode-router",
            child: startedOpenCodeRouterChild,
          });
          tui?.updateService("router", {
            status: "running",
            pid: startedOpenCodeRouterChild.pid ?? undefined,
            port: opencodeRouterHealthPort,
          });
          logger.info(
            "Process spawned",
            { pid: startedOpenCodeRouterChild.pid ?? 0 },
            "opencode-router",
          );
          startedOpenCodeRouterChild.on("exit", (code, signal) => {
            if (restartingServices.has("opencode-router")) {
              restartingServices.delete("opencode-router");
              return;
            }
            if (opencodeRouterRequired) {
              handleExit("opencode-router", code, signal);
              return;
            }
            const reason =
              code !== null
                ? `code ${code}`
                : signal
                  ? `signal ${signal}`
                  : "unknown";
            tui?.updateService("router", {
              status: "stopped",
              message: reason,
            });
            logger.warn(
              "Process exited, continuing without opencodeRouter",
              { reason, code, signal },
              "opencode-router",
            );
          });
          startedOpenCodeRouterChild.on("error", (error) =>
            handleSpawnError("opencode-router", error),
          );

          const healthBaseUrl = `http://127.0.0.1:${opencodeRouterHealthPort}`;
          logger.info(
            "Waiting for health",
            { url: healthBaseUrl },
            "opencode-router",
          );
          const health = await waitForOpenCodeRouterHealthy(
            healthBaseUrl,
            10_000,
            400,
          );
          tui?.setRouterHealth(health);
          tui?.updateService("router", {
            status: health.ok ? "healthy" : "running",
          });
          logger.info(
            "Healthy",
            { url: healthBaseUrl, ok: health.ok },
            "opencode-router",
          );
          opencodeRouterReady = true;
        } catch (error) {
          if (opencodeRouterRequired) {
            throw error;
          }
          const message =
            error instanceof Error ? error.message : String(error);
          logger.warn(
            "OpenCodeRouter failed to start, continuing without it",
            { error: message },
            "opencode-router",
          );
          tui?.updateService("router", { status: "stopped", message });
          if (opencodeRouterChild) {
            try {
              opencodeRouterChild.kill();
            } catch {
              // ignore
            }
          }
          opencodeRouterChild = null;
          opencodeRouterReady = false;
        }
      }

      const startedOnMyAgentChild = await startOnMyAgentServer({
        bin: onmyagentServerBinary.bin,
        host: onmyagentHost,
        port: onmyagentPort,
        workspace: resolvedWorkspace,
        token: onmyagentToken,
        hostToken: onmyagentHostToken,
        approvalMode: approvalMode === "auto" ? "auto" : "manual",
        approvalTimeoutMs,
        readOnly,
        corsOrigins: corsOrigins.length ? corsOrigins : ["*"],
        opencodeBaseUrl: opencodeConnectUrl,
        opencodeDirectory: resolvedWorkspace,
        opencodeUsername,
        opencodePassword,
        opencodeRouterHealthPort: opencodeRouterEnabled
          ? opencodeRouterHealthPort
          : undefined,
        opencodeRouterDataDir: opencodeRouterEnabled
          ? (opencodeRouterDataDir ?? undefined)
          : undefined,
        logger,
        runId,
        logFormat,
        controlBaseUrl,
        controlToken,
      });
      onmyagentChild = startedOnMyAgentChild;
      children.push({ name: "onmyagent-server", child: startedOnMyAgentChild });
      tui?.updateService("onmyagent-server", {
        status: "running",
        pid: startedOnMyAgentChild.pid ?? undefined,
        port: onmyagentPort,
      });
      logger.info(
        "Process spawned",
        { pid: startedOnMyAgentChild.pid ?? 0 },
        "onmyagent-server",
      );
      startedOnMyAgentChild.on("exit", (code, signal) =>
        handleExit("onmyagent-server", code, signal),
      );
      startedOnMyAgentChild.on("error", (error) =>
        handleSpawnError("onmyagent-server", error),
      );

      logger.info(
        "Waiting for health",
        { url: onmyagentBaseUrl },
        "onmyagent-server",
      );
      await waitForHealthy(onmyagentBaseUrl);
      logger.info("Healthy", { url: onmyagentBaseUrl }, "onmyagent-server");
      tui?.updateService("onmyagent-server", { status: "healthy" });

      onmyagentActualVersion = await verifyOnMyAgentServer({
        baseUrl: onmyagentBaseUrl,
        token: onmyagentToken,
        hostToken: onmyagentHostToken,
        expectedVersion: onmyagentServerBinary.expectedVersion,
        expectedWorkspace: resolvedWorkspace,
        expectedOpencodeBaseUrl: opencodeConnectUrl,
        expectedOpencodeDirectory: resolvedWorkspace,
        expectedOpencodeUsername: opencodeUsername,
        expectedOpencodePassword: opencodePassword,
      });
      onmyagentOwnerToken = await issueOnMyAgentOwnerToken(
        onmyagentBaseUrl,
        onmyagentHostToken,
        "OnMyAgent owner token",
      );
      tui?.setConnectInfo({ ownerToken: onmyagentOwnerToken });
      logVerbose(
        `onmyagent-server version: ${onmyagentActualVersion ?? "unknown"}`,
      );

      if (opencodeRouterReady && !opencodeRouterHealthInterval) {
        opencodeRouterHealthInterval = setInterval(() => {
          fetchOpenCodeRouterHealthViaOnMyAgent(onmyagentBaseUrl, onmyagentToken)
            .then((health) => {
              tui?.setRouterHealth(health);
              if (health.ok) {
                tui?.updateService("router", { status: "healthy" });
              }
            })
            .catch(() => undefined);
        }, 15_000);
      }
    }

    if (opencodeRouterEnabled) {
      if (sandboxMode !== "none") {
        // OpenCodeRouter is started inside the sandbox container; just probe health.
        opencodeRouterActualVersion = opencodeRouterBinary?.expectedVersion;
        logVerbose(
          `opencodeRouter version: ${opencodeRouterActualVersion ?? "unknown"}`,
        );
        try {
          const url = `${onmyagentBaseUrl.replace(/\/$/, "")}/opencode-router/health`;
          logger.info("Waiting for health", { url }, "opencode-router");
          const health = await waitForOpenCodeRouterHealthyViaOnMyAgent(
            onmyagentBaseUrl,
            onmyagentToken,
          );
          tui?.setRouterHealth(health);
          tui?.updateService("router", {
            status: health.ok ? "healthy" : "running",
          });
          logger.info("Healthy", { url, ok: health.ok }, "opencode-router");
        } catch (error) {
          logger.warn(
            "OpenCodeRouter health check failed",
            { error: String(error) },
            "opencode-router",
          );
          tui?.updateService("router", {
            status: "running",
            message: String(error),
          });
        }
        if (!opencodeRouterHealthInterval) {
          opencodeRouterHealthInterval = setInterval(() => {
            fetchOpenCodeRouterHealthViaOnMyAgent(onmyagentBaseUrl, onmyagentToken)
              .then((health) => {
                tui?.setRouterHealth(health);
                if (health.ok) {
                  tui?.updateService("router", { status: "healthy" });
                }
              })
              .catch(() => undefined);
          }, 15_000);
        }
      } else {
        // In host mode, opencodeRouter is started before onmyagent-server so we can
        // confirm health before wiring the proxy.
      }
    }

    if (workerActivityHeartbeat.enabled && !checkOnly) {
      logger.info(
        "Worker activity heartbeat enabled",
        {
          workerId: workerActivityHeartbeat.workerId,
          intervalMs: workerActivityHeartbeat.intervalMs,
          activeWindowMs: workerActivityHeartbeat.activeWindowMs,
        },
        "onmyagent-orchestrator",
      );
      const runHeartbeat = () => {
        void postWorkerActivityHeartbeat({
          config: workerActivityHeartbeat,
          opencodeClient,
          logger,
        }).catch((error) => {
          logger.warn(
            "Worker activity heartbeat failed",
            { error: error instanceof Error ? error.message : String(error) },
            "onmyagent-orchestrator",
          );
        });
      };
      runHeartbeat();
      workerActivityHeartbeatInterval = setInterval(
        runHeartbeat,
        workerActivityHeartbeat.intervalMs,
      );
    }

    const payload = {
      runId,
      workspace: resolvedWorkspace,
      approval: {
        mode: approvalMode,
        timeoutMs: approvalTimeoutMs,
        readOnly,
      },
      opencode: {
        baseUrl: opencodeBaseUrl,
        connectUrl: opencodeConnectUrl,
        username: sandboxMode !== "none" ? undefined : opencodeUsername,
        password: sandboxMode !== "none" ? undefined : opencodePassword,
        bindHost: opencodeBindHost,
        port: opencodePort,
        hotReload: opencodeHotReload,
        version: opencodeActualVersion,
      },
      onmyagent: {
        baseUrl: onmyagentBaseUrl,
        connectUrl: onmyagentConnectUrl,
        host: onmyagentHost,
        port: onmyagentPort,
        collaboratorToken: onmyagentToken,
        ownerToken: onmyagentOwnerToken,
        token: onmyagentToken,
        hostToken: onmyagentHostToken,
        version: onmyagentActualVersion,
      },
      opencodeRouter: {
        enabled: opencodeRouterEnabled,
        version: opencodeRouterEnabled
          ? opencodeRouterActualVersion
          : undefined,
        healthPort: sandboxMode !== "none" ? null : opencodeRouterHealthPort,
      },
      diagnostics: {
        cliVersion,
        sidecar: {
          dir: sidecar.dir,
          baseUrl: sidecar.baseUrl,
          manifestUrl: sidecar.manifestUrl,
          target: sidecar.target,
          source: sidecarSource,
          opencodeSource,
          allowExternal,
        } as SidecarDiagnostics,
        binaries: {
          opencode: {
            path: opencodeBinary.bin,
            source: opencodeBinary.source,
            expectedVersion: opencodeBinary.expectedVersion,
            actualVersion: opencodeActualVersion,
          } as BinaryDiagnostics,
          onmyagentServer: {
            path: onmyagentServerBinary.bin,
            source: onmyagentServerBinary.source,
            expectedVersion: onmyagentServerBinary.expectedVersion,
            actualVersion: onmyagentActualVersion,
          } as BinaryDiagnostics,
          opencodeRouter: opencodeRouterBinary
            ? ({
                path: opencodeRouterBinary.bin,
                source: opencodeRouterBinary.source,
                expectedVersion: opencodeRouterBinary.expectedVersion,
                actualVersion: opencodeRouterActualVersion,
              } as BinaryDiagnostics)
            : null,
        },
      },
    };

    if (outputJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else if (useTui) {
      logger.info(
        "Ready",
        {
          workspace: payload.workspace,
          opencode: payload.opencode,
          onmyagent: payload.onmyagent,
          opencodeRouter: payload.opencodeRouter,
        },
        "onmyagent-orchestrator",
      );
    } else if (logFormat === "json") {
      logger.info(
        "Ready",
        {
          workspace: payload.workspace,
          opencode: payload.opencode,
          onmyagent: payload.onmyagent,
          opencodeRouter: payload.opencodeRouter,
        },
        "onmyagent-orchestrator",
      );
    } else {
      console.log("OnMyAgent orchestrator running");
      console.log(`Run ID: ${runId}`);
      console.log(`Workspace: ${payload.workspace}`);
      console.log(`OpenCode: ${payload.opencode.baseUrl}`);
      console.log(`OpenCode connect URL: ${payload.opencode.connectUrl}`);
      if (payload.opencode.username && payload.opencode.password) {
        console.log("OpenCode auth: managed credentials configured (withheld from stdout)");
      }
      console.log(`OnMyAgent server: ${payload.onmyagent.baseUrl}`);
      console.log(`OnMyAgent connect URL: ${payload.onmyagent.connectUrl}`);
      console.log("OnMyAgent collaborator token: issued (withheld from stdout)");
      console.log("  Routine remote access for shared workers.");
      if (payload.onmyagent.ownerToken) {
        console.log("OnMyAgent owner token: issued (withheld from stdout)");
        console.log(
          "  Use this when the remote client must answer permission prompts.",
        );
      }
      console.log("OnMyAgent host admin token: issued (withheld from stdout)");
      console.log(
        "  Internal host/admin token for approvals CLI and host-only APIs.",
      );
      console.log(
        "Use `--json` only when you explicitly need raw credentials in command output.",
      );
    }

    if (detachRequested) {
      await handleDetach();
    }

    if (checkOnly) {
      try {
        if (sandboxMode !== "none") {
          // In sandbox mode the released server binary may not support the
          // Bearer-through-proxy auth that the OpenCode SDK client expects.
          // Run a lighter set of checks: onmyagent-server endpoints + proxy
          // health.  Full SDK checks (session create, SSE events) are deferred
          // until the modified server binary is released.
          await runSandboxChecks({
            onmyagentUrl: onmyagentBaseUrl,
            onmyagentToken,
            hostToken: onmyagentHostToken,
          });
        } else {
          await runChecks({
            opencodeClient,
            onmyagentUrl: onmyagentBaseUrl,
            onmyagentToken,
            hostToken: onmyagentHostToken,
            checkEvents,
          });
        }
        logger.info("Checks ok", { checkEvents }, "onmyagent-orchestrator");
        if (!outputJson && logFormat === "pretty") {
          console.log("Checks: ok");
        }
      } catch (error) {
        logger.error(
          "Checks failed",
          { error: String(error) },
          "onmyagent-orchestrator",
        );
        await shutdown();
        tui?.stop();
        process.exit(1);
      }
      await shutdown();
      tui?.stop();
      process.exit(0);
    }

    process.on("SIGINT", () => shutdown().then(() => process.exit(0)));
    process.on("SIGTERM", () => shutdown().then(() => process.exit(0)));
    await new Promise(() => undefined);
  } catch (error) {
    await shutdown();
    tui?.stop();
    logger.error(
      "Run failed",
      { error: error instanceof Error ? error.message : String(error) },
      "onmyagent-orchestrator",
    );
    process.exit(1);
  }
}
