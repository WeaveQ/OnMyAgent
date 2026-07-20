// Canonical type definitions for the desktop bridge.
// These types are runtime-agnostic and shared by Electron and renderer.

export type { DesktopCommandName } from "./desktop-ipc-commands.mjs";

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

export type WorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  preset: string;
  workspaceType: "local" | "remote";
  remoteType?: "onmyagent" | "opencode" | null;
  baseUrl?: string | null;
  directory?: string | null;
  displayName?: string | null;
  onmyagentHostUrl?: string | null;
  onmyagentToken?: string | null;
  onmyagentClientToken?: string | null;
  onmyagentHostToken?: string | null;
  onmyagentWorkspaceId?: string | null;
  onmyagentWorkspaceName?: string | null;
  sandboxBackend?: "docker" | "microsandbox" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
};

export type WorkspaceList = {
  selectedId?: string;
  watchedId?: string | null;
  activeId?: string | null;
  workspaces: WorkspaceInfo[];
};

/** Args for desktop `workspaceCreateRemote` (remote onmyagent / opencode mount). */
export type WorkspaceCreateRemoteInput = {
  baseUrl: string;
  remoteType?: "onmyagent" | "opencode" | null;
  directory?: string | null;
  displayName?: string | null;
  onmyagentHostUrl?: string | null;
  onmyagentToken?: string | null;
  onmyagentClientToken?: string | null;
  onmyagentHostToken?: string | null;
  onmyagentWorkspaceId?: string | null;
  onmyagentWorkspaceName?: string | null;
  sandboxBackend?: "docker" | "microsandbox" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
};

/** Args for desktop `workspaceUpdateRemote` — patch remote connection fields by id. */
export type WorkspaceUpdateRemoteInput = {
  workspaceId: string;
  baseUrl?: string | null;
  remoteType?: "onmyagent" | "opencode" | null;
  directory?: string | null;
  displayName?: string | null;
  onmyagentHostUrl?: string | null;
  onmyagentToken?: string | null;
  onmyagentClientToken?: string | null;
  onmyagentHostToken?: string | null;
  onmyagentWorkspaceId?: string | null;
  onmyagentWorkspaceName?: string | null;
  sandboxBackend?: "docker" | "microsandbox" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
};

export type WorkspaceExportSummary = {
  outputPath: string;
  included: number;
  excluded: string[];
};

export type OpencodeCommandDraft = {
  name: string;
  description?: string;
  template: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
};

