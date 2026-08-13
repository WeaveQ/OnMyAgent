import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");
const electronSidecarDir = resolve(desktopRoot, "resources", "sidecars");
const electronRuntimeDir = resolve(desktopRoot, "resources", "runtimes");
const electronHelperDir = resolve(desktopRoot, "resources", "helpers");
const electronArtifactRuntimeDir = resolve(desktopRoot, "resources", "artifact-runtime");
const artifactRuntimeWorkspaceLink = resolve(
  electronArtifactRuntimeDir,
  "node_modules",
  ".pnpm",
  "node_modules",
  "@onmyagent",
  "artifact-runtime",
);
const electronRoot = resolve(desktopRoot, "electron");
const packagedServerRoot = resolve(desktopRoot, "server");

const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const nodeCmd = process.execPath;

function needsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: needsShell(command),
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/**
 * Turn a `pnpm deploy --legacy` node_modules tree into a symlink-free,
 * self-contained tree that Node's ESM resolver can read from inside app.asar.
 *
 * Why this is needed at all: electron-builder stores symlinks verbatim in
 * app.asar, and Node cannot follow symlinks inside an asar archive — the
 * v0.4.20 packaged boot crash ("Cannot find package 'jsonc-parser'").
 *
 * Why flattening symlinks in place is NOT enough: pnpm keeps transitive
 * dependencies as siblings of each package under `.pnpm/<id>/node_modules/`,
 * reachable on disk only via realpath redirection through the symlink chain.
 * Copying just the top-level link targets and deleting `.pnpm` orphans every
 * transitive dependency (the follow-up "Cannot find package 'brace-expansion'
 * imported from …/minimatch/…" crash).
 *
 * So for every package link we copy the real package directory and nest real
 * copies of its own runtime dependencies under `<pkg>/node_modules/`,
 * recursively — exactly what resolution would have found on disk, but with
 * plain directories only. Deps that pnpm placed in the `.pnpm/node_modules`
 * fallback hoist pool (instead of as scope siblings, e.g. cross-spawn for
 * @opencode-ai/sdk) are resolved via the same upward walk Node performs and
 * nested as well.
 *
 * Returns the number of package directories materialized.
 */
