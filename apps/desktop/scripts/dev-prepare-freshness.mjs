import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function resolveDevOrchestratorArtifactPath({ sidecarDir, platform, targetTriple }) {
  const isWindowsTarget = platform === "win32" || targetTriple?.toLowerCase().includes("windows") === true;
  return resolve(sidecarDir, `onmyagent-orchestrator${isWindowsTarget ? ".exe" : ""}`);
}

/**
 * The desktop and embedded server resolve package exports through the default
 * (built) condition in Node. Keep the full tsup entry set as freshness
 * artifacts: checking only index.js would let a missing runtime subpath break
 * Electron after we skipped the build.
 */
export function resolveDevTypesArtifactPaths(typesDistDir) {
  return [
    "index",
    "den/desktop-app-restrictions",
    "den/desktop-policies",
    "den/inference",
    "server",
    "server-client-method-map",
    "desktop-ipc",
    "session-archive",
    "browser",
    "channel",
    "artifact-plugin",
    "officecli",
    "lark-cli-auth",
    "tencent-docs-connector",
    "baidu-drive-connector",
    "kdocs-connector",
    "dingtalk-connector",
    "wecom-connector",
    "tencent-meeting-connector",
  ].map((entry) => resolve(typesDistDir, `${entry}.js`));
}

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
