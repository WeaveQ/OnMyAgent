export function resolveExpertOriginHydrationView(input: {
  activeChat: boolean;
  originHydrated: boolean;
  originDegraded: boolean;
  selectedSessionId: string | null;
  hasAnyExpertConversation: boolean;
  showWorkspaceSetupEmptyState: boolean;
  showSelectedWorkspaceError: boolean;
  showBlockingStartupSkeleton: boolean;
  /**
   * Summon / 去聊天 draft chrome — recovery degraded must not block a new
   * expert draft surface after the user explicitly starts one.
   */
  showDraftChrome?: boolean;
}) {
  const draftChrome = Boolean(input.showDraftChrome);
  const pending = input.activeChat && !input.originHydrated;
  const showPendingWithoutSelection =
    pending &&
    !input.selectedSessionId &&
    !draftChrome &&
    !input.showWorkspaceSetupEmptyState &&
    !input.showSelectedWorkspaceError &&
    !input.showBlockingStartupSkeleton;
  // Degraded banner only when not in an explicit draft — empty reset with
  // ghost origins is fixed by prune+hydrate; soft-fail degraded still warns
  // but must not cover an in-progress summon draft.
  const showDegradedWithoutSelection =
    input.activeChat &&
    input.originDegraded &&
    !input.selectedSessionId &&
    !draftChrome &&
    !input.showWorkspaceSetupEmptyState &&
    !input.showSelectedWorkspaceError &&
    !input.showBlockingStartupSkeleton;
  const showNoExpertConversation =
    input.activeChat &&
    input.originHydrated &&
    !input.originDegraded &&
    !input.selectedSessionId &&
    !draftChrome &&
    !input.hasAnyExpertConversation &&
    !input.showWorkspaceSetupEmptyState &&
    !input.showSelectedWorkspaceError &&
    !input.showBlockingStartupSkeleton;

  return {
    deferColdOpen: pending,
    showPendingWithoutSelection,
    showDegradedWithoutSelection,
    showNoExpertConversation,
  };
}

/**
 * Whether the expert chat SessionSurface may mount. Degraded recovery alone
 * must not block an explicit summon/draft shell, or a first-send `creating`
 * surface that has already bound a real session id (showDraftChrome drops then).
 */
export function shouldMountExpertSessionSurface(input: {
  canRenderReactSurface: boolean;
  blockForWorkspaceError: boolean;
  showNoExpertConversationEmptyState: boolean;
  showExpertOriginHydrationDegraded: boolean;
  showExpertOriginHydrationLoading: boolean;
  /** True for idle_draft draftOnly shell. */
  isDraftSession: boolean;
  showDraftChrome: boolean;
  /**
   * Session id SessionSurface would bind. Real `ses_*` (including creating)
   * must mount even when origin recovery is soft-fail degraded.
   */
  surfaceSessionId?: string | null;
}): boolean {
  if (!input.canRenderReactSurface) return false;
  if (input.blockForWorkspaceError) return false;
  if (input.showExpertOriginHydrationLoading) return false;
  if (input.showNoExpertConversationEmptyState) return false;
  const draftIntent = input.isDraftSession || input.showDraftChrome;
  const surfaceId = input.surfaceSessionId?.trim() ?? "";
  const hasConcreteSurface =
    Boolean(surfaceId) && (!surfaceId.startsWith("draft:") || draftIntent);
  if (
    input.showExpertOriginHydrationDegraded &&
    !draftIntent &&
    !hasConcreteSurface
  ) {
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
