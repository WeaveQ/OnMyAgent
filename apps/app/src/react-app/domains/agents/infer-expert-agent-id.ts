/**
 * Recover a marketplace-style expert agent id from an isolated runtime path.
 * Paths historically look like:
 *   .../项目复盘专家-kol-project-review-specialistkol-project-review-specialist/<ts>
 * or (after segment fix):
 *   .../kol-project-review-specialist/<ts>
 */

function undoublePackageSlug(slug: string): string {
  const value = slug.trim();
  if (value.length < 4 || value.length % 2 !== 0) return value;
  const half = value.length / 2;
  const left = value.slice(0, half);
  const right = value.slice(half);
  if (left === right) return left;
  return value;
}

/**
 * Extract `package:package` agent id from an expert-session directory, or null.
 */
export function inferExpertAgentIdFromDirectory(
  directory: string | null | undefined,
): string | null {
  const dir = directory?.trim() ?? "";
  if (!dir) return null;
  const parts = dir.split(/[/\\]/).filter(Boolean);
  if (parts.length < 1) return null;
  // Prefer parent of numeric session key (…/agentSegment/1786…)
  let agentSeg = parts[parts.length - 1] ?? "";
  if (/^\d{10,16}$/.test(agentSeg) && parts.length >= 2) {
    agentSeg = parts[parts.length - 2] ?? "";
  }
  if (!agentSeg) return null;
  // Latin package slug at end of segment (after optional CJK display name)
  const match = agentSeg.match(/([a-z][a-z0-9]+(?:-[a-z0-9]+)+)$/i);
  if (!match?.[1]) return null;
  const pkg = undoublePackageSlug(match[1].toLowerCase());
  if (pkg.length < 3) return null;
  return `${pkg}:${pkg}`;
}
