import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createTaskOrchestrator } from "./index.mjs";
import { createAttempt, defaultId } from "./definitions.mjs";
import { createTaskOrchestratorStore } from "./store-factory.mjs";
import {
  cleanupDirectories,
  contract,
  createRuntime,
  taskInput,
  temporaryDirectory,
  waitForSnapshot,
} from "./v2-test-helpers.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await cleanupDirectories(temporaryDirectories.splice(0));
});

async function createAutoTask(orchestrator, workspaceRoot, overrides = {}) {
  return orchestrator.createTask(taskInput(workspaceRoot, {
    contractFinalization: "model-recommended-auto",
    allowedWorkers: [],
    ...overrides,
  }));
}

describe("Task Center structured completion kernel", () => {
  it("blocks a new run when the provider exits without a durable primary decision", async () => {
    const userDataDir = await temporaryDirectory("task-decision-missing-user-");
    const workspaceRoot = await temporaryDirectory("task-decision-missing-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        return { output: "Provider prose claimed completion without a decision." };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await createAutoTask(orchestrator, workspaceRoot);
      const blocked = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "blocked");
      assert.equal(blocked.run.definition.executionProtocol, "structured-decisions-v1");
      assert.equal(blocked.run.primaryDecisions.length, 0);
      assert.equal(blocked.run.primaryAttempts[0].status, "blocked");
      assert.match(blocked.run.error, /completed without a durable task decision/);
      assert.equal(blocked.artifacts.some((artifact) => /claimed completion/.test(artifact.content)), true);
    } finally {
      await orchestrator.close();
    }
  });

  it("rejects incomplete acceptance reports and succeeds only after exact structured completion", async () => {
    const userDataDir = await temporaryDirectory("task-decision-complete-user-");
    const workspaceRoot = await temporaryDirectory("task-decision-complete-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let rejected = null;
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract({ acceptance: ["Criterion A", "Criterion B"] }) });
          return { output: "aligned" };
        }
        const state = await input.taskControlPlane.get_task_state();
        await input.taskControlPlane.complete_task({
          summary: "Incomplete report",
          acceptanceResults: [{ criterionIndex: 0, status: "passed", summary: "A passed", evidenceArtifactIds: [] }],
        }).catch((error) => { rejected = error; });
        await input.taskControlPlane.complete_task({
          summary: "Both frozen criteria passed.",
          acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
            criterionIndex,
            status: "passed",
            summary: `${criterion} passed`,
            evidenceArtifactIds: [],
          })),
        });
        return { output: "Structured completion recorded." };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await createAutoTask(orchestrator, workspaceRoot);
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.match(rejected?.message ?? "", /exactly one result/);
      assert.equal(finished.run.primaryDecisions.length, 1);
      assert.equal(finished.run.primaryDecisions[0].kind, "complete");
      assert.equal(finished.run.primaryDecisions[0].acceptanceResults.length, 2);
      assert.equal(finished.events.some((event) => event.type === "primary-decision-recorded"), true);
    } finally {
      await orchestrator.close();
    }
  });

  it("defers a primary decision while a worker is active without failing the provider turn", async () => {
    const userDataDir = await temporaryDirectory("task-decision-worker-deferral-user-");
    const workspaceRoot = await temporaryDirectory("task-decision-worker-deferral-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let primaryTurns = 0;
    let deferredResult = null;
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        if (input.taskDepth === 1) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { output: "worker completed" };
        }
        primaryTurns += 1;
        if (primaryTurns === 1) {
          const worker = await input.taskControlPlane.spawn_agent({
            workerProfileId: "worker-1",
            prompt: "Complete after the primary decision is first deferred.",
          });
          deferredResult = await input.taskControlPlane.checkpoint_task({
            summary: "Checkpoint after worker completion.",
            nextAction: "Finish the task in a fresh turn.",
          });
          assert.equal(deferredResult.recorded, false);
          assert.equal(deferredResult.retryable, true);
          assert.equal(deferredResult.code, "active_workers");
          assert.deepEqual(deferredResult.activeWorkers.map(({ attemptId }) => attemptId), [worker.attemptId]);
          await input.taskControlPlane.wait_agent({ attemptId: worker.attemptId });
          await input.taskControlPlane.checkpoint_task({
            summary: "Checkpoint after worker completion.",
            nextAction: "Finish the task in a fresh turn.",
          });
          return { output: "checkpoint recorded after worker completion" };
        }
        const state = await input.taskControlPlane.get_task_state();
        await input.taskControlPlane.complete_task({
          summary: "Task completed after the deferred checkpoint.",
          acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
            criterionIndex,
            status: "passed",
            summary: `${criterion} passed`,
            evidenceArtifactIds: [],
          })),
        });
        return { output: "completed" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await createAutoTask(orchestrator, workspaceRoot, {
        allowedWorkers: taskInput(workspaceRoot).allowedWorkers,
      });
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.status, "succeeded");
      assert.equal(finished.run.workerAttempts[0].status, "succeeded");
      assert.equal(finished.run.primaryDecisions.length, 2);
      assert.equal(deferredResult.code, "active_workers");
    } finally {
      await orchestrator.close();
    }
  });

  it("fences an active worker when a primary fails", async () => {
    const userDataDir = await temporaryDirectory("task-primary-failure-user-");
    const workspaceRoot = await temporaryDirectory("task-primary-failure-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let signalWorkerStarted;
    const workerStarted = new Promise((resolve) => { signalWorkerStarted = resolve; });
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        if (input.taskDepth === 1) {
          signalWorkerStarted();
          return { status: "running", output: "worker still active" };
        }
        await input.taskControlPlane.spawn_agent({ workerProfileId: "worker-1", prompt: "Remain active until fenced." });
        await workerStarted;
        return { status: "failed", error: "primary provider failed" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await createAutoTask(orchestrator, workspaceRoot, {
        allowedWorkers: taskInput(workspaceRoot).allowedWorkers,
      });
      const failed = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "failed");
      assert.equal(failed.run.primaryAttempts[0].status, "failed");
      assert.equal(failed.run.workerAttempts[0].status, "cancelled");
      assert.equal(failed.run.workerAttempts[0].leaseId, null);
      assert.equal(runtime.cancelCalls.some((call) => call.runId === failed.run.workerAttempts[0].personalRunId), true);
    } finally {
      await orchestrator.close();
    }
  });

  it("fences an inconsistent live old worker before launching a primary retry", async () => {
    const userDataDir = await temporaryDirectory("task-retry-fence-user-");
    const workspaceRoot = await temporaryDirectory("task-retry-fence-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let primaryStarts = 0;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        primaryStarts += 1;
        return primaryStarts === 1 ? { status: "failed", error: "first primary failed" } : { output: "retry completed" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await createAutoTask(orchestrator, workspaceRoot, {
        allowedWorkers: taskInput(workspaceRoot).allowedWorkers,
      });
      const failed = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "failed");
      const store = createTaskOrchestratorStore({ userDataDir });
      await store.initialize();
      const run = await store.requireRun(started.task.id, failed.run.id);
      const worker = createAttempt(defaultId, Date.now, run, "worker", run.definition.allowedWorkers[0], "stale worker", run.primaryAttemptId, "running");
      worker.leaseId = "lease-stale-worker";
      worker.personalRunId = "personal-stale-worker";
      worker.startedAt = Date.now();
      run.workerAttempts.push(worker);
      run.sideEffects.push(...["get_task_state", "list_agents"].map((operation, index) => ({
        id: `effect_legacy_task_control_${index}`,
        attemptId: run.primaryAttemptId,
        toolCallId: `legacy-task-control-${index}`,
        operation: `mcp.onmyagent-task-control.${operation}`,
        idempotency: "non-idempotent",
        intentHash: "0".repeat(64),
        intentAt: Date.now(),
        intentSource: "pre-execute",
        receiptStatus: "unknown",
        receiptAt: null,
        resultHash: null,
        turnId: null,
      })));
      await store.writeRun(run);

      await orchestrator.retryPrimary({ taskRunId: run.id, attemptId: run.primaryAttemptId });
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.workerAttempts[0].status, "cancelled");
      assert.equal(finished.run.workerAttempts[0].leaseId, null);
      assert.equal(runtime.cancelCalls.some((call) => call.runId === "personal-stale-worker"), true);
      assert.equal(finished.run.primaryAttempts.length, 2);
      assert.equal(finished.run.sideEffects.filter((effect) => effect.receiptStatus === "unknown").length, 2);
    } finally {
      await orchestrator.close();
    }
  });

  it("blocks replay when a non-idempotent provider tool has an unknown outcome", async () => {
    const userDataDir = await temporaryDirectory("task-side-effect-user-");
    const workspaceRoot = await temporaryDirectory("task-side-effect-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        return {
          status: "failed",
          error: "provider disconnected during the write",
          events: [{
            type: "tool",
            at: Date.now(),
            toolCall: {
              id: "tool-write-unknown",
              name: "Bash",
              kind: "execute",
              status: "running",
              input: "printf result > proof.txt",
            },
          }],
        };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await createAutoTask(orchestrator, workspaceRoot);
      const failed = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "failed");
      assert.deepEqual(failed.run.sideEffects.map((effect) => ({
        idempotency: effect.idempotency,
        receiptStatus: effect.receiptStatus,
      })), [{ idempotency: "non-idempotent", receiptStatus: "unknown" }]);
      await assert.rejects(
        orchestrator.retryPrimary({ taskRunId: failed.run.id, attemptId: failed.run.primaryAttemptId }),
        /unknown outcome and require reconciliation/,
      );
      const stable = await orchestrator.getTask({ taskId: started.task.id });
      assert.equal(stable.run.primaryAttempts.length, 1);
    } finally {
      await orchestrator.close();
    }
  });

  it("fails a completed provider turn when a side effect bypassed the durable pre-execute hook", async () => {
    const userDataDir = await temporaryDirectory("task-side-effect-bypass-user-");
    const workspaceRoot = await temporaryDirectory("task-side-effect-bypass-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        return {
          output: "provider claimed completion after an unobserved write",
          events: [{
            type: "tool",
            at: Date.now(),
            toolCall: {
              id: "tool-write-bypassed",
              name: "Bash",
              kind: "execute",
              status: "completed",
              input: "printf result > proof.txt",
              output: "done",
            },
          }],
        };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await createAutoTask(orchestrator, workspaceRoot);
      const failed = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "failed");
      assert.match(failed.run.error, /without a durable pre-execute intent/i);
      assert.equal(failed.run.sideEffects[0].intentSource, "observed-terminal");
      assert.equal(failed.run.sideEffects[0].receiptStatus, "completed");
    } finally {
      await orchestrator.close();
    }
  });
});
