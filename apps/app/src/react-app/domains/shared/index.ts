/**
 * Cross-cutting infra only. Product domains export from their own packages:
 * agents | connections | plugins | workspace | shell-feedback | messaging
 */
export {
  buildOnMyAgentEnvSystemContext,
  clearOnMyAgentEnvSystemContextCache,
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
  createOnMyAgentServerStore,
  useOnMyAgentServerStoreSnapshot,
} from "./onmyagent-server-store";
export type {
  OnMyAgentServerStore,
  OnMyAgentServerStoreSnapshot,
} from "./onmyagent-server-store";
export { OnMyAgentDenHelpLink } from "./onmyagent-den-help-link";
export * from "./desktop-config-context";
export {
  ASSISTANT_ARCHIVED_TASKS_STORAGE_KEY,
  type AssistantArchivedTask,
  archiveAssistantTask,
  archiveTaskInList,
  archivedSessionIdSet,
  assistantArchivedTasksChangedEvent,
  dispatchAssistantArchivedTasksChanged,
  filterGroupsExcludingArchived,
  isArchivedSessionId,
  permanentlyRemoveAssistantArchivedTask,
  permanentlyRemoveFromList,
  readAssistantArchivedTasks,
  resolveOpenFolderPath,
  restoreAssistantArchivedTask,
  restoreTaskFromList,
  writeAssistantArchivedTasks,
} from "./assistant-archived-tasks";
export {
  assertNoForbiddenVerticalsInCatalog,
  buildPersonalizationPlan,
  listPersonalizationVerticalIds,
  type PersonalizationPlan,
  type PersonalizationProfileSnapshot,
} from "./personalization/plan";
export {
  FORBIDDEN_VERTICAL_IDS,
  PERSONALIZATION_VERTICALS,
  isForbiddenVerticalId,
  type PersonalizationVerticalId,
} from "./personalization/verticals";
