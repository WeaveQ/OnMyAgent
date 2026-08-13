import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { createPersonalAgentRuntime } from "./index.mjs";
import { clearAgentProcesses, flushAgentProcessRegistry, getAgentProcess } from "./process-registry.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";

const roots = [];

afterEach(async () => {
  clearAgentProcesses({ persist: false });
  await flushAgentProcessRegistry().catch(() => undefined);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function createHarness({ cancel, emitPid = true, timeoutMs = 25, registerHandler = true, directCancel = null, terminationResult = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "personal-cancel-escalation-"));
  roots.push(root);
  configurePersonalAgentRuntimeState({ runtimeStateRoot: path.join(root, "runtime-state") });
  const sendGate = deferred();
  const terminated = [];
  let processAlive = emitPid;
  const legacy = {
    normalizeAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [] }),
    detectAgent: async () => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", customArgs: [], status: "online" }),
    listAgents: async () => ({ agents: [] }),
    start: async () => ({ status: "legacy-start" }),
    run: async () => ({ status: "legacy-run" }),
    status: () => ({ status: "missing" }),
    cancel: async () => ({ ok: false }),
  };
  const runtime = createPersonalAgentRuntime({
    legacy,
    cancelHandlerTimeoutMs: timeoutMs,
    cancelEscalationTimeoutMs: timeoutMs,
    cancelEscalationGraceMs: 1,
    isProcessTreeAlive: () => processAlive,
    terminateProcessTreeByPid: async (record) => {
      terminated.push(record);
      processAlive = false;
      return terminationResult ?? { terminated: true, reason: null };
    },
    adapters: {
      codex: ({ appendEvent, registerCancel }) => {
        if (registerHandler) registerCancel(cancel);
        return {
          sendMessage: async () => {
            if (emitPid) appendEvent({ type: "log", text: "pid 424242" });
            await sendGate.promise;
            return { output: "late provider result", command: "fake-codex" };
          },
          ...(directCancel ? { cancel: directCancel } : {}),
        };
      },
    },
  });
  const operationId = "cancel-escalation";
  const started = await runtime.startMessage({ operationId, workspaceRoot: root, prompt: "long run", agent: { provider: "codex" } });
  const drain = async () => {
    const deadline = Date.now() + 2_000;
    while (["pending", "cancelling"].includes(runtime.getTaskOperation({ operationId })?.status)) {
      if (Date.now() >= deadline) throw new Error("cancelled provider turn did not drain");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  return { root, runtime, started, sendGate, drain, terminated, setAlive: (value) => { processAlive = value; } };
}

describe("Personal runtime cancellation escalation", () => {
  it("escalates a rejected adapter cancel through the registered process and finalizes", async () => {
    const harness = await createHarness({ cancel: async () => { throw new Error("provider cancel rejected"); } });
    const result = await harness.runtime.cancelRun(harness.started.runId, { reason: "user" });
    assert.equal(result.ok, true);
    assert.equal(harness.terminated.length, 1);
    assert.equal(harness.terminated[0].pid, 424242);
    const terminal = harness.runtime.getRun({ runId: harness.started.runId, workspaceRoot: harness.root });
    assert.equal(terminal.status, "cancelled");
    assert.match(terminal.error ?? "", /escalation/i);
    assert.equal(getAgentProcess(harness.started.runId), null);
    harness.sendGate.resolve();
    await harness.drain();
  });

  it("uses the adapter cancel path when no active handler is registered", async () => {
    const harness = await createHarness({
      registerHandler: false,
      cancel: null,
      directCancel: async () => { throw new Error("adapter cancel rejected"); },
    });
    const result = await harness.runtime.cancelRun(harness.started.runId);
    assert.equal(result.ok, true);
    assert.equal(harness.terminated.length, 1);
    assert.equal(harness.runtime.getRun({ runId: harness.started.runId, workspaceRoot: harness.root }).status, "cancelled");
    harness.sendGate.resolve();
    await harness.drain();
  });

  it("bounds a hanging adapter cancel before escalating", async () => {
    const harness = await createHarness({ cancel: () => new Promise(() => undefined), timeoutMs: 15 });
    const startedAt = Date.now();
    const result = await harness.runtime.cancelRun(harness.started.runId, { reason: "timeout" });
    assert.equal(result.ok, true);
    assert.ok(Date.now() - startedAt < 500, "cancel escalation must remain bounded");
    assert.equal(harness.terminated.length, 1);
    const terminal = harness.runtime.getRun({ runId: harness.started.runId, workspaceRoot: harness.root });
    assert.equal(terminal.status, "failed");
    assert.equal(terminal.errorInfo?.code, "timeout");
    assert.match(terminal.error ?? "", /escalation/i);
    harness.sendGate.resolve();
    await harness.drain();
  });

  it("does not claim cancellation when rejection has no validated PID", async () => {
    const harness = await createHarness({ cancel: async () => { throw new Error("provider cancel rejected"); }, emitPid: false });
    const result = await harness.runtime.cancelRun(harness.started.runId, { reason: "user" });
    assert.equal(result.ok, false);
    assert.equal(harness.terminated.length, 0);
    const terminal = harness.runtime.getRun({ runId: harness.started.runId, workspaceRoot: harness.root });
    assert.equal(terminal.status, "failed");
    assert.equal(terminal.errorInfo?.code, "cancel_escalation_failed");
    assert.match(terminal.error ?? "", /not.*confirm|rejected/i);
    harness.sendGate.resolve();
    await harness.drain();
  });

  it("does not claim cancellation when process-tree termination reports failure", async () => {
    const harness = await createHarness({
      cancel: async () => { throw new Error("provider cancel rejected"); },
      terminationResult: { terminated: false, reason: "taskkill_failed" },
    });
    const result = await harness.runtime.cancelRun(harness.started.runId, { reason: "user" });
    assert.equal(result.ok, false);
    assert.equal(harness.terminated.length, 1);
    assert.equal(harness.runtime.getRun({ runId: harness.started.runId, workspaceRoot: harness.root }).errorInfo?.code, "cancel_escalation_failed");
    assert.ok(getAgentProcess(harness.started.runId), "failed termination must keep the durable process record");
    harness.sendGate.resolve();
    await harness.drain();
  });

  it("ignores a late provider result after cancellation is terminal", async () => {
    const harness = await createHarness({ cancel: async () => { throw new Error("provider cancel rejected"); } });
    const result = await harness.runtime.cancelRun(harness.started.runId);
    assert.equal(result.ok, true);
    harness.sendGate.resolve();
    await harness.drain();
    const terminal = harness.runtime.getRun({ runId: harness.started.runId, workspaceRoot: harness.root });
    assert.equal(terminal.status, "cancelled");
    assert.doesNotMatch(terminal.output ?? "", /late provider result/);
  });
});
