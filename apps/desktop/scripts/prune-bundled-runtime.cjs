/**
 * Drop files that official Node/Python archives ship but the product never
 * executes. Used by prepare-runtimes and electron afterPack so a dirty local
 * runtime (npm -g grok, pip pandas, headers) cannot leak into the installer.
 */
const fs = require("node:fs");
const path = require("node:path");

const KEPT_NODE_MODULES = new Set(["npm", "corepack"]);

const PYTHON_DROP_DIR_NAMES = new Set([
  "__pycache__",
  "idlelib",
  "ensurepip",
  "pydoc_data",
  "lib2to3",
  "include",
  "tkinter",
  "tcl9.0",
  "tk9.0",
  "tcl9",
  "tcl8.6",
  "tk8.6",
  "itcl4.3.5",
  "thread3.0.4",
  "pkgconfig",
]);

const PYTHON_DROP_FILE_PREFIXES = ["libtcl", "libtk"];

function rmIfExists(target) {
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

function pruneNodeTree(nodeRoot) {
  if (!nodeRoot || !fs.existsSync(nodeRoot)) return;
  rmIfExists(path.join(nodeRoot, "include"));
  rmIfExists(path.join(nodeRoot, "share"));
  rmIfExists(path.join(nodeRoot, "CHANGELOG.md"));
  rmIfExists(path.join(nodeRoot, "README.md"));

  const modulesRoot = path.join(nodeRoot, "lib", "node_modules");
  if (!fs.existsSync(modulesRoot)) return;
  for (const entry of fs.readdirSync(modulesRoot)) {
    if (KEPT_NODE_MODULES.has(entry) || entry.startsWith(".")) continue;
    rmIfExists(path.join(modulesRoot, entry));
  }
}

function shouldKeepPythonSitePackage(name) {
  return name === "README.txt" || name === "README" || name === "pip" || name.startsWith("pip-");
}

function prunePythonSitePackages(siteDir) {
  if (!siteDir || !fs.existsSync(siteDir)) return;
  for (const entry of fs.readdirSync(siteDir)) {
    if (shouldKeepPythonSitePackage(entry)) continue;
    rmIfExists(path.join(siteDir, entry));
  }
}

function prunePythonTree(pythonRoot) {
  if (!pythonRoot || !fs.existsSync(pythonRoot)) return;
  const stack = [pythonRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (PYTHON_DROP_DIR_NAMES.has(entry.name)) {
          rmIfExists(full);
          continue;
        }
        if (entry.name === "site-packages") {
          prunePythonSitePackages(full);
          continue;
        }
        stack.push(full);
        continue;
      }
      if (PYTHON_DROP_FILE_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
        rmIfExists(full);
      }
    }
  }
}

function isSafeArtifactRuntimeJunk(name) {
  return (
    name.endsWith(".map") ||
    name.endsWith(".md") ||
    name.endsWith(".ts") ||
    name.endsWith(".test.cjs") ||
    name === "@types"
  );
}

function pruneArtifactRuntimeTree(artifactRoot) {
  if (!artifactRoot || !fs.existsSync(artifactRoot)) return;
  const stack = [artifactRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (isSafeArtifactRuntimeJunk(entry.name) || entry.name.startsWith("@types+")) {
        rmIfExists(full);
        continue;
      }
      if (entry.isDirectory()) stack.push(full);
    }
  }
}

function prunePackagedRuntime(targetRuntimeDir) {
  if (!targetRuntimeDir || !fs.existsSync(targetRuntimeDir)) return;
  pruneNodeTree(path.join(targetRuntimeDir, "node"));
  prunePythonTree(path.join(targetRuntimeDir, "python"));
}

/**
 * Packaged lookup tries `<name>-<triple>` then `<name>`. Keep only the short
 * alias so the installer does not ship two copies of the same Mach-O.
 */
function resolvePackagedSidecarKeepList(sidecarsDir, triple, executableSuffix) {
  const bases = ["opencode", "onmyagent-orchestrator"];
  const keep = new Set(["versions.json"]);
  const planned = [];
  for (const base of bases) {
    const aliasName = `${base}${executableSuffix}`;
    const targetName = `${base}-${triple}${executableSuffix}`;
    planned.push({ aliasName, targetName });
    keep.add(aliasName);
  }
  return { keep, planned };
}

module.exports = {
  KEPT_NODE_MODULES,
  PYTHON_DROP_DIR_NAMES,
  pruneNodeTree,
  prunePythonTree,
  prunePythonSitePackages,
  prunePackagedRuntime,
  pruneArtifactRuntimeTree,
  resolvePackagedSidecarKeepList,
};
