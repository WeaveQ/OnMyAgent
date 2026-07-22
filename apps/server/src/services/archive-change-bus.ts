/**
 * Lightweight per-dbPath change bus so archive SSE can push on mutations
 * (sync complete, explicit notify) without reopening SQLite each tick.
 */

export type ArchiveDbChangeListener = () => void;

const listenersByDb = new Map<string, Set<ArchiveDbChangeListener>>();

export function subscribeArchiveDbChanges(
  dbPath: string,
  listener: ArchiveDbChangeListener,
): () => void {
  const key = dbPath.trim();
  let set = listenersByDb.get(key);
  if (!set) {
    set = new Set();
    listenersByDb.set(key, set);
  }
  set.add(listener);
  return () => {
    const current = listenersByDb.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listenersByDb.delete(key);
  };
}

export function notifyArchiveDbChanged(dbPath: string): void {
  const key = dbPath.trim();
  const set = listenersByDb.get(key);
  if (!set || set.size === 0) return;
  for (const listener of [...set]) {
    try {
      listener();
    } catch {
      // listeners must not break publishers
    }
  }
}

/** Test helper: drop all listeners. */
export function clearArchiveDbChangeBus(): void {
  listenersByDb.clear();
}

export function archiveDbChangeListenerCount(dbPath: string): number {
  return listenersByDb.get(dbPath.trim())?.size ?? 0;
}
