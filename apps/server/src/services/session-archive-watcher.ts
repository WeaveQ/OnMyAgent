import { watch, type FSWatcher } from "node:fs";
import { existsSync } from "node:fs";
import {
  resolveSessionArchiveSourceRoots,
  resolveSessionArchiveWatchRoots,
  type SessionArchiveResolvedSourceRoot,
} from "./session-archive-registry.js";

// node:fs.watch based watcher (Phase 2).
// - Enumerates configured source roots for every file-based agent.
// - Debounces bursts (200ms) and forwards batched change sets to the caller.
// - Silent about individual paths that fail to watch; keeps the process alive.

export type SessionArchiveWatcherHandle = {
  close: () => void;
};

export type SessionArchiveWatcherOptions = {
  homeDir?: string;
  env?: Record<string, string | undefined>;
  config?: Record<string, unknown> | string;
  debounceMs?: number;
  onBatch: (input: { sourceRoots: SessionArchiveResolvedSourceRoot[] }) => void | Promise<void>;
};

const DEFAULT_DEBOUNCE_MS = 200;

export function startSessionArchiveWatcher(options: SessionArchiveWatcherOptions): SessionArchiveWatcherHandle {
  const sourceRoots = resolveSessionArchiveSourceRoots({
    homeDir: options.homeDir,
    env: options.env,
    config: options.config,
  });
  const watchers: FSWatcher[] = [];
  const debounceMs = Math.max(50, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const scheduleFlush = () => {
    if (closed) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (closed) return;
      Promise.resolve(options.onBatch({ sourceRoots })).catch(() => {
        // Callers observe errors via their own logging; keep the watcher alive.
      });
    }, debounceMs);
  };

  for (const source of sourceRoots) {
    const watchRoots = resolveSessionArchiveWatchRoots({ agent: source.agent, root: source.root });
    for (const watchRoot of watchRoots) {
      if (!existsSync(watchRoot.root)) continue;
      try {
        const handle = watch(watchRoot.root, { recursive: watchRoot.recursive }, scheduleFlush);
        watchers.push(handle);
      } catch {
        // Some platforms/paths refuse recursive watch; ignore and continue.
      }
    }
  }

  return {
    close() {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      for (const handle of watchers) {
        try {
          handle.close();
        } catch {
          // Already closed by the runtime; nothing to do.
        }
      }
      watchers.length = 0;
    },
  };
}
