import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  excludeCurrentPid,
  parseTasklistCsvPids,
  raceTimeout,
  terminateOtherOnMyAgentProcesses,
} from "./updater-prepare-install.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("parseTasklistCsvPids reads OnMyAgent.exe rows and ignores noise", () => {
  const stdout = [
    '"OnMyAgent.exe","25924","Console","1","12,345 K"',
    '"OnMyAgent.exe","100","Services","0","1,024 K"',
    "INFO: No tasks are running which match the specified criteria.",
    '"notepad.exe","88","Console","1","1 K"',
  ].join("\n");
  assert.deepEqual(parseTasklistCsvPids(stdout), [25924, 100]);
});

test("raceTimeout resolves when the work hangs past the deadline", async () => {
  const started = Date.now();
  await raceTimeout(new Promise(() => {}), 20);
  assert.ok(Date.now() - started < 500);
});

test("excludeCurrentPid never returns the installing process", () => {
  assert.deepEqual(excludeCurrentPid([10, 20, 30], 20), [10, 30]);
  assert.deepEqual(excludeCurrentPid([20], 20), []);
});

test("terminateOtherOnMyAgentProcesses is a no-op off Windows", async () => {
  const calls = [];
  const result = await terminateOtherOnMyAgentProcesses({
    platform: "darwin",
    execFileFn: async (...args) => {
      calls.push(args);
      return { stdout: "" };
    },
  });
  assert.deepEqual(result, { killed: [], skipped: true });
  assert.deepEqual(calls, []);
});

test("terminateOtherOnMyAgentProcesses taskkills sibling OnMyAgent.exe only", async () => {
  const calls = [];
  const result = await terminateOtherOnMyAgentProcesses({
    platform: "win32",
    currentPid: 111,
    execFileFn: async (command, args) => {
      calls.push([command, args]);
      if (command === "tasklist") {
        return {
          stdout: [
            '"OnMyAgent.exe","111","Console","1","40,000 K"',
            '"OnMyAgent.exe","25924","Console","1","12,345 K"',
          ].join("\r\n"),
        };
      }
      return { stdout: "" };
    },
  });
  assert.deepEqual(result.killed, [25924]);
  assert.equal(calls[0][0], "tasklist");
  assert.deepEqual(calls[1], ["taskkill", ["/PID", "25924", "/T", "/F"]]);
  assert.equal(calls.length, 2);
});

test("NSIS installer force-closes leftover OnMyAgent.exe before old-uninstaller", async () => {
  const nsh = await readFile(path.join(here, "..", "build", "installer.nsh"), "utf8");
  assert.match(nsh, /!macro customInit/);
  assert.match(nsh, /taskkill\.exe" \/F \/IM OnMyAgent\.exe \/T/);
});

test("installAndRestart awaits prepareForUpdateInstall before quitAndInstall", async () => {
  const source = await readFile(path.join(here, "updater.mjs"), "utf8");
  const prepare = source.indexOf("await prepareForUpdateInstall()");
  const mark = source.indexOf("quitForUpdateRequested = true");
  const install = source.indexOf("autoUpdater.quitAndInstall(false, true)");
  assert.ok(prepare >= 0 && mark > prepare && install > mark);
});
