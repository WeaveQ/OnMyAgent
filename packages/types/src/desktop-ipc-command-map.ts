/**
 * End-to-end Desktop IPC command contracts.
 *
 * Maps each `DesktopCommandName` to its invoke `args` tuple and `result`.
 * Commands with shared payload types in `desktop-ipc.ts` are typed explicitly;
 * remaining commands default to `unknown[]` / `unknown` so the key set stays
 * complete and can be tightened over time.
 */
import type { DesktopCommandName } from "./desktop-ipc-commands.mjs";
import type {
  CodeWorkspaceEnvironmentSnapshot,
  CodeWorkspaceFileContent,
  CodeWorkspaceFileEntry,
  CodeWorkspaceGitActionResult,
  CodeWorkspaceOpenResult,
  CodeWorkspaceOpenTargetId,
  CodeWorkspaceOpenTargetsResult,
  CodeWorkspaceTerminal,
  CodeWorkspaceTerminalSnapshot,
} from "./desktop-ipc-code-workspace";
import type {
  AgentManagementFetchModelsInput,
  AgentManagementFetchModelsResult,
  AgentManagementMcpActionInput,
  AgentManagementMcpActionResult,
  AgentManagementMcpSnapshot,
  AgentManagementProviderActionInput,
  AgentManagementProviderActionResult,
  AgentManagementSkillActionInput,
  AgentManagementSkillActionResult,
  AgentManagementSnapshot,
  AgentManagementSnapshotInput,
  AppBuildInfo,
  BuiltinSkillPackageInstallInput,
  BuiltinSkillPackageInstallResult,
  CacheResetResult,
  ChannelProbeResult,
  ComputerUseAppshotResult,
  ComputerUsePermissionResult,
  ComputerUseSkysightExclusionOperation,
  ComputerUseSkysightExclusionScope,
  DesktopBootstrapConfig,
  DesktopChannelAuthorizedUser,
  DesktopChannelEventHistoryEntry,
  DesktopChannelPairingRequest,
  DesktopChannelSession,
  DesktopFetchResult,
  DiscordAccountStatus,
  DiscordAccountStatusInput,
  DiscordSaveAccountInput,
  DiscordServiceStartInput,
  DiscordSimulateInboundInput,
  EngineDoctorResult,
  EngineInfo,
  ExpertMarketplaceName,
  ExpertPackageInstallInput,
  ExpertPackageInstallResult,
  ExpertPackageListEntry,
  ExpertRegistryListEntry,
  ExecResult,
  FeishuAccountStatus,
  FeishuAccountStatusInput,
  FeishuSaveAccountInput,
  FeishuServiceStartInput,
  FeishuSimulateInboundInput,
  LocalSkillCard,
  LocalSkillContent,
  MessagingAccessibleRootProbe,
  MessagingChannelStatus,
  MyExpertPackageWriteInput,
  OnMyAgentDockerCleanupResult,
  OnMyAgentServerInfo,
  OpencodeCommandDraft,
  OpencodeConfigFile,
  OrchestratorDetachedHost,
  OrchestratorStatus,
  OrchestratorWorkspaceActivateInput,
  OrchestratorWorkspaceActivateResult,
  PersonalLocalAgent,
  PersonalLocalAgentAcpConfigOptionInput,
  PersonalLocalAgentAcpConfigOptionResult,
  PersonalLocalAgentApprovalDecision,
  PersonalLocalAgentApprovalInput,
  PersonalLocalAgentApprovalMode,
  PersonalLocalAgentChannelConversationsListResult,
  PersonalLocalAgentConversationConfirmationsResult,
  PersonalLocalAgentConversationCreateResult,
  PersonalLocalAgentConversationGetByIdResult,
  PersonalLocalAgentConversationGetResult,
  PersonalLocalAgentConversationImportInput,
  PersonalLocalAgentConversationImportResult,
  PersonalLocalAgentConversationInput,
  PersonalLocalAgentConversationStatusResult,
  PersonalLocalAgentConversationTranscriptInput,
  PersonalLocalAgentConversationTranscriptResult,
  PersonalLocalAgentConversationWarmupResult,
  PersonalLocalAgentConversationsListByProviderResult,
  PersonalLocalAgentConversationsListResult,
  PersonalLocalAgentCustomAgentInput,
  PersonalLocalAgentCustomAgentResult,
  PersonalLocalAgentDeleteCustomAgentResult,
  PersonalLocalAgentDetectResult,
  PersonalLocalAgentExtensionListResult,
  PersonalLocalAgentExtensionSetEnabledResult,
  PersonalLocalAgentHeartbeatCreateInput,
  PersonalLocalAgentHeartbeatCreateResult,
  PersonalLocalAgentHeartbeatDeleteInput,
  PersonalLocalAgentHeartbeatDeleteResult,
  PersonalLocalAgentHeartbeatRunNowInput,
  PersonalLocalAgentHeartbeatRunNowResult,
  PersonalLocalAgentHeartbeatRunsInput,
  PersonalLocalAgentHeartbeatRunsResult,
  PersonalLocalAgentHeartbeatUpdateInput,
  PersonalLocalAgentHeartbeatUpdateResult,
  PersonalLocalAgentHeartbeatsListInput,
  PersonalLocalAgentHeartbeatsListResult,
  PersonalLocalAgentHostStatusInput,
  PersonalLocalAgentHostStatusResult,
  PersonalLocalAgentMetadataListResult,
  PersonalLocalAgentNativeSessionsListResult,
  PersonalLocalAgentOverridesResult,
  PersonalLocalAgentProcessRecord,
  PersonalLocalAgentProviderHealthResult,
  PersonalLocalAgentProviderSessionCloseResult,
  PersonalLocalAgentProviderSessionForkResult,
  PersonalLocalAgentProviderSessionLoadResult,
  PersonalLocalAgentProviderSessionsListResult,
  PersonalLocalAgentResetConversationInput,
  PersonalLocalAgentResetConversationResult,
  PersonalLocalAgentRunInput,
  PersonalLocalAgentRunResult,
  PersonalLocalAgentTestConnectionResult,
  PersonalLocalAgentTestCustomAgentResult,
  PersonalLocalAgentsListResult,
  RuntimeBootstrapResult,
  RuntimeStatus,
  SandboxDebugProbeResult,
  SandboxDoctorResult,
  SandboxStopResult,
  ShellCommandResult,
  SoftwareEnvironmentInfo,
  SoftwareEnvironmentInstallResult,
  SystemPermissionResult,
  SystemPermissionType,
  TelegramAccountStatus,
  TelegramAccountStatusInput,
  TelegramSaveAccountInput,
  TelegramServiceStartInput,
  TelegramSimulateInboundInput,
  UiControlBridgeInfo,
  UpdaterEnvironment,
  UserAgentRegistryFile,
  UserAgentRegistryWriteResult,
  WeixinAccountStatus,
  WeixinAccountStatusInput,
  WeixinLoginPollInput,
  WeixinLoginStartInput,
  WeixinSaveAccountInput,
  WeixinServiceStartInput,
  WeixinSimulateInboundInput,
  LocalAgentComposerListFilesInput,
  LocalAgentComposerListFilesResult,
  LocalAgentComposerSaveAttachmentInput,
  LocalAgentComposerSaveAttachmentResult,
  PersonalLocalAgentAcpConfigOptionsInput,
  PersonalLocalAgentAcpConfigOptionsResult,
  PersonalLocalAgentAcpHealthInput,
  PersonalLocalAgentAcpHealthResult,
  WorkspaceCreateRemoteInput,
  WorkspaceExportSummary,
  WorkspaceList,
  WorkspaceOnMyAgentConfig,
  WorkspaceUpdateRemoteInput,
} from "./desktop-ipc";

