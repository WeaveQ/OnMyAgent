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
