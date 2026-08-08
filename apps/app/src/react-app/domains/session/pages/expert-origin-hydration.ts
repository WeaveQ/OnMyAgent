export function resolveExpertOriginHydrationView(input: {
  activeChat: boolean;
  originHydrated: boolean;
  selectedSessionId: string | null;
  hasAnyExpertConversation: boolean;
  showWorkspaceSetupEmptyState: boolean;
  showSelectedWorkspaceError: boolean;
  showBlockingStartupSkeleton: boolean;
}) {
  const pending = input.activeChat && !input.originHydrated;
  const showPendingWithoutSelection = pending && !input.selectedSessionId;
  const showNoExpertConversation =
    input.activeChat &&
    input.originHydrated &&
    !input.selectedSessionId &&
    !input.hasAnyExpertConversation &&
    !input.showWorkspaceSetupEmptyState &&
    !input.showSelectedWorkspaceError &&
    !input.showBlockingStartupSkeleton;

  return {
    deferColdOpen: pending,
    showPendingWithoutSelection,
    showNoExpertConversation,
  };
}
