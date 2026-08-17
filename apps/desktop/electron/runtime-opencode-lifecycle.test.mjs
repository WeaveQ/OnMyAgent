import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseProcessListRows,
  processMatchesSidecar,
} from "./runtime-opencode-lifecycle.mjs";

test("parseProcessListRows reads POSIX ps output", () => {
  const rows = parseProcessListRows("  12 /app/resources/sidecars/opencode serve\n  13 other", "linux");
  assert.deepEqual(rows, [
    { pid: 12, command: "/app/resources/sidecars/opencode serve" },
    { pid: 13, command: "other" },
  ]);
});

test("parseProcessListRows reads Windows Get-CimInstance JSON", () => {
  const rows = parseProcessListRows(
    JSON.stringify([
      { ProcessId: 4242, CommandLine: "C:\\\\app\\\\resources\\\\sidecars\\\\opencode.exe serve" },
      { ProcessId: 7, CommandLine: "notepad.exe" },
    ]),
    "win32",
  );
  assert.equal(rows[0].pid, 4242);
  assert.match(rows[0].command, /opencode\.exe serve/);
  assert.equal(rows[1].pid, 7);
});

test("parseProcessListRows accepts a single Windows process object and ignores bad JSON", () => {
  const rows = parseProcessListRows(
    JSON.stringify({ ProcessId: 99, CommandLine: "C:\\\\sidecars\\\\onmyagent-orchestrator.exe start" }),
    "win32",
  );
  assert.deepEqual(rows, [
    { pid: 99, command: "C:\\\\sidecars\\\\onmyagent-orchestrator.exe start" },
  ]);
  assert.deepEqual(parseProcessListRows("not-json", "win32"), []);
});

test("cleanupPackagedSidecars enumerates Windows processes via Get-CimInstance parse", () => {
  const src = readFileSync(new URL("./runtime-opencode-lifecycle.mjs", import.meta.url), "utf8");
  assert.match(src, /parseProcessListRows\(/);
  assert.match(src, /Get-CimInstance Win32_Process/);
});

test("processMatchesSidecar requires sidecar dir and product binary", () => {
  const dirs = ["C:\\app\\resources\\sidecars"];
  assert.equal(
    processMatchesSidecar("C:\\app\\resources\\sidecars\\opencode.exe serve", dirs),
    true,
  );
  assert.equal(
    processMatchesSidecar("C:\\app\\resources\\sidecars\\opencode serve --port 4096", dirs),
    true,
  );
  assert.equal(processMatchesSidecar("C:\\other\\opencode.exe serve", dirs), false);
  assert.equal(processMatchesSidecar("C:\\app\\resources\\sidecars\\notepad.exe", dirs), false);
});
