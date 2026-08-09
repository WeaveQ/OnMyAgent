/**
 * Session delete policy: resolve directory, classify remote failures, and
 * keep recently-deleted ids out of sidebar re-hydration (dirty / ghost rows).
 */

/** Max time the delete confirm dialog waits on remote DELETE before closing. */
export const SESSION_DELETE_REMOTE_BUDGET_MS = 3_000;

/** How long a deleted id is filtered out of listSessions merges. */
export const SESSION_RECENTLY_DELETED_TTL_MS = 60_000;
export const SESSION_PENDING_DELETE_MAX_ATTEMPTS = 4;
export const SESSION_PENDING_DELETE_MAX_CONCURRENCY = 2;

type PendingSessionDelete = {
  workspaceId: string;
  sessionId: string;
  directory?: string;
  createdAt: number;
  attempt: number;
};

type SessionDeleteClient = {
  deleteSession: (
    workspaceId: string,
    sessionId: string,
    options?: { directory?: string },
  ) => Promise<unknown>;
};

const recentlyDeletedUntilById = new Map<string, number>();
const pendingDeleteStorageKey = "onmyagent.session-pending-deletes.v1";
const pendingDeletesByKey = new Map<string, PendingSessionDelete>();
const pendingDeleteRequests = new Map<string, Promise<void>>();
const pendingDeleteRetriesByWorkspace = new Map<string, Promise<void>>();
const automaticDeleteAttemptsByKey = new Map<string, number>();
const pendingDeleteWaiters: Array<() => void> = [];
let pendingDeleteRequestCount = 0;

