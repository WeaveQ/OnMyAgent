import type { WorkspaceSessionScope } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";

/**
 * Session list request normalization and slow-path timing thresholds.
 * Keeps listWorkspaceSessions bounded and measurable.
 */

/** When client omits limit, cap OpenCode list size to avoid multi-second cold lists. */
export const DEFAULT_WORKSPACE_SESSION_LIST_LIMIT = 80;

/** Maximum global window fetched per source for workspace aggregation. */
export const MAX_WORKSPACE_SESSION_AGGREGATE_WINDOW = 400;

/** Maximum concurrent source lists in workspace aggregation. */
export const WORKSPACE_SESSION_DIRECTORY_CONCURRENCY = 4;

/** Maximum managed expert directories scanned in one workspace request. */
export const MAX_WORKSPACE_SESSION_DIRECTORIES = 64;

/** Log when list exceeds this duration (ms). */
export const WORKSPACE_SESSION_LIST_SLOW_MS = 500;

export type WorkspaceSessionListInput = {
  scope?: WorkspaceSessionScope;
  roots?: boolean;
  start?: number;
  search?: string;
  limit?: number;
  directory?: string;
};

export type NormalizedWorkspaceSessionListInput = {
  scope: WorkspaceSessionScope;
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
    scope: input.scope ?? "directory",
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

export function assertWorkspaceSessionAggregateWindow(
  input: NormalizedWorkspaceSessionListInput,
): void {
  if (input.scope !== "workspace") return;
  const window = input.limit + (input.start ?? 0);
  if (window > MAX_WORKSPACE_SESSION_AGGREGATE_WINDOW) {
    throw new ApiError(
      400,
      "session_aggregate_window_too_large",
      `Workspace session aggregate window must be at most ${MAX_WORKSPACE_SESSION_AGGREGATE_WINDOW}`,
      { maxWindow: MAX_WORKSPACE_SESSION_AGGREGATE_WINDOW },
    );
  }
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

export type WorkspaceSessionDirectoryTiming = {
  source: "workspace-root" | "expert-runtime";
  key: string;
  index: number;
  durationMs: number;
  itemCount: number;
};

export function shouldLogSlowWorkspaceSessionDirectory(
  durationMs: number,
): boolean {
  return durationMs >= WORKSPACE_SESSION_LIST_SLOW_MS;
}

export function formatWorkspaceSessionDirectoryTiming(
  timing: WorkspaceSessionDirectoryTiming,
): string {
  return [
    "[workspace-sessions] source",
    `source=${timing.source}`,
    `key=${timing.key}`,
    `index=${timing.index}`,
    `ms=${Math.round(timing.durationMs)}`,
    `items=${timing.itemCount}`,
  ].join(" ");
}
