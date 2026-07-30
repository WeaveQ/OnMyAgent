/**
 * Session delete policy: resolve directory, classify remote failures, and
 * keep recently-deleted ids out of sidebar re-hydration (dirty / ghost rows).
 */

/** Max time the delete confirm dialog waits on remote DELETE before closing. */
export const SESSION_DELETE_REMOTE_BUDGET_MS = 3_000;

/** How long a deleted id is filtered out of listSessions merges. */
export const SESSION_RECENTLY_DELETED_TTL_MS = 60_000;

const recentlyDeletedUntilById = new Map<string, number>();

export function resolveSessionDeleteDirectory(input: {
  assistantDirectory?: string | null;
  sessionDirectory?: string | null;
  workspaceRoot?: string | null;
}): string | undefined {
  for (const candidate of [
    input.assistantDirectory,
    input.sessionDirectory,
    input.workspaceRoot,
  ]) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (trimmed) return trimmed;
  }
  return undefined;
}

/** Mark id so a racing listSessions cannot resurrect a dirty row. */
export function markSessionRecentlyDeleted(
  sessionId: string,
  nowMs: number = Date.now(),
  ttlMs: number = SESSION_RECENTLY_DELETED_TTL_MS,
): void {
  const id = sessionId.trim();
  if (!id) return;
  recentlyDeletedUntilById.set(id, nowMs + ttlMs);
}

export function isSessionRecentlyDeleted(
  sessionId: string,
  nowMs: number = Date.now(),
): boolean {
  const id = sessionId.trim();
  if (!id) return false;
  const until = recentlyDeletedUntilById.get(id);
  if (until == null) return false;
  if (nowMs >= until) {
    recentlyDeletedUntilById.delete(id);
    return false;
  }
  return true;
}

export function filterRecentlyDeletedSessions<T extends { id: string }>(
  items: readonly T[],
  nowMs: number = Date.now(),
): T[] {
  return items.filter((item) => !isSessionRecentlyDeleted(item.id, nowMs));
}

/** Test/helper: clear in-memory tombstones. */
export function clearRecentlyDeletedSessionsForTests(): void {
  recentlyDeletedUntilById.clear();
}

/**
 * Race a remote delete against a UI budget. Never throws; returns when either
 * the request settles or the budget elapses (request may continue in flight).
 */
export function raceSessionDeleteRemote<T>(
  remote: Promise<T>,
  budgetMs: number = SESSION_DELETE_REMOTE_BUDGET_MS,
): Promise<void> {
  return Promise.race([
    remote.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      const timer =
        typeof window !== "undefined" ? window.setTimeout : setTimeout;
      timer(resolve, budgetMs);
    }),
  ]);
}

function readErrorFields(error: unknown): {
  status: number | null;
  code: string;
  message: string;
  name: string;
} {
  if (!error || typeof error !== "object") {
    return {
      status: null,
      code: "",
      message: error instanceof Error ? error.message : String(error ?? ""),
      name: error instanceof Error ? error.name : "",
    };
  }
  const record = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const status =
    typeof record.status === "number" && Number.isFinite(record.status)
      ? record.status
      : null;
  return {
    status,
    code: String(record.code ?? "").toLowerCase(),
    message: String(record.message ?? "").toLowerCase(),
    name: String(record.name ?? "").toLowerCase(),
  };
}

/**
 * Remote delete failures that should not block local cleanup.
 * Ghost sidebar rows, wrong directory, OpenCode empty/502, timeouts, and
 * transient network errors are all "dirty data" the user is trying to clear.
 */
export function isTolerableSessionDeleteFailure(error: unknown): boolean {
  const { status, code, message, name } = readErrorFields(error);

  if (
    status === 400 ||
    status === 404 ||
    status === 408 ||
    status === 410 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return true;
  }

  if (
    code === "session_not_found" ||
    code === "not_found" ||
    code === "opencode_request_failed" ||
    code === "opencode_empty_response" ||
    code === "timeout" ||
    code === "aborted" ||
    code === "network_error" ||
    code === "fetch_failed"
  ) {
    return true;
  }

  if (
    name === "aborterror" ||
    name === "timeouterror" ||
    name === "typeerror"
  ) {
    return true;
  }

  if (
    /not found|session_not_found|404|410|502|503|504|timeout|timed out|abort|network|failed to fetch|econnrefused|econnreset|empty response|opencode/i.test(
      message,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Whether delete UI should treat remote outcome as done and always finish
 * local cleanup. Product choice for dirty rows: yes for any failure class
 * we tolerate; rethrow only for unexpected non-tolerable errors is optional
 * at the call site (callers may still always clean local state).
 */
export function shouldContinueLocalSessionCleanupAfterRemoteDelete(
  error: unknown | null,
): boolean {
  if (error == null) return true;
  return isTolerableSessionDeleteFailure(error);
}