function materializeDeployTree(nodeModulesDir) {
  const stats = { packages: 0 };
  const deployRoot = dirname(nodeModulesDir);
  // Dependencies of a `.pnpm/<id>/node_modules/<pkg>` entry are its sibling
  // links in that same scope directory. Detect that scope via the realpath
  // parent; workspace links (realpath inside the source checkout, e.g.
  // packages/types) and staged top-level entries must not pull in siblings.
  const pnpmScopeOf = (realDir) => {
    let parent = dirname(realDir);
    // Scoped packages live one level deeper (.pnpm/<id>/node_modules/@scope/name).
    if (basename(parent).startsWith("@")) parent = dirname(parent);
    return basename(parent) === "node_modules" && parent.includes(`${sep}.pnpm${sep}`)
      ? parent
      : null;
  };
  const readManifestDepNames = (pkgDir) => {
    try {
      const manifest = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8"));
      return [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ];
    } catch {
      return [];
    }
  };
  // Mirror Node's upward node_modules walk from a package's real directory.
  // This finds deps that pnpm did not place as scope siblings but in the
  // `.pnpm/node_modules` fallback hoist pool (or at the staged top level).
  const findDepSource = (fromRealDir, depName) => {
    let dir = fromRealDir;
    for (;;) {
      if (basename(dir) !== "node_modules") {
        const candidate = resolve(dir, "node_modules", depName);
        if (existsSync(candidate)) return candidate;
      }
      if (dir === deployRoot) return null;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  };

  const materializeEntry = (srcPath, destPath, chain, depth) => {
    if (depth > 32) {
      throw new Error(`[server-deps] dependency chain too deep at ${srcPath}`);
    }
    const srcStat = lstatSync(srcPath);
    let realSrc = srcPath;
    let depScope = null;
    if (srcStat.isSymbolicLink()) {
      realSrc = realpathSync(srcPath); // throws on dangling links
      if (chain.has(realSrc)) return; // dependency cycle: cut
      depScope = pnpmScopeOf(realSrc);
      chain.add(realSrc);
      rmSync(destPath, { recursive: true, force: true });
      cpSync(realSrc, destPath, { recursive: true, dereference: true });
      stats.packages += 1;
    } else if (srcStat.isDirectory()) {
      if (resolve(srcPath) !== resolve(destPath)) {
        rmSync(destPath, { recursive: true, force: true });
        cpSync(srcPath, destPath, { recursive: true, dereference: true });
        stats.packages += 1;
      }
    } else {
      return; // stray file entry: leave untouched
    }

    // Collect this package's runtime deps: sibling links in its pnpm scope,
    // plus anything already present in a nested node_modules (workspace
    // packages may carry one), to be materialized in place.
    const depJobs = [];
    const nestedTopNames = new Set();
    if (depScope) {
      // The scope entry that contains the package itself (a bare name, or an
      // @scope namespace dir for scoped packages) must not be re-nested.
      const skipName = relative(depScope, realSrc).split(sep)[0];
      for (const sibling of readdirSync(depScope, { withFileTypes: true })) {
        if (sibling.name === skipName) continue;
        depJobs.push([resolve(depScope, sibling.name), resolve(destPath, "node_modules", sibling.name)]);
        nestedTopNames.add(sibling.name);
      }
      // Deps that pnpm satisfied from the `.pnpm/node_modules` fallback pool
      // (instead of scope siblings) are invisible to the sibling copy above;
      // resolve them the way Node would and nest them explicitly.
      for (const depName of readManifestDepNames(destPath)) {
        const topName = depName.startsWith("@") ? depName.split("/").slice(0, 2).join("/") : depName;
        if (nestedTopNames.has(topName) || nestedTopNames.has(topName.split("/")[0])) continue;
        const source = findDepSource(realSrc, depName);
        if (source) {
          depJobs.push([source, resolve(destPath, "node_modules", depName)]);
          nestedTopNames.add(topName);
        }
      }
    }
    const innerNodeModules = resolve(destPath, "node_modules");
    if (existsSync(innerNodeModules) && lstatSync(innerNodeModules).isDirectory()) {
      for (const inner of readdirSync(innerNodeModules, { withFileTypes: true })) {
        if (inner.name === ".bin") {
          // bin stubs are symlinks into .pnpm and never imported at runtime.
          rmSync(resolve(innerNodeModules, ".bin"), { recursive: true, force: true });
          continue;
        }
        const innerPath = resolve(innerNodeModules, inner.name);
        depJobs.push([innerPath, innerPath]);
      }
    }
    for (const [depSrc, depDest] of depJobs) {
      materializeDep(depSrc, depDest, chain, depth + 1);
    }
    if (srcStat.isSymbolicLink()) chain.delete(realSrc);
  };

  const materializeDep = (srcPath, destPath, chain, depth) => {
    const stat = lstatSync(srcPath);
    // Scoped namespace dirs (@scope) are real dirs containing package links.
    if (stat.isDirectory() && basename(srcPath).startsWith("@")) {
      mkdirSync(destPath, { recursive: true });
      for (const child of readdirSync(srcPath, { withFileTypes: true })) {
        materializeDep(resolve(srcPath, child.name), resolve(destPath, child.name), chain, depth + 1);
      }
      return;
    }
    materializeEntry(srcPath, destPath, chain, depth);
  };

  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name === ".pnpm" || entry.name === ".bin" || entry.name === ".modules.yaml") continue;
    const entryPath = resolve(nodeModulesDir, entry.name);
    materializeDep(entryPath, entryPath, new Set(), 0);
  }
  return stats.packages;
}

