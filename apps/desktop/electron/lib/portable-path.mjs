/**
 * Portable relative path helper (mirrors apps/server/src/workspace/portable-path.ts).
 * Keep algorithms in sync when either side changes.
 */

/**
 * @param {unknown} input
 * @returns {string | null}
 */
export function toPortableRelativePath(input) {
  if (typeof input !== "string" && input != null && typeof input !== "number") {
    return null;
  }
  const raw = String(input ?? "").trim();
  if (!raw || raw.includes("\0")) return null;

  // Reject absolute paths before stripping separators (Windows + POSIX).
  if (raw.startsWith("/") || raw.startsWith("\\")) return null;
  if (/^[A-Za-z]:[\\/]/.test(raw)) return null;
  if (raw.startsWith("//") || raw.startsWith("\\\\")) return null;

  let normalized = raw.replace(/\\/g, "/");
  normalized = normalized.replace(/^\.\//, "");
  normalized = normalized.replace(/\/+/g, "/");

  if (!normalized) return null;

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (segment === "." || segment === "..") return null;
    if (segment.includes("\0")) return null;
  }
  return segments.join("/");
}