export type DesktopCommandContract<
  Args extends readonly unknown[] = readonly unknown[],
  Result = unknown,
> = {
  args: Args;
  result: Result;
};

type OkResult = { ok: boolean; error?: string };

/** Explicit contracts for commands with known shared payload types. */
type TypedDesktopCommandMap = {
  // workspace
  workspaceBootstrap: DesktopCommandContract<[], WorkspaceList>;
  workspaceSetSelected: DesktopCommandContract<[string], WorkspaceList>;
  workspaceSetRuntimeActive: DesktopCommandContract<[string], WorkspaceList>;
  workspaceCreate: DesktopCommandContract<
    [string | { path?: string; name?: string; preset?: string }],
    WorkspaceList
  >;
  workspaceCreateRemote: DesktopCommandContract<[WorkspaceCreateRemoteInput], WorkspaceList>;
  workspaceUpdateRemote: DesktopCommandContract<[WorkspaceUpdateRemoteInput], WorkspaceList>;
  workspaceUpdateDisplayName: DesktopCommandContract<
    [{ id: string; displayName: string }],
    WorkspaceList
  >;
  workspaceForget: DesktopCommandContract<[string], WorkspaceList>;
  workspaceAddAuthorizedRoot: DesktopCommandContract<
    [{ workspaceId?: string; root: string }],
    WorkspaceList
  >;
  workspaceOpenworkRead: DesktopCommandContract<
    [string?],
    WorkspaceOnMyAgentConfig | null
  >;
  workspaceOnMyAgentRead: DesktopCommandContract<
    [string?],
    WorkspaceOnMyAgentConfig | null
  >;
  workspaceOpenworkWrite: DesktopCommandContract<
    [WorkspaceOnMyAgentConfig, string?],
    WorkspaceOnMyAgentConfig
  >;
  workspaceOnMyAgentWrite: DesktopCommandContract<
    [WorkspaceOnMyAgentConfig, string?],
    WorkspaceOnMyAgentConfig
  >;
  workspaceExportConfig: DesktopCommandContract<
    [{ workspaceId?: string; outputPath?: string }?],
    WorkspaceExportSummary
  >;
  workspaceImportConfig: DesktopCommandContract<
    [{ path: string }],
    WorkspaceList
  >;

  // code workspace
  codeWorkspaceOpenTargets: DesktopCommandContract<[], CodeWorkspaceOpenTargetsResult>;
  codeWorkspaceEnvironment: DesktopCommandContract<
    [{ workspacePath?: string | null; sessionId?: string | null }?],
    CodeWorkspaceEnvironmentSnapshot
  >;
  codeWorkspaceOpen: DesktopCommandContract<
    [{ targetId: CodeWorkspaceOpenTargetId; workspacePath: string }],
    CodeWorkspaceOpenResult
  >;
  codeWorkspaceTerminalCreate: DesktopCommandContract<
    [{ workspacePath?: string | null }],
    CodeWorkspaceTerminal
  >;
  codeWorkspaceTerminalWrite: DesktopCommandContract<
    [{ terminalId: string; data: string }],
    { ok: true }
  >;
  codeWorkspaceTerminalResize: DesktopCommandContract<
    [{ terminalId: string; cols: number; rows: number }],
    { ok: true }
  >;
  codeWorkspaceTerminalSnapshot: DesktopCommandContract<
    [{ terminalId: string }],
    CodeWorkspaceTerminalSnapshot
  >;
  codeWorkspaceTerminalClose: DesktopCommandContract<
    [{ terminalId: string }],
    { ok: true }
  >;
  codeWorkspaceFilesList: DesktopCommandContract<
    [{ workspacePath: string; relativePath?: string }],
    { items: CodeWorkspaceFileEntry[] }
  >;
  codeWorkspaceFileRead: DesktopCommandContract<
    [{ workspacePath: string; relativePath: string }],
    CodeWorkspaceFileContent
  >;
  codeWorkspaceGitSwitchBranch: DesktopCommandContract<
    [{ workspacePath: string; sessionId: string; branch: string }],
    CodeWorkspaceGitActionResult
  >;
  codeWorkspaceGitCommit: DesktopCommandContract<
    [{ workspacePath: string; sessionId: string; message: string; push: boolean }],
    CodeWorkspaceGitActionResult
  >;
  codeWorkspaceGitPush: DesktopCommandContract<
    [{ workspacePath: string; sessionId: string }],
    CodeWorkspaceGitActionResult
  >;

  // system
  userAgentRegistryRead: DesktopCommandContract<[], UserAgentRegistryFile | null>;
  userAgentRegistryWrite: DesktopCommandContract<
    [{ content: string }],
    UserAgentRegistryWriteResult
  >;
  prepareFreshRuntime: DesktopCommandContract<[], void>;
  appBuildInfo: DesktopCommandContract<[], AppBuildInfo>;
  getUiControlBridgeInfo: DesktopCommandContract<[], UiControlBridgeInfo | null>;
  getComputerUseMcpCommand: DesktopCommandContract<[], string[]>;
  checkComputerUsePermissions: DesktopCommandContract<
    [],
    ComputerUsePermissionResult
  >;
  setComputerUseSkysightEnabled: DesktopCommandContract<
    [boolean],
    ComputerUsePermissionResult
  >;
  setComputerUseSkysightPaused: DesktopCommandContract<
    [boolean],
    ComputerUsePermissionResult
  >;
  updateComputerUseSkysightExclusion: DesktopCommandContract<
    [
      ComputerUseSkysightExclusionOperation,
      ComputerUseSkysightExclusionScope,
      string?,
    ],
    ComputerUsePermissionResult
  >;
  clearComputerUseSkysightData: DesktopCommandContract<[], OkResult>;
  captureComputerUseAppshot: DesktopCommandContract<[], ComputerUseAppshotResult>;
  revokeComputerUseAppAuthorization: DesktopCommandContract<
    [string],
    ComputerUsePermissionResult
  >;
  clearComputerUseAppAuthorizations: DesktopCommandContract<
    [],
    ComputerUsePermissionResult
  >;
  openComputerUsePermissionSetup: DesktopCommandContract<
    [],
    ComputerUsePermissionResult
  >;
  openComputerUsePermissionSettings: DesktopCommandContract<
    [],
    ComputerUsePermissionResult
  >;
  checkSystemPermissions: DesktopCommandContract<[], SystemPermissionResult>;
  openSystemPermissionSettings: DesktopCommandContract<
    [SystemPermissionType?],
    void
  >;
  getDesktopBootstrapConfig: DesktopCommandContract<[], DesktopBootstrapConfig>;
  debugDesktopBootstrapConfig: DesktopCommandContract<[], DesktopBootstrapConfig>;
  setDesktopBootstrapConfig: DesktopCommandContract<
    [Partial<DesktopBootstrapConfig>?],
    DesktopBootstrapConfig
  >;
  pickDirectory: DesktopCommandContract<
    [{ title?: string; defaultPath?: string }?],
    string | null
  >;
  pickFile: DesktopCommandContract<
    [{ title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }?],
    string | null
  >;
  saveFile: DesktopCommandContract<
    [{ title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }?],
    string | null
  >;
  exportVisualSnapshot: DesktopCommandContract<
    [{
      format: "png" | "pdf";
      rect: { x: number; y: number; width: number; height: number };
      defaultPath: string;
    }],
    { status: "saved" | "cancelled"; path: string | null }
  >;
  updaterEnvironment: DesktopCommandContract<[], UpdaterEnvironment>;
  setWindowDecorations: DesktopCommandContract<[{ enabled: boolean }], void>;
  __openPath: DesktopCommandContract<[string], string | null>;
  __revealItemInDir: DesktopCommandContract<
    [string],
    { ok: boolean; path?: string; reason?: string }
  >;
  __fetch: DesktopCommandContract<
    [string, { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }?],
    DesktopFetchResult
  >;
  __homeDir: DesktopCommandContract<[], string>;
  __joinPath: DesktopCommandContract<string[], string>;
  __setZoomFactor: DesktopCommandContract<[number], boolean>;
  __setNativeTheme: DesktopCommandContract<[string], void>;
  __setApplicationMenuVisible: DesktopCommandContract<[boolean], void>;
  checkSoftwareEnv: DesktopCommandContract<[], SoftwareEnvironmentInfo>;
  installSoftwareEnv: DesktopCommandContract<
    [string, string?],
    SoftwareEnvironmentInstallResult
  >;

  // local agents
  personalLocalAgentsList: DesktopCommandContract<
    [
      {
        agents?: Array<Partial<PersonalLocalAgent>>;
        workspaceRoot?: string;
        includeModels?: boolean;
      }?,
    ],
    PersonalLocalAgentsListResult
  >;
  personalLocalAgentMetadataList: DesktopCommandContract<
    [
      {
        agents?: Array<Partial<PersonalLocalAgent>>;
        workspaceRoot?: string;
        includeModels?: boolean;
      }?,
    ],
    PersonalLocalAgentMetadataListResult
  >;
  personalLocalAgentAcpAgentsList: DesktopCommandContract<
    [
      {
        agents?: Array<Partial<PersonalLocalAgent>>;
        workspaceRoot?: string;
        includeModels?: boolean;
      }?,
    ],
    PersonalLocalAgentMetadataListResult
  >;
  personalLocalAgentAcpAgentsRefresh: DesktopCommandContract<
    [
      {
        agents?: Array<Partial<PersonalLocalAgent>>;
        workspaceRoot?: string;
        includeModels?: boolean;
      }?,
    ],
    PersonalLocalAgentMetadataListResult
  >;
  personalLocalAgentAcpHealth: DesktopCommandContract<
    [PersonalLocalAgentAcpHealthInput?],
    PersonalLocalAgentAcpHealthResult
  >;
  personalLocalAgentAcpSend: DesktopCommandContract<
    [PersonalLocalAgentRunInput],
    PersonalLocalAgentRunResult
  >;
  personalLocalAgentAcpCancel: DesktopCommandContract<[string], OkResult>;
  personalLocalAgentAcpResolveApproval: DesktopCommandContract<
    [PersonalLocalAgentApprovalInput],
    OkResult
  >;
  personalLocalAgentAcpConfigOptions: DesktopCommandContract<
    [PersonalLocalAgentAcpConfigOptionsInput?],
    PersonalLocalAgentAcpConfigOptionsResult
  >;
  personalLocalAgentSetAcpConfigOption: DesktopCommandContract<
    [PersonalLocalAgentAcpConfigOptionInput],
    PersonalLocalAgentAcpConfigOptionResult
  >;
  personalLocalAgentCreateCustomAgent: DesktopCommandContract<
    [PersonalLocalAgentCustomAgentInput],
    PersonalLocalAgentCustomAgentResult
  >;
  personalLocalAgentDetectAvailableAgents: DesktopCommandContract<
    [{ workspaceRoot: string; existingIds?: string[] }],
    PersonalLocalAgentDetectResult
  >;
  personalLocalAgentUpdateCustomAgent: DesktopCommandContract<
    [PersonalLocalAgentCustomAgentInput],
    PersonalLocalAgentCustomAgentResult
  >;
  personalLocalAgentDeleteCustomAgent: DesktopCommandContract<
    [{ workspaceRoot: string; id: string }],
    PersonalLocalAgentDeleteCustomAgentResult
  >;
  personalLocalAgentGetAgentOverrides: DesktopCommandContract<
    [{ workspaceRoot: string; id: string }],
    PersonalLocalAgentOverridesResult
  >;
  personalLocalAgentSetAgentOverrides: DesktopCommandContract<
    [{ workspaceRoot: string; id: string; overrides: Record<string, unknown> }],
    PersonalLocalAgentOverridesResult
  >;
  personalLocalAgentExtensionsList: DesktopCommandContract<
    [Record<string, never>?],
    PersonalLocalAgentExtensionListResult
  >;
  personalLocalAgentExtensionSetEnabled: DesktopCommandContract<
    [{ name: string; enabled: boolean }],
    PersonalLocalAgentExtensionSetEnabledResult
  >;
  personalLocalAgentAcpProcessesList: DesktopCommandContract<
    [{ workspaceRoot?: string; provider?: string; conversationId?: string }?],
    { processes: PersonalLocalAgentProcessRecord[] }
  >;
  personalLocalAgentTestConnection: DesktopCommandContract<
    [{ agent: Partial<PersonalLocalAgent>; workspaceRoot?: string; timeoutMs?: number }],
    PersonalLocalAgentTestConnectionResult
  >;
  personalLocalAgentTestCustomAgent: DesktopCommandContract<
    [{
      command: string;
      acpArgs?: string[];
      args?: string[];
      env?: Record<string, string>;
      timeoutMs?: number;
    }],
    PersonalLocalAgentTestCustomAgentResult
  >;
  personalLocalAgentCheckProviderHealth: DesktopCommandContract<
    [{ agent: Partial<PersonalLocalAgent>; workspaceRoot?: string; timeoutMs?: number }],
    PersonalLocalAgentProviderHealthResult
  >;
  personalLocalAgentCheckManagedAgentHealthById: DesktopCommandContract<
    [{
      id?: string;
      agentId?: string;
      provider?: string;
      workspaceRoot?: string;
      timeoutMs?: number;
    }],
    PersonalLocalAgentProviderHealthResult
  >;
  personalLocalAgentValidate: DesktopCommandContract<
    [Partial<PersonalLocalAgent>],
    PersonalLocalAgent
  >;
  personalLocalAgentStart: DesktopCommandContract<
    [PersonalLocalAgentRunInput],
    PersonalLocalAgentRunResult
  >;
  personalLocalAgentStatus: DesktopCommandContract<
    [string | { runId: string; workspaceRoot?: string }],
    PersonalLocalAgentRunResult
  >;
  personalLocalAgentRun: DesktopCommandContract<
    [PersonalLocalAgentRunInput],
    PersonalLocalAgentRunResult
  >;
  personalLocalAgentCancel: DesktopCommandContract<[string], OkResult>;
  personalLocalAgentResolveApproval: DesktopCommandContract<
    [PersonalLocalAgentApprovalInput],
    OkResult
  >;
  personalLocalAgentResetConversation: DesktopCommandContract<
    [PersonalLocalAgentResetConversationInput],
    PersonalLocalAgentResetConversationResult
  >;
  personalLocalAgentConversationsList: DesktopCommandContract<
    [PersonalLocalAgentConversationInput],
    PersonalLocalAgentConversationsListResult
  >;
  personalLocalAgentConversationGet: DesktopCommandContract<
    [PersonalLocalAgentConversationInput],
    PersonalLocalAgentConversationGetResult
  >;
  personalLocalAgentConversationGetById: DesktopCommandContract<
    [{ workspaceRoot: string; conversationId: string }],
    PersonalLocalAgentConversationGetByIdResult
  >;
  personalLocalAgentChannelConversationsList: DesktopCommandContract<
    [{ workspaceRoot: string }],
    PersonalLocalAgentChannelConversationsListResult
  >;
  personalLocalAgentConversationsListByProvider: DesktopCommandContract<
    [PersonalLocalAgentConversationInput],
    PersonalLocalAgentConversationsListByProviderResult
  >;
  personalLocalAgentConversationImportFromArchive: DesktopCommandContract<
    [PersonalLocalAgentConversationImportInput],
    PersonalLocalAgentConversationImportResult
  >;
  personalLocalAgentConversationCreate: DesktopCommandContract<
    [PersonalLocalAgentConversationInput],
    PersonalLocalAgentConversationCreateResult
  >;
  personalLocalAgentConversationStatus: DesktopCommandContract<
    [PersonalLocalAgentConversationInput & { conversationId?: string | null }],
    PersonalLocalAgentConversationStatusResult
  >;
  personalLocalAgentConversationWarmup: DesktopCommandContract<
    [
      PersonalLocalAgentConversationInput & {
        conversationId?: string | null;
        approvalMode?: PersonalLocalAgentApprovalMode;
        model?: string | null;
      },
    ],
    PersonalLocalAgentConversationWarmupResult
  >;
  personalLocalAgentProviderSessionsList: DesktopCommandContract<
    [PersonalLocalAgentConversationInput],
    PersonalLocalAgentProviderSessionsListResult
  >;
  personalLocalAgentProviderSessionLoad: DesktopCommandContract<
    [PersonalLocalAgentConversationInput & { sessionId: string; title?: string }],
    PersonalLocalAgentProviderSessionLoadResult
  >;
  personalLocalAgentProviderSessionClose: DesktopCommandContract<
    [
      PersonalLocalAgentConversationInput & {
        conversationId?: string | null;
        sessionId: string;
      },
    ],
    PersonalLocalAgentProviderSessionCloseResult
  >;
  personalLocalAgentProviderSessionFork: DesktopCommandContract<
    [
      PersonalLocalAgentConversationInput & {
        sessionId: string;
        title?: string;
        messageId?: string;
      },
    ],
    PersonalLocalAgentProviderSessionForkResult
  >;
  personalLocalAgentConversationConfirmationsList: DesktopCommandContract<
    [PersonalLocalAgentConversationInput],
    PersonalLocalAgentConversationConfirmationsResult
  >;
  personalLocalAgentHostStatus: DesktopCommandContract<
    [PersonalLocalAgentHostStatusInput],
    PersonalLocalAgentHostStatusResult
  >;
  personalLocalAgentConversationConfirmationConfirm: DesktopCommandContract<
    [
      PersonalLocalAgentConversationInput & {
        runId?: string | null;
        approvalId?: string | null;
        id?: string | null;
        decision: PersonalLocalAgentApprovalDecision;
        alwaysAllow?: boolean;
      },
    ],
    OkResult
  >;
  personalLocalAgentNativeSessionsList: DesktopCommandContract<
    [
      {
        workspaceRoot: string;
        limit?: number;
        agent?: Partial<PersonalLocalAgent>;
      },
    ],
    PersonalLocalAgentNativeSessionsListResult
  >;
  personalLocalAgentConversationTranscript: DesktopCommandContract<
    [PersonalLocalAgentConversationTranscriptInput],
    PersonalLocalAgentConversationTranscriptResult
  >;
  personalLocalAgentHeartbeatsList: DesktopCommandContract<
    [PersonalLocalAgentHeartbeatsListInput],
    PersonalLocalAgentHeartbeatsListResult
  >;
  personalLocalAgentHeartbeatCreate: DesktopCommandContract<
    [PersonalLocalAgentHeartbeatCreateInput],
    PersonalLocalAgentHeartbeatCreateResult
  >;
  personalLocalAgentHeartbeatUpdate: DesktopCommandContract<
    [PersonalLocalAgentHeartbeatUpdateInput],
    PersonalLocalAgentHeartbeatUpdateResult
  >;
  personalLocalAgentHeartbeatDelete: DesktopCommandContract<
    [PersonalLocalAgentHeartbeatDeleteInput],
    PersonalLocalAgentHeartbeatDeleteResult
  >;
  personalLocalAgentHeartbeatRunNow: DesktopCommandContract<
    [PersonalLocalAgentHeartbeatRunNowInput],
    PersonalLocalAgentHeartbeatRunNowResult
  >;
  personalLocalAgentHeartbeatRuns: DesktopCommandContract<
    [PersonalLocalAgentHeartbeatRunsInput],
    PersonalLocalAgentHeartbeatRunsResult
  >;
  localAgentComposerListFiles: DesktopCommandContract<
    [LocalAgentComposerListFilesInput],
    LocalAgentComposerListFilesResult
  >;
  localAgentComposerSaveAttachment: DesktopCommandContract<
    [LocalAgentComposerSaveAttachmentInput],
    LocalAgentComposerSaveAttachmentResult
  >;

  // messaging — weixin
  weixinLoginStart: DesktopCommandContract<
    [WeixinLoginStartInput?],
    MessagingChannelStatus
  >;
  weixinLoginPoll: DesktopCommandContract<[WeixinLoginPollInput], MessagingChannelStatus>;
  weixinSaveAccount: DesktopCommandContract<[WeixinSaveAccountInput], WeixinAccountStatus>;
  weixinAccountStatus: DesktopCommandContract<
    [WeixinAccountStatusInput?],
    WeixinAccountStatus
  >;
  weixinStart: DesktopCommandContract<[WeixinServiceStartInput], MessagingChannelStatus>;
  weixinAutoStart: DesktopCommandContract<
    [WeixinServiceStartInput?],
    MessagingChannelStatus
  >;
  weixinStop: DesktopCommandContract<[], MessagingChannelStatus>;
  weixinStatus: DesktopCommandContract<[], MessagingChannelStatus>;
  weixinSimulateInbound: DesktopCommandContract<
    [WeixinSimulateInboundInput],
    MessagingChannelStatus
  >;
  weixinProbeAccessibleRoot: DesktopCommandContract<
    [{ root: string } | { folderPath: string }],
    MessagingAccessibleRootProbe
  >;

  // messaging — feishu
  feishuSaveAccount: DesktopCommandContract<[FeishuSaveAccountInput], FeishuAccountStatus>;
  feishuAccountStatus: DesktopCommandContract<
    [FeishuAccountStatusInput?],
    FeishuAccountStatus
  >;
  feishuStart: DesktopCommandContract<[FeishuServiceStartInput], MessagingChannelStatus>;
  feishuAutoStart: DesktopCommandContract<
    [FeishuServiceStartInput?],
    MessagingChannelStatus
  >;
  feishuStop: DesktopCommandContract<[], MessagingChannelStatus>;
  feishuStatus: DesktopCommandContract<[], MessagingChannelStatus>;
  feishuSimulateInbound: DesktopCommandContract<
    [FeishuSimulateInboundInput],
    MessagingChannelStatus
  >;
  feishuProbeAccessibleRoot: DesktopCommandContract<
    [{ root: string } | { folderPath: string }],
    MessagingAccessibleRootProbe
  >;

  // messaging — telegram
  telegramSaveAccount: DesktopCommandContract<
    [TelegramSaveAccountInput],
    TelegramAccountStatus
  >;
  telegramAccountStatus: DesktopCommandContract<
    [TelegramAccountStatusInput?],
    TelegramAccountStatus
  >;
  telegramStart: DesktopCommandContract<
    [TelegramServiceStartInput],
    MessagingChannelStatus
  >;
  telegramAutoStart: DesktopCommandContract<
    [TelegramServiceStartInput?],
    MessagingChannelStatus
  >;
  telegramStop: DesktopCommandContract<[], MessagingChannelStatus>;
  telegramStatus: DesktopCommandContract<[], MessagingChannelStatus>;
  telegramSimulateInbound: DesktopCommandContract<
    [TelegramSimulateInboundInput],
    MessagingChannelStatus
  >;

  // messaging — discord
  discordSaveAccount: DesktopCommandContract<
    [DiscordSaveAccountInput],
    DiscordAccountStatus
  >;
  discordAccountStatus: DesktopCommandContract<
    [DiscordAccountStatusInput?],
    DiscordAccountStatus
  >;
  discordStart: DesktopCommandContract<[DiscordServiceStartInput], MessagingChannelStatus>;
  discordAutoStart: DesktopCommandContract<
    [DiscordServiceStartInput?],
    MessagingChannelStatus
  >;
  discordStop: DesktopCommandContract<[], MessagingChannelStatus>;
  discordStatus: DesktopCommandContract<[], MessagingChannelStatus>;
  discordSimulateInbound: DesktopCommandContract<
    [DiscordSimulateInboundInput],
    MessagingChannelStatus
  >;

  // channel infrastructure (args shaped like desktop wrappers)
  channelTestPlugin: DesktopCommandContract<
    [{ pluginId: string; accountId?: string }],
    ChannelProbeResult
  >;
  channelGetPendingPairingRequests: DesktopCommandContract<
    [],
    DesktopChannelPairingRequest[]
  >;
  channelApprovePairing: DesktopCommandContract<
    [{ code: string }],
    OkResult & { user?: DesktopChannelAuthorizedUser }
  >;
  channelDenyPairing: DesktopCommandContract<[{ code: string }], OkResult>;
  channelGetAuthorizedUsers: DesktopCommandContract<
    [],
    DesktopChannelAuthorizedUser[]
  >;
  channelIsUserAuthorized: DesktopCommandContract<
    [{ platformType: string; platformUserId: string }],
    boolean
  >;
  channelRevokeUserAuthorization: DesktopCommandContract<
    [{ platformType: string; platformUserId: string }],
    OkResult
  >;
  channelGetOrCreateSession: DesktopCommandContract<
    [
      {
        platformType: string;
        platformUserId: string;
        agentType: string;
        workspace?: string;
        chatId?: string;
      },
    ],
    OkResult & { session?: DesktopChannelSession }
  >;
  channelGetSession: DesktopCommandContract<
    [{ sessionId: string }],
    OkResult & { session?: DesktopChannelSession }
  >;
  channelGetSessionsByPlatform: DesktopCommandContract<
    [{ platformType: string }],
    DesktopChannelSession[]
  >;
  channelGetSessionsByUser: DesktopCommandContract<
    [{ platformType: string; platformUserId: string }],
    DesktopChannelSession[]
  >;
  channelCloseSession: DesktopCommandContract<[{ sessionId: string }], OkResult>;
  channelUpdateSessionMetadata: DesktopCommandContract<
    [{ sessionId: string; metadata: Record<string, unknown> }],
    OkResult
  >;
  channelGetEventHistory: DesktopCommandContract<
    [{ limit?: number; filterEvent?: string }?],
    DesktopChannelEventHistoryEntry[]
  >;

  // agent management
  agentManagementSnapshot: DesktopCommandContract<
    [AgentManagementSnapshotInput],
    AgentManagementSnapshot
  >;
  agentManagementProviderAction: DesktopCommandContract<
    [AgentManagementProviderActionInput],
    AgentManagementProviderActionResult
  >;
  agentManagementFetchModels: DesktopCommandContract<
    [AgentManagementFetchModelsInput],
    AgentManagementFetchModelsResult
  >;
  agentManagementSkillAction: DesktopCommandContract<
    [AgentManagementSkillActionInput],
    AgentManagementSkillActionResult
  >;
  agentManagementMcpSnapshot: DesktopCommandContract<[], AgentManagementMcpSnapshot>;
  agentManagementMcpAction: DesktopCommandContract<
    [AgentManagementMcpActionInput],
    AgentManagementMcpActionResult
  >;

  // opencode config / commands
  opencodeCommandList: DesktopCommandContract<
    [{ scope?: string; projectDir?: string }?],
    string[]
  >;
  opencodeCommandWrite: DesktopCommandContract<
    [{ scope?: string; projectDir?: string; command: OpencodeCommandDraft }],
    ExecResult
  >;
  opencodeCommandDelete: DesktopCommandContract<
    [{ scope?: string; projectDir?: string; name: string }],
    ExecResult
  >;
  readOpencodeConfig: DesktopCommandContract<[string?], OpencodeConfigFile>;
  writeOpencodeConfig: DesktopCommandContract<
    [{ path?: string; content: string }],
    OpencodeConfigFile
  >;
  resetOpencodeCache: DesktopCommandContract<[], CacheResetResult>;
  opencodeMcpAuth: DesktopCommandContract<[string, string], ShellCommandResult>;

  // runtime / engine
  engineStart: DesktopCommandContract<
    [string, Record<string, unknown>?],
    EngineInfo
  >;
  runtimeBootstrap: DesktopCommandContract<[], RuntimeBootstrapResult>;
  runtimeStatus: DesktopCommandContract<[], RuntimeStatus>;
  engineStop: DesktopCommandContract<[], EngineInfo>;
  engineRestart: DesktopCommandContract<[string?, Record<string, unknown>?], EngineInfo>;
  engineInfo: DesktopCommandContract<[], EngineInfo>;
  engineDoctor: DesktopCommandContract<[Record<string, unknown>?], EngineDoctorResult>;
  engineInstall: DesktopCommandContract<[], EngineDoctorResult>;
  orchestratorStatus: DesktopCommandContract<[], OrchestratorStatus>;
  orchestratorWorkspaceActivate: DesktopCommandContract<
    [OrchestratorWorkspaceActivateInput],
    OrchestratorWorkspaceActivateResult
  >;
  orchestratorInstanceDispose: DesktopCommandContract<[string], boolean>;
  getOpenworkUiMcpCommand: DesktopCommandContract<[], string[]>;
  getOnMyAgentUiMcpCommand: DesktopCommandContract<[], string[]>;
  getOpenworkUiMcpEnvironment: DesktopCommandContract<
    [],
    Record<string, string>
  >;
  getOnMyAgentUiMcpEnvironment: DesktopCommandContract<
    [],
    Record<string, string>
  >;
  nukeOpenworkAndOpencodeConfigAndExit: DesktopCommandContract<[], void>;
  nukeOnMyAgentAndOpencodeConfigAndExit: DesktopCommandContract<[], void>;
  orchestratorStartDetached: DesktopCommandContract<
    [Record<string, unknown>?],
    OrchestratorDetachedHost
  >;
  sandboxDoctor: DesktopCommandContract<[], SandboxDoctorResult>;
  sandboxStop: DesktopCommandContract<[string?], SandboxStopResult>;
  sandboxCleanupOpenworkContainers: DesktopCommandContract<
    [],
    OnMyAgentDockerCleanupResult
  >;
  sandboxCleanupOnMyAgentContainers: DesktopCommandContract<
    [],
    OnMyAgentDockerCleanupResult
  >;
  sandboxDebugProbe: DesktopCommandContract<[], SandboxDebugProbeResult>;
  onmyagentServerInfo: DesktopCommandContract<[], OnMyAgentServerInfo>;
  onmyagentServerRestart: DesktopCommandContract<[], OnMyAgentServerInfo>;
  /** @deprecated alias — same as resetOnMyAgentState */
  resetOpenworkState: DesktopCommandContract<
    [("onboarding" | "all")?],
    CacheResetResult
  >;
  /**
   * Reset OnMyAgent local product data then UI relaunches.
   * - onboarding: workspace list + desktop bootstrap only
   * - all: Electron userData + ~/.onmyagent + ~/.studio-switch + legacy product home
   *   (does not wipe shared CLI configs like ~/.config/opencode / ~/.claude / ~/.codex)
   */
  resetOnMyAgentState: DesktopCommandContract<
    [("onboarding" | "all")?],
    CacheResetResult
  >;

  // skills
  importSkill: DesktopCommandContract<
    [string, string, { overwrite?: boolean }?],
    ExecResult
  >;
  installSkillTemplate: DesktopCommandContract<
    [string, string, string, { overwrite?: boolean }?],
    ExecResult
  >;
  listLocalSkills: DesktopCommandContract<[string?], LocalSkillCard[]>;
  onmyagentSkillsRoot: DesktopCommandContract<[], string>;
  onmyagentMarketplaceRoot: DesktopCommandContract<
    [ExpertMarketplaceName],
    string
  >;
  listExpertPackages: DesktopCommandContract<
    [ExpertMarketplaceName],
    ExpertPackageListEntry[]
  >;
  listExpertRegistryRecords: DesktopCommandContract<
    [ExpertMarketplaceName],
    ExpertRegistryListEntry[]
  >;
  installExpertPackage: DesktopCommandContract<
    [ExpertPackageInstallInput],
    ExpertPackageInstallResult
  >;
  installBuiltinSkillPackage: DesktopCommandContract<
    [BuiltinSkillPackageInstallInput],
    BuiltinSkillPackageInstallResult
  >;
  writeMyExpertPackage: DesktopCommandContract<
    [MyExpertPackageWriteInput],
    ExpertPackageInstallResult
  >;
  readLocalSkill: DesktopCommandContract<[string], LocalSkillContent>;
  writeLocalSkill: DesktopCommandContract<
    [{ path: string; content: string }],
    LocalSkillContent
  >;
  uninstallSkill: DesktopCommandContract<[string], OkResult>;
};

/**
 * Complete command map: every `DesktopCommandName` is a key.
 * Typed entries come from `TypedDesktopCommandMap`; others are untyped placeholders.
 */
export type DesktopCommandMap = {
  [K in DesktopCommandName]: K extends keyof TypedDesktopCommandMap
    ? TypedDesktopCommandMap[K]
    : DesktopCommandContract;
};

export type DesktopCommandArgsOf<C extends DesktopCommandName> =
  DesktopCommandMap[C]["args"];

export type DesktopCommandResultOf<C extends DesktopCommandName> =
  DesktopCommandMap[C]["result"];

/** Typed invoke signature for preload / renderer bridge helpers. */
export type DesktopInvoke = <C extends DesktopCommandName>(
  command: C,
  ...args: DesktopCommandMap[C]["args"] extends readonly unknown[]
    ? DesktopCommandMap[C]["args"]
    : never
) => Promise<DesktopCommandMap[C]["result"]>;
