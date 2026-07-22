import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

run(nodeCmd, [resolve(__dirname, "prepare-sidecar.mjs"), "--force", "--outdir", electronSidecarDir], desktopRoot);
run(nodeCmd, [resolve(__dirname, "prepare-runtimes.mjs"), "--outdir", electronRuntimeDir], desktopRoot);
run(nodeCmd, [resolve(__dirname, "prepare-computer-use-helper.mjs"), "--force", "--outdir", electronHelperDir], desktopRoot);
rmSync(electronArtifactRuntimeDir, { recursive: true, force: true });
run(
  pnpmCmd,
  ["--offline", "--filter", "@onmyagent/artifact-runtime", "deploy", "--legacy", "--prod", electronArtifactRuntimeDir],
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
cpSync(serverDistDir, resolve(packagedServerRoot, "dist"), { recursive: true });
copyFileSync(resolve(repoRoot, "apps", "server", "package.json"), resolve(packagedServerRoot, "package.json"));
for (const fileName of readdirSync(electronRoot).filter((name) => name.endsWith(".mjs")).sort()) {
  run(nodeCmd, ["--check", resolve(electronRoot, fileName)], repoRoot);
}
run(nodeCmd, [resolve(__dirname, "check-electron-bridge.mjs")], repoRoot);

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
