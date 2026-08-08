import { existsSync, readdirSync, statSync } from "node:fs";

function newestModificationMs(path) {
  try {
    if (!existsSync(path)) return null;

    const stat = statSync(path);
    if (!stat.isDirectory()) return stat.mtimeMs;

    let newest = stat.mtimeMs;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if ([".build", ".git", "dist", "node_modules"].includes(entry.name)) continue;
      const childNewest = newestModificationMs(`${path}/${entry.name}`);
      if (childNewest !== null) newest = Math.max(newest, childNewest);
    }
    return newest;
  } catch {
    // A file can disappear while the dev process is starting. Treat it as
    // absent so preparation remains conservative instead of failing startup.
    return null;
  }
}

/**
 * Dev preparation may reuse an existing native artifact unless an explicit
 * force is requested, an output is missing, or its inputs changed afterwards.
 */
export function shouldForceDevPreparation({ artifactPaths, inputPaths, force = false, getNewest = newestModificationMs }) {
  if (force) return true;

  const artifactTimes = artifactPaths.map((path) => getNewest(path));
  if (artifactTimes.some((time) => time === null)) return true;

  const oldestArtifact = Math.min(...artifactTimes);
  return inputPaths.some((path) => {
    const inputTime = getNewest(path);
    return inputTime !== null && inputTime > oldestArtifact;
  });
}
