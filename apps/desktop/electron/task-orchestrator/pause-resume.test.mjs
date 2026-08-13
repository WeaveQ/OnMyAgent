import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

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

const temporaryDirectories = [];

afterEach(async () => {
  await cleanupDirectories(temporaryDirectories.splice(0));
});

function resumableRuntime() {
  let executionStarts = 0;
  return createRuntime({
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { output: "aligned" };
      }
      executionStarts += 1;
      return executionStarts === 1
        ? { status: "running", output: "work in progress" }
        : { output: "continued from checkpoint" };
    },
  });
}

describe("Task Center safe pause and fresh-session resume", () => {
  it("does not start a provider when pause wins after admission but before lease persistence", async () => {
    const userDataDir = await temporaryDirectory("task-v2-pause-admission-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-pause-admission-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const store = createTaskOrchestratorStore({ userDataDir });
    const writeRun = store.writeRun.bind(store);
    const markAdmission = store.markAdmission.bind(store);
    let releaseAdmission;
    let admissionEntered;
    const admissionEnteredPromise = new Promise((resolve) => { admissionEntered = resolve; });
    const admissionReleasePromise = new Promise((resolve) => { releaseAdmission = resolve; });
    store.markAdmission = async (input) => {
      const result = await markAdmission(input);
      if (input.status === "admitted") {
        admissionEntered();
        await admissionReleasePromise;
      }
      return result;
    };
    store.writeRun = async (run) => {
      const result = await writeRun(run);
      if (run.status === "pausing") {
        // Keep the pause serializer busy while the already-granted admission
        // resumes and queues beginAttempt behind the durable pausing state.
        releaseAdmission();
        await new Promise((resolve) => setImmediate(resolve));
      }
      return result;
    };
    let executionStarts = 0;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        executionStarts += 1;
        return { status: "running", output: "must not start while pausing" };
      },
    });
    const orchestrator = createTaskOrchestrator({
      store,
      userDataDir,
      personalAgentRuntime: runtime,
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        permissionMode: "full-allow",
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
      }));
      await admissionEnteredPromise;
      const paused = await orchestrator.pauseTask({ taskRunId: created.run.id });
      assert.equal(paused.run.status, "paused");
      assert.equal(paused.run.primaryAttempts[0].status, "cancelled");
      assert.equal(executionStarts, 0);
      assert.equal(runtime.conversations.length, 1, "only the alignment conversation may exist");
    } finally {
      releaseAdmission();
      await orchestrator.close();
    }
  });

  it("pauses one run with a checkpoint and resumes in a new turn", async () => {
    const userDataDir = await temporaryDirectory("task-v2-pause-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-pause-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = resumableRuntime();
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        permissionMode: "full-allow",
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
      }));
      const running = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "running" && snapshot.run.primaryAttempts[0]?.personalRunId);
      const originalGrantId = running.run.permissionGrant.id;
      const paused = await orchestrator.pauseTask({ taskRunId: running.run.id });
      assert.equal(paused.run.status, "paused");
      assert.equal(paused.run.pause.reason, "user");
      assert.equal(paused.run.pause.resumeEligible, true);
      assert.equal(paused.run.checkpoints.length, 1);
      assert.equal(paused.run.continuationCapsules.length, 1);
      assert.equal(paused.run.primaryAttempts[0].status, "cancelled");

      const queued = await orchestrator.resumeTask({ taskRunId: running.run.id });
      assert.equal(queued.run.primaryAttempts.length, 2);
      assert.equal(queued.run.turns.length, 2);
      assert.equal(queued.run.turns[1].reason, "user-resume");
      assert.equal(queued.run.permissionGrant.id, originalGrantId);
      const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.primaryAttempts[0].status, "cancelled");
      assert.equal(finished.run.primaryAttempts[1].status, "succeeded");
      assert.equal(runtime.conversations.length, 3); // alignment + two isolated primary turns
    } finally {
      await orchestrator.close();
    }
  });

  it("explicit quit drains to paused state that a new supervisor can resume", async () => {
    const userDataDir = await temporaryDirectory("task-v2-quit-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-quit-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const firstRuntime = resumableRuntime();
    const first = createTaskOrchestrator({ userDataDir, personalAgentRuntime: firstRuntime, pollMs: 1, awaitAlignment: true });
    const created = await first.createTask(taskInput(workspaceRoot, {
      contractFinalization: "model-recommended-auto",
      allowedWorkers: [],
    }));
    const running = await waitForSnapshot(first, created.task.id, (snapshot) => snapshot.run?.status === "running" && snapshot.run.primaryAttempts[0]?.personalRunId);
    const drained = await first.pauseAllAndDrain("explicit_quit");
    assert.deepEqual(drained.pausedRunIds, [running.run.id]);

    const secondRuntime = createRuntime();
    const second = createTaskOrchestrator({ userDataDir, personalAgentRuntime: secondRuntime, pollMs: 1, awaitAlignment: true });
    try {
      const paused = await second.getTask({ taskId: created.task.id });
      assert.equal(paused.run.status, "paused");
      assert.equal(paused.run.pause.reason, "app-quit");
      const queued = await second.resumeTask({ taskRunId: paused.run.id });
      assert.equal(queued.run.turns.at(-1).reason, "app-quit-resume");
      const finished = await waitForSnapshot(second, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.primaryAttempts.length, 2);
      assert.equal(secondRuntime.startCalls.length, 1);
    } finally {
      await second.close();
    }
  });

  it("keeps a failed explicit-quit drain retryable without duplicating its checkpoint", async () => {
    const userDataDir = await temporaryDirectory("task-v2-quit-retry-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-quit-retry-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let cancelAttempts = 0;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        return { status: "running", output: "work in progress" };
      },
      cancel: async () => {
        cancelAttempts += 1;
        return cancelAttempts === 1
          ? { ok: false, error: "provider cancellation was temporarily unavailable" }
          : { ok: true };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
      }));
      const running = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "running" && snapshot.run.primaryAttempts[0]?.personalRunId);

      await assert.rejects(
        orchestrator.pauseAllAndDrain("explicit_quit"),
        /could not safely cancel every provider session/i,
      );
      const retryable = await orchestrator.getTask({ taskId: created.task.id });
      assert.equal(retryable.run.status, "pausing");
      assert.equal(retryable.run.checkpoints.length, 1);
      assert.equal(retryable.run.continuationCapsules.length, 1);

      const drained = await orchestrator.pauseAllAndDrain("explicit_quit");
      assert.deepEqual(drained.pausedRunIds, [running.run.id]);
      assert.equal(cancelAttempts, 2);
      const paused = await orchestrator.getTask({ taskId: created.task.id });
      assert.equal(paused.run.status, "paused");
      assert.equal(paused.run.checkpoints.length, 1);
      assert.equal(paused.run.continuationCapsules.length, 1);
    } finally {
      await orchestrator.close();
    }
  });
});
