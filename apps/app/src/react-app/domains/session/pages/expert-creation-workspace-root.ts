export function resolveExpertCreationWorkspaceRoot(input: {
  selectedWorkspaceRoot: string;
  workspaceFilesRoot?: string | null;
}): string {
  return input.workspaceFilesRoot?.trim() || input.selectedWorkspaceRoot.trim();
}
