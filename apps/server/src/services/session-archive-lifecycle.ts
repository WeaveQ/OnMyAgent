import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SessionArchiveLifecycleStatus } from "@onmyagent/types/session-archive";

import { openSessionArchiveStore } from "./session-archive.js";
import type { SessionArchiveRuntimePaths } from "./session-archive-sync.js";

export async function getSessionArchiveLifecycleStatus(input: {
  paths: SessionArchiveRuntimePaths;
  startedAt: number;
  version: string;
}): Promise<SessionArchiveLifecycleStatus> {
  const store = await openSessionArchiveStore({ dbPath: input.paths.dbPath });
  try {
    const dbInfo = await fileInfo(input.paths.dbPath);
    const logRoot = join(input.paths.root, "logs");
    return {
      healthy: true,
      version: input.version,
      mode: "studio-native",
      uptime_ms: Math.max(0, Date.now() - input.startedAt),
      runtime_root: input.paths.root,
      db_path: input.paths.dbPath,
      db_exists: dbInfo.exists,
      db_bytes: dbInfo.bytes,
      stats: store.stats(),
      update: {
        supported: false,
        update_available: false,
        current_version: input.version,
        blocker: "Session archive standalone updater is not used in Studio; Studio desktop updates are handled by the Studio application lifecycle.",
      },
      logs: {
        root: logRoot,
        files: await logFileSummaries(logRoot),
      },
    };
  } finally {
    store.close();
  }
}

async function fileInfo(path: string): Promise<{ exists: boolean; bytes: number; modified_at: string | null }> {
  try {
    const info = await stat(path);
    return { exists: true, bytes: info.size, modified_at: info.mtime.toISOString() };
  } catch {
    return { exists: false, bytes: 0, modified_at: null };
  }
}

async function logFileSummaries(root: string): Promise<Array<{ name: string; path: string; bytes: number; modified_at: string | null }>> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const entries = await Promise.all(names.map(async (name) => {
    const path = join(root, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      return { name: basename(path), path, bytes: info.size, modified_at: info.mtime.toISOString() };
    } catch {
      return null;
    }
  }));
  return entries
    .filter((entry): entry is { name: string; path: string; bytes: number; modified_at: string } => entry !== null)
    .sort((left, right) => right.modified_at.localeCompare(left.modified_at))
    .slice(0, 20);
}