export type WorkspaceOnMyAgentConfig = {
  version: number;
  workspace?: {
    name?: string | null;
    createdAt?: number | null;
    preset?: string | null;
  } | null;
  authorizedRoots: string[];
  reload?: {
    auto?: boolean;
    resume?: boolean;
  } | null;
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

export type OrchestratorDetachedHost = {
  onmyagentUrl: string;
  token: string;
  ownerToken?: string | null;
  hostToken: string;
  port: number;
  sandboxBackend?: "docker" | "microsandbox" | null;
  sandboxRunId?: string | null;
  sandboxContainerName?: string | null;
};

export type SandboxDoctorResult = {
  installed: boolean;
  daemonRunning: boolean;
  permissionOk: boolean;
  ready: boolean;
  clientVersion?: string | null;
  serverVersion?: string | null;
  error?: string | null;
  debug?: {
    candidates: string[];
    selectedBin?: string | null;
    versionCommand?: {
      status: number;
      stdout: string;
      stderr: string;
    } | null;
    infoCommand?: {
      status: number;
      stdout: string;
      stderr: string;
    } | null;
  } | null;
};

export type OnMyAgentDockerCleanupResult = {
  candidates: string[];
  removed: string[];
  errors: string[];
};

export type SandboxDebugProbeResult = {
  startedAt: number;
  finishedAt: number;
  runId: string;
  workspacePath: string;
  ready: boolean;
  doctor: SandboxDoctorResult;
  detachedHost?: OrchestratorDetachedHost | null;
  dockerInspect?: {
    status: number;
    stdout: string;
    stderr: string;
  } | null;
  dockerLogs?: {
    status: number;
    stdout: string;
    stderr: string;
  } | null;
  cleanup: {
    containerName?: string | null;
    containerRemoved: boolean;
    removeResult?: {
      status: number;
      stdout: string;
      stderr: string;
    } | null;
    workspaceRemoved: boolean;
    errors: string[];
  };
  error?: string | null;
};

export type ExecResult = {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
};

// Code Workspace IPC contracts live in @onmyagent/types (desktop-ipc).
// Re-exported here for backward-compatible app/lib imports.
export type {
  CodeWorkspaceOpenTargetId,
  CodeWorkspaceOpenTarget,
  CodeWorkspaceOpenTargetsResult,
  CodeWorkspaceOpenResult,
  CodeWorkspaceEnvironmentSnapshot,
  CodeWorkspaceGitActionResult,
  CodeWorkspaceTerminal,
  CodeWorkspaceTerminalSnapshot,
  CodeWorkspaceFileEntry,
  CodeWorkspaceFileContent,
} from "./desktop-ipc-code-workspace";

export type LocalSkillCard = {
  name: string;
  path: string;
  description?: string;
  trigger?: string;
  root?: string;
  readonly?: boolean;
  displayNameZh?: string;
  displayNameEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
};

export type LocalSkillContent = {
  path: string;
  content: string;
};

export type OpencodeConfigFile = {
  path: string;
  exists: boolean;
  content: string | null;
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
  | "notifications";

export type SystemPermissionStatus = {
  [key in SystemPermissionType]: "granted" | "denied" | "unknown";
};

export type SystemPermissionResult = {
  platform: "macos" | "windows" | "linux" | "unknown";
  permissions: SystemPermissionStatus;
};

export type PersonalLocalAgentProvider =
  | "opencode"
  | "codex"
  | "claude"
  | "openclaw"
  | "hermes"
  | "custom";

export type PersonalLocalAgentModelOption = {
  id: string;
  label: string;
};

export type PersonalLocalAgentStatus =
  | "online"
  | "needs_auth"
  | "offline"
  | "missing"
  | "unknown"
  // Legacy value kept for backward compatibility with persisted state.
  | "error";

export type PersonalLocalAgentCapability = {
  installed: boolean;
  authenticated: boolean | "unknown";
  minVersionOk: boolean;
  supportsStreaming: boolean;
  supportsResume: boolean;
  supportsModelOverride: boolean;
  supportsPermissionAutoApprove: boolean;
  /** Whether this provider exposes a real ACP entrypoint for Local Agent sessions. */
  supportsAcp: boolean;
  /**
   * Whether the adapter can route native approval requests through Studio's
   * `pendingApprovals` UI. Some agents (e.g. OpenClaw) only execute under
   * their own native CLI permission policy and cannot be intercepted; the
   * UI uses this to disable the approval-mode dropdown for those agents.
   */
  supportsApproval: boolean;
  targetKind: "model" | "agent" | "profile" | "command";
  smokePrompt: string;
  warning: string | null;
};

export type PersonalLocalAgentErrorInfo = {
  code:
    | "missing_binary"
    | "auth_required"
    | "version_unsupported"
    | "provider_failed"
    | "parse_failed"
    | "timeout"
    | "empty_output"
    | "acp_incomplete_output"
    | "cancelled"
    | "codex_acp_model_format"
    | "codex_acp_mode_failed"
    | "acp_bridge_interrupted"
    | "acp_bridge_interrupted_after_retry"
    | "acp_tool_failed"
    | "sandbox_or_network_refusal"
    | "orphaned"
    | "unknown";
  message: string;
  debug?: string | null;
};

export type PersonalLocalAgent = {
  id: string;
  name: string;
  provider: PersonalLocalAgentProvider;
  executablePath: string;
  model: string | null;
  customArgs: string[];
  modelOptions: PersonalLocalAgentModelOption[];
  defaultModel: string | null;
  connectionMode?: string | null;
  status: PersonalLocalAgentStatus;
  version: string | null;
  error: string | null;
  errorInfo?: PersonalLocalAgentErrorInfo | null;
  capability?: PersonalLocalAgentCapability | null;
  handshake?: PersonalLocalAgentMetadata["handshake"];
  behavior_policy?: PersonalLocalAgentMetadata["behavior_policy"];
  lastCheckedAt: number | null;
  /** Present for custom agents; when false the agent is hidden from runtime dropdowns but kept in management. */
  enabled?: boolean;
  /** Source discriminator used by the management UI to split detected vs custom agents. */
  agentSource?: string;
};

export type PersonalLocalAgentMetadata = {
  id: string;
  name: string;
  backend: PersonalLocalAgentProvider | string;
  agent_type: "acp" | "local-harness" | string;
  agent_source: "builtin" | "custom" | "extension" | string;
  agent_source_info?: {
    binary_name?: string | null;
    bridge_binary?: string | null;
    hub_package_id?: string | null;
    package_version?: string | null;
    install_root?: string | null;
    version?: string | null;
  } | null;
  enabled: boolean;
  available: boolean;
  command?: string | null;
  args?: string[];
  env?: Array<{ name: string; value: string; description?: string }>;
  native_skills_dirs?: string[];
  behavior_policy?: {
    permission_mode?: string | null;
    yolo_mode_id?: string | null;
    auto_approve_readonly?: boolean;
  } | null;
  connectionMode?: string | null;
  status?: PersonalLocalAgentStatus;
  error?: string | null;
  handshake?: {
    agent_capabilities?: unknown;
    auth_methods?: unknown;
    config_options?: unknown;
    available_modes?: unknown;
    available_models?: unknown;
    available_commands?: unknown;
  };
  capability?: PersonalLocalAgentCapability | null;
};

export type PersonalLocalAgentRunArtifact = {
  /** Stable id (sha1 slice) used for renderer dedupe. */
  id?: string;
  /** Structured artifact kind emitted by the adapter; defaults to "file". */
  kind?: string;
  /** Absolute path when resolvable, otherwise the raw value emitted by the agent. */
  path: string;
  /** The original (possibly relative) path string emitted by the agent. */
  relPath: string;
  name: string;
  /**
   * Where this artifact was first observed. Only "adapter" is used by the
   * current runtime; "assistant" is retained for backward-compat with older
   * run logs that still carry text-mined entries.
   */
  source: "adapter" | "assistant" | string;
  exists: boolean;
  createdAt?: number;
  addedAt: number;
};

export type PersonalLocalAgentRunFileChange = {
  id: string;
  filePath: string;
  fileName: string;
  tool: string;
  toolCallId?: string;
  diff?: string | null;
  at: number;
};

export type PersonalLocalAgentRunEvent = {
  type:
    | "log"
    | "status"
    | "assistant_chunk"
    | "chunk"
    | "assistant"
    | "finish"
    | "tool"
    | "acp_tool_call"
    | "plan"
    | "thinking"
    | "thought"
    | "tips"
    | "tool_group"
    | "error"
    | "exit"
    | "approval_request"
    | "approval_decision"
    | "artifact";
  text: string;
  at: number;
  stopReason?: string | null;
  truncated?: boolean;
  approval?: PersonalLocalAgentApprovalRequest | null;
  artifact?: PersonalLocalAgentRunArtifact | null;
  toolCall?: PersonalLocalAgentToolCall | null;
  update?: PersonalLocalAgentAcpToolCallUpdate | null;
  data?: Record<string, unknown> | null;
  plan?: { entries?: PersonalLocalAgentPlanEntry[] } | null;
  status?: string | null;
  category?: "error" | "warning" | "info" | string | null;
  ownership?: string | null;
  resolution?: { target?: string; kind?: string; message?: string } | null;
  msgId?: string | null;
  durationMs?: number | null;
  startedAt?: number | null;
  subject?: string | null;
  description?: string | null;
};

export type PersonalLocalAgentToolCall = {
  id: string;
  name: string;
  kind?: string;
  status: "running" | "completed" | "failed" | "cancelled" | "pending" | string;
  description?: string;
  input?: string;
  output?: string;
  inputTruncated?: boolean;
  outputTruncated?: boolean;
};

export type PersonalLocalAgentPlanEntry = {
  id: string;
  title: string;
  content?: string | null;
  status: "pending" | "in_progress" | "completed" | string;
  priority?: "low" | "medium" | "high" | string | null;
};

export type PersonalLocalAgentAcpToolCallUpdate = {
  toolCallId?: string | null;
  status?: "pending" | "in_progress" | "completed" | "failed" | string;
  title?: string | null;
  kind?: "read" | "edit" | "execute" | string | null;
  content?: unknown[];
  input?: string | null;
  output?: string | null;
  locations?: Array<{ path?: string | null } | string>;
};

export type PersonalLocalAgentConversationMessage = {
  id: string;
  type: "start" | "text" | "content" | "thinking" | "tool" | "permission" | "available_commands" | "context_usage" | "agent_status" | "finish" | "tips" | "error" | string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  createdAt: number;
  sourceEventType?: string;
  stopReason?: string | null;
  truncated?: boolean;
  status?: "running" | "completed" | "failed" | string;
  category?: "permission" | "auth" | "network" | "provider" | string;
  approval?: PersonalLocalAgentApprovalRequest | null;
  toolCall?: PersonalLocalAgentToolCall | null;
  update?: PersonalLocalAgentAcpToolCallUpdate | null;
  entries?: PersonalLocalAgentPlanEntry[];
  toolCalls?: PersonalLocalAgentConversationMessage[];
  msgId?: string | null;
  durationMs?: number | null;
  startedAt?: number | null;
  ownership?: string | null;
  resolution?: { target?: string; kind?: string; message?: string } | null;
  contextUsage?: { used: number; total: number; label?: string | null } | null;
  commands?: unknown[];
};

export type PersonalLocalAgentApprovalMode = "auto" | "ask" | "read-only-auto";

export type PersonalLocalAgentApprovalRequest = {
  id: string;
  runId: string;
  provider: PersonalLocalAgentProvider;
  method: string;
  kind: "command" | "file_change" | "permissions" | "mcp" | "unknown";
  title: string;
  summary: string;
  command?: string | null;
  cwd?: string | null;
  readonly?: boolean;
  params?: Record<string, unknown> | null;
  createdAt: number;
};

export type PersonalLocalAgentApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type PersonalLocalAgentRunResult = {
  ok: boolean;
  runId: string;
  agentId: string;
  agentProvider?: PersonalLocalAgentProvider;
  connectionMode?: string | null;
  status: "running" | "completed" | "failed" | "cancelled" | "missing";
  startedAt: number;
  finishedAt: number | null;
  pid: number | null;
  command: string;
  output: string;
  error: string | null;
  errorInfo?: PersonalLocalAgentErrorInfo | null;
  events: PersonalLocalAgentRunEvent[];
  conversationMessages?: PersonalLocalAgentConversationMessage[];
  logPath: string | null;
  workdir?: string | null;
  conversationId?: string | null;
  debugSummary?: string | null;
  providerSessionId?: string | null;
  resumeKey?: string | null;
  metadata?: Record<string, string | number | boolean | null> | null;
  approvalMode?: PersonalLocalAgentApprovalMode | null;
  pendingApprovals?: PersonalLocalAgentApprovalRequest[];
  /**
   * Files / artifacts the runtime believes were produced or referenced by this run.
   * Populated only from structured adapter `artifact` events. Text mining
   * was removed in HR2-A-01 to align with AionUi behavior.
   */
  artifacts?: PersonalLocalAgentRunArtifact[];
  /**
   * File edits captured from tool_call events (apply_patch/edit/write_file/...).
   * Rendered by MessageFileChanges alongside artifacts.
   */
  fileChanges?: PersonalLocalAgentRunFileChange[];
};

export type PersonalLocalAgentsListResult = {
  agents: PersonalLocalAgent[];
  metadata?: PersonalLocalAgentMetadata[];
};

export type PersonalLocalAgentMetadataListResult = {
  agents: PersonalLocalAgentMetadata[];
};

export type PersonalLocalAgentConversation = {
  id: string;
  provider: PersonalLocalAgentProvider;
  agentId: string;
  title: string;
  providerSessionId: string | null;
  resumeKey: string | null;
  workdir: string | null;
  createdAt: number;
  updatedAt: number;
  lastRunId: string | null;
  lastStatus: string | null;
  source: string;
  metadata?: Record<string, unknown> | null;
};

export type PersonalLocalAgentConversationsListResult = {
  conversations: PersonalLocalAgentConversation[];
  activeConversationId: string | null;
};

export type PersonalLocalAgentRunInput = {
  workspaceRoot: string;
  prompt: string;
  approvalMode?: PersonalLocalAgentApprovalMode;
  /**
   * Wall-clock timeout for the run in milliseconds. The runtime will
   * auto-cancel the run with `errorInfo.code = "timeout"` once exceeded.
   * Defaults to 15 minutes when omitted.
   */
  timeoutMs?: number;
  conversationId?: string | null;
  agent?: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
};

export type PersonalLocalAgentResetConversationInput = {
  workspaceRoot: string;
  conversationId?: string | null;
  agent?: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
};

export type PersonalLocalAgentResetConversationResult = {
  ok: boolean;
  removed?: string[];
  missing?: string[];
  errors?: string[];
  error?: string;
  conversation?: PersonalLocalAgentConversation | null;
};

export type PersonalLocalAgentConversationInput = {
  workspaceRoot: string;
  title?: string;
  providerSessionId?: string | null;
  resumeKey?: string | null;
  workdir?: string | null;
  source?: string;
  metadata?: Record<string, unknown> | null;
  agent?: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
};

export type PersonalLocalAgentAcpConfigOptionValue = string | number | boolean | null;

export type PersonalLocalAgentAcpConfigOptionInput = {
  workspaceRoot: string;
  optionId: string;
  value: PersonalLocalAgentAcpConfigOptionValue;
  sessionId?: string | null;
  providerSessionId?: string | null;
  resumeKey?: string | null;
  agent?: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
};

/** Input for ACP agent health probe (`personalLocalAgentAcpHealth`). */
export type PersonalLocalAgentAcpHealthInput = {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
};

export type PersonalLocalAgentAcpHealthAgent = {
  id?: string;
  backend?: string;
  agent_type?: string;
  available?: boolean;
  connectionMode?: string | null;
  error?: string | null;
  [key: string]: unknown;
};

export type PersonalLocalAgentAcpHealthResult = {
  ok: boolean;
  agents: PersonalLocalAgentAcpHealthAgent[];
};

/** Input for listing ACP session config options / models / commands. */
export type PersonalLocalAgentAcpConfigOptionsInput = {
  agent?: Partial<PersonalLocalAgent>;
  agentId?: string;
  provider?: string;
  workspaceRoot?: string;
};

export type PersonalLocalAgentAcpConfigOptionsResult = {
  configOptions: unknown[];
  availableModels: unknown[];
  availableCommands: unknown[];
  capabilities?: {
    supportsConfigOptions?: boolean;
    supportsModelOverride?: boolean;
    supportsModeOverride?: boolean;
    [key: string]: boolean | undefined;
  };
  unsupportedReason?: string | null;
};

export type LocalAgentComposerFileEntry = {
  path: string;
  relativePath: string;
  name: string;
  isDirectory: boolean;
};

export type LocalAgentComposerListFilesInput = {
  workspaceRoot: string;
  query?: string;
  limit?: number;
};

export type LocalAgentComposerListFilesResult = {
  files: LocalAgentComposerFileEntry[];
};

export type LocalAgentComposerSaveAttachmentInput = {
  workspaceRoot: string;
  name: string;
  dataUrl: string;
};

export type LocalAgentComposerSaveAttachmentResult = {
  path: string;
  relativePath: string;
  name: string;
  size: number;
};

export type PersonalLocalAgentAcpConfigOptionResult = {
  ok: boolean;
  sessionId?: string | null;
  optionId?: string;
  value?: PersonalLocalAgentAcpConfigOptionValue;
  confirmation?: string | null;
  configOptions?: unknown[];
  raw?: unknown;
  error?: string;
};

export type PersonalLocalAgentCustomAgentInput = {
  workspaceRoot: string;
  id?: string;
  agent?: Partial<PersonalLocalAgent> & {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    description?: string | null;
    nativeSkillsDirs?: string[];
    behaviorPolicy?: Record<string, unknown>;
    connectionType?: "cli" | "raw";
    acpArgs?: string[];
    supportsAcp?: boolean;
    supportsStreaming?: boolean;
    supportsResume?: boolean;
    supportsApproval?: boolean;
    supportsModelOverride?: boolean;
    supportsPermissionAutoApprove?: boolean;
    authRequired?: boolean;
  };
};

export type PersonalLocalAgentExtensionAdapterInfo = {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  connectionType: "cli" | "raw";
  supportsAcp: boolean;
};

export type PersonalLocalAgentExtensionInfo = {
  name: string;
  version: string;
  displayName: string;
  description?: string | null;
  author?: string | null;
  source: "bundled" | "user";
  installRoot: string;
  manifestPath: string;
  enabled: boolean;
  errors: Array<{ message: string }>;
  adapterIds: string[];
};

export type PersonalLocalAgentExtensionListResult = {
  extensions: PersonalLocalAgentExtensionInfo[];
  enabledAdapters: Array<PersonalLocalAgentExtensionAdapterInfo & { extension: { name: string; version: string; source: string } }>;
};

export type PersonalLocalAgentExtensionSetEnabledResult = {
  name: string;
  enabled: boolean;
};

export type PersonalLocalAgentCustomAgentResult = {
  agent: PersonalLocalAgent;
};

export type PersonalLocalAgentDetectAvailableAgent = {
  id: string;
  name: string;
  command: string;
  connectionType: "cli" | "raw";
  supportsAcp: boolean;
  acpArgs: string[];
  nativeSkillsDirs: string[];
};

export type PersonalLocalAgentDetectResult = {
  agents: PersonalLocalAgentDetectAvailableAgent[];
};

export type PersonalLocalAgentDeleteCustomAgentResult = {
  ok: boolean;
  deleted: boolean;
};

export type PersonalLocalAgentOverridesResult = {
  overrides: Record<string, unknown>;
};

export type PersonalLocalAgentConversationCreateResult = {
  conversation: PersonalLocalAgentConversation;
};

export type PersonalLocalAgentConversationGetResult = {
  conversation: PersonalLocalAgentConversation | null;
};

export type PersonalLocalAgentConversationGetByIdResult = {
  conversation: PersonalLocalAgentConversation | null;
};

export type PersonalLocalAgentChannelConversationsListResult = {
  conversations: PersonalLocalAgentConversation[];
};

export type PersonalLocalAgentConversationsListByProviderResult = {
  conversations: PersonalLocalAgentConversation[];
  activeConversationId: string | null;
};

export type PersonalLocalAgentConversationImportInput = {
  workspaceRoot: string;
  agent?: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
  conversationId?: string | null;
  title?: string;
  providerSessionId?: string | null;
  workdir?: string | null;
  source?: string;
  messages: Array<{ id?: string | null; role?: string; content?: unknown; createdAt?: number }>;
};

export type PersonalLocalAgentConversationImportResult = {
  conversation: PersonalLocalAgentConversation | null;
  importedMessageCount: number;
};

export type PersonalLocalAgentConversationStatusResult = {
  conversation: PersonalLocalAgentConversation | null;
  activeRun: PersonalLocalAgentRunResult | null;
  running: boolean;
  status: string;
  events?: PersonalLocalAgentRunEvent[];
  conversationMessages?: PersonalLocalAgentConversationMessage[];
};

export type PersonalLocalAgentConversationWarmupResult = {
  ok: boolean;
  conversation?: PersonalLocalAgentConversation | null;
  providerSessionId?: string | null;
  resumeKey?: string | null;
  unsupportedReason?: string | null;
  error?: string | null;
};


export type PersonalLocalAgentConversationConfirmationsResult = {
  conversation: PersonalLocalAgentConversation | null;
  confirmations: PersonalLocalAgentApprovalRequest[];
};

export type PersonalLocalAgentNativeSession = {
  id: string;
  title: string;
  providerSessionId: string;
  resumeKey: string;
  workdir: string | null;
  updatedAt: number;
  source: string;
  metadata?: Record<string, unknown> | null;
};

export type PersonalLocalAgentNativeSessionsListResult = {
  provider: PersonalLocalAgentProvider;
  sessions: PersonalLocalAgentNativeSession[];
  error?: string | null;
};

export type PersonalLocalAgentProviderSession = {
  id: string;
  sessionId: string;
  title: string;
  cwd?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type PersonalLocalAgentProviderSessionsListResult = {
  sessions: PersonalLocalAgentProviderSession[];
  unsupportedReason?: string | null;
  raw?: unknown;
};

export type PersonalLocalAgentProviderSessionLoadResult = {
  sessionId?: string;
  providerSessionId?: string;
  conversation?: PersonalLocalAgentConversation;
  raw?: unknown;
};

export type PersonalLocalAgentProviderSessionCloseResult = {
  ok: boolean;
  sessionId?: string;
  closedConversationIds?: string[];
  error?: string;
};

export type PersonalLocalAgentProviderSessionForkResult = {
  sessionId?: string;
  providerSessionId?: string;
  conversation?: PersonalLocalAgentConversation;
  raw?: unknown;
};

export type PersonalLocalAgentTranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
};

export type PersonalLocalAgentConversationTranscriptInput = {
  workspaceRoot: string;
  conversationId?: string | null;
  providerSessionId?: string | null;
  resumeKey?: string | null;
  limit?: number;
  agent?: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
};

export type PersonalLocalAgentConversationTranscriptResult = {
  provider: PersonalLocalAgentProvider;
  conversationId: string | null;
  messages: PersonalLocalAgentTranscriptMessage[];
  source: string | null;
  error?: string | null;
};

export type PersonalLocalAgentHeartbeatSchedule = {
  mode: "interval";
  intervalMinutes: number;
  timezone?: string | null;
};

export type PersonalLocalAgentHeartbeatRun = {
  id: string;
  runId: string | null;
  status: PersonalLocalAgentRunResult["status"];
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  output: string;
};

export type PersonalLocalAgentHeartbeatJob = {
  id: string;
  title: string;
  prompt: string;
  sessionContext: string | null;
  agent: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
  conversationId: string | null;
  approvalMode: PersonalLocalAgentApprovalMode;
  enabled: boolean;
  schedule: PersonalLocalAgentHeartbeatSchedule;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  running: { runId: string | null; claimedAt: number } | null;
  lastRun: PersonalLocalAgentHeartbeatRun | null;
  runs: PersonalLocalAgentHeartbeatRun[];
};

export type PersonalLocalAgentHeartbeatsListInput = {
  workspaceRoot: string;
};

export type PersonalLocalAgentHeartbeatsListResult = {
  jobs: PersonalLocalAgentHeartbeatJob[];
};

export type PersonalLocalAgentHeartbeatCreateInput = {
  workspaceRoot: string;
  title: string;
  prompt: string;
  sessionContext?: string | null;
  conversationId?: string | null;
  approvalMode?: PersonalLocalAgentApprovalMode;
  enabled?: boolean;
  schedule: PersonalLocalAgentHeartbeatSchedule;
  agent: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
};

export type PersonalLocalAgentHeartbeatCreateResult = {
  job: PersonalLocalAgentHeartbeatJob;
};

export type PersonalLocalAgentHeartbeatUpdateInput = {
  workspaceRoot: string;
  jobId: string;
  patch: Partial<Omit<PersonalLocalAgentHeartbeatJob, "id" | "createdAt" | "runs" | "lastRun" | "running">>;
};

export type PersonalLocalAgentHeartbeatUpdateResult = {
  ok: boolean;
  job?: PersonalLocalAgentHeartbeatJob;
  error?: string;
};

export type PersonalLocalAgentHeartbeatDeleteInput = {
  workspaceRoot: string;
  jobId: string;
};

export type PersonalLocalAgentHeartbeatDeleteResult = {
  ok: boolean;
  missing?: boolean;
  error?: string;
};

export type PersonalLocalAgentHeartbeatRunNowInput = {
  workspaceRoot: string;
  jobId: string;
};

export type PersonalLocalAgentHeartbeatRunNowResult = {
  ok: boolean;
  job?: PersonalLocalAgentHeartbeatJob | null;
  error?: string;
};

export type PersonalLocalAgentHeartbeatRunsInput = {
  workspaceRoot: string;
  jobId: string;
};

export type PersonalLocalAgentHeartbeatRunsResult = {
  runs: PersonalLocalAgentHeartbeatRun[];
};

export type PersonalLocalAgentApprovalInput = {
  runId: string;
  approvalId: string;
  decision: PersonalLocalAgentApprovalDecision;
  alwaysAllow?: boolean;
};

export type PersonalLocalAgentStatusInput = {
  runId: string;
  workspaceRoot?: string;
};

export type PersonalLocalAgentProcessRecord = {
  runId: string;
  pid: number | null;
  pgid?: number | null;
  provider: string | null;
  backend: string | null;
  conversationId: string | null;
  agentType: string;
  command: string | null;
  startedAt: number;
  updatedAt: number;
  status?: string;
};

export type MessagingChannelStatus = {
  status?: string;
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  approvalMode?: PersonalLocalAgentApprovalMode;
  lastError?: string | null;
  lastMessageAt?: number | null;
  lastRunId?: string | null;
  processedCount?: number;
  sentCount?: number;
  [key: string]: unknown;
};

export type MessagingAccessibleRootProbe = {
  ok: boolean;
  root: string;
  readable?: boolean;
  entryCount?: number;
  error?: string;
};

export type WeixinLoginStartInput = { baseUrl?: string };
export type WeixinLoginPollInput = {
  qrcode: string;
  baseUrl?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
};
export type WeixinSaveAccountInput = { accountId: string; token: string; baseUrl?: string };
export type WeixinAccountStatusInput = { accountId?: string };
export type WeixinServiceStartInput = {
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  autoStart?: boolean;
};
export type WeixinSimulateInboundInput = {
  accountId?: string;
  fromUserId?: string;
  chatId?: string;
  text: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  textBatchDelayMs?: number;
};

export type FeishuConnectionMode = "websocket" | "webhook";
export type FeishuSaveAccountInput = {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  baseUrl?: string;
};
export type FeishuAccountStatusInput = { accountId?: string };
export type FeishuServiceStartInput = {
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  connectionMode?: FeishuConnectionMode;
  dmPolicy?: string;
  allowedUsers?: string[];
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  autoStart?: boolean;
};
export type FeishuSimulateInboundInput = {
  accountId?: string;
  fromUserId?: string;
  chatId?: string;
  text: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  connectionMode?: FeishuConnectionMode;
  dmPolicy?: string;
  allowedUsers?: string[];
  textBatchDelayMs?: number;
};

export type WeixinAccountStatus = {
  ok: boolean;
  account?: {
    accountId: string;
    baseUrl: string;
    cdnBaseUrl: string;
    userId: string;
    savedAt: string | null;
    hasToken: boolean;
    tokenPreview: string;
  } | null;
  status?: MessagingChannelStatus;
  error?: string;
};

export type FeishuAccountStatus = {
  ok: boolean;
  account?: {
    accountId: string;
    appId: string;
    baseUrl: string;
    savedAt: string | null;
    hasAppSecret: boolean;
    appSecretPreview: string;
    hasVerificationToken: boolean;
    hasEncryptKey: boolean;
  } | null;
  status?: MessagingChannelStatus;
  config?: MessagingChannelStatus;
  error?: string;
};


export type AgentManagementManagedProviderModel = {
  id: string;
  name: string;
  contextWindow?: number | string | null;
  outputTokenLimit?: number | string | null;
};

export type AgentManagementManagedProvider = {
  id: string;
  appType: "opencode" | "codex" | "claude" | "openclaw" | "hermes";
  name: string;
  settingsConfig: Record<string, unknown>;
  websiteUrl?: string | null;
  category?: string | null;
  createdAt?: number | null;
  sortIndex?: number | null;
  notes?: string | null;
  icon?: string | null;
  iconColor?: string | null;
  meta?: Record<string, unknown>;
  isCurrent: boolean;
  inFailoverQueue: boolean;
  costMultiplier?: string;
  providerType?: string | null;
  liveManaged: boolean;
  livePresent: boolean;
  configPath: string;
  models: AgentManagementManagedProviderModel[];
};

export type AgentManagementProvidersSnapshot = {
  databasePath: string;
  total: number;
  byAgent: Record<"opencode" | "codex" | "claude" | "openclaw" | "hermes", AgentManagementManagedProvider[]>;
};

export type AgentManagementMcpApp = "claude" | "codex" | "gemini" | "opencode" | "hermes";

export type AgentManagementMcpSpec = {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
};

export type AgentManagementMcpServer = {
  id: string;
  name: string;
  description: string | null;
  homepage: string | null;
  docs: string | null;
  tags: string[];
  server: AgentManagementMcpSpec;
  apps: Record<AgentManagementMcpApp, boolean>;
  createdAt: number;
  updatedAt: number;
};

export type AgentManagementMcpAppStatus = {
  app: AgentManagementMcpApp;
  label: string;
  configPath: string;
  configExists: boolean;
  configDirExists: boolean;
  syncSupported: boolean;
};

export type AgentManagementMcpSnapshot = {
  generatedAt: number;
  databasePath: string;
  apps: Record<AgentManagementMcpApp, AgentManagementMcpAppStatus>;
  servers: AgentManagementMcpServer[];
  total: number;
  countsByApp: Record<AgentManagementMcpApp, number>;
};

export type AgentManagementMcpActionInput =
  | { action: "import"; app?: AgentManagementMcpApp; apps?: AgentManagementMcpApp[] }
  | { action: "save"; server: Partial<AgentManagementMcpServer> & { id: string; server: AgentManagementMcpSpec } }
  | { action: "delete"; id: string }
  | { action: "toggle"; id: string; app: AgentManagementMcpApp; enabled: boolean };

export type AgentManagementMcpActionResult = {
  ok: boolean;
  snapshot: AgentManagementMcpSnapshot;
  imported?: number;
  updated?: number;
  removed?: boolean;
  server?: AgentManagementMcpServer;
};

export type AgentManagementUsageSummary = {
  runs: number;
  completed: number;
  failed: number;
  cancelled: number;
  totalDurationMs: number;
  lastRunAt: number | null;
  lastStatus: string | null;
};

/** Product columns plus catalog/custom fleet keys (e.g. workbuddy). */
export type AgentManagementSkillAgent =
  | "opencode"
  | "claude"
  | "openclaw"
  | "hermes"
  | "codex"
  | "gemini"
  | "onmyagent"
  | "unknown"
  | (string & {});

export type AgentManagementSkillSource = {
  agent: AgentManagementSkillAgent;
  label: string;
  scope: string;
  root: string;
  path: string;
  managedByStudioSwitch: boolean;
  kind?: "skill" | "runtime-skill" | "slash-command" | "plugin";
  pluginName?: string | null;
};

export type AgentManagementStudioSwitchSkill = {
  id?: string;
  name?: string;
  description?: string | null;
  directory: string;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
  readmeUrl?: string | null;
  agents: AgentManagementSkillAgent[];
  installedAt?: number | null;
  contentHash?: string | null;
  updatedAt?: number | null;
};

export type AgentManagementSkill = LocalSkillCard & {
  agents: AgentManagementSkillAgent[];
  scopeLabel: string;
  sources: AgentManagementSkillSource[];
  managedByStudioSwitch: boolean;
  studioSwitch: AgentManagementStudioSwitchSkill | null;
  kind?: "skill" | "runtime-skill" | "slash-command" | "plugin";
  pluginName?: string | null;
  lastSeenAt?: number | null;
};

export type AgentManagementAgent = PersonalLocalAgent & {
  usage: AgentManagementUsageSummary;
  skillCount: number;
};

export type AgentManagementSnapshot = {
  generatedAt: number;
  workspaceRoot: string;
  agents: AgentManagementAgent[];
  skills: AgentManagementSkill[];
  providers: AgentManagementProvidersSnapshot;
  mcp: AgentManagementMcpSnapshot;
};


export type AgentManagementProviderActionInput =
  | { action: "importLive"; appType: AgentManagementManagedProvider["appType"]; workspaceRoot?: string }
  | { action: "save"; appType: AgentManagementManagedProvider["appType"]; workspaceRoot?: string; syncLive?: boolean; provider: Omit<Partial<AgentManagementManagedProvider>, "settingsConfig"> & { settingsConfig?: Record<string, unknown> | string; simple?: Record<string, unknown> } }
  | { action: "delete" | "switch" | "syncLive"; appType: AgentManagementManagedProvider["appType"]; workspaceRoot?: string; providerId: string };

export type AgentManagementProviderActionResult = {
  ok: boolean;
  action: string;
  appType: AgentManagementManagedProvider["appType"];
  providerId?: string;
  imported?: number;
  providers: AgentManagementProvidersSnapshot;
};

export type AgentManagementFetchedModel = {
  id: string;
  name: string;
  contextWindow?: number | string | null;
  outputTokenLimit?: number | string | null;
};

export type AgentManagementFetchModelsInput = {
  appType: AgentManagementManagedProvider["appType"];
  baseUrl: string;
  apiKey?: string;
};

export type AgentManagementFetchModelsResult = {
  ok: boolean;
  endpoint: string;
  models: AgentManagementFetchedModel[];
};

export type AgentManagementSkillActionInput = {
  action: "enable" | "disable" | "import" | "open";
  agent: AgentManagementSkillAgent;
  directory: string;
  sourcePath?: string;
  displayName?: string;
  description?: string;
  kind?: "skill" | "runtime-skill" | "slash-command" | "plugin";
};

export type AgentManagementSkillActionResult = {
  ok: boolean;
  action?: string;
  agent?: AgentManagementSkillAgent;
  directory?: string;
  path?: string;
  result?: string;
};


export type PersonalLocalAgentHostStatusInput = {
  workspaceRoot: string;
  conversationId?: string | null;
  additionalSkillRoots?: string[];
  agent?: Partial<PersonalLocalAgent> & {
    provider?: PersonalLocalAgentProvider;
    customArgs?: string[];
  };
};

export type PersonalLocalAgentHostStatusSkillEntry = {
  id: string;
  name: string;
  indexFile: string;
  source: string;
  provenance: "workspace";
};

export type PersonalLocalAgentHostStatusSkillRoot = {
  path: string;
  exists: boolean;
  count: number;
};

export type PersonalLocalAgentHostStatusMcpServer = {
  name: string;
  transport: string | null;
  connected: boolean;
  toolCount: number;
  source?: string;
  sourceFile?: string;
};

export type PersonalLocalAgentHostStatusPermissionItem = {
  id: string;
  state: "pending" | "approved" | "denied";
  summary: string;
  method: string;
  at: number | null;
};

export type PersonalLocalAgentHostStatusResult = {
  workspaceRoot: string;
  agentId: string | null;
  conversationId: string | null;
  skill: {
    skills: PersonalLocalAgentHostStatusSkillEntry[];
    roots: PersonalLocalAgentHostStatusSkillRoot[];
    error: string | null;
  };
  mcp: {
    servers: PersonalLocalAgentHostStatusMcpServer[];
    error: string | null;
    sourceErrors?: Array<{ file: string; message: string }>;
  };
  permission: {
    pending: number;
    approved: number;
    denied: number;
    remembered: number;
    items: PersonalLocalAgentHostStatusPermissionItem[];
  };
};

export type TelegramSaveAccountInput = { accountId: string; token: string };
export type TelegramAccountStatusInput = { accountId?: string };
export type TelegramServiceStartInput = {
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  allowedUserIds?: string[];
  autoStart?: boolean;
};
export type TelegramSimulateInboundInput = {
  accountId?: string;
  fromUserId?: string;
  chatId?: string;
  text: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  textBatchDelayMs?: number;
};
export type TelegramAccountStatus = {
  ok: boolean;
  account?: {
    accountId: string;
    botUsername?: string;
    hasToken?: boolean;
    [key: string]: unknown;
  } | null;
  status?: MessagingChannelStatus;
  config?: MessagingChannelStatus;
  error?: string;
};

export type DiscordSaveAccountInput = {
  accountId: string;
  token: string;
  allowedUserIds?: string[];
};
export type DiscordAccountStatusInput = { accountId?: string };
export type DiscordServiceStartInput = {
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  allowedUserIds?: string[];
  autoStart?: boolean;
};
export type DiscordSimulateInboundInput = {
  accountId?: string;
  fromUserId?: string;
  chatId?: string;
  text: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  textBatchDelayMs?: number;
};
export type DiscordAccountStatus = {
  ok: boolean;
  account?: {
    accountId: string;
    botUsername?: string;
    hasToken?: boolean;
    allowedUserIds?: string[];
    [key: string]: unknown;
  } | null;
  status?: MessagingChannelStatus;
  config?: MessagingChannelStatus;
  error?: string;
};

export type PersonalLocalAgentTestConnectionResult = {
  ok: boolean;
  status: PersonalLocalAgentStatus;
  step: "fail_cli" | "fail_acp" | "needs_auth" | "online" | string;
  error: string | null;
  capabilities: Record<string, unknown> | null;
  models: Array<{ id: string; label: string }>;
  configOptions: unknown[];
  checkedAt: number;
};

export type PersonalLocalAgentProviderHealthResult =
  PersonalLocalAgentTestConnectionResult & {
    healthy: boolean;
    reason: string | null;
  };

export type PersonalLocalAgentTestCustomAgentResult = {
  step: "success" | "fail_cli" | "fail_acp";
  error: string | null;
  durationMs: number;
};

export type UserAgentRegistryFile = {
  path: string;
  content: string;
  bytes: number;
  updatedAt: number;
};

export type UserAgentRegistryWriteResult = {
  ok: boolean;
  path: string;
  bytes: number;
  updatedAt: number;
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

// ---------------------------------------------------------------------------
// Runtime — bootstrap / status / orchestrator / sandbox stop
// ---------------------------------------------------------------------------

export type RuntimeLifecycleState =
  | "idle"
  | "cleaning"
  | "starting"
  | "healthy"
  | "error"
  | (string & {});

export type RuntimeStatus = {
  lifecycleState: RuntimeLifecycleState;
  engine: EngineInfo;
  onmyagentServer: OnMyAgentServerInfo;
};

export type RuntimeBootstrapResult =
  | { ok: true; skipped: true; reason: string }
  | {
      ok: true;
      skipped: false;
      engine: EngineInfo;
      onmyagentServer: OnMyAgentServerInfo;
      workspaceId: string | null;
    }
  | { ok: false; error: string };

export type OrchestratorDaemonSnapshot = {
  baseUrl: string | null;
  port: number | null;
  pid: number | null;
  runtime: string;
};

export type OrchestratorOpencodeSnapshot = {
  baseUrl: string | null;
  port: number | null;
  pid: number | null;
  projectDir: string | null;
  runtime: string;
};

export type OrchestratorStatus = {
  running: boolean;
  dataDir: string | null;
  daemon: OrchestratorDaemonSnapshot | null;
  opencode: OrchestratorOpencodeSnapshot | null;
  cliVersion: string | null;
  sidecar: unknown;
  binaries: unknown;
  activeId: string | null;
  workspaceCount: number;
  workspaces: Array<{ id: string; path: string; name: string }>;
  lastError: string | null;
};

export type OrchestratorWorkspaceActivateInput = {
  workspacePath: string;
  name?: string | null;
};

export type OrchestratorWorkspaceActivateResult = {
  id: string;
  path: string;
  name: string;
};

/** Docker `stop` / shell-style result used by sandbox + opencode helpers. */
export type ShellCommandResult = {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
};

export type SandboxStopResult = ShellCommandResult;

// ---------------------------------------------------------------------------
// Skills / expert marketplace
// ---------------------------------------------------------------------------

export type ExpertMarketplaceName = "experts" | "my-experts";

export type ExpertPackageInstallInput = {
  source: "builtin";
  marketplace: ExpertMarketplaceName;
  packageName: string;
};

export type ExpertPackageInstallResult = {
  ok: true;
  path: string;
  packageName: string;
  marketplace: ExpertMarketplaceName;
};

export type BuiltinSkillPackageInstallInput = {
  source: "builtin";
  packageName: string;
  skillName: string;
};

export type BuiltinSkillPackageInstallResult = {
  ok: true;
  path: string;
  packageName: string;
  skillName: string;
};

export type ExpertPackageListEntry = {
  id: string;
  packageName: string;
  source: "installed" | "mine";
  packagePath: string;
  displayName: string;
  profession: string;
  description: string;
  categoryId: string;
  tags: string[];
  quickPrompts: string[];
  avatarUrl: string | null;
  expertType: "agent" | "team";
  leadAgentName: string;
  systemPrompt: string;
  version: string | null;
};

export type ExpertRegistryListEntry = {
  id: string;
  name: string;
  source: "installed" | "mine";
  packageName: string;
  packagePath: string;
};

export type MyExpertPackageWriteInput = {
  id: string;
  packageName: string;
  name: string;
  description: string;
  quote: string;
};

// ---------------------------------------------------------------------------
// Messaging channel infrastructure (desktop IPC wire shapes)
// ---------------------------------------------------------------------------

export type ChannelProbeResult = {
  ok: boolean;
  botUsername?: string;
  hasToken?: boolean;
  error?: string;
};

export type DesktopChannelPairingRequest = {
  code: string;
  platformType: string;
  platformUserId: string;
  displayName?: string;
  requestedAt: number;
  expiresAt: number;
  status: string;
};

export type DesktopChannelAuthorizedUser = {
  id: string;
  platformType: string;
  platformUserId: string;
  displayName?: string;
  authorizedAt: number;
  lastActive?: number;
};

export type DesktopChannelSession = {
  id: string;
  platformType: string;
  platformUserId: string;
  agentType: string;
  workspace?: string;
  chatId?: string;
  createdAt: number;
  lastActivity: number;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
  }>;
  metadata: Record<string, unknown>;
  closedAt?: number;
};

export type DesktopChannelEventHistoryEntry = {
  id: string;
  name: string;
  payload: unknown;
  timestamp: number;
};

/** End-to-end desktop IPC command → { args; result } map. */
export type {
  DesktopCommandContract,
  DesktopCommandMap,
  DesktopCommandArgsOf,
  DesktopCommandResultOf,
  DesktopInvoke,
} from "./desktop-ipc-command-map";
