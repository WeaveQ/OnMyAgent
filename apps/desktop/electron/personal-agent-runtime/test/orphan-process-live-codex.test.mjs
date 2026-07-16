// Real-process end-to-end verification for the AionUi-parity orphan cleanup.
//
// This is the live half of Px-03 that was previously `blocked-external`
// (the sandbox had no `codex` binary). Now that `codex` 0.x is installed we
// can exercise the REAL cleanup primitive against a GENUINE hung codex run:
//   1. spawn the real `codex` binary as a detached process group (exactly how
//      `adapters/codex.mjs` launches it), pointed at a blackhole endpoint so it
//      hangs on the network — a faithful reproduction of the original 8-hour
//      stuck run;
//   2. register it in the real process registry (pid + pgid);
//   3. call the real `cleanupRegisteredAgentProcesses` (SIGTERM -> grace -> SIGKILL
//      on the process group);
//   4. assert the ENTIRE real codex process tree is gone from the OS and the
//      registry entry was reaped.
//
// This goes beyond the prior `sleep 60` stand-in: it proves the kill works on a
// real codex subprocess tree, not just a toy process.

import os from "node:os";
import net from "node:net";
import path from "node:path";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { createExecHelpers, isProcessTreeAlive, runId } from "../utils.mjs";
import {
  configurePersonalAgentRuntimeState,
  personalAgentRuntimeStateRoot,
} from "../runtime-state.mjs";
import {
  clearAgentProcesses,
  cleanupRegisteredAgentProcesses,
  flushAgentProcessRegistry,
  processRegistryFile,
  registerAgentProcess,
} from "../process-registry.mjs";

const { resolveExecutable } = createExecHelpers();

let runtimeRoot;
let codexBin;
let blackhole;
let blackholePort;

before(async () => {
  runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "oma-orphan-live-"));
  configurePersonalAgentRuntimeState({ runtimeStateRoot: runtimeRoot });
  clearAgentProcesses();

  codexBin = await resolveExecutable("codex");
  assert.ok(codexBin, "codex binary must be available on PATH for this live test");

  // Blackhole: accept TCP connections and never respond, so codex hangs on the
  // network read — reproducing a genuinely stuck run.
  blackhole = net.createServer((sock) => sock.on("error", () => {}));
  await new Promise((resolve) => blackhole.listen(0, "127.0.0.1", resolve));
  blackholePort = blackhole.address().port;
});

after(async () => {
  try { blackhole?.close(); } catch { /* noop */ }
  try { await rm(runtimeRoot, { recursive: true, force: true }); } catch { /* noop */ }
});

function psTreeAlive(pid) {
  // A node:child_process `spawn("ps", ...)` would itself be killed if we aimed
  // at the group, so shell out to /bin/ps and parse.
  const out = spawnSync("ps", ["-eo", "pid,pgid"], { encoding: "utf8" }).stdout || "";
  for (const line of out.split("\n").slice(1)) {
    const [p, g] = line.trim().split(/\s+/).map(Number);
    if (p === pid || g === pid) return true;
  }
  return false;
}

test("reaps a real hung codex process tree via cleanupRegisteredAgentProcesses", async (t) => {
  t.setTimeout?.(40_000);

  const codexHome = path.join(runtimeRoot, "codex-home");
  await rm(codexHome, { recursive: true, force: true });
  await import("node:fs/promises").then((fs) => fs.mkdir(codexHome, { recursive: true }));

  const child = spawn(
    codexBin,
    ["exec", "please hang forever on this bogus endpoint"],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        OPENAI_BASE_URL: `http://127.0.0.1:${blackholePort}/v1`,
        CODEX_BASE_URL: `http://127.0.0.1:${blackholePort}/v1`,
        OPENAI_API_KEY: "sk-bogus-for-smoke-test",
        CODEX_API_KEY: "sk-bogus-for-smoke-test",
      },
    },
  );
  const pid = child.pid;
  const pgid = pid; // detached -> pgid === pid

  // Wait until codex is genuinely hung on the network (not yet exited).
  let hung = false;
  for (let i = 0; i < 40; i++) {
    if (isProcessTreeAlive({ pid, pgid })) { hung = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  try {
    assert.ok(hung, "real codex run should be alive/hung before cleanup");

    const runIdValue = runId();
    registerAgentProcess({
      runId: runIdValue,
      pid,
      pgid,
      agentType: "codex",
      workspaceRoot: runtimeRoot,
      status: "running",
    });
    await flushAgentProcessRegistry();
    const fileBefore = JSON.parse(await readFile(processRegistryFile(), "utf8"));
    assert.ok(
      fileBefore.processes.some((p) => p.runId === runIdValue),
      "registry file should contain the hung codex run before cleanup",
    );

    // ACT: the real startup/exit orphan-reaper.
    const { killed } = await cleanupRegisteredAgentProcesses({ graceMs: 1_000 });
    assert.ok(killed.includes(runIdValue), "hung codex run should be reported as killed");

    // The real codex process GROUP must be gone from the OS.
    assert.equal(
      isProcessTreeAlive({ pid, pgid }),
      false,
      "codex process tree must be dead after cleanup",
    );
    assert.equal(psTreeAlive(pid), false, "no codex process should remain in the OS process table");

    // Registry file must no longer reference the reaped run.
    const fileAfter = JSON.parse(await readFile(processRegistryFile(), "utf8"));
    assert.ok(
      !fileAfter.processes.some((p) => p.runId === runIdValue),
      "registry file should drop the reaped codex run",
    );
  } finally {
    // Best-effort reaping of any leftover in case an assertion failed mid-way.
    try { process.kill(-pgid, "SIGKILL"); } catch { /* noop */ }
    try { process.kill(pid, "SIGKILL"); } catch { /* noop */ }
  }
});
