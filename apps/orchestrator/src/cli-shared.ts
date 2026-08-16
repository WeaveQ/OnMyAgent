/**
 * CLI shared surface — compatibility barrel after P2 cohesion splits.
 * Implementations live in leaf modules; this file keeps the public export map.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { localOpencodeWindowsExtraCandidates } from "./cli-opencode-windows-paths.js";
export { localOpencodeWindowsExtraCandidates };

import { readBool, readFlag, type ParsedArgs } from "./cli-args.js";
import { fileExists } from "./cli-fs.js";

export {
  canBind,
  findFreePort,
  resolvePort,
  isCompiledBunBinary,
  resolveLanIp,
  resolveConnectUrl,
} from "./cli-network.js";

export {
  assertVersionMatch,
  captureCommandOutput,
  isProcessAlive,
  parseVersion,
  readCliVersion,
  resolveSelfCommand,
  runCommand,
} from "./runtime-spawn.js";

export {
  type ApprovalMode,
  DEFAULT_ONMYAGENT_PORT,
  SANDBOX_INTERNAL_ONMYAGENT_PORT,
  SANDBOX_INTERNAL_OPENCODE_PORT,
  SANDBOX_INTERNAL_OPENCODE_ROUTER_HEALTH_PORT,
  SANDBOX_OPENCODE_GLOBAL_CONFIG_CONTAINER_PATH,
  SANDBOX_OPENCODE_GLOBAL_DATA_IMPORT_CONTAINER_PATH,
} from "./sandbox-constants.js";

export {
  opencodeRouterSendToolSource,
  opencodeRouterStatusToolSource,
  ensureOpencodeManagedTools,
} from "./cli-router-tools.js";

export {
  stageSandboxRuntime,
  writeSandboxEntrypoint,
  startDockerSandbox,
  startAppleContainerSandbox,
} from "./cli-sandbox-runtime.js";

export type {
  BinaryDiagnostics,
  BinarySource,
  ChildHandle,
  FieldsResult,
  OpencodeStateLayout,
  RemoteSidecarAsset,
  RemoteSidecarEntry,
  RemoteSidecarManifest,
  ResolvedBinary,
  RouterBinaryInfo,
  RouterBinaryState,
  RouterDaemonState,
  RouterOpencodeState,
  RouterSidecarState,
  RouterState,
  RouterWorkspace,
  RouterWorkspaceType,
  RuntimeServiceName,
  RuntimeServiceSnapshot,
  RuntimeUpgradeState,
  SidecarDiagnostics,
  SidecarName,
  WorkerActivityHeartbeatConfig,
} from "./cli-types.js";

export { fileExists, isDir } from "./cli-fs.js";

export {
  FALLBACK_VERSION,
  OPENCODE_LOG_LEVELS,
  readPackageVersion,
  readPinnedOpencodeVersion,
  resolveCliVersion,
  resolveExpectedVersion,
  resolveLocalOpencodeBin,
  resolveLocalOpencodeConfigDir,
  resolveOpencodeLogLevel,
} from "./cli-version.js";

export {
  DEFAULT_ACTIVITY_HEARTBEAT_INTERVAL_MS,
  DEFAULT_ACTIVITY_WINDOW_MS,
  parsePositiveNumberEnv,
  parseSessionActivityAt,
  postWorkerActivityHeartbeat,
  resolveWorkerActivityHeartbeatConfig,
} from "./cli-activity.js";

export {
  ONMYAGENT_DEV_DATA_DIR,
  asRecord,
  ensureOpencodeStateLayout,
  hasConfiguredMessagingServices,
  internalDevModeFromEnv,
  readMessagingEnabledFromOnMyAgentConfig,
  resolveInternalDevMode,
  resolveOpencodeRouterConfigPath,
  resolveOpencodeRouterEnabled,
  resolveOpencodeStateLayout,
  resolveWorkspaceOnMyAgentConfigPath,
} from "./cli-opencode-layout.js";

export {
  buildAttachCommand,
  copyToClipboard,
  createVerboseLogger,
  fetchJson,
  issueOnMyAgentOwnerToken,
  normalizeEvent,
  outputError,
  outputResult,
  readOnMyAgentClientAuth,
  readSessionId,
  runClipboardCommand,
  unwrap,
} from "./cli-http-output.js";

export {
  buildRuntimeServiceSnapshot,
  installGlobalPackages,
  runChecks,
  runSandboxChecks,
  verifyOnMyAgentServer,
  verifyOpenCodeRouterVersion,
  verifyOpencodeVersion,
} from "./cli-runtime-checks.js";

export {
  ensureRouterDaemon,
  findWorkspace,
  loadRouterState,
  normalizeWorkspacePath,
  nowMs,
  requestRouter,
  routerStatePath,
  saveRouterState,
  spawnRouterDaemon,
  workspaceIdForLocal,
  workspaceIdForRemote,
} from "./cli-router-state.js";

export const DEFAULT_APPROVAL_TIMEOUT = 30000;
export const DEFAULT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS = 700;
export const DEFAULT_OPENCODE_HOT_RELOAD_COOLDOWN_MS = 1500;

export const CLI_SOURCE_DIR = dirname(fileURLToPath(import.meta.url));
export const ORCHESTRATOR_ROOT_DIR = resolve(CLI_SOURCE_DIR, "..");
export const REPO_ROOT_DIR = resolve(ORCHESTRATOR_ROOT_DIR, "..", "..");

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

export function resolveOnMyAgentRemoteAccess(args: ParsedArgs): boolean {
  const explicitHost =
    readFlag(args.flags, "onmyagent-host") ?? process.env.ONMYAGENT_HOST;
  const remoteAccessRequested =
    readBool(args.flags, "remote-access", false, "ONMYAGENT_REMOTE_ACCESS") ||
    explicitHost?.trim() === "0.0.0.0";
  return remoteAccessRequested;
}
