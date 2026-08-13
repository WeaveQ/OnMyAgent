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

test("a persisted resolving provider gate is fenced on restart and never replayed", async () => {
  const workspaceRoot = await temporaryDirectory("oma-approval-restart-workspace-");
  const userDataDir = await temporaryDirectory("oma-approval-restart-user-data-");
  const initialRuntime = createRuntime({
    autoCompletePrimary: false,
    start: async ({ input }) => {
      if (input.taskTools?.includes("propose_contract")) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { status: "completed", output: "aligned" };
      }
      return {
        status: "running",
        pendingApprovals: [{ id: "restart-approval", kind: "command", command: "pnpm test" }],
        output: "waiting",
      };
    },
  });
  const first = createTaskOrchestrator({
    userDataDir,
    personalAgentRuntime: initialRuntime,
    pollMs: 1,
    awaitAlignment: true,
  });
  let taskId;
  let waiting;
  try {
    const created = await first.createTask(taskInput(workspaceRoot, {
      contractFinalization: "model-recommended-auto",
      allowedWorkers: [],
      endConditions: { completionAuthority: "user-confirm" },
    }));
    taskId = created.task.id;
    waiting = await waitForSnapshot(first, taskId, (snapshot) => snapshot.run?.status === "waiting-approval");
  } finally {
    await first.close();
  }

  // Reconstruct the exact durable state that a crash could leave: provider
  // resolution was accepted locally, but its durable intent remains resolving.
  const persisted = createTaskOrchestratorStore({ userDataDir });
  const resolvingGate = {
    ...waiting.gates[0],
    status: "resolving",
    decision: "approve",
    decisionRequestedAt: waiting.gates[0].requestedAt + 1,
    resolvedAt: null,
  };
  const interruptedRun = structuredClone(waiting.run);
  interruptedRun.sideEffects = [{
    id: "effect_restart_unknown",
    attemptId: interruptedRun.primaryAttempts[0].id,
    turnId: interruptedRun.primaryAttempts[0].turnId,
    toolCallId: "provider-command-restart",
    operation: "Provider command",
    idempotency: "non-idempotent",
    intentHash: "a".repeat(64),
    intentAt: resolvingGate.decisionRequestedAt,
    intentSource: "pre-execute",
    receiptStatus: "unknown",
    receiptAt: null,
    resultHash: null,
  }];
  await persisted.writeRun({
    ...interruptedRun,
    // Keep the provider lease/attempt identity so the restart reconciler has
    // something to fence.  The unknown non-idempotent effect prevents the
    // optional safe-continuation path from launching a fresh provider turn.
    error: null,
    updatedAt: resolvingGate.decisionRequestedAt,
    finishedAt: resolvingGate.decisionRequestedAt,
  });
  await persisted.writeGate(resolvingGate);
  await persisted.close();

  const restartedRuntime = createRuntime({
    autoCompletePrimary: false,
    resolveApproval: async () => {
      throw new Error("a resolving provider approval must never replay after restart");
    },
  });
  const restarted = createTaskOrchestrator({
    userDataDir,
    personalAgentRuntime: restartedRuntime,
    pollMs: 1,
    awaitAlignment: true,
  });
  try {
    const blocked = await waitForSnapshot(restarted, taskId, (snapshot) => snapshot.run?.status === "blocked");
    assert.equal(restartedRuntime.startCalls.length, 0);
    assert.equal(blocked.gates[0].status, "cancelled");
    assert.equal(blocked.run.primaryAttempts[0].status, "blocked");
    assert.equal(blocked.run.primaryAttempts[0].leaseId, null);
    assert.equal(restartedRuntime.cancelCalls.filter((call) => call.runId === resolvingGate.personalRunId).length, 1);
    assert.equal(blocked.events.some((event) => event.type === "approval-resolved"), false);
    assert.equal(blocked.events.some((event) => event.type === "run-reconciled"), true);
  } finally {
    await restarted.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});
