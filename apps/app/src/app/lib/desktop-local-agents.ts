/**
 * Domain wrappers: personal local agents + composer Desktop IPC.
 * Public API is re-exported from `./desktop`.
 */
import { invokeDesktopCommand } from "./desktop-invoke";
import type {
  PersonalLocalAgent,
  PersonalLocalAgentAcpConfigOptionInput,
  PersonalLocalAgentApprovalDecision,
  PersonalLocalAgentApprovalMode,
  PersonalLocalAgentApprovalInput,
  PersonalLocalAgentCustomAgentInput,
  PersonalLocalAgentConversationImportInput,
  PersonalLocalAgentConversationInput,
  PersonalLocalAgentConversationTranscriptInput,
  PersonalLocalAgentHostStatusInput,
  PersonalLocalAgentHeartbeatCreateInput,
  PersonalLocalAgentHeartbeatDeleteInput,
  PersonalLocalAgentHeartbeatRunNowInput,
  PersonalLocalAgentHeartbeatRunsInput,
  PersonalLocalAgentHeartbeatsListInput,
  PersonalLocalAgentHeartbeatUpdateInput,
  PersonalLocalAgentResetConversationInput,
  PersonalLocalAgentRunInput,
} from "./desktop-types";

export const personalLocalAgentsList = (input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}) => invokeDesktopCommand("personalLocalAgentsList", input ?? {});

export const personalLocalAgentMetadataList = (input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}) => invokeDesktopCommand("personalLocalAgentMetadataList", input ?? {});

export const personalLocalAgentAcpAgentsList = (input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}) => invokeDesktopCommand("personalLocalAgentAcpAgentsList", input ?? {});

export const personalLocalAgentAcpAgentsRefresh = (input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
  includeModels?: boolean;
}) => invokeDesktopCommand("personalLocalAgentAcpAgentsRefresh", input ?? {});

export const personalLocalAgentAcpHealth = (input?: {
  agents?: Array<Partial<PersonalLocalAgent>>;
  workspaceRoot?: string;
}) => invokeDesktopCommand("personalLocalAgentAcpHealth", input ?? {});

export type { LocalAgentComposerFileEntry } from "./desktop-types";

export const localAgentComposerListFiles = (input: {
  workspaceRoot: string;
  query?: string;
  limit?: number;
}) => invokeDesktopCommand("localAgentComposerListFiles", input);

export const localAgentComposerSaveAttachment = (input: {
  workspaceRoot: string;
  name: string;
  dataUrl: string;
}) => invokeDesktopCommand("localAgentComposerSaveAttachment", input);

export const personalLocalAgentAcpSend = (input: PersonalLocalAgentRunInput) =>
  invokeDesktopCommand("personalLocalAgentAcpSend", input);

export const personalLocalAgentAcpCancel = (runId: string) =>
  invokeDesktopCommand("personalLocalAgentAcpCancel", runId);

export const personalLocalAgentAcpResolveApproval = (
  input: PersonalLocalAgentApprovalInput,
) => invokeDesktopCommand("personalLocalAgentAcpResolveApproval", input);

export const personalLocalAgentAcpConfigOptions = (input?: {
  agent?: Partial<PersonalLocalAgent>;
  workspaceRoot?: string;
}) => invokeDesktopCommand("personalLocalAgentAcpConfigOptions", input ?? {});

export const personalLocalAgentSetAcpConfigOption = (
  input: PersonalLocalAgentAcpConfigOptionInput,
) => invokeDesktopCommand("personalLocalAgentSetAcpConfigOption", input);

export const personalLocalAgentCreateCustomAgent = (
  input: PersonalLocalAgentCustomAgentInput,
) => invokeDesktopCommand("personalLocalAgentCreateCustomAgent", input);

export const personalLocalAgentUpdateCustomAgent = (
  input: PersonalLocalAgentCustomAgentInput,
) => invokeDesktopCommand("personalLocalAgentUpdateCustomAgent", input);

