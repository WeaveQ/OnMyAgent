/**
 * Session-archive SSE poll policy: long default heartbeats; connection holds one store.
 * Explicit client `poll_ms` is honored (tests and interactive UIs may pass short values).
 */

export const ARCHIVE_SSE_DEFAULT_POLL_MS = 15_000;
/** Floor for *default* path only (when poll_ms omitted). */
export const ARCHIVE_SSE_MIN_POLL_MS = 5_000;
/** Hard floor for any explicit poll_ms (avoid zero/negative). */
export const ARCHIVE_SSE_EXPLICIT_MIN_POLL_MS = 50;

export function resolveArchiveSsePollMs(
  requested: number | null | undefined,
  fallback: number = ARCHIVE_SSE_DEFAULT_POLL_MS,
): number {
  if (typeof requested === "number" && Number.isFinite(requested) && requested > 0) {
    return Math.max(ARCHIVE_SSE_EXPLICIT_MIN_POLL_MS, Math.trunc(requested));
  }
  return Math.max(ARCHIVE_SSE_MIN_POLL_MS, fallback);
}
