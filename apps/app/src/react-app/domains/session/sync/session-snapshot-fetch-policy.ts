/**
 * Client-side snapshot fetch policy: do not retry 404/session_not_found so
 * ghost sidebar rows cannot storm the server.
 */

export function isSessionSnapshotNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const status = Number(record.status);
  if (status === 404) return true;
  const code = String(record.code ?? "").toLowerCase();
  if (code === "session_not_found" || code === "not_found") return true;
  const message = String(record.message ?? "").toLowerCase();
  if (message.includes("session not found") || message.includes("404")) {
    return true;
  }
  return false;
}

/** React Query / fetch: never retry missing sessions. */
export function shouldRetrySessionSnapshotQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (isSessionSnapshotNotFoundError(error)) return false;
  return failureCount < 1;
}

/**
 * After a not-found snapshot, keep the id in a short cooldown set so
 * remounts do not re-request immediately.
 */
export const SESSION_SNAPSHOT_NOT_FOUND_COOLDOWN_MS = 60_000;

export function shouldSkipSnapshotForNotFoundCooldown(input: {
  sessionId: string;
  notFoundUntilBySessionId: Map<string, number>;
  nowMs: number;
}): boolean {
  const id = input.sessionId.trim();
  if (!id) return true;
  const until = input.notFoundUntilBySessionId.get(id);
  if (until == null) return false;
  // Pure read — never mutate the map here. This runs during render / query
  // option evaluation; deleting on expiry re-entered observers mid-paint and
  // helped drive "Cannot update SessionRoute while rendering AgentConversationPanel".
  return input.nowMs < until;
}

/** Drop expired cooldown entries (call from effects / queryFn, not render). */
export function pruneSnapshotNotFoundCooldown(input: {
  notFoundUntilBySessionId: Map<string, number>;
  nowMs: number;
}): void {
  for (const [id, until] of input.notFoundUntilBySessionId) {
    if (input.nowMs >= until) {
      input.notFoundUntilBySessionId.delete(id);
    }
  }
}

export function markSessionSnapshotNotFound(input: {
  sessionId: string;
  notFoundUntilBySessionId: Map<string, number>;
  nowMs: number;
  cooldownMs?: number;
}): void {
  const id = input.sessionId.trim();
  if (!id) return;
  const cooldown = input.cooldownMs ?? SESSION_SNAPSHOT_NOT_FOUND_COOLDOWN_MS;
  input.notFoundUntilBySessionId.set(id, input.nowMs + cooldown);
}
