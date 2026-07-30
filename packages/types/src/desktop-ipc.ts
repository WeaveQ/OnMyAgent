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
  CodeWorkspaceFileContent, CodeWorkspaceBinaryFileContent,
} from "./desktop-ipc-code-workspace.js";

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
  | "notifications"
  | "screen-recording"
  | "microphone";

export type SystemPermissionStatus = {
  [key in SystemPermissionType]: "granted" | "denied" | "unknown";
};

export type SystemPermissionResult = {
  platform: "macos" | "windows" | "linux" | "unknown";
  permissions: SystemPermissionStatus;
};

// Personal Local Agent IPC contracts (split module; re-exported for compatibility).
import type {
  LocalAgentComposerFileEntry,
  LocalAgentComposerListFilesInput,
  LocalAgentComposerListFilesResult,
  LocalAgentComposerSaveAttachmentInput,
  LocalAgentComposerSaveAttachmentResult,
  PersonalLocalAgent,
  PersonalLocalAgentAcpConfigOptionInput,
  PersonalLocalAgentAcpConfigOptionResult,
  PersonalLocalAgentAcpConfigOptionValue,
  PersonalLocalAgentAcpConfigOptionsInput,
  PersonalLocalAgentAcpConfigOptionsResult,
  PersonalLocalAgentAcpHealthAgent,
  PersonalLocalAgentAcpHealthInput,
  PersonalLocalAgentAcpHealthResult,
  PersonalLocalAgentAcpToolCallUpdate,
  PersonalLocalAgentApprovalDecision,
  PersonalLocalAgentApprovalInput,
  PersonalLocalAgentApprovalMode,
  PersonalLocalAgentApprovalRequest,
  PersonalLocalAgentCapability,
  PersonalLocalAgentChannelConversationsListResult,
  PersonalLocalAgentConversation,
  PersonalLocalAgentConversationConfirmationsResult,
  PersonalLocalAgentConversationCreateResult,
  PersonalLocalAgentConversationGetByIdResult,
  PersonalLocalAgentConversationGetResult,
  PersonalLocalAgentConversationImportInput,
  PersonalLocalAgentConversationImportResult,
  PersonalLocalAgentConversationInput,
  PersonalLocalAgentConversationMessage,
  PersonalLocalAgentConversationStatusResult,
  PersonalLocalAgentConversationTranscriptInput,
  PersonalLocalAgentConversationTranscriptResult,
  PersonalLocalAgentConversationWarmupResult,
  PersonalLocalAgentConversationsListByProviderResult,
  PersonalLocalAgentConversationsListResult,
  PersonalLocalAgentCustomAgentInput,
  PersonalLocalAgentCustomAgentResult,
  PersonalLocalAgentDeleteCustomAgentResult,
  PersonalLocalAgentDetectAvailableAgent,
  PersonalLocalAgentDetectResult,
  PersonalLocalAgentErrorInfo,
  PersonalLocalAgentExtensionAdapterInfo,
  PersonalLocalAgentExtensionInfo,
  PersonalLocalAgentExtensionListResult,
  PersonalLocalAgentExtensionSetEnabledResult,
  PersonalLocalAgentHeartbeatCreateInput,
  PersonalLocalAgentHeartbeatCreateResult,
  PersonalLocalAgentHeartbeatDeleteInput,
  PersonalLocalAgentHeartbeatDeleteResult,
  PersonalLocalAgentHeartbeatJob,
  PersonalLocalAgentHeartbeatRun,
  PersonalLocalAgentHeartbeatRunNowInput,
  PersonalLocalAgentHeartbeatRunNowResult,
  PersonalLocalAgentHeartbeatRunsInput,
  PersonalLocalAgentHeartbeatRunsResult,
  PersonalLocalAgentHeartbeatSchedule,
  PersonalLocalAgentHeartbeatUpdateInput,
  PersonalLocalAgentHeartbeatUpdateResult,
  PersonalLocalAgentHeartbeatsListInput,
  PersonalLocalAgentHeartbeatsListResult,
  PersonalLocalAgentMetadata,
  PersonalLocalAgentMetadataListResult,
  PersonalLocalAgentModelOption,
  PersonalLocalAgentNativeSession,
  PersonalLocalAgentNativeSessionsListResult,
  PersonalLocalAgentOverridesResult,
  PersonalLocalAgentPlanEntry,
  PersonalLocalAgentProcessRecord,
  PersonalLocalAgentProvider,
  PersonalLocalAgentProviderSession,
  PersonalLocalAgentProviderSessionCloseResult,
  PersonalLocalAgentProviderSessionForkResult,
  PersonalLocalAgentProviderSessionLoadResult,
  PersonalLocalAgentProviderSessionsListResult,
  PersonalLocalAgentResetConversationInput,
  PersonalLocalAgentResetConversationResult,
  PersonalLocalAgentRunArtifact,
  PersonalLocalAgentRunEvent,
  PersonalLocalAgentRunFileChange,
  PersonalLocalAgentRunInput,
  PersonalLocalAgentRunResult,
  PersonalLocalAgentStatus,
  PersonalLocalAgentStatusInput,
  PersonalLocalAgentToolCall,
  PersonalLocalAgentTranscriptMessage,
  PersonalLocalAgentsListResult,
} from "./desktop-ipc-local-agents.js";
export type {
  LocalAgentComposerFileEntry,
  LocalAgentComposerListFilesInput,
  LocalAgentComposerListFilesResult,
  LocalAgentComposerSaveAttachmentInput,
  LocalAgentComposerSaveAttachmentResult,
  PersonalLocalAgent,
  PersonalLocalAgentAcpConfigOptionInput,
  PersonalLocalAgentAcpConfigOptionResult,
  PersonalLocalAgentAcpConfigOptionValue,
  PersonalLocalAgentAcpConfigOptionsInput,
  PersonalLocalAgentAcpConfigOptionsResult,
  PersonalLocalAgentAcpHealthAgent,
  PersonalLocalAgentAcpHealthInput,
  PersonalLocalAgentAcpHealthResult,
  PersonalLocalAgentAcpToolCallUpdate,
  PersonalLocalAgentApprovalDecision,
  PersonalLocalAgentApprovalInput,
  PersonalLocalAgentApprovalMode,
  PersonalLocalAgentApprovalRequest,
  PersonalLocalAgentCapability,
  PersonalLocalAgentChannelConversationsListResult,
  PersonalLocalAgentConversation,
  PersonalLocalAgentConversationConfirmationsResult,
  PersonalLocalAgentConversationCreateResult,
  PersonalLocalAgentConversationGetByIdResult,
  PersonalLocalAgentConversationGetResult,
  PersonalLocalAgentConversationImportInput,
  PersonalLocalAgentConversationImportResult,
  PersonalLocalAgentConversationInput,
  PersonalLocalAgentConversationMessage,
  PersonalLocalAgentConversationStatusResult,
  PersonalLocalAgentConversationTranscriptInput,
  PersonalLocalAgentConversationTranscriptResult,
  PersonalLocalAgentConversationWarmupResult,
  PersonalLocalAgentConversationsListByProviderResult,
  PersonalLocalAgentConversationsListResult,
  PersonalLocalAgentCustomAgentInput,
  PersonalLocalAgentCustomAgentResult,
  PersonalLocalAgentDeleteCustomAgentResult,
  PersonalLocalAgentDetectAvailableAgent,
  PersonalLocalAgentDetectResult,
  PersonalLocalAgentErrorInfo,
  PersonalLocalAgentExtensionAdapterInfo,
  PersonalLocalAgentExtensionInfo,
  PersonalLocalAgentExtensionListResult,
  PersonalLocalAgentExtensionSetEnabledResult,
  PersonalLocalAgentHeartbeatCreateInput,
  PersonalLocalAgentHeartbeatCreateResult,
  PersonalLocalAgentHeartbeatDeleteInput,
  PersonalLocalAgentHeartbeatDeleteResult,
  PersonalLocalAgentHeartbeatJob,
  PersonalLocalAgentHeartbeatRun,
  PersonalLocalAgentHeartbeatRunNowInput,
  PersonalLocalAgentHeartbeatRunNowResult,
  PersonalLocalAgentHeartbeatRunsInput,
  PersonalLocalAgentHeartbeatRunsResult,
  PersonalLocalAgentHeartbeatSchedule,
  PersonalLocalAgentHeartbeatUpdateInput,
  PersonalLocalAgentHeartbeatUpdateResult,
  PersonalLocalAgentHeartbeatsListInput,
  PersonalLocalAgentHeartbeatsListResult,
  PersonalLocalAgentMetadata,
  PersonalLocalAgentMetadataListResult,
  PersonalLocalAgentModelOption,
  PersonalLocalAgentNativeSession,
  PersonalLocalAgentNativeSessionsListResult,
  PersonalLocalAgentOverridesResult,
  PersonalLocalAgentPlanEntry,
  PersonalLocalAgentProcessRecord,
  PersonalLocalAgentProvider,
  PersonalLocalAgentProviderSession,
  PersonalLocalAgentProviderSessionCloseResult,
  PersonalLocalAgentProviderSessionForkResult,
  PersonalLocalAgentProviderSessionLoadResult,
  PersonalLocalAgentProviderSessionsListResult,
  PersonalLocalAgentResetConversationInput,
  PersonalLocalAgentResetConversationResult,
  PersonalLocalAgentRunArtifact,
  PersonalLocalAgentRunEvent,
  PersonalLocalAgentRunFileChange,
  PersonalLocalAgentRunInput,
  PersonalLocalAgentRunResult,
  PersonalLocalAgentStatus,
  PersonalLocalAgentStatusInput,
  PersonalLocalAgentToolCall,
  PersonalLocalAgentTranscriptMessage,
  PersonalLocalAgentsListResult,
} from "./desktop-ipc-local-agents.js";

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

