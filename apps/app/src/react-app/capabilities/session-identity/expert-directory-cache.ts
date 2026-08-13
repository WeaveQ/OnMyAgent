import type { ExpertDirectoryProjection } from "@onmyagent/types/server";

export const EXPERT_DIRECTORY_CACHE_VERSION = 1 as const;
export const EXPERT_DIRECTORY_CACHE_KEY_PREFIX = "onmyagent:expert-directory:";

export type ExpertDirectoryCacheEnvelope = {
  version: typeof EXPERT_DIRECTORY_CACHE_VERSION;
  workspaceId: string;
  revision: number;
  payload: ExpertDirectoryProjection;
};

export type ExpertDirectoryCacheStorage = Pick<Storage, "getItem" | "setItem"> &
  Partial<Pick<Storage, "removeItem">>;

function cacheKey(workspaceId: string): string {
  return `${EXPERT_DIRECTORY_CACHE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`;
}

function defaultStorage(): ExpertDirectoryCacheStorage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readExpertDirectoryCache(
  workspaceId: string,
  storage: ExpertDirectoryCacheStorage | null = defaultStorage(),
): ExpertDirectoryCacheEnvelope | null {
  const id = workspaceId.trim();
  if (!id || !storage) return null;
  try {
    const raw = storage.getItem(cacheKey(id));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCacheEnvelope(parsed) && parsed.workspaceId === id ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist only complete projections. A single localStorage setItem is the
 * replacement boundary; malformed or stale input never mutates the cache.
 */
export function writeExpertDirectoryCache(
  workspaceId: string,
  payload: ExpertDirectoryProjection,
  storage: ExpertDirectoryCacheStorage | null = defaultStorage(),
): boolean {
  const id = workspaceId.trim();
  if (!id || !storage || !isCompleteProjection(payload)) return false;
  const current = readExpertDirectoryCache(id, storage);
  if (current) {
    if (payload.revision < current.revision) return false;
    if (payload.revision === current.revision &&
      payload.inventoryFingerprint !== current.payload.inventoryFingerprint) {
      return false;
    }
  }
  const envelope: ExpertDirectoryCacheEnvelope = {
    version: EXPERT_DIRECTORY_CACHE_VERSION,
    workspaceId: id,
    revision: payload.revision,
    payload,
  };
  try {
    storage.setItem(cacheKey(id), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function stripExpertDirectorySessionsFromProjection(
  payload: ExpertDirectoryProjection,
  sessionIds: readonly string[],
): ExpertDirectoryProjection {
  const evict = new Set(sessionIds.map((id) => id.trim()).filter(Boolean));
  if (evict.size === 0) return payload;
  const records = payload.records
    .map((record) => {
      const nextSessionIds = (record.sessionIds ?? []).filter((id) => !evict.has(id));
      const sessions = (record.sessions ?? []).filter((session) => !evict.has(session.sessionId));
      return { ...record, sessionIds: nextSessionIds, sessions };
    })
    .filter((record) => record.sessionIds.length > 0);
  return {
    ...payload,
    records,
    tombstonedSessionIds: [...new Set([...(payload.tombstonedSessionIds ?? []), ...evict])],
  };
}

function deleteExpertDirectoryCacheEntry(
  workspaceId: string,
  storage: ExpertDirectoryCacheStorage,
): void {
  const key = cacheKey(workspaceId);
  if (typeof storage.removeItem === "function") {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, "");
}

/**
 * Drop deleted session ids from the persisted lastComplete snapshot.
 * Empty leftovers are deleted; a still-listed or unwritable entry is dropped.
 */
export function evictExpertDirectorySessions(
  workspaceId: string,
  sessionIds: readonly string[],
  storage: ExpertDirectoryCacheStorage | null = defaultStorage(),
): boolean {
  const id = workspaceId.trim();
  const evict = new Set(sessionIds.map((sid) => sid.trim()).filter(Boolean));
  if (!id || !storage || evict.size === 0) return false;
  const current = readExpertDirectoryCache(id, storage);
  if (!current) return false;
  const listed = current.payload.records.some((record) =>
    (record.sessionIds ?? []).some((sid) => evict.has(sid)),
  );
  const nextPayload = stripExpertDirectorySessionsFromProjection(current.payload, [...evict]);
  const stillListed = nextPayload.records.some((record) =>
    (record.sessionIds ?? []).some((sid) => evict.has(sid)),
  );
  if (!listed && !stillListed) return false;
  deleteExpertDirectoryCacheEntry(id, storage);
  if (stillListed || nextPayload.records.length === 0 || !isCompleteProjection(nextPayload)) {
    return true;
  }
  return writeExpertDirectoryCache(id, nextPayload, storage);
}

export function isCompleteProjection(
  value: unknown,
): value is ExpertDirectoryProjection {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ExpertDirectoryProjection>;
  return payload.version === 1 &&
    payload.schema === "onmyagent.expert-directory.v1" &&
    payload.complete === true &&
    typeof payload.revision === "number" && Number.isSafeInteger(payload.revision) && payload.revision >= 0 &&
    typeof payload.inventoryFingerprint === "string" &&
    Array.isArray(payload.records) &&
    Array.isArray(payload.tombstonedSessionIds);
}

function isCacheEnvelope(value: unknown): value is ExpertDirectoryCacheEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<ExpertDirectoryCacheEnvelope>;
  return envelope.version === EXPERT_DIRECTORY_CACHE_VERSION &&
    typeof envelope.workspaceId === "string" && envelope.workspaceId.trim().length > 0 &&
    typeof envelope.revision === "number" && Number.isSafeInteger(envelope.revision) && envelope.revision >= 0 &&
    isCompleteProjection(envelope.payload) &&
    envelope.payload.revision === envelope.revision;
}
