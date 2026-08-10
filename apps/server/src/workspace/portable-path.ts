/**
 * Portable relative path helpers shared by workspace file APIs.
 * Always use forward slashes; reject absolute and traversal segments.
 * Safe on Windows when callers pass user/agent-supplied relative paths
 * that may use `\` separators.
 */

/**
 * Normalize a workspace- or package-relative path to portable form.
 * Returns `null` when the path is empty, absolute, or contains traversal.
 *
 * Does **not** throw — call sites map `null` to domain errors.
 */
export function toPortableRelativePath(input: unknown): string | null {
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
  // Strip leading ./ only (not absolute / — already rejected)
  normalized = normalized.replace(/^\.\//, "");
  // Collapse duplicate slashes
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

/**
 * Split a portable relative path into segments (after normalize).
 * Returns `null` if normalize fails.
 */
export function portableRelativeSegments(input: unknown): string[] | null {
  const path = toPortableRelativePath(input);
  if (path == null) return null;
  return path.split("/").filter(Boolean);
}
