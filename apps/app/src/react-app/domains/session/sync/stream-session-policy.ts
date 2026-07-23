/**
 * Focused-session stream ownership: only the focused session should receive
 * full message-part deltas; background sessions demote to status-only
 * (activity store still updates from the shared SSE, without transcript writes).
 */

export function normalizeSessionId(sessionId: string | null | undefined): string {
  return sessionId?.trim() ?? "";
}

/**
 * Resolve which session ids should be fully tracked for transcript streaming.
 * Prefer the focused id; fall back to the first non-empty candidate.
 */
export function selectFullStreamSessionIds(input: {
  focusedSessionId: string | null | undefined;
  candidateSessionIds: ReadonlyArray<string | null | undefined>;
}): string[] {
  const focused = normalizeSessionId(input.focusedSessionId);
  if (focused) return [focused];
  const seen = new Set<string>();
  for (const raw of input.candidateSessionIds) {
    const id = normalizeSessionId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    return [id];
  }
  return [];
}

/**
 * Session ids present in candidates but not selected for full stream.
 * Callers may still listen for activity/status via activity store without
 * tracking them for message deltas.
 */
export function selectStatusOnlySessionIds(input: {
  focusedSessionId: string | null | undefined;
  candidateSessionIds: ReadonlyArray<string | null | undefined>;
}): string[] {
  const full = new Set(
    selectFullStreamSessionIds({
      focusedSessionId: input.focusedSessionId,
      candidateSessionIds: input.candidateSessionIds,
    }),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.candidateSessionIds) {
    const id = normalizeSessionId(raw);
    if (!id || full.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
