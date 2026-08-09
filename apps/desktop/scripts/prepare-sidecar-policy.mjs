export function shouldDownloadOpencode({
  candidateExists,
  candidateIsStub,
  existingVersion,
  pinnedVersion,
  preferExisting,
}) {
  const hasUsableCandidate = candidateExists && !candidateIsStub && Boolean(existingVersion);
  if (preferExisting && hasUsableCandidate) return false;
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
  localVersion,
  pinnedVersion,
  preferExisting,
}) {
  if (!localVersion) return false;

  const hasUsableCandidate = candidateExists && !candidateIsStub;
  if (preferExisting && hasUsableCandidate) return false;

  return preferExisting || localVersion === pinnedVersion;
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
