import assert from "node:assert/strict";
import test from "node:test";

import { createTaskOrchestrator } from "./index.mjs";
import { createTaskOrchestratorStore } from "./store-factory.mjs";
import {
  cleanupDirectories,
  contract,
  createRuntime,
  taskInput,
  temporaryDirectory,
  waitForSnapshot,
} from "./v2-test-helpers.mjs";

test("approval expiry sweep is single-flight and close drains an in-flight sweep", async () => {
  const workspaceRoot = await temporaryDirectory("oma-approval-timer-workspace-");
  const userDataDir = await temporaryDirectory("oma-approval-timer-user-");
  const store = createTaskOrchestratorStore({ userDataDir });
  const originalAllRuns = store.allRuns.bind(store);
  let holdSweep = false;
  let sweepStarted;
  const sweepReady = new Promise((resolve) => { sweepStarted = resolve; });
  let releaseSweep;
  const sweepRelease = new Promise((resolve) => { releaseSweep = resolve; });
  store.allRuns = async (...args) => {
    if (holdSweep) {
      holdSweep = false;
      sweepStarted();
      await sweepRelease;
    }
    return originalAllRuns(...args);
  };
  const orchestrator = createTaskOrchestrator({
    store,
    userDataDir,
    personalAgentRuntime: createRuntime(),
    approvalExpirySweepMs: 1,
    pollMs: 1,
    awaitAlignment: true,
  });
  try {
    await orchestrator.createTask(taskInput(workspaceRoot, { allowedWorkers: [] }));
    holdSweep = true;
    await sweepReady;
    let closed = false;
    const closing = orchestrator.close().then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(closed, false);
    releaseSweep();
    await closing;
    assert.equal(closed, true);
  } finally {
    releaseSweep?.();
    await orchestrator.close().catch(() => undefined);
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});

test("periodic expiry sweep fences a no-click manual review", async () => {
  const workspaceRoot = await temporaryDirectory("oma-approval-periodic-workspace-");
  const userDataDir = await temporaryDirectory("oma-approval-periodic-user-data-");
  let clock = Date.now();
  const runtime = createRuntime({
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
      }
      return { status: "completed", output: "Completed." };
    },
  });
  const orchestrator = createTaskOrchestrator({
    userDataDir,
    personalAgentRuntime: runtime,
    approvalExpirySweepMs: 5,
    pollMs: 1,
    now: () => clock,
    awaitAlignment: true,
  });
  try {
    const created = await orchestrator.createTask(taskInput(workspaceRoot, {
      allowedWorkers: [],
      contractFinalization: "model-recommended-auto",
      permissionMode: "full-allow",
      endConditions: {
        completionAuthority: "user-confirm",
        deadlineAt: clock + 60_000,
        maxElapsedMs: null,
      },
    }));
    const waiting = await waitForSnapshot(
      orchestrator,
      created.task.id,
      (snapshot) => snapshot.run?.status === "waiting-approval" && snapshot.gates.some((gate) => gate.kind === "manual-review"),
      5_000,
    );
    assert.equal(waiting.gates.find((gate) => gate.kind === "manual-review")?.status, "pending");
    clock += 60_001;
    const blocked = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "blocked", 5_000);
    assert.equal(blocked.gates.length, 1);
    assert.equal(blocked.gates[0].kind, "manual-review");
    assert.equal(blocked.gates[0].status, "cancelled");
    assert.equal(blocked.events.some((event) => event.type === "approval-expired"), true);
    assert.equal(blocked.events.some((event) => event.type === "approval-resolved"), false);
  } finally {
    await orchestrator.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});
