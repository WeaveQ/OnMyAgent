import { unlink } from "node:fs/promises";
import {
  createSessionArchiveCache,
  defaultSessionArchiveSummaryExtractor,
  type SessionArchiveCache,
  type SessionArchiveSummary,
} from "./session-archive-cache.js";
import { openSessionArchiveCacheStore, type SessionArchiveCacheStore } from "./session-archive-cache-store.js";
import {
  scanSessionArchiveRoots,
  type SessionArchiveScanOptions,
} from "./session-archive-scanner.js";
import { startSessionArchiveWatcher, type SessionArchiveWatcherHandle } from "./session-archive-watcher.js";
import { loadSessionArchiveMessagesFromFile, type SessionArchiveMessageRow } from "./session-archive-messages.js";
import type { SessionArchiveAgent } from "@onmyagent/types/session-archive";

// SessionArchiveIndex — cc-switch parity facade.
// Consolidates: scanner + in-memory cache + persistent cache-store + watcher + message loader.
// - No sync UI concept. `refresh()` is idempotent and internal.
// - Watcher-driven re-index feeds `onChange` subscribers (SSE, later).
// - Delete = remove source file + drop cache row.

export type SessionArchiveIndexOptions = SessionArchiveScanOptions & {
  cacheDbPath: string;
  autoWatch?: boolean;
  debounceMs?: number;
};

export type SessionArchiveIndexListInput = {
  limit?: number;
  cursor?: string | null;
  agent?: string;
  search?: string;
};

export type SessionArchiveIndexPage = {
  items: SessionArchiveSummary[];
  nextCursor: string | null;
  total: number;
  agentCounts: Array<{ agent: string; count: number }>;
};

export type SessionArchiveIndexChangeListener = (input: { items: SessionArchiveSummary[] }) => void;

export type SessionArchiveIndex = {
  refresh: () => Promise<SessionArchiveSummary[]>;
  list: (input?: SessionArchiveIndexListInput) => SessionArchiveIndexPage;
  detail: (sessionId: string) => SessionArchiveSummary | null;
  messages: (input: { sessionId: string; limit?: number }) => Promise<SessionArchiveMessageRow[]>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  subscribe: (listener: SessionArchiveIndexChangeListener) => () => void;
  close: () => void;
};

const DEFAULT_PAGE_LIMIT = 200;

export async function openSessionArchiveIndex(options: SessionArchiveIndexOptions): Promise<SessionArchiveIndex> {
  const store = await openSessionArchiveCacheStore({ dbPath: options.cacheDbPath });
  const cache: SessionArchiveCache = createSessionArchiveCache({ extract: defaultSessionArchiveSummaryExtractor });
  // Warm the in-memory cache from disk.
  cache.seed(store.loadAll());

  const listeners = new Set<SessionArchiveIndexChangeListener>();
  let watcher: SessionArchiveWatcherHandle | null = null;
  let refreshing = false;
  let queuedRefresh = false;

  const doRefresh = async (): Promise<SessionArchiveSummary[]> => {
    if (refreshing) {
      queuedRefresh = true;
      return cache.entries();
    }
    refreshing = true;
    try {
      const metas = await scanSessionArchiveRoots(options);
      const merged = cache.reconcile(metas);
      store.replaceAll(merged);
      for (const listener of listeners) {
        try {
          listener({ items: merged });
        } catch {
          // Listeners must not break the refresh loop.
        }
      }
      return merged;
    } finally {
      refreshing = false;
      if (queuedRefresh) {
        queuedRefresh = false;
        void doRefresh();
      }
    }
  };

  if (options.autoWatch !== false) {
    watcher = startSessionArchiveWatcher({
      homeDir: options.homeDir,
      env: options.env,
      config: options.config,
      debounceMs: options.debounceMs,
      onBatch: () => {
        void doRefresh();
      },
    });
  }

  return {
    refresh: doRefresh,
    list(input) {
      return listFromCache(cache, input ?? {});
    },
    detail(sessionId) {
      return cache.entries().find((entry) => entry.sessionId === sessionId) ?? null;
    },
    async messages(input) {
      const entry = cache.entries().find((row) => row.sessionId === input.sessionId);
      if (entry === undefined) return [];
      return loadSessionArchiveMessagesFromFile({
        agent: entry.agent as SessionArchiveAgent,
        filePath: entry.filePath,
        limit: input.limit,
      });
    },
    async deleteSession(sessionId) {
      const entry = cache.entries().find((row) => row.sessionId === sessionId);
      if (entry === undefined) return false;
      try {
        await unlink(entry.filePath);
      } catch {
        // File may already be gone; still drop the cache row for consistency.
      }
      cache.invalidate(entry.filePath);
      store.deleteMany([entry.filePath]);
      for (const listener of listeners) {
        try {
          listener({ items: cache.entries() });
        } catch {
          // Ignore listener failures.
        }
      }
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      if (watcher !== null) watcher.close();
      listeners.clear();
      store.close();
    },
  };
}


function listFromCache(cache: SessionArchiveCache, input: SessionArchiveIndexListInput): SessionArchiveIndexPage {
  const all = cache.entries();
  const filtered = all.filter((row) => {
    if (input.agent && row.agent !== input.agent) return false;
    if (input.search) {
      const needle = input.search.toLowerCase();
      const haystack = `${row.title ?? ""} ${row.projectDir ?? ""} ${row.sessionId}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
  const limit = input.limit && input.limit > 0 ? input.limit : DEFAULT_PAGE_LIMIT;
  const startIndex = input.cursor ? Math.max(0, Number.parseInt(input.cursor, 10) || 0) : 0;
  const slice = filtered.slice(startIndex, startIndex + limit);
  const nextIndex = startIndex + slice.length;
  const nextCursor = nextIndex < filtered.length ? String(nextIndex) : null;
  const agentCounts = countByAgent(filtered);
  return { items: slice, nextCursor, total: filtered.length, agentCounts };
}

function countByAgent(rows: readonly SessionArchiveSummary[]): Array<{ agent: string; count: number }> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.agent, (map.get(row.agent) ?? 0) + 1);
  return [...map.entries()].map(([agent, count]) => ({ agent, count })).sort((a, b) => b.count - a.count);
}
