export {
  AgentsPage,
  CreateAgentWizard,
  type AgentsPageProps,
  type AgentCardItem,
} from "./agents-page";
export {
  ExpertCreationPage,
  type ExpertCreationPageProps,
  type ExpertCreationTab,
  type ExpertKnowledgeEntry,
} from "./expert-creation-page";
export type {
  ExpertCreationComposerProps,
  ExpertCreationSuggestionApplyOptions,
} from "./expert-creation-conversation";
export {
  beginExpertCreateSaveAttempt,
  buildExpertCreationPreview,
  consumeExpertCreateComposerFlush,
  saveExpertCreation,
  updateExpertCreation,
  useExpertCreationController,
  type ExpertCreationControllerInput,
  type SaveExpertCreationInput,
  type SaveExpertCreationResult,
  type UpdateExpertCreationInput,
} from "./expert-creation-actions";
export {
  buildExpertCreationCoachPendingContext,
  buildExpertCreationCoachSystemPrompt,
  buildExpertCreationCoachToolAccess,
  resolveExpertCreationCoachAgent,
} from "./expert-creation-coach-agent";
export {
  buildExpertCreationPreviewPendingContext,
  buildExpertCreationPreviewToolAccess,
} from "./expert-creation-preview-agent";
export {
  buildExpertPreviewSystemPrompt,
  createExpertPreviewAcceptanceGate,
  runExpertPreviewTurn,
} from "./expert-creation-preview-runtime";
export {
  buildExpertCreationCoachWorkflowInstructions,
  validateExpertCreationRolePrompt,
} from "./expert-creation-coach-contract";
export {
  ExpertCreationCoachWelcome,
  type ExpertCreationCoachWelcomeProps,
} from "./expert-creation-coach-welcome";
export { isExpertCreationPreviewReady } from "./expert-creation-lifecycle";
export { buildExpertChatPromptParts } from "./expert-creation-chat-attachments";
export {
  expertDraftSuggestionFingerprint,
  isExpertDraftSuggestionConfirmation,
  parseExpertDraftSuggestion,
  partitionExpertDraftSuggestion,
  stripExpertDraftSuggestionFromText,
  type ExpertDraftSuggestion,
  type ExpertDraftSuggestionApplyMode,
  type ExpertDraftSuggestionField,
} from "./expert-creation-suggestions";
export { renderAvatar } from "./agents-avatar-rendering";

/** Deferred loader so session host can code-split the heavy agents registry UI. */
export const loadAgentsPage = () => import("./agents-page");
export { useEnsureAgentRegistry } from "./use-agent-registry";
export {
  buildPendingAgentFromRecord,
  readCustomAgentIdForSession,
  readCustomAgentSessionEntries,
  readSessionAgentSnapshot,
  useAgentRegistryStore,
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
} from "./agent-registry-store";
export { buildPendingAgentFromMarketplaceExpert } from "./marketplace-pending-agent";
export * from "./agent-session-state";
export {
  writeSessionOriginBestEffort,
  writeSessionOriginDurable,
} from "./session-origin-write";

export * from "./pending-agent-store";
export { AgentPromptSuggestions } from "./agent-prompt-suggestions";
export * from "./agent-registry-types";
export * from "./agent-registry-helpers";
export { createDefaultAgentRegistry } from "./agent-default-registry";
export {
  EXPERT_CREATION_COACH_AGENT_ID,
  EXPERT_CREATION_COACH_AVATAR_PATH,
  isBuiltinAgentId,
  isBuiltinAgentRecord,
  buildBuiltinAgentRecords,
  mergeBuiltinAgents,
} from "./agent-builtin";
export {
  registerExpertCreationEphemeralSession,
  isExpertCreationEphemeralSession,
  listExpertCreationEphemeralSessions,
  unregisterExpertCreationEphemeralSession,
  clearExpertCreationEphemeralSessions,
  deleteExpertCreationEphemeralSession,
  type ExpertCreationSessionDeleteClient,
} from "./expert-creation-ephemeral-sessions";
export {
  AGENT_REGISTRY_PATH,
  createAgentRecordFromDraft,
  createWizardDraftFromAgent,
  serializeAgentRegistry,
  serializeUserAgentRegistry,
} from "./agent-registry";
export {
  isCreationExpertEditable,
  updateExpertRecordFromDraft,
} from "./expert-creation-save-model";
export {
  canHardDeleteExpert,
  clearExpertLocalSessionBindings,
  deleteExpertPackageForAgent,
  deleteExpertPackagesForAgent,
  packageNameCandidatesForAgent,
  packageNameForAgent,
  removeExpertFromRegistry,
} from "./expert-hard-delete";
export {
  EXPERT_PACKAGE_QUERY_KEY,
  expertPackageMarketplacesForEnter,
  fetchExpertPackageEntries,
  invalidateExpertPackageQuery,
  refreshExpertPackageQuery,
  useExpertPackageQuery,
} from "./expert-package-query";
export {
  EXPERT_SESSION_LIFECYCLE_RULES,
  isDraftSessionId,
  remainingExpertSessionIdsAfterDelete,
  shouldApplyExpertSelection,
  shouldClearLocalBindingOnDelete,
  shouldFlushComposerOnExpertCreate,
} from "./expert-session-lifecycle";
