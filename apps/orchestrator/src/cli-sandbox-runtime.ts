/**
 * Sandbox runtime staging and container start helpers.
 * Extracted from cli-shared.ts (mechanical split; re-exported for compat).
 */
import type { ChildProcess } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LogFormat, OpencodeHotReload } from "./cli-args.js";
import { ensureExecutable } from "./cli-binary-resolve.js";
import type { Logger } from "./cli-logging.js";
import { loadUserEnvFile } from "./env-paths.js";
import {
  prefixStream,
  spawnProcess,
} from "./runtime-services.js";
import {
  addEnvPassThroughArgs,
  ensureAppleContainerSystemReady,
  sandboxEnvPassThroughNames,
  shQuote,
} from "./runtime-sandbox.js";
import {
  resolveHostOpencodeGlobalConfigDir,
  resolveHostOpencodeGlobalDataDir,
  type SandboxMount,
} from "./sandbox-mounts.js";
import {
  type ApprovalMode,
  SANDBOX_INTERNAL_ONMYAGENT_PORT,
  SANDBOX_INTERNAL_OPENCODE_PORT,
  SANDBOX_INTERNAL_OPENCODE_ROUTER_HEALTH_PORT,
  SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH,
  SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH,
} from "./cli-shared.js";



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