function pendingDeleteKey(workspaceId: string, sessionId: string) {
  return `${workspaceId}\u0000${sessionId}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function persistPendingDeletes() {
  const target = storage();
  if (!target) return;
  try {
    target.setItem(
      pendingDeleteStorageKey,
      JSON.stringify([...pendingDeletesByKey.values()]),
    );
  } catch {
  }
}

function hydratePendingDeletes() {
  if (pendingDeletesByKey.size > 0) return;
  const target = storage();
  if (!target) return;
  try {
    const raw = target.getItem(pendingDeleteStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return;
    for (const value of parsed) {
      if (!isPendingSessionDeleteRecord(value)) continue;
      const record = value;
      const workspaceId = record.workspaceId.trim();
      const sessionId = record.sessionId.trim();
      if (!workspaceId || !sessionId) continue;
      pendingDeletesByKey.set(pendingDeleteKey(workspaceId, sessionId), {
        workspaceId,
        sessionId,
        ...(typeof record.directory === "string" && record.directory.trim()
          ? { directory: record.directory.trim() }
          : {}),
        createdAt: record.createdAt,
        attempt: record.attempt,
      });
    }
  } catch {
  }
}

function isPendingSessionDeleteRecord(
  value: unknown,
): value is PendingSessionDelete {
  return (
    value !== null &&
    typeof value === "object" &&
    "workspaceId" in value &&
    typeof value.workspaceId === "string" &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    "createdAt" in value &&
    typeof value.createdAt === "number" &&
    "attempt" in value &&
    typeof value.attempt === "number"
  );
}

function pendingDeleteBackoffMs(attempt: number) {
  return Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = typeof window !== "undefined" ? window.setTimeout : setTimeout;
    timer(resolve, ms);
  });
}

function acquirePendingDeleteSlot() {
  if (pendingDeleteRequestCount < SESSION_PENDING_DELETE_MAX_CONCURRENCY) {
    pendingDeleteRequestCount += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    pendingDeleteWaiters.push(() => {
      pendingDeleteRequestCount += 1;
      resolve();
    });
  });
}

async function withPendingDeleteSlot<T>(request: () => Promise<T>) {
  await acquirePendingDeleteSlot();
  try {
    return await request();
  } finally {
    pendingDeleteRequestCount -= 1;
    pendingDeleteWaiters.shift()?.();
  }
}

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

export function registerPendingSessionDelete(input: {
  workspaceId: string;
  sessionId: string;
  directory?: string;
  nowMs?: number;
}) {
  hydratePendingDeletes();
  const workspaceId = input.workspaceId.trim();
  const sessionId = input.sessionId.trim();
  if (!workspaceId || !sessionId) return;
  const key = pendingDeleteKey(workspaceId, sessionId);
  const previous = pendingDeletesByKey.get(key);
  pendingDeletesByKey.set(key, {
    workspaceId,
    sessionId,
    ...(input.directory?.trim() ? { directory: input.directory.trim() } : {}),
    createdAt: previous?.createdAt ?? input.nowMs ?? Date.now(),
    attempt: previous?.attempt ?? 0,
  });
  persistPendingDeletes();
}

export function isSessionPendingDelete(workspaceId: string, sessionId: string) {
  hydratePendingDeletes();
  return pendingDeletesByKey.has(
    pendingDeleteKey(workspaceId.trim(), sessionId.trim()),
  );
}

export function filterPendingDeletedSessions<T extends { id: string }>(input: {
  workspaceId: string;
  items: readonly T[];
}) {
  return input.items.filter(
    (item) => !isSessionPendingDelete(input.workspaceId, item.id),
  );
}

function clearPendingSessionDelete(workspaceId: string, sessionId: string) {
  hydratePendingDeletes();
  const key = pendingDeleteKey(workspaceId, sessionId);
  pendingDeletesByKey.delete(key);
  automaticDeleteAttemptsByKey.delete(key);
  persistPendingDeletes();
}

function isConfirmedDeletedSession(error: unknown) {
  const { status, code } = readErrorFields(error);
  return (
    status === 404 ||
    status === 410 ||
    code === "session_not_found" ||
    code === "not_found"
  );
}

function recordPendingSessionDeleteFailure(
  workspaceId: string,
  sessionId: string,
) {
  const key = pendingDeleteKey(workspaceId, sessionId);
  const current = pendingDeletesByKey.get(key);
  if (!current) return;
  pendingDeletesByKey.set(key, {
    ...current,
    attempt: current.attempt + 1,
  });
  persistPendingDeletes();
}

export function executePendingSessionDelete(input: {
  workspaceId: string;
  remoteWorkspaceId: string;
  sessionId: string;
  client: SessionDeleteClient;
}) {
  hydratePendingDeletes();
  const workspaceId = input.workspaceId.trim();
  const sessionId = input.sessionId.trim();
  const key = pendingDeleteKey(workspaceId, sessionId);
  const record = pendingDeletesByKey.get(key);
  if (!record) return Promise.resolve();
  const existing = pendingDeleteRequests.get(key);
  if (existing) return existing;

  const request = withPendingDeleteSlot(() =>
    input.client.deleteSession(input.remoteWorkspaceId, sessionId, {
      ...(record.directory ? { directory: record.directory } : {}),
    }),
  )
    .then(() => {
      clearPendingSessionDelete(workspaceId, sessionId);
    })
    .catch((error: unknown) => {
      if (isConfirmedDeletedSession(error)) {
        clearPendingSessionDelete(workspaceId, sessionId);
        return;
      }
      recordPendingSessionDeleteFailure(workspaceId, sessionId);
      throw error;
    })
    .finally(() => {
      pendingDeleteRequests.delete(key);
    });
  pendingDeleteRequests.set(key, request);
  return request;
}

export function retryPendingSessionDeletesForWorkspace(input: {
  workspaceId: string;
  remoteWorkspaceId: string;
  client: SessionDeleteClient;
}) {
  hydratePendingDeletes();
  const workspaceId = input.workspaceId.trim();
  const existing = pendingDeleteRetriesByWorkspace.get(workspaceId);
  if (existing) return existing;
  // One bounded attempt per pending record in this retry pass. Automatic retry
  // is capped for the current app process; a restart gets a fresh small budget
  // while the durable tombstone continues to hide the user's deleted row.
  const pending = [...pendingDeletesByKey.values()].filter(
    (item) =>
      item.workspaceId === workspaceId &&
      (automaticDeleteAttemptsByKey.get(
        pendingDeleteKey(item.workspaceId, item.sessionId),
      ) ?? 0) < SESSION_PENDING_DELETE_MAX_ATTEMPTS,
  );
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const record = pending[next];
      next += 1;
      if (!record) continue;
      const key = pendingDeleteKey(record.workspaceId, record.sessionId);
      automaticDeleteAttemptsByKey.set(
        key,
        (automaticDeleteAttemptsByKey.get(key) ?? 0) + 1,
      );
      await wait(pendingDeleteBackoffMs(record.attempt));
      try {
        await executePendingSessionDelete({
          workspaceId,
          remoteWorkspaceId: input.remoteWorkspaceId,
          sessionId: record.sessionId,
          client: input.client,
        });
      } catch (error) {
        console.warn("[session-delete] pending remote delete failed", record.sessionId, error);
      }
    }
  };
  const retry = Promise.all(
    Array.from({ length: Math.min(2, pending.length) }, worker),
  ).then(() => undefined);
  pendingDeleteRetriesByWorkspace.set(workspaceId, retry);
  void retry.finally(() => {
    pendingDeleteRetriesByWorkspace.delete(workspaceId);
  });
  return retry;
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
  pendingDeletesByKey.clear();
  pendingDeleteRequests.clear();
  pendingDeleteRetriesByWorkspace.clear();
  automaticDeleteAttemptsByKey.clear();
  pendingDeleteWaiters.length = 0;
  pendingDeleteRequestCount = 0;
  const target = storage();
  if (!target) return;
  try {
    target.removeItem(pendingDeleteStorageKey);
  } catch {
  }
}

/** Test helper: simulate a new app process without removing durable tombstones. */
export function resetPendingDeleteRetryBudgetForTests(): void {
  automaticDeleteAttemptsByKey.clear();
}

export function getPendingSessionDeleteForTests(
  workspaceId: string,
  sessionId: string,
) {
  hydratePendingDeletes();
  return pendingDeletesByKey.get(
    pendingDeleteKey(workspaceId.trim(), sessionId.trim()),
  );
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