run(nodeCmd, [resolve(__dirname, "prepare-sidecar.mjs"), "--force", "--outdir", electronSidecarDir], desktopRoot);
run(nodeCmd, [resolve(__dirname, "prepare-pi-sidecar.mjs"), "--outdir", electronSidecarDir], desktopRoot);
run(nodeCmd, [resolve(__dirname, "prepare-runtimes.mjs"), "--outdir", electronRuntimeDir], desktopRoot);
run(nodeCmd, [resolve(__dirname, "prepare-computer-use-helper.mjs"), "--force", "--outdir", electronHelperDir], desktopRoot);
// Windows Computer Use: stage Cua Driver (full binary pack) next to HandsFree helpers.
run(nodeCmd, [resolve(__dirname, "prepare-cua-helper.mjs"), "--outdir", electronHelperDir], desktopRoot);
rmSync(electronArtifactRuntimeDir, { recursive: true, force: true });
// Prefer offline store after root `pnpm install`, but allow network when the
// offline metadata mirror is incomplete (seen on GHA as ERR_PNPM_NO_OFFLINE_META
// for exceljs during Release App packaging).
run(
  pnpmCmd,
  [
    "--prefer-offline",
    "--filter",
    "@onmyagent/artifact-runtime",
    "deploy",
    "--legacy",
    "--prod",
    electronArtifactRuntimeDir,
  ],
  repoRoot,
);
// pnpm's legacy deploy includes a workspace self-link that points back into the
// source checkout. It is unnecessary at runtime and becomes broken after
// electron-builder copies resources into the application bundle for signing.
rmSync(artifactRuntimeWorkspaceLink, { recursive: true, force: true });
// Built-in skills are curated directly in resources/bundled-skills and are
// packaged read-only. Workspace-local .opencode/skills is development-only and
// must not implicitly change the shipped desktop bundle.
const bundledSkillsDir = resolve(desktopRoot, "resources", "bundled-skills");
if (existsSync(bundledSkillsDir)) {
  const bundledSkillNames = readdirSync(bundledSkillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (bundledSkillNames.length > 0) {
    process.stdout.write(`[bundled-skills] Packaging ${bundledSkillNames.length} curated built-in skills from ${bundledSkillsDir}\n`);
  } else {
    process.stderr.write(`[bundled-skills] No curated skills found in ${bundledSkillsDir}; bundling empty directory\n`);
  }
} else {
  process.stderr.write(`[bundled-skills] ${bundledSkillsDir} does not exist; no built-in skills will be packaged\n`);
}
// Compile shared types to JS so the packaged Electron main process can load
// @onmyagent/types/* from node_modules (Node refuses type-stripping under node_modules).
run(pnpmCmd, ["--filter", "@onmyagent/types", "build"], repoRoot);
// Build the server TS → JS so Electron can import it in-process
run(pnpmCmd, ["--filter", "onmyagent-server", "build"], repoRoot);
// ONMYAGENT_ELECTRON_BUILD tells Vite to emit relative asset paths so
// index.html resolves /assets/* correctly when loaded via file:// from
// inside the packaged .app bundle.
// Raise V8 heap for vite production builds — GHA macos-14 runners have
// OOM'd mid-bundle (SIGABRT) under default ~2–4GB Node limits.
const nodeHeap =
  process.env.NODE_OPTIONS && process.env.NODE_OPTIONS.includes("max-old-space-size")
    ? process.env.NODE_OPTIONS
    : [process.env.NODE_OPTIONS, "--max-old-space-size=8192"].filter(Boolean).join(" ");
run(pnpmCmd, ["--filter", "@onmyagent/app", "build"], repoRoot, {
  ONMYAGENT_ELECTRON_BUILD: "1",
  NODE_OPTIONS: nodeHeap,
});
// Copy constants.json next to server dist so the packaged asar can resolve it.
// Also patch the compiled import path so it works from both dev and packaged layouts.
const serverDistDir = resolve(repoRoot, "apps", "server", "dist");
const constantsSrc = resolve(repoRoot, "constants.json");
copyFileSync(constantsSrc, resolve(serverDistDir, "constants.json"));
const serverJsPath = resolve(serverDistDir, "server.js");
const serverJsSrc = readFileSync(serverJsPath, "utf8");
const patched = serverJsSrc.replace(
  /from\s+["']\.\.\/\.\.\/\.\.\/constants\.json["']/,
  'from "./constants.json"',
);
if (patched !== serverJsSrc) {
  writeFileSync(serverJsPath, patched, "utf8");
}
rmSync(packagedServerRoot, { recursive: true, force: true });
// Stage the server with its production node_modules (jsonc-parser, minimatch,
// yaml, zod, @opencode-ai/sdk, @onmyagent/types, better-sqlite3). tsc emits
// bare ESM imports, so dist alone cannot resolve packages at runtime — this is
// what caused the packaged "Cannot find package 'jsonc-parser'" boot crash.
// `pnpm deploy --prod` materializes a self-contained install (same pattern as
// the artifact-runtime deploy above). We then overwrite its dist/ with the
// locally built (and constants-patched) output so the shipped bundle matches
// this build exactly.
run(
  pnpmCmd,
  [
    "--prefer-offline",
    "--filter",
    "onmyagent-server",
    "deploy",
    "--legacy",
    "--prod",
    packagedServerRoot,
  ],
  repoRoot,
);
// pnpm deploy leaves a workspace self-link under node_modules/ pointing back
// into the source checkout; it is unused at runtime and breaks after signing.
const deployedSelfLink = resolve(
  packagedServerRoot,
  "node_modules",
  ".pnpm",
  "node_modules",
  "onmyagent-server",
);
rmSync(deployedSelfLink, { recursive: true, force: true });
// pnpm's layout is symlink-based (node_modules/<dep> -> .pnpm/<dep>@x/...).
// Symlinks survive into app.asar, where Node's ESM resolver cannot follow
// them — that reproduced the "Cannot find package 'jsonc-parser'" boot crash
// even with every dependency present. Rebuild the tree as nested real
// directories (each package carries its own runtime deps), then drop the
// now-unreferenced pnpm metadata.
const stagedNodeModules = resolve(packagedServerRoot, "node_modules");
const materializedPackages = materializeDeployTree(stagedNodeModules);
rmSync(resolve(stagedNodeModules, ".pnpm"), { recursive: true, force: true });
rmSync(resolve(stagedNodeModules, ".bin"), { recursive: true, force: true });
rmSync(resolve(stagedNodeModules, ".modules.yaml"), { force: true });
process.stdout.write(
  `[server-deps] materialized ${materializedPackages} package dir(s) into a nested, symlink-free tree for asar-safe resolution\n`,
);
rmSync(resolve(packagedServerRoot, "dist"), { recursive: true, force: true });
cpSync(serverDistDir, resolve(packagedServerRoot, "dist"), { recursive: true });
for (const fileName of readdirSync(electronRoot).filter((name) => name.endsWith(".mjs")).sort()) {
  run(nodeCmd, ["--check", resolve(electronRoot, fileName)], repoRoot);
}
run(nodeCmd, [resolve(__dirname, "check-electron-bridge.mjs")], repoRoot);
// Guard against a packaged "Cannot find package 'x'" boot crash: every bare
// import in the staged server/dist must resolve against its deployed node_modules.
run(nodeCmd, [resolve(__dirname, "check-server-runtime-deps.mjs")], desktopRoot);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      renderer: "apps/app/dist",
      electronMain: "apps/desktop/electron/main.mjs",
      electronPreload: "apps/desktop/electron/preload.mjs",
    },
    null,
    2,
  )}\n`,
);
