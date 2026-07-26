/**
 * Snapshot read error policy: distinguish missing sessions so clients can
 * stop retry storms without treating every failure as transient.
 */

import { ApiError } from "../core/errors.js";

/** Canonical 404 for missing OpenCode sessions (list/snapshot/messages). */
export function sessionNotFoundError(details?: unknown): ApiError {
  return new ApiError(404, "session_not_found", "Session not found", details);
}

export function isSessionNotFoundApiError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "session_not_found";
}

/**
 * Whether a failed snapshot should be retried by the server pipeline.
 * Missing sessions are terminal for that id until the list is refreshed.
 */
export function shouldRetryWorkspaceSessionSnapshot(error: unknown): boolean {
  if (isSessionNotFoundApiError(error)) return false;
  if (error instanceof ApiError && error.status === 404) return false;
  return true;
}
