#!/usr/bin/env node
// Windows preflight for OnMyAgent.
// Fails fast on the specific Windows-only gotchas we already know about.
// Safe to run on macOS/Linux too — it will just skip Windows checks.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail: detail ?? "" });
};

const isWin = process.platform === "win32";

record("platform", true, `${process.platform} ${process.arch}${isWin ? "" : " (not windows; skipping windows-specific checks)"}`);
if (!isWin) {
  const constantsPath = resolve(repoRoot, "constants.json");
  const constants = existsSync(constantsPath)
    ? JSON.parse(readFileSync(constantsPath, "utf8"))
    : {};
  record("constants.json", Boolean(constants.nodeVersion), constants.nodeVersion ?? "missing");
  print();
  process.exit(0);
}

record("node", true, process.version);
const pnpm = spawnSync("pnpm.cmd", ["--version"], { encoding: "utf8" });
record("pnpm", pnpm.status === 0, (pnpm.stdout || pnpm.stderr).trim());

const constants = JSON.parse(readFileSync(resolve(repoRoot, "constants.json"), "utf8"));
record("constants.nodeVersion", Boolean(constants.nodeVersion), constants.nodeVersion ?? "missing");
record("constants.pythonVersion", Boolean(constants.pythonVersion), constants.pythonVersion ?? "missing");

const homeDrive = process.env.HOMEDRIVE ?? "";
const homePath = process.env.HOMEPATH ?? "";
const home = process.env.USERPROFILE ?? (homeDrive + homePath);
record("USERPROFILE", Boolean(home), home);

const repoDrive = repoRoot.slice(0, 2);
const homeDriveOnly = (process.env.USERPROFILE ?? "").slice(0, 2);
record(
  "repo-and-home-on-same-volume",
  repoDrive.toLowerCase() === homeDriveOnly.toLowerCase(),
  `repo=${repoDrive} home=${homeDriveOnly}`,
);

const vswhere = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
record("vswhere", existsSync(vswhere), vswhere);

const dockerCandidates = [
  process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Docker\\Docker\\resources\\bin\\docker.exe` : null,
  process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\Docker\\Docker\\resources\\bin\\docker.exe` : null,
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\Docker\\Docker\\resources\\bin\\docker.exe` : null,
].filter(Boolean);
const dockerFound = dockerCandidates.find((candidate) => existsSync(candidate)) ?? null;
record("docker.exe", Boolean(dockerFound), dockerFound ?? "not found (Docker Desktop optional for basic dev)");

const symlinkTest = spawnSync("cmd.exe", [
  "/c",
  "mklink /D " + os.tmpdir() + "\\onmyagent-symlink-test " + os.tmpdir() + " && rmdir " + os.tmpdir() + "\\onmyagent-symlink-test",
], { encoding: "utf8" });
record(
  "symlink-privilege",
  symlinkTest.status === 0,
  symlinkTest.status === 0
    ? "ok"
    : "developer mode disabled or non-admin; junction fallback will be used",
);

const electronDist = resolve(
  repoRoot,
  "node_modules",
  ".pnpm",
  "electron@39.8.10",
  "node_modules",
  "electron",
  "dist",
);
record("electron/dist present", existsSync(electronDist), electronDist);

const runtimesRoot = resolve(repoRoot, "apps", "desktop", "resources", "runtimes");
record("runtimes root", existsSync(runtimesRoot), runtimesRoot);

const arch = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
const runtimeTarget = resolve(runtimesRoot, arch);
record(
  `runtimes/${arch}`,
  existsSync(runtimeTarget),
  existsSync(runtimeTarget) ? runtimeTarget : "will be produced by prepare-runtimes.mjs on first dev/build",
);

const sidecarRoot = resolve(repoRoot, "apps", "desktop", "resources", "sidecars");
record("sidecars root", existsSync(sidecarRoot), sidecarRoot);

const opencodeExe = resolve(sidecarRoot, "opencode.exe");
record(
  "sidecars/opencode.exe",
  existsSync(opencodeExe),
  existsSync(opencodeExe) ? opencodeExe : "will be produced by prepare-sidecar.mjs on first dev/build",
);

const nodePtyWin = resolve(
  repoRoot,
  "node_modules",
  ".pnpm",
  "node-pty@1.1.0",
  "node_modules",
  "node-pty",
  "prebuilds",
  process.arch === "arm64" ? "win32-arm64" : "win32-x64",
);
record("node-pty prebuild", existsSync(nodePtyWin), nodePtyWin);

const betterSqliteWin = resolve(
  repoRoot,
  "node_modules",
  ".pnpm",
  "better-sqlite3@11.10.0",
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node",
);
record(
  "better-sqlite3 binding",
  existsSync(betterSqliteWin),
  existsSync(betterSqliteWin)
    ? betterSqliteWin
    : "will need @electron/rebuild after pnpm install (see BUILD.md)",
);

print();
const failed = results.filter((r) => !r.ok);
process.exit(failed.length === 0 ? 0 : 1);

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  console.log("");
  console.log("OnMyAgent Windows preflight");
  console.log("===========================");
  for (const r of results) {
    const status = r.ok ? "OK  " : "FAIL";
    console.log(`  [${status}] ${r.name.padEnd(width)}  ${r.detail}`);
  }
  const failedNames = results.filter((r) => !r.ok).map((r) => r.name);
  if (failedNames.length === 0) {
    console.log("\nAll Windows preflight checks passed.");
  } else {
    console.log("\nFailed checks: " + failedNames.join(", "));
    console.log("See docs/windows-compat.md for remediation.");
  }
}
