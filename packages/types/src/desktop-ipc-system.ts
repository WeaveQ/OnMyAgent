// System / engine / computer-use desktop IPC wire types.
// Extracted from desktop-ipc.ts (re-exported for public entry compatibility).

/** Options for `engineStart` / `engineRestart` (desktop runtime handler). */
export type EngineStartOptions = {
  runtime?: "direct" | "onmyagent-orchestrator";
  workspacePaths?: string[];
  onmyagentRemoteAccess?: boolean;
  opencodeBinPath?: string;
  opencodeEnableExa?: boolean;
};

export type EngineDoctorOptions = {
  opencodeBinPath?: string;
};

export type EngineInfo = {
  running: boolean;
  runtime: "direct";
  baseUrl: string | null;
  projectDir: string | null;
  hostname: string | null;
  port: number | null;
  opencodeUsername: string | null;
  opencodePassword: string | null;
  opencodeBinPath: string | null;
  opencodeBinSource: string | null;
  pid: number | null;
  lastStdout: string | null;
  lastStderr: string | null;
};

export type OnMyAgentServerInfo = {
  running: boolean;
  remoteAccessEnabled: boolean;
  host: string | null;
  port: number | null;
  baseUrl: string | null;
  connectUrl: string | null;
  mdnsUrl: string | null;
  lanUrl: string | null;
  clientToken: string | null;
  ownerToken: string | null;
  hostToken: string | null;
  managedOpencodeBinPath: string | null;
  managedOpencodeBinSource: string | null;
  pid: number | null;
  lastStdout: string | null;
  lastStderr: string | null;
};

export type EngineDoctorResult = {
  found: boolean;
  inPath: boolean;
  resolvedPath: string | null;
  resolvedSource: string | null;
  version: string | null;
  supportsServe: boolean;
  notes: string[];
  serveHelpStatus: number | null;
  serveHelpStdout: string | null;
  serveHelpStderr: string | null;
};

export type AppBuildInfo = {
  version: string;
  gitSha?: string | null;
  buildEpoch?: string | null;
  onmyagentDevMode?: boolean;
  os?: string | null;
  arch?: string | null;
};

export type DesktopBootstrapConfig = {
  baseUrl: string;
  apiBaseUrl?: string | null;
  requireSignin: boolean;
};

export type ExecResult = {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
};

export type UpdaterEnvironment = {
  supported: boolean;
  reason: string | null;
  executablePath: string | null;
  appBundlePath: string | null;
};

export type CacheResetResult = {
  removed: string[];
  missing: string[];
  errors: string[];
};

export type SystemPermissionType =
  | "full-disk-access"
  | "accessibility"
  | "automation"
  | "notifications"
  | "screen-recording"
  | "microphone";

export type SystemPermissionStatus = {
  [key in SystemPermissionType]: "granted" | "denied" | "unknown";
};

export type DesktopPlatformCapability = {
  supported: boolean;
  reason: string | null;
  backend?: "handsfree" | "cua" | "none";
};

export type DesktopSandboxCapability = {
  supported: boolean;
  reason: string | null;
  backend: "docker" | "bwrap" | "sandbox-exec" | "none";
};

export type DesktopPlatformCapabilities = {
  platform: "macos" | "windows" | "linux" | "unknown";
  computerUse: DesktopPlatformCapability;
  appshot: DesktopPlatformCapability;
  sandboxExec: DesktopPlatformCapability;
  sandbox: DesktopSandboxCapability;
};

export type SystemPermissionResult = {
  platform: "macos" | "windows" | "linux" | "unknown";
  permissions: SystemPermissionStatus;
  capabilities?: DesktopPlatformCapabilities;
};

export type DesktopFetchResult = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
};

// ---------------------------------------------------------------------------
// System — computer use / software env / UI control bridge
// ---------------------------------------------------------------------------

export type ComputerUseActivityPhase =
  | "inactive"
  | "ready"
  | "running"
  | "paused"
  | "errored";

export type ComputerUseActivity = {
  phase: ComputerUseActivityPhase;
  app?: string;
  reason?: string;
};

export type ComputerUseSkysightStatus = {
  enabled?: boolean;
  paused?: boolean;
  recording?: boolean;
  [key: string]: unknown;
};

export type ComputerUseAppAuthorizations = {
  allowedBundleIdentifiers: string[];
  [key: string]: unknown;
};

/** Result of `checkComputerUsePermissions` and related permission helpers. */
export type ComputerUsePermissionResult = {
  ok: boolean;
  accessibility: boolean;
  screenRecording: boolean;
  error?: string;
  helperVersion?: string;
  protocolVersion?: number;
  desktopVersion?: string;
  /** Runtime backend: HandsFree (mac) or Cua Driver (Windows). */
  backend?: "handsfree" | "cua" | "none";
  /** Whether OpenCode computer-use MCP is enabled (user pref / env). */
  mcpEnabled?: boolean;
  /** Present when the host platform has no Computer Use backend. */
  unsupportedReason?: "platform-unsupported";
  activity?: ComputerUseActivity;
  skysight?: ComputerUseSkysightStatus;
  appAuthorizations?: ComputerUseAppAuthorizations;
};

export type ComputerUseAppshotResult = {
  name: string;
  mimeType: string;
  data: string;
  appName?: string;
};

export type ComputerUseSkysightExclusionOperation = "add" | "remove";
export type ComputerUseSkysightExclusionScope =
  | "app"
  | "website"
  | "private_browsing";

export type UiControlBridgeInfo = {
  version: number;
  app: string;
  identifier: string;
  platform: string;
  baseUrl: string;
  token: string;
};

export type SoftwareEnvironmentToolDetail = {
  installed: boolean;
  bundled?: boolean;
  path?: string | null;
  version?: string | null;
};

export type SoftwareEnvironmentInfo = {
  node: boolean;
  python: boolean;
  opencode: boolean;
  details: {
    node: SoftwareEnvironmentToolDetail;
    python: SoftwareEnvironmentToolDetail;
    opencode: SoftwareEnvironmentToolDetail;
  };
};

export type SoftwareEnvironmentInstallResult = {
  ok: boolean;
  message?: string;
  version?: string | null;
  path?: string | null;
};
