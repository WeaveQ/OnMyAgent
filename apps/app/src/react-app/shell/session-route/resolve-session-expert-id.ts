/**
 * Resolve which expert (if any) owns work-memory slot C for this send.
 * Pure: callers supply already-read ids so unit tests need no localStorage.
 *
 * Paths:
 * - create: pendingAgentSnapshot / currentAgent at create time
 * - continue: currentAgent bound to this session, or persisted session agent id
 * - reopen: Expert Directory identity (with snapshot only as content fallback)
 */
export function resolveSessionExpertId(input: {
  sessionId: string;
  /** Pending agent id available on the create-session turn. */
  pendingAgentId?: string | null;
  /**
   * In-memory pending store agent (may survive across turns when still bound).
   */
  currentAgentId?: string | null;
  currentAgentBoundSessionId?: string | null;
  /** From the Expert Directory identity index for this sessionId. */
  sessionAgentId?: string | null;
}): string | null {
  const sessionId = input.sessionId?.trim() ?? "";
  if (!sessionId || sessionId.startsWith("draft:")) return null;

  const pending = trimId(input.pendingAgentId);
  if (pending) return pending;

  const current = trimId(input.currentAgentId);
  if (current) {
    const bound = input.currentAgentBoundSessionId?.trim() ?? "";
    // Unbound (fresh pick) or bound to this session counts.
    if (!bound || bound === sessionId) return current;
  }

  const stored = trimId(input.sessionAgentId);
  if (stored) return stored;

  return null;
}

function trimId(value: string | null | undefined): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return id ? id : null;
}
