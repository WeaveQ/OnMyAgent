import type { ExpertDirectoryPageModel } from "../../../capabilities/session-identity/expert-directory-page-model";

export function resolveExpertDirectoryView(input: {
  activeChat: boolean;
  directoryState: ExpertDirectoryPageModel["state"];
  selectedSessionId: string | null;
  hasAnyExpertConversation: boolean;
  showWorkspaceSetupEmptyState: boolean;
  showSelectedWorkspaceError: boolean;
  showBlockingStartupSkeleton: boolean;
  showDraftChrome?: boolean;
}) {
  const draftChrome = Boolean(input.showDraftChrome);
  const loading = input.activeChat && input.directoryState === "loading";
  const incomplete =
    input.directoryState === "incomplete" || input.directoryState === "error";
  const commonEmpty =
    !input.selectedSessionId &&
    !draftChrome &&
    !input.showWorkspaceSetupEmptyState &&
    !input.showSelectedWorkspaceError &&
    !input.showBlockingStartupSkeleton;
  return {
    deferColdOpen: loading,
    showLoadingWithoutSelection: loading && commonEmpty,
    showIncompleteWithoutSelection:
      input.activeChat && incomplete && commonEmpty,
    showNoExpertConversation:
      input.activeChat &&
      input.directoryState === "ready" &&
      commonEmpty &&
      !input.hasAnyExpertConversation,
  };
}

export function shouldMountExpertSessionSurface(input: {
  canRenderReactSurface: boolean;
  blockForWorkspaceError: boolean;
  showNoExpertConversationEmptyState: boolean;
  showDirectoryIncomplete: boolean;
  showDirectoryLoading: boolean;
  isDraftSession: boolean;
  showDraftChrome: boolean;
  surfaceSessionId?: string | null;
}): boolean {
  if (!input.canRenderReactSurface) return false;
  if (input.blockForWorkspaceError) return false;
  if (input.showDirectoryLoading) return false;
  if (input.showNoExpertConversationEmptyState) return false;
  const draftIntent = input.isDraftSession || input.showDraftChrome;
  const surfaceId = input.surfaceSessionId?.trim() ?? "";
  const hasConcreteSurface =
    Boolean(surfaceId) && (!surfaceId.startsWith("draft:") || draftIntent);
  if (input.showDirectoryIncomplete && !draftIntent && !hasConcreteSurface) {
    return false;
  }
  return true;
}

export function shouldBlockExpertSurfaceForWorkspaceError(input: {
  selectedSessionId: string | null;
  showSelectedWorkspaceError: boolean;
}): boolean {
  return input.showSelectedWorkspaceError && !input.selectedSessionId;
}
