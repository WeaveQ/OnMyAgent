/**
 * Whether first-send create should yank the route to the new session.
 *
 * While UI shows「准备中」, `session.create` can take seconds. If the user
 * switches expert / rail / tab mid-create, force-navigating on completion
 * races cold-open and blanks the surface (feels like a desktop crash).
 */
export function shouldNavigateToCreatedSession(input: {
  /** Route selection when the send started (draft id, previous ses_*, or empty). */
  sessionIdAtSendStart: string | null | undefined;
  /** Live route selection when create finished. */
  currentSelectedSessionId: string | null | undefined;
  createdSessionId: string;
}): boolean {
  const created = input.createdSessionId.trim();
  if (!created) return false;
  const current = input.currentSelectedSessionId?.trim() ?? "";
  const started = input.sessionIdAtSendStart?.trim() ?? "";
  // Empty route / home draft shell still owns the in-flight create.
  if (!current) return true;
  if (current === created) return true;
  // Still on the same draft or prior session that initiated the send.
  if (current === started) return true;
  // User moved to another real session or a different expert draft.
  return false;
}

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
  writeLastSessionFor: (
    workspaceId: string,
    sessionId: string,
    mode?: "assistant" | "expert",
  ) => void;
  pageMode?: "assistant" | "expert";
  /**
   * When false, still remember the session for the sidebar but do not force
   * route navigation (user already left the creating surface).
   */
  navigate?: boolean;
}) {
  input.setLegacySelectedWorkspaceId(input.selectedWorkspaceId);
  input.writeActiveWorkspaceId(input.selectedWorkspaceId || null);
  input.writeLastSessionFor(
    input.selectedWorkspaceId,
    input.sessionId,
    input.pageMode,
  );
  input.rememberPendingCreatedSession(input.selectedWorkspaceId, input.sessionId);
  if (input.navigate === false) {
    // Session is recoverable from the expert list; do not steal focus.
    return;
  }
  input.suppressRestoreSessionRef.current = true;
  input.navigateToWorkspaceSession(input.selectedWorkspaceId, input.sessionId);
  input.setAssistantDraftWorkspaceRoot("");
  input.focusPromptSoon();
}
