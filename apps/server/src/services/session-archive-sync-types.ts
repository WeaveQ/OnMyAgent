import type { SessionArchiveAgent } from "@onmyagent/types/session-archive";

/**
 * Shared types for session-archive sync.
 *
 * Extracted from `session-archive-sync.ts` so that
 * `session-archive-sync-worker-runner.ts` (which only needs these types) does
 * not import the sync module, breaking the sync <-> worker-runner cycle.
 */

export type SessionArchiveRuntimePaths = {
  root: string;
  dbPath: string;
};

export type SessionArchiveSyncMode = "incremental" | "resync";

export type SessionArchiveSourceRoot = {
  agent: SessionArchiveAgent;
  root: string;
};
