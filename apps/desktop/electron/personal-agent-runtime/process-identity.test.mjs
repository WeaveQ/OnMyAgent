import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { matchProcessStartToken, processGroupFromStartToken, readProcessStartToken } from "./process-identity.mjs";
import { terminateProcessTreeByPid } from "./utils.mjs";
import {
  cleanupRegisteredAgentProcesses,
  clearAgentProcesses,
  configureProcessRegistry,
  flushAgentProcessRegistry,
  listAgentProcesses,
  registerAgentProcess,
} from "./process-registry.mjs";

test("reads Linux starttime without being confused by spaces in comm", () => {
  const fields = ["S", ...Array.from({ length: 18 }, (_, index) => String(index + 3)), "424242", "tail"];
  const token = readProcessStartToken(123, {
    platform: "linux",
    readFileSync: (file) => file.endsWith("boot_id")
      ? "boot-identity\n"
      : `123 (provider child with spaces) ${fields.join(" ")}`,
  });
  assert.equal(token, "linux:boot-identity:424242|pgid:4");
  assert.equal(processGroupFromStartToken(token), 4);
});

test("normalizes POSIX and Windows process start identities", () => {
  const posix = readProcessStartToken(123, {
    platform: "darwin",
    execFileSync: (command, args) => {
      if (command === "sysctl") {
        assert.deepEqual(args, ["-n", "kern.bootsessionuuid"]);
        return "boot-session\n";
      }
      assert.equal(command, "ps");
      assert.deepEqual(args, ["-o", "lstart=", "-o", "pgid=", "-p", "123"]);
      return " Mon Aug 11 12:34:56 2026  321\n";
    },
  });
  assert.equal(posix, "posix:boot-session:Mon Aug 11 12:34:56 2026|pgid:321");

  const windows = readProcessStartToken(456, {
    platform: "win32",
    execFileSync: (_command, args) => {
      assert.match(args.at(-1), /Get-Process -Id 456/);
      return "638905412960000000\r\n";
    },
  });
  assert.equal(windows, "win:638905412960000000");
});

test("fails closed when a durable PID has no verifiable matching identity", () => {
  const options = { platform: "linux", readFileSync: (file) => file.endsWith("boot_id") ? "boot\n" : "123 (agent) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 999" };
  assert.deepEqual(matchProcessStartToken({ pid: 123 }), {
    matches: false,
    reason: "process_identity_missing",
    actual: null,
  });
  assert.deepEqual(matchProcessStartToken({ pid: 123, processStartToken: "linux:boot:111|pgid:2" }, options), {
    matches: false,
    reason: "process_identity_mismatch",
    actual: "linux:boot:999|pgid:2",
  });
  assert.equal(matchProcessStartToken({ pid: 123, processStartToken: "linux:boot:999|pgid:2" }, options).matches, true);
});

test("persisted PID termination rejects missing identity, pid 1, and an unbound process group", async () => {
  assert.deepEqual(await terminateProcessTreeByPid({ pid: 424_242, pgid: 424_242 }), {
    terminated: false,
    reason: "process_identity_missing",
  });
  assert.deepEqual(await terminateProcessTreeByPid({ pid: 1, processStartToken: "posix:value|pgid:2" }), {
    terminated: false,
    reason: "invalid_pid",
  });
  for (const pid of [0, -2, 1.5, process.pid]) {
    assert.equal((await terminateProcessTreeByPid({ pid, processStartToken: "posix:value|pgid:2" })).reason, "invalid_pid");
  }
  assert.deepEqual(await terminateProcessTreeByPid({
    pid: 424_242,
    pgid: 9,
    processStartToken: "linux:boot:start|pgid:8",
  }), {
    terminated: false,
    reason: "process_group_identity_mismatch",
  });
});

test("startup cleanup never signals a live PID whose durable start identity cannot be verified", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-process-identity-"));
  const registryFile = path.join(root, "processes.json");
  configureProcessRegistry({ filePath: registryFile, namespace: "identity-test" });
  try {
    registerAgentProcess({
      runId: "run-reused-pid",
      pid: 424_242,
      pgid: 424_242,
      provider: "codex",
      processStartToken: "linux:old-start",
      startedAt: 1,
    });
    await flushAgentProcessRegistry();
    let terminateCalls = 0;
    const result = await cleanupRegisteredAgentProcesses({
      isProcessTreeAlive: () => true,
      matchProcessStartToken: () => ({ matches: false, reason: "process_identity_mismatch" }),
      terminateProcessTreeByPid: async () => { terminateCalls += 1; },
    });
    assert.equal(terminateCalls, 0);
    assert.deepEqual(result, { killed: [], unverified: ["run-reused-pid"] });
    assert.equal(listAgentProcesses()[0]?.staleReason, "process_identity_mismatch");
  } finally {
    clearAgentProcesses({ persist: false });
    configureProcessRegistry({ filePath: null, namespace: "personal-agent-runtime" });
    await rm(root, { recursive: true, force: true });
  }
});

test("startup cleanup preserves a record when the strict terminator reports failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-process-termination-failure-"));
  const registryFile = path.join(root, "processes.json");
  configureProcessRegistry({ filePath: registryFile, namespace: "termination-failure-test" });
  try {
    registerAgentProcess({
      runId: "run-taskkill-failed",
      pid: 424_243,
      pgid: 424_243,
      provider: "codex",
      processStartToken: "win:638905412960000000",
      startedAt: 1,
    });
    await flushAgentProcessRegistry();
    let alive = true;
    const result = await cleanupRegisteredAgentProcesses({
      isProcessTreeAlive: () => alive,
      matchProcessStartToken: () => ({ matches: true, reason: null }),
      terminateProcessTreeByPid: async () => {
        alive = false;
        return { terminated: false, reason: "taskkill_failed" };
      },
    });
    assert.deepEqual(result, { killed: [], unverified: ["run-taskkill-failed"] });
    assert.equal(listAgentProcesses()[0]?.staleReason, "taskkill_failed");
  } finally {
    clearAgentProcesses({ persist: false });
    configureProcessRegistry({ filePath: null, namespace: "personal-agent-runtime" });
    await rm(root, { recursive: true, force: true });
  }
});
