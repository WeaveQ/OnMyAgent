/**
 * Public surface for domains/local-agents.
 * External callers (session host pages, session barrel re-exports) should import from here.
 * Internal modules may keep deep relative imports.
 */

// Agent management page + OpenCode provider dialog
export { AgentManagementPage } from "./agent-management/agent-management-page";
export { OpenCodeProviderConfigDialog } from "./agent-management/agent-management-providers";

// Host-page building blocks
export { LocalAgentStatusRail } from "./local-agent-status-rail";
export {
  LocalAgentDraftComposer,
  buildLocalAgentPrompt,
  type LocalAgentComposerSubmit,
  type LocalAgentSlashCommand,
} from "./local-agent-draft-composer";
export { elapsedSeconds, shortTime } from "./local-agent-formatters";
export {
  APPROVAL_MODE_OPTIONS,
  DEFAULT_HEALTH_RESULT,
  DEFAULT_HEARTBEAT_PROMPT,
  LOCAL_AGENT_LIST_DEFAULT_WIDTH,
  LOCAL_AGENT_LIST_MAX_WIDTH,
  LOCAL_AGENT_LIST_MIN_WIDTH,
  PROVIDER_LABELS,
  agentFromAcpMetadata,
  agentIdFromChatKey,
  builtinSlashCommands,
  chooseInitialModel,
  compactMessagesByAgent,
  isPersonalLocalAgentProvider,
  isUnsupportedNativeTranscriptError,
  localAgentChatKey,
  mergeSlashCommands,
  modelSelectorLabel,
  nativeSessionResumeOnlyMessage,
  normalizeAcpSlashCommandList,
  normalizeAcpSlashCommands,
  personalAgentApprovalModeKey,
  personalAgentChatStateKey,
  personalAgentModelPrefKey,
  providerIconUrl,
  recoverActiveRunIds,
  safeReadApprovalMode,
  safeReadCachedAgents,
  safeReadPersistedChatState,
  safeWriteCachedAgents,
  transcriptMessagesForAgent,
  welcomeMessageForAgent,
  type PersistedLocalAgentChatState,
} from "./local-agent-page-model";
export type { AgentHealthResult } from "./local-agent-page-types";
export type { LocalAgentRepairAction } from "./local-agent-repair-panel";
export { latestContextUsage } from "./context-usage-indicator";
export {
  conversationTitle,
  HeartbeatPanel,
  heartbeatClass,
  scheduledRunMessage,
  scheduledTaskSessionContext,
  type HeartbeatDraft,
} from "./personal-local-agent-scheduled-tasks";

// Messages
export { ChatBubble } from "./messages/chat-bubble";
export type { ChatMessage } from "./messages/message-types";
export { collectRunOpenTargets, isRunFinal } from "./messages/message-utils";
export { lastEventTime } from "./messages/timeline-messages";

// ACP hooks
export { useAcpInitialMessage } from "./hooks/use-acp-initial-message";
export { useAcpModelInfo } from "./hooks/use-acp-model-info";
export { useConversationHistoryHydration } from "./hooks/use-conversation-history-hydration";

// Workspace picker helpers used by the personal-local-agent host page
export { WorkspaceFootnote } from "./workspace-picker/workspace-footnote";
export {
  addRecentWorkspace,
  getRecentWorkspaces,
  readWorkspaceOverride,
  writeWorkspaceOverride,
} from "./workspace-picker/recent-workspaces";

export { resolveAgentIconUrlFor, resolveAgentIconUrl } from "./agent-icon-map";
