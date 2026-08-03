export type { OpenTarget, OpenTargetKind, OpenTargetPreview } from "./artifacts/open-target";

export {
  bagSessionSurfaceProps,
  flattenSessionSurfaceProps,
} from "./surface/session-surface-types";
export type {
  SessionSurfaceProps,
  SessionSurfaceFlatProps,
  SessionSurfaceModelBag,
  SessionSurfaceCollaborationBag,
  SessionSurfacePermissionBag,
  SessionSurfaceMarketplaceBag,
  SessionSurfaceDraftWorkspaceBag,
} from "./surface/session-surface-types";
export {
  classifyOpenTarget,
  deriveOpenTargets,
  isCollectibleArtifactTarget,
  isLocalhostBrowserTarget,
  isUserFacingLocalPreviewTarget,
  selectAutoOpenTarget,
  shouldAutoOpenTarget,
} from "./artifacts/open-target";
export { useSessionControlActions } from "./control/session-control-actions";
export { ModelPickerModal } from "./modals/model-picker-modal";
export { readHiddenModels } from "./sync/hidden-models-store";
export type { ModelPickerModalProps } from "./modals/model-picker-modal";
export {
  SessionPage,
  type PageMode,
  type SessionAgentManagementIntent,
  type SessionPageSurfaceProps,
} from "./pages";
/** Mode-switch helper used by shell page-view to clear secondary rail bookmarks. */
export { resetRailBookmarkToPrimary } from "./pages/use-rail-location";
export {
  MAX_SESSIONS_PREVIEW,
  buildSessionTreeState,
  flattenSessionRows,
  getRootSessions,
  isStreamingSessionStatus,
  workspaceKindLabel,
  workspaceLabel,
  workspaceSwatchColor,
} from "./sidebar/utils";
export type {
  FlattenedSessionRow,
  SessionListItem,
  SessionTreeState,
} from "./sidebar/utils";
export {
  getSessionActivityStatusLabel,
  useSessionActivityStore,
} from "./status/session-activity-store";
export type { SessionActivityStatus } from "./status/session-activity-store";
export {
  resolveAgentIdForSession,
  resolveUnreadAgentIdForSession,
  useExpertUnreadStore,
} from "./status/expert-unread-store";
export type { ExpertUnreadRecord } from "./status/expert-unread-store";
export {
  assistantSessionWorkspacesChangedEvent,
  dispatchAssistantSessionWorkspacesChanged,
  readAssistantSessionWorkspace,
  readAssistantSessionWorkspaceChangeOwner,
  readAssistantSessionWorkspaces,
  removeAssistantSessionWorkspace,
  removeAssistantSessionWorkspacesByDirectory,
  writeAssistantSessionWorkspace,
} from "./sync/assistant-session-workspaces";
export type { AssistantSessionWorkspace } from "./sync/assistant-session-workspaces";
export {
  buildIsolatedExpertSessionDirectory,
  createExpertSessionKey,
  isSameDirectory,
  joinWorkspacePath,
  materializeExpertSessionDirectory,
  resolveExpertSessionDirectoryMarker,
  resolveSelectedSessionFileRoot,
  sanitizePathSegment,
  shouldIsolateExpertSessionDirectory,
} from "./sync/expert-session-directory";
export {
  clearSessionDraft,
  getSessionDraft,
  saveSessionDraft,
  sessionDraftScopeKey,
  useSessionDraftSnapshot,
  useSessionDraftState,
} from "./sync/draft-store";
export type { SessionDraftSnapshot } from "./sync/draft-store";
/** Composer Zustand store — shell seeds drafts via domain barrel only. */
export {
  useComposerStateStore,
  getComposerDraft,
  getComposerAttachments,
  getComposerMentions,
  getComposerPasteParts,
} from "./surface/composer-state-store";
export type {
  ComposerPastePart,
  ComposerSessionState,
  ComposerStateStore,
} from "./surface/composer-state-store";
/** Post-create composer seed used by quick-capture / new-task flows. */
export { setComposerDraftAfterNewTask } from "./pages/shared-page-utils";
/** Sidebar cold-start list limits — shell loads via domain barrel only. */
export {
  SIDEBAR_ASSISTANT_DIRECTORY_LIST_LIMIT,
  SIDEBAR_AUTOMATION_LIST_DEFER_MS,
  SIDEBAR_PREVIEW_SNAPSHOT_DEFER_MS,
  SIDEBAR_PREVIEW_SNAPSHOT_MAX,
  SIDEBAR_PREVIEW_SNAPSHOT_MESSAGE_LIMIT,
  SIDEBAR_SESSION_LIST_LIMIT,
  isDraftSessionId,
  orderBackgroundSessionWorkspacesSelectedOnly,
  selectSidebarPreviewSessionIds,
} from "./sync/sidebar-load-policy";
/** Quiet-session poll policy — shell imports via this barrel only. */
export {
  CONVERSATION_HISTORY_SNAPSHOT_LIMIT,
  RELOAD_EVENTS_POLL_INTERVAL_MS,
  SESSION_SNAPSHOT_STALE_TIME_MS,
  shouldRunReloadEventsPoll,
} from "./sync/session-poll-policy";
/** Focused snapshot query key/options — surface + route prefetch share this. */
export {
  SESSION_SNAPSHOT_MESSAGE_LIMIT,
  buildSessionSnapshotPrefetchSpec,
  sessionSnapshotFetchOptions,
  sessionSnapshotQueryKey,
} from "./sync/session-snapshot-query-policy";
export type {
  SessionSnapshotFetchOptions,
  SessionSnapshotQueryKey,
} from "./sync/session-snapshot-query-policy";
/** Delete policy: directory resolution + dirty/ghost remote failure tolerance. */
export {
  SESSION_DELETE_REMOTE_BUDGET_MS,
  SESSION_RECENTLY_DELETED_TTL_MS,
  clearRecentlyDeletedSessionsForTests,
  filterRecentlyDeletedSessions,
  isSessionRecentlyDeleted,
  isTolerableSessionDeleteFailure,
  markSessionRecentlyDeleted,
  raceSessionDeleteRemote,
  resolveSessionDeleteDirectory,
  shouldContinueLocalSessionCleanupAfterRemoteDelete,
} from "./sync/session-delete-policy";
export { ReactSessionRuntime } from "./sync/runtime-sync";
export {
  clearOptimisticSessionUserMessage,
  permissionKey,
  questionKey,
  seedPermissionState,
  seedOptimisticSessionUserMessage,
  seedQuestionState,
  seedSessionState,
  statusKey,
  todoKey,
  trackWorkspaceSessionSync,
  transcriptKey,
} from "./sync/session-sync";

export {
  removeAutomationSessionRecord,
  renameAutomationSessionRecord,
} from "../messaging";
export { OpenCodeProviderConfigDialog } from "../local-agents";
export { PersonalUsagePage } from "./usage/personal-usage-page";
export type { PersonalUsageClient } from "./usage/personal-usage-model";
