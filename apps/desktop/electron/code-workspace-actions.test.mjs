import assert from "node:assert/strict";
import test from "node:test";

import {
  quoteWindowsCmdArg,
  quoteWindowsPowerShellLiteral,
  resolveWindowsTerminalLaunch,
} from "./code-workspace-actions.mjs";

test("resolveWindowsTerminalLaunch prefers Windows Terminal (wt.exe -d)", () => {
  const workspace = "C:\\Users\\demo\\project";
  const launch = resolveWindowsTerminalLaunch(workspace, {
    hasCommand: (name) => name === "wt.exe" || name === "wt",
  });
  assert.equal(launch.strategy, "wt");
  assert.equal(launch.command, "wt.exe");
  assert.deepEqual(launch.args, ["-d", workspace]);
  assert.ok(!launch.args.includes("start"), "must not use start \"\" explorer association");
});

test("resolveWindowsTerminalLaunch falls back to PowerShell Set-Location", () => {
  const workspace = "C:\\Users\\demo\\My Project";
  const launch = resolveWindowsTerminalLaunch(workspace, {
    hasCommand: (name) => name === "powershell.exe" || name === "powershell",
  });
  assert.equal(launch.strategy, "powershell");
  assert.equal(launch.command, "powershell.exe");
  assert.equal(launch.args[0], "-NoExit");
  assert.equal(launch.args[1], "-Command");
  assert.match(launch.args[2], /^Set-Location -LiteralPath '/);
  assert.match(launch.args[2], /My Project/);
  assert.ok(!launch.args.includes("start"));
});

test("resolveWindowsTerminalLaunch falls back to cmd /K cd /D", () => {
  const workspace = "D:\\work\\repo";
  const launch = resolveWindowsTerminalLaunch(workspace, {
    hasCommand: () => false,
  });
  assert.equal(launch.strategy, "cmd");
  assert.equal(launch.command, "cmd.exe");
  assert.equal(launch.args[0], "/K");
  assert.equal(launch.args[1], `cd /D ${workspace}`);
  // Must never use the Explorer file-association form:
  // cmd /c start "" <path>
  assert.notEqual(launch.args[0], "/c");
  assert.ok(!launch.args.includes("start"));
  assert.ok(!launch.args.includes(""));
});

test("resolveWindowsTerminalLaunch cascade order: wt before powershell before cmd", () => {
  const workspace = "C:\\ws";
  const seen = [];
  resolveWindowsTerminalLaunch(workspace, {
    hasCommand: (name) => {
      seen.push(name);
      return false;
    },
  });
  // First probes wt, then powershell, then falls to cmd without probing cmd as optional.
  assert.ok(seen.includes("wt.exe") || seen.includes("wt"));
  assert.ok(seen.includes("powershell.exe") || seen.includes("powershell"));
  const wtIndex = Math.min(
    ...["wt.exe", "wt"].map((n) => (seen.indexOf(n) >= 0 ? seen.indexOf(n) : Number.POSITIVE_INFINITY)),
  );
  const psIndex = Math.min(
    ...["powershell.exe", "powershell"].map((n) => (seen.indexOf(n) >= 0 ? seen.indexOf(n) : Number.POSITIVE_INFINITY)),
  );
  assert.ok(wtIndex < psIndex, "wt must be probed before powershell");
});

test("quoteWindowsCmdArg wraps paths with spaces", () => {
  assert.equal(quoteWindowsCmdArg("C:\\plain"), "C:\\plain");
  assert.equal(quoteWindowsCmdArg("C:\\with space"), '"C:\\with space"');
});

test("quoteWindowsPowerShellLiteral doubles single quotes", () => {
  assert.equal(quoteWindowsPowerShellLiteral("C:\\ok"), "'C:\\ok'");
  assert.equal(quoteWindowsPowerShellLiteral("C:\\o'brien"), "'C:\\o''brien'");
});
