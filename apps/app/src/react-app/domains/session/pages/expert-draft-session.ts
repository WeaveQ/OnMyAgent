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
  operationId?: string;
}>(input: {
  contexts: Record<string, T>;
  agentId: string;
  operationId?: string;
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
  operationId?: string;
}>(input: {
  contexts: Record<string, T>;
  agentId: string;
  operationId?: string;
}): boolean {
  const agentId = input.agentId.trim();
  const current = agentId ? input.contexts[agentId] : undefined;
  return Boolean(
    current &&
      Boolean(input.operationId?.trim()) &&
      current.operationId === input.operationId,
  );
}

export function resolveBoundExpertDraftNavigation<T extends {
  operationId?: string;
}>(input: {
  contexts: Record<string, T>;
  draftAgentId: string | null;
  draftSessionActive: boolean;
  pendingAgent: {
    id: string;
    boundSessionId?: string;
    operationId?: string;
  } | null;
  selectedSessionId: string | null;
}): string | null {
  const sessionId = resolveBoundExpertDraftSession(input);
  if (!sessionId || !input.pendingAgent) return null;
  if (!matchesExpertDraftTransaction({
    contexts: input.contexts,
    agentId: input.pendingAgent.id,
    operationId: input.pendingAgent.operationId,
  })) return null;
  return input.selectedSessionId === sessionId ? null : sessionId;
}

/**
 * Consume the active draft only when the user explicitly opens a real session
 * of that same expert. Draft contexts for other experts must remain available.
 */
export function consumeActiveExpertDraftForSession<T>(input: {
  contexts: Record<string, T>;
  pendingAgent: { id: string } | null;
  draftAgentId: string | null;
  draftSessionActive: boolean;
  targetAgentId: string | null;
}): {
  contexts: Record<string, T>;
  pendingAgent: { id: string } | null;
  consumed: boolean;
} {
  const draftAgentId = input.draftAgentId?.trim() ?? "";
  const targetAgentId = input.targetAgentId?.trim() ?? "";
  const consumed =
    input.draftSessionActive &&
    Boolean(draftAgentId) &&
    draftAgentId === targetAgentId;
  if (!consumed) {
    return {
      contexts: input.contexts,
      pendingAgent: input.pendingAgent,
      consumed: false,
    };
  }

  const contexts = { ...input.contexts };
  delete contexts[draftAgentId];
  return {
    contexts,
    pendingAgent:
      input.pendingAgent?.id === draftAgentId ? null : input.pendingAgent,
    consumed: true,
  };
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
  // Route synchronization is not user intent: cold-open / restore can briefly
  // point at another expert. Explicit session clicks clear the surface draft
  // in useOpenExpertSession, so an unbound transaction must survive here.
  return true;
}
