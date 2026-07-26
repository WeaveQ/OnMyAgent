/**
 * Session list request normalization and slow-path timing thresholds.
 * Keeps listWorkspaceSessions bounded and measurable.
 */

/** When client omits limit, cap OpenCode list size to avoid multi-second cold lists. */
export const DEFAULT_WORKSPACE_SESSION_LIST_LIMIT = 80;

/** Log when list exceeds this duration (ms). */
export const WORKSPACE_SESSION_LIST_SLOW_MS = 500;

export type WorkspaceSessionListInput = {
  roots?: boolean;
  start?: number;
  search?: string;
  limit?: number;
  directory?: string;
};

export type NormalizedWorkspaceSessionListInput = {
  roots?: boolean;
  start?: number;
  search?: string;
  limit: number;
  directory?: string;
};

/**
 * Apply default limit when missing/invalid so list calls stay bounded.
 */
export function normalizeWorkspaceSessionListInput(
  input: WorkspaceSessionListInput,
): NormalizedWorkspaceSessionListInput {
  const limit =
    typeof input.limit === "number" &&
    Number.isFinite(input.limit) &&
    input.limit > 0
      ? Math.floor(input.limit)
      : DEFAULT_WORKSPACE_SESSION_LIST_LIMIT;
  return {
    ...(input.roots !== undefined ? { roots: input.roots } : {}),
    ...(typeof input.start === "number" && Number.isFinite(input.start)
      ? { start: Math.max(0, Math.floor(input.start)) }
      : {}),
    ...(input.search?.trim() ? { search: input.search.trim() } : {}),
    limit,
    ...(input.directory?.trim()
      ? { directory: input.directory.trim() }
      : {}),
  };
}

export function shouldLogSlowWorkspaceSessionList(durationMs: number): boolean {
  return durationMs >= WORKSPACE_SESSION_LIST_SLOW_MS;
}

export type WorkspaceSessionListTiming = {
  workspaceId: string;
  durationMs: number;
  limit: number;
  itemCount: number;
  roots?: boolean;
  search?: boolean;
};

export function formatWorkspaceSessionListTiming(
  timing: WorkspaceSessionListTiming,
): string {
  return [
    "[workspace-sessions] list",
    `workspace=${timing.workspaceId}`,
    `ms=${Math.round(timing.durationMs)}`,
    `limit=${timing.limit}`,
    `items=${timing.itemCount}`,
    timing.roots === true ? "roots=1" : null,
    timing.search ? "search=1" : null,
  ]
    .filter(Boolean)
    .join(" ");
}
