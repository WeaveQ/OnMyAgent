import type { SessionArchiveStore } from "./session-archive-types.js";
import { openSessionArchiveStore } from "./session-archive.js";

export type SessionArchiveStoreOpener = (input: {
  dbPath: string;
  readOnly?: boolean;
}) => Promise<SessionArchiveStore>;

export type SessionArchiveStorePool = {
  acquire: (input: {
    dbPath: string;
    readOnly?: boolean;
  }) => Promise<SessionArchiveStore>;
  release: (input: { dbPath: string; readOnly?: boolean }) => void;
  disposeAll: () => void;
  stats: () => {
    openCount: number;
    liveEntries: number;
    totalRefs: number;
  };
};

type PoolEntry = {
  store: SessionArchiveStore;
  refs: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

function poolKey(dbPath: string, readOnly: boolean) {
  return `${readOnly ? "ro" : "rw"}:${dbPath}`;
}

/**
 * Long-lived archive store pool: same dbPath reuses one SQLite handle while
 * refs > 0 (and briefly after release until idle TTL). Prevents SSE poll ticks
 * from open/close thrashing.
 *
 * Concurrent acquire of the same key shares a single in-flight open Promise so
 * two SSE connections cannot double-open and overwrite the map entry.
 */
export function createSessionArchiveStorePool(options?: {
  idleTtlMs?: number;
  open?: SessionArchiveStoreOpener;
}): SessionArchiveStorePool {
  const idleTtlMs = Math.max(0, options?.idleTtlMs ?? 60_000);
  const open = options?.open ?? openSessionArchiveStore;
  const entries = new Map<string, PoolEntry>();
  /** In-flight open promises keyed by poolKey — join concurrent acquirers. */
  const opening = new Map<string, Promise<PoolEntry>>();
  let openCount = 0;

  const clearIdle = (entry: PoolEntry) => {
    if (entry.idleTimer != null) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  };

  const dropEntry = (key: string, entry: PoolEntry) => {
    clearIdle(entry);
    try {
      entry.store.close();
    } catch {
      // already closed
    }
    entries.delete(key);
  };

  return {
    async acquire(input) {
      const readOnly = input.readOnly === true;
      const key = poolKey(input.dbPath, readOnly);
      const existing = entries.get(key);
      if (existing) {
        clearIdle(existing);
        existing.refs += 1;
        return existing.store;
      }

      let inflight = opening.get(key);
      if (!inflight) {
        openCount += 1;
        inflight = (async () => {
          const store = await open({
            dbPath: input.dbPath,
            readOnly,
          });
          // If an entry appeared while we awaited (should not with single-flight),
          // prefer the map entry and close the extra handle.
          const raced = entries.get(key);
          if (raced) {
            try {
              store.close();
            } catch {
              // ignore
            }
            return raced;
          }
          const entry: PoolEntry = { store, refs: 0, idleTimer: null };
          entries.set(key, entry);
          return entry;
        })().finally(() => {
          opening.delete(key);
        });
        opening.set(key, inflight);
      }

      const entry = await inflight;
      clearIdle(entry);
      entry.refs += 1;
      return entry.store;
    },

    release(input) {
      const readOnly = input.readOnly === true;
      const key = poolKey(input.dbPath, readOnly);
      const entry = entries.get(key);
      if (!entry) return;
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs > 0) return;
      clearIdle(entry);
      if (idleTtlMs === 0) {
        dropEntry(key, entry);
        return;
      }
      entry.idleTimer = setTimeout(() => {
        const current = entries.get(key);
        if (!current || current.refs > 0) return;
        dropEntry(key, current);
      }, idleTtlMs);
      entry.idleTimer.unref?.();
    },

    disposeAll() {
      for (const [key, entry] of [...entries.entries()]) {
        dropEntry(key, entry);
      }
      opening.clear();
    },

    stats() {
      let totalRefs = 0;
      for (const entry of entries.values()) totalRefs += entry.refs;
      return {
        openCount,
        liveEntries: entries.size,
        totalRefs,
      };
    },
  };
}

/** Process-wide default pool for HTTP/SSE hot paths. */
export const defaultSessionArchiveStorePool = createSessionArchiveStorePool();

export async function withSessionArchiveStore<T>(
  input: { dbPath: string; readOnly?: boolean; pool?: SessionArchiveStorePool },
  fn: (store: SessionArchiveStore) => Promise<T> | T,
): Promise<T> {
  const pool = input.pool ?? defaultSessionArchiveStorePool;
  const store = await pool.acquire({
    dbPath: input.dbPath,
    readOnly: input.readOnly,
  });
  try {
    return await fn(store);
  } finally {
    pool.release({ dbPath: input.dbPath, readOnly: input.readOnly });
  }
}
