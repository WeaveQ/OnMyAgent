#!/usr/bin/env node
// Windows runtime unit/smoke entry for OnMyAgent.
//
// Runs the kill-tree + open-terminal unit tests (platform-mocked so they pass
// on macOS/Linux CI hosts) and a static self-check of the Windows launch plan.
// Safe to run on any host:
//
//   node scripts/dev/windows-runtime-test.mjs
//   pnpm --filter @onmyagent/desktop test:windows-runtime
//
// On a real Windows machine this is the companion to windows-preflight.mjs.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");
const desktopRoot = resolve(repoRoot, "apps", "desktop");

/** Windows ESM requires file:// URLs for absolute path dynamic imports. */
function importFromPath(absPath) {
  return import(pathToFileURL(absPath).href);
}

const testFiles = [
  resolve(desktopRoot, "electron/personal-agent-runtime/utils.test.mjs"),
  resolve(desktopRoot, "electron/code-workspace-actions.test.mjs"),
];

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
};

function printSummary() {
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`windows-runtime-test: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
  }
  return failed.length === 0;
}

// --- static imports / pure helpers (no real win32 spawn required) ---
async function runStaticChecks() {
  const { resolveProcessTreeKillPlan } = await importFromPath(
    resolve(desktopRoot, "electron/personal-agent-runtime/utils.mjs"),
  );
  const { resolveWindowsTerminalLaunch } = await importFromPath(
    resolve(desktopRoot, "electron/code-workspace-actions.mjs"),
  );

  const killPlan = resolveProcessTreeKillPlan({ platform: "win32", pid: 1234, force: true });
  record(
    "kill-plan taskkill /T /F",
    killPlan.kind === "taskkill"
      && killPlan.args.includes("/T")
      && killPlan.args.includes("/F")
      && killPlan.args.includes("1234"),
    JSON.stringify(killPlan),
  );

  const posixPlan = resolveProcessTreeKillPlan({ platform: "darwin", pid: 55 });
  record(
    "kill-plan posix group signals",
    posixPlan.kind === "posix-group" && posixPlan.signals?.includes("SIGTERM"),
    JSON.stringify(posixPlan),
  );

  const wt = resolveWindowsTerminalLaunch("C:\\Users\\demo\\ws", {
    hasCommand: (n) => n === "wt.exe" || n === "wt",
  });
  record(
    "terminal cascade prefers wt.exe -d",
    wt.strategy === "wt" && wt.command === "wt.exe" && wt.args[0] === "-d",
    JSON.stringify(wt),
  );

  const ps = resolveWindowsTerminalLaunch("C:\\Users\\demo\\ws", {
    hasCommand: (n) => n === "powershell.exe" || n === "powershell",
  });
  record(
    "terminal cascade falls back to PowerShell",
    ps.strategy === "powershell" && String(ps.args.join(" ")).includes("Set-Location"),
    JSON.stringify(ps),
  );

  const cmd = resolveWindowsTerminalLaunch("C:\\Users\\demo\\ws", { hasCommand: () => false });
  record(
    "terminal cascade falls back to cmd /K (not start \"\")",
    cmd.strategy === "cmd"
      && cmd.command === "cmd.exe"
      && cmd.args[0] === "/K"
      && !cmd.args.includes("start"),
    JSON.stringify(cmd),
  );

  // Adapter source audit: cancel/cleanup paths should import terminateProcessTree
  // and not define a private waitForExit that bare-kills.
  const adapterFiles = [
    "electron/personal-agent-runtime/adapters/claude.mjs",
    "electron/personal-agent-runtime/adapters/codex.mjs",
    "electron/personal-agent-runtime/adapters/hermes.mjs",
    "electron/personal-agent-runtime/adapters/openclaw.mjs",
    "electron/personal-agent-runtime/adapters/acp-generic.mjs",
    "electron/personal-agent-runtime/legacy-harness.mjs",
  ];
  const { readFileSync } = await import("node:fs");
  for (const rel of adapterFiles) {
    const abs = resolve(desktopRoot, rel);
    if (!existsSync(abs)) {
      record(`source:${rel}`, false, "missing");
      continue;
    }
    const src = readFileSync(abs, "utf8");
    const importsTreeKill = /terminateProcessTree/.test(src);
    const localBareWaitForExit =
      /function waitForExit\s*\([^)]*\)\s*\{[\s\S]*?child\.kill\(/.test(src);
    record(
      `source:${rel}`,
      importsTreeKill && !localBareWaitForExit,
      importsTreeKill
        ? localBareWaitForExit
          ? "still has local waitForExit bare kill"
          : "uses shared terminateProcessTree"
        : "missing terminateProcessTree import/use",
    );
  }

  // Path contracts: Windows launch helpers must stay drive-letter / backslash safe.
  const { join: winJoin, normalize: winNormalize, isAbsolute: winAbs } = await import(
    "node:path"
  ).then((m) => m.win32);
  const joined = winJoin("C:\\Users\\demo", "ws", "file.txt");
  record(
    "path.win32 join keeps drive + separators",
    winAbs(joined) && joined.includes("C:") && joined.includes("file.txt"),
    joined,
  );
  const mixed = winNormalize("C:/Users/demo/../demo\\ws");
  record(
    "path.win32 normalize collapses mixed slashes",
    mixed.toLowerCase() === "c:\\users\\demo\\ws",
    mixed,
  );
}

function runUnitTests() {
  for (const file of testFiles) {
    if (!existsSync(file)) {
      record(`unit:${file}`, false, "missing test file");
      continue;
    }
    const result = spawnSync(process.execPath, ["--test", file], {
      cwd: desktopRoot,
      encoding: "utf8",
      env: process.env,
    });
    const ok = result.status === 0;
    const tail = (result.stdout || result.stderr || "").trim().split(/\r?\n/).slice(-8).join(" | ");
    record(`unit:${file.replace(repoRoot + "/", "")}`, ok, tail || `exit=${result.status}`);
    if (!ok && result.stdout) console.log(result.stdout);
    if (!ok && result.stderr) console.error(result.stderr);
  }
}

const logDir = process.env.ONMYAGENT_WINDOWS_TEST_LOG_DIR
  ? resolve(process.env.ONMYAGENT_WINDOWS_TEST_LOG_DIR)
  : null;

async function main() {
  console.log(`windows-runtime-test host=${process.platform} arch=${process.arch} node=${process.version}`);
  console.log(`repoRoot=${repoRoot}`);
  console.log("");

  await runStaticChecks();
  console.log("");
  runUnitTests();

  const ok = printSummary();

  if (logDir) {
    mkdirSync(logDir, { recursive: true });
    const logPath = resolve(logDir, "windows-runtime-test.json");
    writeFileSync(
      logPath,
      JSON.stringify(
        {
          ok,
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          results,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`wrote ${logPath}`);
  }

  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
