#!/usr/bin/env node
// Windows preflight for OnMyAgent.
// Fails fast on the specific Windows-only gotchas we already know about.
//
// Modes (ONMYAGENT_WINDOWS_PREFLIGHT_MODE):
//   strict (default) — any failed check exits 1 (local first-run dogfood)
//   ci               — only required checks fail the process; optional warn-only
//                      (Docker, symlink privilege, sidecars/runtimes not yet built)
//
// Safe to run on macOS/Linux — non-Windows hosts only check constants.json.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");

const argvCi = process.argv.includes("--ci");
const modeRaw = String(process.env.ONMYAGENT_WINDOWS_PREFLIGHT_MODE || (argvCi ? "ci" : "strict"))
  .trim()
  .toLowerCase();
const mode = modeRaw === "ci" ? "ci" : "strict";

/** @type {Array<{ name: string, ok: boolean, detail: string, required: boolean }>} */
const results = [];
const record = (name, ok, detail, required = true) => {
  results.push({ name, ok: Boolean(ok), detail: detail ?? "", required: Boolean(required) });
};

const isWin = process.platform === "win32";

record(
  "platform",
  true,
  `${process.platform} ${process.arch}${isWin ? "" : " (not windows; skipping windows-specific checks)"}`,
  true,
);

if (!isWin) {
  const constantsPath = resolve(repoRoot, "constants.json");
  const constants = existsSync(constantsPath)
    ? JSON.parse(readFileSync(constantsPath, "utf8"))
    : {};
  record("constants.json", Boolean(constants.nodeVersion), constants.nodeVersion ?? "missing", true);
  print();
  process.exit(0);
}

record("preflight-mode", true, mode, true);
record("node", true, process.version, true);

const pnpm = spawnSync("pnpm.cmd", ["--version"], { encoding: "utf8", shell: true });
const pnpmOut = String(pnpm.stdout ?? pnpm.stderr ?? "").trim();
record("pnpm", pnpm.status === 0 && Boolean(pnpmOut), pnpmOut || `exit=${pnpm.status}`, true);

const constants = JSON.parse(readFileSync(resolve(repoRoot, "constants.json"), "utf8"));
record("constants.nodeVersion", Boolean(constants.nodeVersion), constants.nodeVersion ?? "missing", true);
record(
  "constants.pythonVersion",
  Boolean(constants.pythonVersion),
  constants.pythonVersion ?? "missing",
  true,
);

const homeDrive = process.env.HOMEDRIVE ?? "";
const homePath = process.env.HOMEPATH ?? "";
const home = process.env.USERPROFILE ?? homeDrive + homePath;
record("USERPROFILE", Boolean(home), home, true);

const repoDrive = repoRoot.slice(0, 2);
const homeDriveOnly = (process.env.USERPROFILE ?? "").slice(0, 2);
record(
  "repo-and-home-on-same-volume",
  repoDrive.toLowerCase() === homeDriveOnly.toLowerCase(),
  `repo=${repoDrive} home=${homeDriveOnly}`,
  // CI runners keep repo + profile on C:; local multi-volume is warn-only in ci mode.
  mode === "strict",
);

const vswhere = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
record(
  "vswhere",
  existsSync(vswhere),
  existsSync(vswhere) ? vswhere : "missing (needed for dev:windows / node-gyp)",
  // Full VS install is required for local native rebuilds; GitHub windows-2022 has it.
  mode === "strict",
);

const dockerCandidates = [
  process.env.ProgramFiles
    ? `${process.env.ProgramFiles}\\Docker\\Docker\\resources\\bin\\docker.exe`
    : null,
  process.env["ProgramFiles(x86)"]
    ? `${process.env["ProgramFiles(x86)"]}\\Docker\\Docker\\resources\\bin\\docker.exe`
    : null,
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\Programs\\Docker\\Docker\\resources\\bin\\docker.exe`
    : null,
].filter(Boolean);
const dockerFound = dockerCandidates.find((candidate) => existsSync(candidate)) ?? null;
record(
  "docker.exe",
  Boolean(dockerFound),
  dockerFound ?? "not found (Docker Desktop optional for basic dev)",
  false,
);

const symlinkTest = spawnSync(
  "cmd.exe",
  [
    "/c",
    "mklink /D " +
      os.tmpdir() +
      "\\onmyagent-symlink-test " +
      os.tmpdir() +
      " && rmdir " +
      os.tmpdir() +
      "\\onmyagent-symlink-test",
  ],
  { encoding: "utf8" },
);
record(
  "symlink-privilege",
  symlinkTest.status === 0,
  symlinkTest.status === 0
    ? "ok"
    : "developer mode disabled or non-admin; junction/copy fallback will be used",
  false,
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
const electronPresent = existsSync(electronDist);
record(
  "electron/dist present",
  electronPresent,
  electronPresent
    ? electronDist
    : "missing after install — see docs/windows-compat.md electron post-install",
  // After pnpm install on a healthy runner this should exist.
  true,
);

const runtimesRoot = resolve(repoRoot, "apps", "desktop", "resources", "runtimes");
record("runtimes root", existsSync(runtimesRoot), runtimesRoot, false);

const arch = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
const runtimeTarget = resolve(runtimesRoot, arch);
record(
  `runtimes/${arch}`,
  existsSync(runtimeTarget),
  existsSync(runtimeTarget)
    ? runtimeTarget
    : "will be produced by prepare-runtimes.mjs on first dev/build",
  false,
);

const sidecarRoot = resolve(repoRoot, "apps", "desktop", "resources", "sidecars");
record("sidecars root", existsSync(sidecarRoot), sidecarRoot, false);

const opencodeExe = resolve(sidecarRoot, "opencode.exe");
record(
  "sidecars/opencode.exe",
  existsSync(opencodeExe),
  existsSync(opencodeExe)
    ? opencodeExe
    : "will be produced by prepare-sidecar.mjs on first dev/build",
  false,
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
record(
  "node-pty prebuild",
  existsSync(nodePtyWin),
  existsSync(nodePtyWin) ? nodePtyWin : "missing win32 prebuild after install",
  // Optional in ci until install graph guarantees prebuild; still required locally for terminal.
  mode === "strict",
);

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
  // Native rebuild is a local/dev packaging concern; CI package job covers it separately.
  mode === "strict",
);

print();
const hardFailed = results.filter((r) => !r.ok && (mode === "strict" || r.required));
process.exit(hardFailed.length === 0 ? 0 : 1);

function print() {
  const width = Math.max(...results.map((r) => r.name.length), 8);
  console.log("");
  console.log("OnMyAgent Windows preflight");
  console.log("===========================");
  console.log(`mode=${mode}`);
  for (const r of results) {
    const status = r.ok ? "OK  " : r.required || mode === "strict" ? "FAIL" : "WARN";
    const req = r.required ? "req" : "opt";
    console.log(`  [${status}] (${req}) ${r.name.padEnd(width)}  ${r.detail}`);
  }
  const hardFailedNames = results
    .filter((r) => !r.ok && (mode === "strict" || r.required))
    .map((r) => r.name);
  const softFailedNames = results.filter((r) => !r.ok && !r.required && mode === "ci").map((r) => r.name);
  if (hardFailedNames.length === 0) {
    console.log(
      softFailedNames.length
        ? `\nRequired checks passed (${softFailedNames.length} optional warning(s)).`
        : "\nAll Windows preflight checks passed.",
    );
  } else {
    console.log("\nFailed checks: " + hardFailedNames.join(", "));
    console.log("See docs/windows-compat.md for remediation.");
  }
}
