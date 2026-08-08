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
 * Consume a draft only when the bound callback belongs to the same creation
 * transaction. The agent id alone is insufficient because an older create can
 * finish after the user has started a newer draft for that expert.
 */
export function consumeBoundExpertDraftContext<T extends {
  conversationStartId?: number;
}>(input: {
  contexts: Record<string, T>;
  agentId: string;
  conversationStartId?: number;
}): Record<string, T> {
  if (!matchesExpertDraftTransaction(input)) {
    return input.contexts;
  }
  const agentId = input.agentId.trim();
  const next = { ...input.contexts };
  delete next[agentId];
  return next;
}

export function matchesExpertDraftTransaction<T extends {
  conversationStartId?: number;
}>(input: {
  contexts: Record<string, T>;
  agentId: string;
  conversationStartId?: number;
}): boolean {
  const agentId = input.agentId.trim();
  const current = agentId ? input.contexts[agentId] : undefined;
  return Boolean(
    current &&
      input.conversationStartId !== undefined &&
      current.conversationStartId === input.conversationStartId,
  );
}

export function resolveBoundExpertDraftNavigation<T extends {
  conversationStartId?: number;
}>(input: {
  contexts: Record<string, T>;
  draftAgentId: string | null;
  draftSessionActive: boolean;
  pendingAgent: {
    id: string;
    boundSessionId?: string;
    conversationStartId?: number;
  } | null;
  selectedSessionId: string | null;
}): string | null {
  const sessionId = resolveBoundExpertDraftSession(input);
  if (!sessionId || !input.pendingAgent) return null;
  if (!matchesExpertDraftTransaction({
    contexts: input.contexts,
    agentId: input.pendingAgent.id,
    conversationStartId: input.pendingAgent.conversationStartId,
  })) return null;
  return input.selectedSessionId === sessionId ? null : sessionId;
}

/**
 * Whether an unbound "+ 新会话" draft should survive a route session id.
 *
 * Without this, clearing the route (or a recency-based restore of another
 * expert's last tab) immediately kills the draft and the user lands on the
 * wrong expert's recent session.
 */
export function shouldKeepUnboundExpertDraft(input: {
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
  if (
    input.pendingDraftSource !== "new-session" &&
    input.pendingDraftSource !== "agent-selection"
  ) {
    return false;
  }
  const pendingAgentId = input.pendingAgentId?.trim() ?? "";
  if (pendingAgentId && pendingAgentId !== draftAgentId) return false;
  const bound = input.pendingBoundSessionId?.trim() ?? "";
  if (bound && !bound.startsWith("draft:")) return false;
  const selectedAgent = input.selectedSessionAgentId?.trim() ?? "";
  if (input.pendingDraftSource === "agent-selection") return true;
  // User explicitly opened another expert's real session → drop the draft.
  if (selectedAgent && selectedAgent !== draftAgentId) return false;
  return true;
}
