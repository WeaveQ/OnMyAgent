export function activateCreatedSessionRoute(input: {
  focusPromptSoon: () => void;
  navigateToWorkspaceSession: (workspaceId: string, sessionId: string | null) => void;
  rememberPendingCreatedSession: (workspaceId: string, sessionId: string) => void;
  selectedWorkspaceId: string;
  sessionId: string;
  setAssistantDraftWorkspaceRoot: (value: string) => void;
  setLegacySelectedWorkspaceId: (workspaceId: string) => void;
  suppressRestoreSessionRef: { current: boolean };
  writeActiveWorkspaceId: (workspaceId: string | null) => void;
  writeLastSessionFor: (workspaceId: string, sessionId: string) => void;
}) {
  input.setLegacySelectedWorkspaceId(input.selectedWorkspaceId);
  input.writeActiveWorkspaceId(input.selectedWorkspaceId || null);
  input.writeLastSessionFor(input.selectedWorkspaceId, input.sessionId);
  input.rememberPendingCreatedSession(input.selectedWorkspaceId, input.sessionId);
  input.suppressRestoreSessionRef.current = true;
  input.navigateToWorkspaceSession(input.selectedWorkspaceId, input.sessionId);
  input.setAssistantDraftWorkspaceRoot("");
  input.focusPromptSoon();
}
