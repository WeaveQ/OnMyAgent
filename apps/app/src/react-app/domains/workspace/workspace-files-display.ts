/**
 * Display helpers for Files trees (session titles, truncation).
 * Pure — unit-tested without React/Electron.
 */

/** Default max grapheme-ish count for session chips in Files (CJK ≈ 1 each). */
export const SESSION_TITLE_MAX_CHARS = 10;

/**
 * Truncate a session/task title for tree rows.
 * Counts UTF-16 code units as approximate CJK width (product: ~10 chars).
 */
export function truncateDisplayTitle(
  title: string,
  maxChars: number = SESSION_TITLE_MAX_CHARS,
): { display: string; full: string; truncated: boolean } {
  const full = String(title ?? "").trim();
  if (!full) {
    return { display: "", full: "", truncated: false };
  }
  const limit = Math.max(1, Math.floor(maxChars));
  // [...str] splits most CJK / emoji into single visual units better than length alone.
  const units = [...full];
  if (units.length <= limit) {
    return { display: full, full, truncated: false };
  }
  return {
    display: `${units.slice(0, limit).join("")}…`,
    full,
    truncated: true,
  };
}

/**
 * Prefer real session title; else folder-based fallback (caller supplies fallback).
 */
export function resolveSessionDisplayTitle(input: {
  sessionTitle?: string | null;
  folderFallback: string;
}): { display: string; full: string; truncated: boolean } {
  const preferred = String(input.sessionTitle ?? "").trim();
  const full = preferred || String(input.folderFallback ?? "").trim();
  return truncateDisplayTitle(full);
}
