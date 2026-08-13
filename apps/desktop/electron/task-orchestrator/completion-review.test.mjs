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

function completingRuntime(overrides = {}) {
  return createRuntime({
    ...overrides,
    start: async (context) => {
      if (context.input.taskControlPlane?.propose_contract) {
        await context.input.taskControlPlane.propose_contract({ contract: contract() });
      }
      return overrides.start?.(context) ?? { status: "completed", output: "Completed." };
    },
  });
}

function userConfirmedTask(workspaceRoot, overrides = {}) {
  return taskInput(workspaceRoot, {
    allowedWorkers: [],
    contractFinalization: "model-recommended-auto",
    permissionMode: "full-allow",
    ...overrides,
    endConditions: { completionAuthority: "user-confirm", ...(overrides.endConditions ?? {}) },
  });
}

test("user-confirm completion survives supervisor restart and succeeds only after explicit review", async () => {
  const workspaceRoot = await temporaryDirectory("oma-review-workspace-");
  const userDataDir = await temporaryDirectory("oma-review-user-data-");
  const firstRuntime = completingRuntime();
  const first = createTaskOrchestrator({ userDataDir, personalAgentRuntime: firstRuntime, pollMs: 1, awaitAlignment: true });
  let taskId;
  try {
    const created = await first.createTask(userConfirmedTask(workspaceRoot));
    taskId = created.task.id;
    const waiting = await waitForSnapshot(first, taskId, (snapshot) => snapshot.run?.status === "waiting-approval");
    assert.equal(waiting.run.primaryAttempts.at(-1)?.status, "succeeded");
    assert.equal(waiting.gates.length, 1);
    assert.equal(waiting.gates[0].kind, "manual-review");
    assert.equal(waiting.gates[0].status, "pending");
  } finally {
    await first.close();
  }

  const restartedRuntime = createRuntime({ autoCompletePrimary: false });
  const restarted = createTaskOrchestrator({ userDataDir, personalAgentRuntime: restartedRuntime, pollMs: 1, awaitAlignment: true });
  try {
    const restored = await restarted.getTask({ taskId });
    assert.equal(restored.run.status, "waiting-approval");
    assert.equal(restored.gates[0].status, "pending");
    assert.equal(restartedRuntime.startCalls.length, 0);
    const approved = await restarted.resolveGate({ taskRunId: restored.run.id, gateId: restored.gates[0].id, decision: "approve" });
    assert.equal(approved.run.status, "succeeded");
    assert.equal(approved.gates[0].status, "approved");
    assert.equal(approved.events.some((event) => event.type === "run-succeeded"), true);
  } finally {
    await restarted.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});

test("rejected completion becomes a bounded fresh-primary retry and asks for review again", async () => {
  const workspaceRoot = await temporaryDirectory("oma-review-retry-workspace-");
  const userDataDir = await temporaryDirectory("oma-review-retry-user-data-");
  const runtime = completingRuntime();
  const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
  try {
    const created = await orchestrator.createTask(userConfirmedTask(workspaceRoot));
    const firstReview = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "waiting-approval");
    const firstAttemptId = firstReview.run.primaryAttempts.at(-1).id;
    const rejected = await orchestrator.resolveGate({
      taskRunId: firstReview.run.id,
      gateId: firstReview.gates[0].id,
      decision: "reject",
    });
    assert.equal(rejected.run.status, "blocked");
    assert.match(rejected.run.error, /Completion review rejected/);

    await orchestrator.retryPrimary({ taskRunId: rejected.run.id, attemptId: firstAttemptId });
    const secondReview = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => (
      snapshot.run?.status === "waiting-approval" && snapshot.run.primaryAttempts.length === 2
    ));
    assert.equal(secondReview.run.primaryAttempts[0].status, "succeeded");
    assert.equal(secondReview.run.primaryAttempts[1].status, "succeeded");
    assert.deepEqual(secondReview.gates.map((gate) => gate.status), ["rejected", "pending"]);
  } finally {
    await orchestrator.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});

test("manual review crossing its frozen TTL is fenced inside resolveGate before rejection", async () => {
  const workspaceRoot = await temporaryDirectory("oma-review-boundary-workspace-");
  const userDataDir = await temporaryDirectory("oma-review-boundary-user-data-");
  const store = createTaskOrchestratorStore({ userDataDir });
  let logicalNow = 100;
  let resolvingReads = 0;
  let resolvingWritten = false;
  const originalWriteGate = store.writeGate.bind(store);
  const originalReadGates = store.readGates.bind(store);
  store.writeGate = async (gate) => {
    const result = await originalWriteGate(gate);
    if (gate.status === "resolving") resolvingWritten = true;
    return result;
  };
  store.readGates = async (...args) => {
    const result = await originalReadGates(...args);
    if (resolvingWritten && result.some((gate) => gate.status === "resolving")) {
      resolvingReads += 1;
      // The first read belongs to the post-write expiry sweep.  Advance only
      // before the second read (the manual branch's final validation) so the
      // segmented clock proves the exact sweep -> now crossing.
      if (resolvingReads === 2) logicalNow = 300;
    }
    return result;
  };
  const orchestrator = createTaskOrchestrator({
    store,
    userDataDir,
    personalAgentRuntime: completingRuntime(),
    now: () => logicalNow,
    approvalExpirySweepMs: 60_000,
    pollMs: 1,
    awaitAlignment: true,
  });
  try {
    const created = await orchestrator.createTask(userConfirmedTask(workspaceRoot, {
      endConditions: { deadlineAt: 200, maxElapsedMs: null },
    }));
    const waiting = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "waiting-approval");
    await assert.rejects(
      orchestrator.resolveGate({ taskRunId: waiting.run.id, gateId: waiting.gates[0].id, decision: "approve" }),
      /expired|stale/i,
    );
    const blocked = await orchestrator.getTask({ taskId: created.task.id });
    assert.equal(blocked.run.status, "blocked");
    assert.equal(blocked.gates[0].status, "cancelled");
    // The completed primary result remains immutable; only the run/gate
    // decision boundary is fenced.
    assert.equal(blocked.run.primaryAttempts[0].status, "succeeded");
    assert.equal(blocked.events.some((event) => event.type === "approval-expired"), true);
    assert.equal(blocked.events.some((event) => event.type === "approval-resolved"), false);
  } finally {
    await orchestrator.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});