export const personalLocalAgentDeleteCustomAgent = (input: {
  workspaceRoot: string;
  id: string;
}) => invokeDesktopCommand("personalLocalAgentDeleteCustomAgent", input);

export const personalLocalAgentDetectAvailableAgents = (input: {
  workspaceRoot: string;
  existingIds?: string[];
}) => invokeDesktopCommand("personalLocalAgentDetectAvailableAgents", input);

export const personalLocalAgentListExtensions = () =>
  invokeDesktopCommand("personalLocalAgentExtensionsList", {});

export const personalLocalAgentSetExtensionEnabled = (input: {
  name: string;
  enabled: boolean;
}) => invokeDesktopCommand("personalLocalAgentExtensionSetEnabled", input);

export const personalLocalAgentGetAgentOverrides = (input: {
  workspaceRoot: string;
  id: string;
}) => invokeDesktopCommand("personalLocalAgentGetAgentOverrides", input);

export const personalLocalAgentSetAgentOverrides = (input: {
  workspaceRoot: string;
  id: string;
  overrides: Record<string, unknown>;
}) => invokeDesktopCommand("personalLocalAgentSetAgentOverrides", input);

export const personalLocalAgentAcpProcessesList = (input?: {
  workspaceRoot?: string;
  provider?: string;
  conversationId?: string;
}) => invokeDesktopCommand("personalLocalAgentAcpProcessesList", input ?? {});

export type {
  PersonalLocalAgentTestConnectionResult,
  PersonalLocalAgentProviderHealthResult,
  PersonalLocalAgentTestCustomAgentResult,
} from "./desktop-types";

export const personalLocalAgentTestConnection = (input: {
  agent: Partial<PersonalLocalAgent>;
  workspaceRoot?: string;
  timeoutMs?: number;
}) => invokeDesktopCommand("personalLocalAgentTestConnection", input);

export const personalLocalAgentTestCustomAgent = (input: {
  command: string;
  acpArgs?: string[];
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}) => invokeDesktopCommand("personalLocalAgentTestCustomAgent", input);

export const personalLocalAgentCheckProviderHealth = (input: {
  agent: Partial<PersonalLocalAgent>;
  workspaceRoot?: string;
  timeoutMs?: number;
}) => invokeDesktopCommand("personalLocalAgentCheckProviderHealth", input);

export const personalLocalAgentCheckManagedAgentHealthById = (input: {
  id?: string;
  agentId?: string;
  provider?: string;
  workspaceRoot?: string;
  timeoutMs?: number;
}) => invokeDesktopCommand("personalLocalAgentCheckManagedAgentHealthById", input);

export const personalLocalAgentValidate = (agent: Partial<PersonalLocalAgent>) =>
  invokeDesktopCommand("personalLocalAgentValidate", agent);

export const personalLocalAgentStart = (input: PersonalLocalAgentRunInput) =>
  invokeDesktopCommand("personalLocalAgentStart", input);

export const personalLocalAgentStatus = (
  input: string | { runId: string; workspaceRoot?: string },
) => invokeDesktopCommand("personalLocalAgentStatus", input);

export const personalLocalAgentRun = (input: PersonalLocalAgentRunInput) =>
  invokeDesktopCommand("personalLocalAgentRun", input);

export const personalLocalAgentCancel = (runId: string) =>
  invokeDesktopCommand("personalLocalAgentCancel", runId);

export const personalLocalAgentResolveApproval = (
  input: PersonalLocalAgentApprovalInput,
) => invokeDesktopCommand("personalLocalAgentResolveApproval", input);

export const personalLocalAgentResetConversation = (
  input: PersonalLocalAgentResetConversationInput,
) => invokeDesktopCommand("personalLocalAgentResetConversation", input);

export const personalLocalAgentConversationsList = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentConversationsList", input);

export const personalLocalAgentConversationCreate = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentConversationCreate", input);

export const personalLocalAgentConversationGet = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentConversationGet", input);

export const personalLocalAgentConversationGetById = (input: {
  workspaceRoot: string;
  conversationId: string;
}) => invokeDesktopCommand("personalLocalAgentConversationGetById", input);

