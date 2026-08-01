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

/**
 * Session id + draftOnly for the expert chat surface.
 *
 * After the first send, the tab strip highlights the bound real session via
 * pendingTabSessionId, but the route/selectedSessionId (and draft clear) can
 * lag one or more frames. Without this, content stays on draft-home empty
 * cards while the tab already shows the new session ("总结中…").
 */
export function resolveExpertSurfaceSession(input: {
  draftSessionActive: boolean;
  draftAgentId: string | null;
  pendingAgent: { id: string; boundSessionId?: string } | null;
  activeDraftSessionId: string | null;
  selectedSessionId: string | null | undefined;
  workspaceId: string;
}): { sessionId: string; draftOnly: boolean } {
  const draftSessionId = `draft:${input.workspaceId}`;
  const boundSessionId = resolveBoundExpertDraftSession(input);
  if (boundSessionId) {
    return { sessionId: boundSessionId, draftOnly: false };
  }
  if (input.draftSessionActive) {
    return {
      sessionId: input.activeDraftSessionId?.trim() || draftSessionId,
      draftOnly: true,
    };
  }
  const selected = input.selectedSessionId?.trim() ?? "";
  if (selected) {
    return { sessionId: selected, draftOnly: false };
  }
  return { sessionId: draftSessionId, draftOnly: true };
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
 * Whether an unbound expert draft should survive a route session id.
 *
 * Covers:
 * - "+ 新会话" (`new-session`)
 * - marketplace summon (`agent-selection`)
 *
 * Without this, summoning expert B while expert A's session is still selected
 * (or while create-task briefly clears pending) kills the draft and the UI
 * stays stuck on A — and the left list may mark B selected while content is A.
 *
 * Opening a real session intentionally clears draft via handleOpenExpertSession;
 * do NOT drop agent-selection drafts merely because the previous expert is still
 * on the route for a tick before openFreshExpertDraft navigates away.
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

  const source = input.pendingDraftSource ?? null;
  // create-task clears pending before re-activate — treat null as in-progress.
  if (
    source !== null
    && source !== "new-session"
    && source !== "agent-selection"
  ) {
    return false;
  }

  const pendingAgentId = input.pendingAgentId?.trim() ?? "";
  if (pendingAgentId && pendingAgentId !== draftAgentId) return false;

  const bound = input.pendingBoundSessionId?.trim() ?? "";
  if (bound && !bound.startsWith("draft:")) return false;

  // selectedSessionAgentId may still be the previous expert during summon —
  // keep the draft. Sidebar open of another expert clears draft explicitly.
  return true;
}
