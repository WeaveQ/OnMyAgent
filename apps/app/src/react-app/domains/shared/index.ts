/**
 * Cross-cutting infra still owned by `shared/` (not product domains).
 * Product code (agents, plugins, connections, workspace toasts) lives in those domains.
 */
export {
  buildOpenworkEnvSystemContext,
  clearOpenworkEnvSystemContextCache,
} from "./env-context";
export {
  ONMYAGENT_EXTENSION_STATE_CHANGED,
  getExtensionId,
  isOnMyAgentExtensionEnabled,
  isOnMyAgentExtensionHidden,
  setOnMyAgentExtensionEnabled,
  setOnMyAgentExtensionHidden,
} from "./extension-state";
export {
  createOpenworkServerStore,
  useOpenworkServerStoreSnapshot,
} from "./onmyagent-server-store";
export type {
  OpenworkServerStore,
  OpenworkServerStoreSnapshot,
} from "./onmyagent-server-store";
export { OnMyAgentDenHelpLink } from "./onmyagent-den-help-link";
export * from "./desktop-config-context";

// Re-export product domains for gradual migration of legacy barrel imports
export {
  buildPendingAgentFromRecord,
  readCustomAgentIdForSession,
  readSessionAgentSnapshot,
  useAgentRegistryStore,
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
  usePendingAgentStore,
  AgentPromptSuggestions,
  createDefaultAgentRegistry,
} from "../agents";
export type { PendingAgentContext, AgentCardItem, AgentRegistry } from "../agents";
export * from "../agents/agent-session-state";
export {
  StatusToastsProvider,
  StatusToastsViewport,
  statusToastDurationForTone,
  useStatusToasts,
} from "../shell-feedback";
export type {
  AppStatusToast,
  AppStatusToastInput,
  AppStatusToastTone,
  StatusToastsStore,
} from "../shell-feedback";
export {
  ensureProviderListQuery,
  fetchProviderList,
  getConnectedProviderItems,
  useProviderListQuery,
  refreshProviderListQueries,
  providerListQueryKey,
  PROVIDER_LIST_CACHE_MS,
  isModelAvailableInConnectedProviders,
} from "../connections/provider-list-query";
export type { ConnectedProviderSnapshot, ConnectedProviderSnapshotChange } from "../connections/provider-list-query";
export { default as ProviderAuthModal } from "../connections/provider-auth-modal";
export type { ProviderAuthModalProps } from "../connections/provider-auth-modal";
export { ShareWorkspaceModal } from "../workspace/share-workspace-modal";
export { PluginsPage, SkillsPage, ConnectorsPage } from "../plugins";
export { classifySkillScope, classifyLocalOrigin, SKILL_SCOPE_LABELS, LOCAL_ORIGIN_LABELS } from "../plugins";
export type { SkillScope, LocalSkillOrigin } from "../plugins";
export { resolveBundledSkillDisplay } from "../plugins";
export { AddMcpModal } from "../connections/add-mcp-modal";