export const personalLocalAgentChannelConversationsList = (input: {
  workspaceRoot: string;
}) => invokeDesktopCommand("personalLocalAgentChannelConversationsList", input);

export const personalLocalAgentConversationsListByProvider = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentConversationsListByProvider", input);

export const personalLocalAgentConversationImportFromArchive = (
  input: PersonalLocalAgentConversationImportInput,
) => invokeDesktopCommand("personalLocalAgentConversationImportFromArchive", input);

export const personalLocalAgentConversationStatus = (
  input: PersonalLocalAgentConversationInput & { conversationId?: string | null },
) => invokeDesktopCommand("personalLocalAgentConversationStatus", input);

export const personalLocalAgentConversationWarmup = (
  input: PersonalLocalAgentConversationInput & {
    conversationId?: string | null;
    approvalMode?: PersonalLocalAgentApprovalMode;
    model?: string | null;
  },
) => invokeDesktopCommand("personalLocalAgentConversationWarmup", input);

export const personalLocalAgentProviderSessionsList = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentProviderSessionsList", input);

export const personalLocalAgentProviderSessionLoad = (
  input: PersonalLocalAgentConversationInput & { sessionId: string; title?: string },
) => invokeDesktopCommand("personalLocalAgentProviderSessionLoad", input);

export const personalLocalAgentProviderSessionClose = (
  input: PersonalLocalAgentConversationInput & {
    conversationId?: string | null;
    sessionId: string;
  },
) => invokeDesktopCommand("personalLocalAgentProviderSessionClose", input);

export const personalLocalAgentProviderSessionFork = (
  input: PersonalLocalAgentConversationInput & {
    sessionId: string;
    title?: string;
    messageId?: string;
  },
) => invokeDesktopCommand("personalLocalAgentProviderSessionFork", input);

export const personalLocalAgentConversationConfirmationsList = (
  input: PersonalLocalAgentConversationInput,
) => invokeDesktopCommand("personalLocalAgentConversationConfirmationsList", input);

export const personalLocalAgentHostStatus = (
  input: PersonalLocalAgentHostStatusInput,
) => invokeDesktopCommand("personalLocalAgentHostStatus", input);

export const personalLocalAgentConversationConfirmationConfirm = (
  input: PersonalLocalAgentConversationInput & {
    runId?: string | null;
    approvalId?: string | null;
    id?: string | null;
    decision: PersonalLocalAgentApprovalDecision;
    alwaysAllow?: boolean;
  },
) => invokeDesktopCommand("personalLocalAgentConversationConfirmationConfirm", input);

export const personalLocalAgentNativeSessionsList = (input: {
  workspaceRoot: string;
  limit?: number;
  agent?: Partial<PersonalLocalAgent>;
}) => invokeDesktopCommand("personalLocalAgentNativeSessionsList", input);

export const personalLocalAgentConversationTranscript = (
  input: PersonalLocalAgentConversationTranscriptInput,
) => invokeDesktopCommand("personalLocalAgentConversationTranscript", input);

export const personalLocalAgentHeartbeatsList = (
  input: PersonalLocalAgentHeartbeatsListInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatsList", input);

export const personalLocalAgentHeartbeatCreate = (
  input: PersonalLocalAgentHeartbeatCreateInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatCreate", input);

export const personalLocalAgentHeartbeatUpdate = (
  input: PersonalLocalAgentHeartbeatUpdateInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatUpdate", input);

export const personalLocalAgentHeartbeatDelete = (
  input: PersonalLocalAgentHeartbeatDeleteInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatDelete", input);

export const personalLocalAgentHeartbeatRunNow = (
  input: PersonalLocalAgentHeartbeatRunNowInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatRunNow", input);

export const personalLocalAgentHeartbeatRuns = (
  input: PersonalLocalAgentHeartbeatRunsInput,
) => invokeDesktopCommand("personalLocalAgentHeartbeatRuns", input);

