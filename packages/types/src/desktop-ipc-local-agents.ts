import type {
  PersonalLocalAgentMetadataRuntimeExtensions,
  PersonalLocalAgentRuntimeExtensions,
} from "./desktop-ipc-local-agent-extensions.js";

// Personal Local Agent desktop IPC wire types.
// Extracted from desktop-ipc.ts (re-exported for public entry compatibility).

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
    | "context_window_exceeded"
    | "acp_prompt_failed"
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
} & PersonalLocalAgentRuntimeExtensions;

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
} & PersonalLocalAgentMetadataRuntimeExtensions;

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

/** Push-first runtime notification; payloads contain identity, not transcripts. */
export type PersonalLocalAgentRuntimeEvent = {
  type: "run.started" | "run.snapshot" | "run.delta" | "run.finished" | "process.changed" | "catalog.invalidated";
  runId: string | null;
  workspaceRoot: string;
  conversationId: string | null;
  status: "running" | "completed" | "failed" | "cancelled" | string;
  updatedAt: number;
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
  tool_call_id?: string | null;
  status?: "pending" | "in_progress" | "completed" | "failed" | string;
  title?: string | null;
  kind?: "read" | "edit" | "execute" | string | null;
  content?: unknown[];
  input?: unknown;
  rawInput?: unknown;
  raw_input?: unknown;
  output?: unknown;
  rawOutput?: unknown;
  raw_output?: unknown;
  outputTruncated?: boolean;
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
  contextUsage?: {
    used: number;
    total: number;
    label?: string | null;
    totalSource?: string | null;
    usedSource?: string | null;
    breakdown?: Array<{ id: string; tokens: number }> | null;
    breakdownSource?: string | null;
    modelId?: string | null;
  } | null;
  commands?: unknown[];
};

export type PersonalLocalAgentApprovalMode = "auto" | "ask" | "read-only-auto";

export type PersonalLocalAgentApprovalRequest = {
  id: string;
  toolCallId?: string | null;
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
  expiresAt?: number | null;
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
  model?: string | null;
  workdir?: string | null;
  approvalMode?: PersonalLocalAgentApprovalMode;
  /**
   * Whether the provider may resume an existing provider-side session.
   * Task workers use `new` so each role starts from an isolated context.
   */
  sessionStrategy?: "resume" | "new";
  /**
   * Set to false for isolated task workers so a prior interactive
   * "always allow" decision cannot silently approve this run.
   */
  useRememberedApprovals?: boolean;
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
