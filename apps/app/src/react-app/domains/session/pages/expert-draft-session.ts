export function resolveBoundExpertDraftSession(input: {
  draftSessionActive: boolean;
  draftAgentId: string | null;
  pendingAgent: { id: string; boundSessionId?: string } | null;
}): string | null {
  if (!input.draftSessionActive || !input.pendingAgent) return null;
  if (input.pendingAgent.id !== input.draftAgentId) return null;
  const sessionId = input.pendingAgent.boundSessionId?.trim() ?? "";
  return sessionId && !sessionId.startsWith("draft:") ? sessionId : null;
}

export function resolveReadyBoundExpertDraftSession(input: {
  draftSessionActive: boolean;
  draftAgentId: string | null;
  pendingAgent: { id: string; boundSessionId?: string } | null;
  selectedSessionId: string | null;
}): string | null {
  const boundSessionId = resolveBoundExpertDraftSession(input);
  return boundSessionId && boundSessionId === input.selectedSessionId
    ? boundSessionId
    : null;
}

/**
 * Whether an unbound "+ 新会话" draft should survive a route session id.
 *
 * Without this, clearing the route (or a recency-based restore of another
 * expert's last tab) immediately kills the draft and the user lands on the
 * wrong expert's recent session.
 */
export function shouldKeepUnboundNewSessionDraft(input: {
  draftSessionActive: boolean;
  draftAgentId: string | null;
  pendingDraftSource?: string | null;
  pendingAgentId?: string | null;
  pendingBoundSessionId?: string | null;
  /** Agent id bound to the currently selected real session, if any. */
  selectedSessionAgentId?: string | null;
}): boolean {
  if (!input.draftSessionActive) return false;
  const draftAgentId = input.draftAgentId?.trim() ?? "";
  if (!draftAgentId) return false;
  if (input.pendingDraftSource !== "new-session") return false;
  const pendingAgentId = input.pendingAgentId?.trim() ?? "";
  if (pendingAgentId && pendingAgentId !== draftAgentId) return false;
  const bound = input.pendingBoundSessionId?.trim() ?? "";
  if (bound && !bound.startsWith("draft:")) return false;
  const selectedAgent = input.selectedSessionAgentId?.trim() ?? "";
  // User explicitly opened another expert's real session → drop the draft.
  if (selectedAgent && selectedAgent !== draftAgentId) return false;
  return true;
}
