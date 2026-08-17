export function compareSidecarVersions(left, right) {
  const tokens = (value) =>
    String(value ?? "")
      .replace(/^v/i, "")
      .split(/[.-]/)
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const a = tokens(left);
  const b = tokens(right);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

export function shouldDownloadOpencode({
  candidateExists,
  candidateIsStub,
  existingVersion,
  pinnedVersion,
  preferExisting,
}) {
  const hasUsableCandidate = candidateExists && !candidateIsStub && Boolean(existingVersion);
  if (preferExisting && hasUsableCandidate) {
    if (!pinnedVersion) return false;
    // Reuse a warm sidecar only when it is at least the pin. Older copies
    // must refresh instead of silently staying stale in `pnpm dev`.
    return compareSidecarVersions(existingVersion, pinnedVersion) < 0;
  }
  return !hasUsableCandidate || existingVersion !== pinnedVersion;
}

/**
 * Development prefers a usable bundled sidecar over a separately installed
 * OpenCode binary. This keeps a warm `pnpm dev` from copying a large binary on
 * every launch. Release preparation only accepts a local binary at the pinned
 * version, so its version guarantee remains intact.
 */
export function shouldCopyLocalOpencode({
  candidateExists,
  candidateIsStub,
  existingVersion,
  localVersion,
  pinnedVersion,
  preferExisting,
}) {
  if (!localVersion) return false;

  const hasUsableCandidate = candidateExists && !candidateIsStub && Boolean(existingVersion);
  if (preferExisting && hasUsableCandidate) {
    if (pinnedVersion && compareSidecarVersions(existingVersion, pinnedVersion) < 0) {
      return localVersion === pinnedVersion;
    }
    return false;
  }

  return preferExisting || localVersion === pinnedVersion;
}

/**
 * Prepare writes only the afterPack short alias. Presence still treats a
 * leftover triple-named (or bun-target) sibling as "already have one" so a
 * warm run does not re-download ~148MB just because the unused name is missing.
 */
export function sidecarNormalizeActions({ aliasName, leftoverNames = [], existingNames = [] }) {
  if (!aliasName) {
    return { writeNames: [], present: false, renameFrom: null, prune: [] };
  }

  const leftovers = [...new Set(leftoverNames.filter((name) => name && name !== aliasName))];
  const existing = new Set(existingNames);
  const leftoverPresent = leftovers.find((name) => existing.has(name)) ?? null;
  const hasAlias = existing.has(aliasName);

  return {
    writeNames: [aliasName],
    present: hasAlias || leftoverPresent !== null,
    renameFrom: !hasAlias && leftoverPresent ? leftoverPresent : null,
    prune: leftovers,
  };
}

/**
 * A manifest may safely supply its existing hashes when no binary changed and
 * its lightweight file snapshots still match. Avoiding a second full-file hash
 * is important for native sidecars during warm desktop starts.
 */
export function canReuseSidecarManifest({ manifest, expectedEntries, didMutate }) {
  if (didMutate || !manifest || typeof manifest !== "object") return false;

  return Object.entries(expectedEntries).every(([name, expected]) => {
    const recorded = manifest[name];
    if (!recorded || typeof recorded !== "object") return false;
    if (recorded.version !== expected.version || typeof recorded.sha256 !== "string" || !recorded.sha256) {
      return false;
    }
    if (!expected.file) return expected.hasFile !== true;

    return recorded.size === expected.file.size && recorded.mtimeMs === expected.file.mtimeMs;
  });
}
