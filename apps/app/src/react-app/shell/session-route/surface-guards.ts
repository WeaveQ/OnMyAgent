/** Pure guards for session surface mounting. */

export function shouldBlockSurfaceForForeignSession(input: {
  sessionsByWorkspaceId: Record<string, Array<{ id: string }>>;
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  sessionBelongsToAnotherWorkspace: (args: {
    sessionsByWorkspaceId: Record<string, Array<{ id: string }>>;
    selectedSessionId: string | null;
    selectedWorkspaceId: string;
  }) => boolean;
}): boolean {
  if (!input.selectedWorkspaceId || !input.selectedSessionId) return false;
  return input.sessionBelongsToAnotherWorkspace({
    sessionsByWorkspaceId: input.sessionsByWorkspaceId,
    selectedSessionId: input.selectedSessionId,
    selectedWorkspaceId: input.selectedWorkspaceId,
  });
}
