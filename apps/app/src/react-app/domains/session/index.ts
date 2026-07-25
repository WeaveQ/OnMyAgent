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
export { ReactSessionRuntime } from "./sync/runtime-sync";
export {
  permissionKey,
  questionKey,
  seedPermissionState,
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
