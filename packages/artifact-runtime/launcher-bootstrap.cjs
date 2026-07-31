"use strict";

/**
 * Shared bootstrap for skill-local `runtime/artifact_runtime.cjs` launchers.
 * Resolves the packaged/monorepo artifact-runtime root and fixes NODE_PATH so
 * `require("exceljs")` / `require("xlsx")` work even when the skill lives under
 * ~/.config/opencode/skills.
 */

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function candidateRoots(launcherDirname, runtimeEntryFile) {
  const env = process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT?.trim();
  return [
    env,
    // monorepo: apps/desktop/resources/bundled-plugins/<plugin>/skills/<skill>/runtime
    path.resolve(launcherDirname, "../../../../../../../../packages/artifact-runtime"),
    // monorepo: apps/desktop/resources/bundled-skills/<skill>/runtime
    path.resolve(launcherDirname, "../../../../../../packages/artifact-runtime"),
    // packaged electron: resources/artifact-runtime next to bundled plugins/skills
    path.resolve(launcherDirname, "../../../../../artifact-runtime"),
    path.resolve(launcherDirname, "../../../../artifact-runtime"),
    path.resolve(launcherDirname, "../../../artifact-runtime"),
  ].filter(Boolean).filter((candidate, index, all) => all.indexOf(candidate) === index)
    .filter((candidate) => fs.existsSync(path.join(candidate, runtimeEntryFile)));
}

function resolveRuntimeRoot(launcherDirname, runtimeEntryFile) {
  const found = candidateRoots(launcherDirname, runtimeEntryFile);
  if (found[0]) return found[0];
  throw new Error(
    `Cannot resolve artifact runtime for ${runtimeEntryFile}. ` +
      "Set ONMYAGENT_ARTIFACT_RUNTIME_ROOT to packages/artifact-runtime (or the packaged resources/artifact-runtime).",
  );
}

function applyRuntimeNodePath(runtimeRoot) {
  process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT = runtimeRoot;
  const nodeModules = path.join(runtimeRoot, "node_modules");
  if (!fs.existsSync(nodeModules)) return runtimeRoot;
  process.env.NODE_PATH = [nodeModules, process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  // Node only reads NODE_PATH at startup; re-init so require() sees it.
  if (typeof Module._initPaths === "function") {
    Module._initPaths();
  }
  return runtimeRoot;
}

function bootstrapArtifactRuntime(launcherDirname, runtimeEntryFile) {
  const runtimeRoot = resolveRuntimeRoot(launcherDirname, runtimeEntryFile);
  applyRuntimeNodePath(runtimeRoot);
  return {
    runtimeRoot,
    runtimeEntry: path.join(runtimeRoot, runtimeEntryFile),
  };
}

module.exports = {
  applyRuntimeNodePath,
  bootstrapArtifactRuntime,
  resolveRuntimeRoot,
};
