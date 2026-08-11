import type { ExpertDirectoryProjection } from "@onmyagent/types/server";

export const EXPERT_DIRECTORY_CACHE_VERSION = 1 as const;
export const EXPERT_DIRECTORY_CACHE_KEY_PREFIX = "onmyagent:expert-directory:";

export type ExpertDirectoryCacheEnvelope = {
  version: typeof EXPERT_DIRECTORY_CACHE_VERSION;
  workspaceId: string;
  revision: number;
  payload: ExpertDirectoryProjection;
};

export type ExpertDirectoryCacheStorage = Pick<Storage, "getItem" | "setItem">;

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