/** Selective snapshot domains for lazy management loads. */
export type AgentManagementSnapshotDomain = "core" | "skills" | "providers";

export type AgentManagementSnapshotInput = {
  workspaceRoot: string;
  /** When set, only these domains are loaded. Omit for full legacy snapshot. */
  domains?: AgentManagementSnapshotDomain[];
  /** Default false for domain-aware loads; true for full legacy snapshot. */
  includeModels?: boolean;
  includeDiscoverable?: boolean;
};

export type AgentManagementSnapshot = {
  generatedAt: number;
  workspaceRoot: string;
  agents: AgentManagementAgent[];
  skills: AgentManagementSkill[];
  providers: AgentManagementProvidersSnapshot;
  /** Domains actually populated in this response (partial loads omit others). */
  loadedDomains?: AgentManagementSnapshotDomain[];
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
  /** Default model id chosen for this provider after save (OpenCode etc.). */
  defaultModelId?: string | null;
  /** Canonical default model ref applied after save. */
  defaultModel?: { providerID: string; modelID: string } | null;
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

export type AgentManagementTestModelInput = {
  appType: AgentManagementManagedProvider["appType"];
  baseUrl: string;
  apiKey?: string;
  modelId: string;
};

export type AgentManagementTestModelResult = {
  ok: boolean;
  endpoint: string;
  modelId: string;
  elapsedMs: number;
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

export type { BrowserSkillStatusResult } from "./desktop-ipc-browser-skill.js";

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

export type ExpertPromptTemplate = { id: string; title: string; description: string; template: string; requiredSlots: string[]; conditionalSlots: string[] };
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
  promptTemplates: ExpertPromptTemplate[];
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
} from "./desktop-ipc-command-map.js";
