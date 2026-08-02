export { CreateWorkspaceModal } from "./create-workspace-modal";
export type { RemoteWorkspaceInput } from "./create-workspace-modal";
export { CreateRemoteWorkspaceModal } from "./create-remote-workspace-modal";
export { RenameWorkspaceModal } from "./rename-workspace-modal";
export type { RenameWorkspaceModalProps } from "./rename-workspace-modal";
export { useShareWorkspaceState } from "./share-workspace-state";
export type { ShareWorkspaceState } from "./share-workspace-state";
export { useRemoteWorkspaceConnectionEditor } from "./use-remote-workspace-connection-editor";
export {
  getRemoteWorkspaceConnectionKey,
  testRemoteWorkspaceConnection,
  diagnoseRemoteWorkspaceTaskLoadFailure,
  redactRemoteDiagnosticText,
  resolveRemoteWorkspaceConnectionTarget,
} from "./remote-workspace-diagnostics";
export type {
  RemoteWorkspaceConnectionResult,
  RemoteWorkspaceConnectionTarget,
} from "./remote-workspace-diagnostics";
export { useRemoteAccessRestart } from "./remote-access-restart";
export type { RemoteAccessRestartPhase } from "./remote-access-restart";
export { ShareWorkspaceModal } from "./share-workspace-modal";
export {
  WorkspaceFilesPage,
  resolveToolWorkspaceFileRoot,
} from "./workspace-files-page";
export * from "./workspace-modal-types";
export * from "./workspace-option-card";
export * from "./share-workspace-access-panel";

/** Product layout roots + session-owned cleanup (consumed by session / shell). */
export {
  WORKSPACE_UPLOADS_DIR,
  WORKSPACE_TASKS_DIR,
  WORKSPACE_EXPERTS_DIR,
  WORKSPACE_PROJECTS_DIR,
} from "./workspace-files-layout";
export { WORKSPACE_INBOX_DIR } from "./workspace-files-uploads-catalog";
export {
  uploadUserFileToWorkspace,
  type WorkspaceUserFileUploadClient,
  type WorkspaceUserFileUploadResult,
} from "./workspace-files-upload-user-file";
export {
  deleteSessionOwnedWorkspaceFiles,
  resolveSessionOwnedFilePaths,
  type SessionOwnedDeleteClient,
} from "./workspace-files-session-cleanup";
export {
  buildSessionTitleByKey,
  buildSessionIdByPathKeyFromAutomationRecords,
  isHistoricalAutomationTaskFolder,
  resolveOpenSourceSessionAction,
  type OpenSourceSessionAction,
  type SourceSessionStatus,
} from "./workspace-files-open-session";
export {
  isLikelySessionId,
  isAutomationTaskFolderName,
} from "./workspace-files-layout";
