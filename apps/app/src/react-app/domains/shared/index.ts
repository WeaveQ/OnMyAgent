/**
 * Cross-cutting infra only. Product domains export from their own packages:
 * agents | connections | plugins | workspace | shell-feedback | messaging
 */
export {
  buildOnMyAgentEnvSystemContext,
  clearOnMyAgentEnvSystemContextCache,
  prewarmOnMyAgentEnvSystemContext,
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
  getExtensionConfigSlot,
  getExtensionConnected,
  hasExtensionConfig,
  registerExtensionConfig,
  registerExtensionRuntime,
} from "./extension-registry";
export type {
  ExtensionConfigContext,
  ExtensionConfigFactory,
  ExtensionRuntimeContext,
  OnMyAgentExtensionRuntime,
} from "./extension-registry";
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
  archiveAssistantTasks,
  archiveTaskInList,
  archiveTasksInList,
  archivedSessionIdSet,
  assistantArchivedTasksChangedEvent,
  dispatchAssistantArchivedTasksChanged,
  filterArchivedTaskRoots,
  filterGroupsExcludingArchived,
  isArchivedSessionId,
  permanentlyRemoveAssistantArchivedTask,
  permanentlyRemoveAssistantArchivedTaskTree,
  permanentlyRemoveFromList,
  permanentlyRemoveTaskTreeFromList,
  readAssistantArchivedTasks,
  resolveOpenFolderPath,
  restoreAssistantArchivedTask,
  restoreAssistantArchivedTaskTree,
  restoreTaskFromList,
  restoreTaskTreeFromList,
  writeAssistantArchivedTasks,
} from "./assistant-archived-tasks";
export {
  collectSessionDescendantIds,
  collectSessionSubtreeIds,
  excludeSessionsWithArchivedAncestor,
  type SessionParentRef,
} from "./session-parent-tree";
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
export {
  PERSONALIZATION_APPLIED_STORAGE_KEY,
  planFingerprint,
  rankTemplatesForPlan,
  readAppliedPlanFingerprint,
  shouldOfferPersonalizationApply,
  writeAppliedPlanFingerprint,
} from "./personalization/rank";
export {
  automationPayloadFromTemplate,
  selectTemplatesToCreate,
} from "./personalization/apply-automations";
export {
  PROFILE_INDUSTRY_ALIASES,
  PROFILE_ROLE_ALIASES,
  canonicalizeProfileOptionValue,
  canonicalizeProfileOptionValues,
} from "./personalization/profile-option-aliases";
export {
  MAX_CONVERSATION_MEMORY_ITEMS,
  MAX_CONVERSATION_MEMORY_TEXT_CHARS,
  MAX_EXTRACT_CANDIDATES_PER_TURN,
  MAX_EXPERT_MEMORY_ITEMS,
  MAX_INJECTED_EXPERT_MEMORY_CHARS,
  MAX_INJECTED_MEMORY_CHARS,
  MAX_PENDING_MEMORY_ITEMS,
  MEMORY_PROFILE_CATEGORIES,
  acceptAllPendingMemory,
  acceptPendingMemory,
  appendMemoryItems,
  appendShortTermMemoryItems,
  applyAutoCaptureMemory,
  buildPersonalProfileInsightPrompt,
  createConversationMemoryId,
  enqueuePendingMemoryCandidates,
  extractMemoryCandidatesFromUserText,
  MAX_SHORT_TERM_MEMORY_ITEMS,
  MAX_INJECTED_SHORT_TERM_CHARS,
  formatProfileMemoryLine,
  importProfileBlockToItems,
  isSensitiveMemoryText,
  mergePendingMemoryCandidates,
  normalizeMemoryFingerprint,
  parseProfileMemoryLine,
  rejectPendingMemory,
  shouldAttemptMemoryExtract,
  todayMemoryDate,
  type MemoryProfileCategory,
} from "./memory/conversation-memory";
export {
  buildPersonalProfileLines,
  buildUserProfileMarkdown,
  buildWorkMemoryContext,
  clearGlobalWorkMemory,
  getWorkMemorySeed,
  resolveAwarenessFileLocale,
  resolveWorkMemoryAwarenessPaths,
  sanitizeExpertId,
  selectExpertMemoryItems,
  selectGlobalMemoryItems,
  truncateMemoryLines,
  WORK_MEMORY_SEED,
  type AwarenessFileLocale,
  type BuildWorkMemoryContextInput,
  type UserProfileLabelMaps,
  type WorkMemoryAwarenessPaths,
  type WorkMemorySeedFileName,
  type WorkMemoryContextResult,
} from "./memory/work-memory";
export {
  applyLongTermMemoryMarkdown,
  buildLongTermMemoryMarkdown,
  buildStyleMarkdown,
  buildUserProfileLabelMaps,
  parseLongTermMemoryMarkdown,
  parseStyleMarkdown,
  parseUserProfileMarkdown,
  prefsPatchFromAwarenessFile,
  scheduleSyncMemoryAwarenessFiles,
  scheduleSyncPersonalAwarenessFiles,
  scheduleSyncStyleAwarenessFiles,
  scheduleSyncUserProfileAwarenessFiles,
  syncMemoryAwarenessFiles,
  syncPersonalAwarenessFiles,
  syncStyleAwarenessFiles,
  syncUserProfileAwarenessFiles,
} from "./memory/work-memory-file-sync";
