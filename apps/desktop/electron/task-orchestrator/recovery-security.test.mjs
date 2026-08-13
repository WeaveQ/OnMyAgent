import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createTaskOrchestrator } from "./index.mjs";
import { createTaskOrchestratorStore } from "./store-factory.mjs";
import { createAttempt, defaultId, definitionFromTask } from "./definitions.mjs";
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

describe("Task Center v2 recovery, cancellation, and redaction", () => {
  it("recovers an auto-frozen task after a run write crash exactly once across restarts", async () => {
    const userDataDir = await temporaryDirectory("task-v2-auto-recovery-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-auto-recovery-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);

    const faultStore = createTaskOrchestratorStore({ userDataDir });
    const originalWriteRun = faultStore.writeRun;
    let failNextRunWrite = true;
    faultStore.writeRun = async (run) => {
      if (failNextRunWrite) {
        failNextRunWrite = false;
        throw new Error("injected run write failure");
      }
      return originalWriteRun(run);
    };
    const initialRuntime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        }
        return { output: "alignment" };
      },
    });
    const initial = createTaskOrchestrator({ store: faultStore, userDataDir, personalAgentRuntime: initialRuntime, pollMs: 1, awaitAlignment: true });
    let taskId;
    try {
      const created = await initial.createTask(taskInput(workspaceRoot, {
        allowedWorkers: [],
        contractFinalization: "model-recommended-auto",
      }));
      assert.equal(created.task.alignment.status, "failed");
      assert.match(created.task.alignment.error, /injected run write failure/);
      const listed = await faultStore.listTasks({ workspaceRoot });
      assert.equal(listed.tasks.length, 1);
      taskId = listed.tasks[0].id;
      const frozen = await faultStore.requireTask(taskId);
      assert.equal(frozen.definitionStatus, "ready");
      assert.equal(frozen.contractFinalization, "model-recommended-auto");
      assert.deepEqual(await faultStore.runsForTask(taskId), []);
    } finally {
      await initial.close();
    }

    const recoveryRuntime = createRuntime({ start: async () => ({ output: "recovered primary" }) });
    const recoveredOrchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: recoveryRuntime, pollMs: 1, awaitAlignment: true });
    let recovered;
    try {
      recovered = await waitForSnapshot(recoveredOrchestrator, taskId, (snapshot) => snapshot.run?.status === "succeeded");
      const runs = await createTaskOrchestratorStore({ userDataDir }).runsForTask(taskId);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].id, recovered.run.id);
      assert.equal(runs[0].primaryAttempts.length, 1);
      assert.equal(recoveryRuntime.startCalls.length, 1);
    } finally {
      await recoveredOrchestrator.close();
    }

    const secondRecoveryRuntime = createRuntime({ start: async () => ({ output: "must not replay" }) });
    const secondRecovery = createTaskOrchestrator({ userDataDir, personalAgentRuntime: secondRecoveryRuntime, pollMs: 1, awaitAlignment: true });
    try {
      const stable = await secondRecovery.getTask({ taskId });
      const runs = await createTaskOrchestratorStore({ userDataDir }).runsForTask(taskId);
      assert.equal(stable.run.id, recovered.run.id);
      assert.equal(stable.run.status, "succeeded");
      assert.equal(runs.length, 1);
      assert.equal(secondRecoveryRuntime.startCalls.length, 0);
    } finally {
      await secondRecovery.close();
    }
  });

  it("returns from stop while a provider is held, then retries on an isolated primary attempt", async () => {
    const userDataDir = await temporaryDirectory("task-v2-stop-drain-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-stop-drain-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runs = new Map();
    const conversations = [];
    const startCalls = [];
    const cancelCalls = [];
    let conversationSequence = 0;
    let runSequence = 0;
    let executionStarts = 0;
    let oldRunId = null;
    let oldPollEntered = false;
    let releasedOld = false;
    let resolveOldPoll;
    const oldPoll = new Promise((resolve) => { resolveOldPoll = resolve; });
    const runtime = {
      runs,
      startCalls,
      cancelCalls,
      get oldRunId() { return oldRunId; },
      get oldPollEntered() { return oldPollEntered; },
      async listAvailableAgentMetadata() {
        return {
          agents: [
            { id: "primary-agent", name: "Primary", provider: "codex", modelOptions: [{ id: "primary-model", label: "Primary model" }] },
            { id: "worker-agent", name: "Worker", provider: "claude", modelOptions: [{ id: "worker-model", label: "Worker model" }] },
          ],
        };
      },
      async createConversation(input) {
        const conversation = { id: `conversation-${++conversationSequence}`, ...input };
        conversations.push(conversation);
        return { conversation };
      },
      async startMessage(input) {
        const runId = `personal-${++runSequence}`;
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          const aligned = { runId, status: "completed", output: "aligned", error: null, pendingApprovals: [] };
          runs.set(runId, aligned);
          return structuredClone(aligned);
        }
        executionStarts += 1;
        startCalls.push({ input, runId });
        if (executionStarts > 1 && input.taskControlPlane?.complete_task) {
          const state = await input.taskControlPlane.get_task_state();
          await input.taskControlPlane.complete_task({
            summary: "The isolated retry completed the contract.",
            acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
              criterionIndex,
              status: "passed",
              summary: `Verified after retry: ${criterion}`,
              evidenceArtifactIds: [],
            })),
          });
        }
        const snapshot = executionStarts === 1
          ? { runId, status: "running", output: "old execution held", error: null, pendingApprovals: [] }
          : { runId, status: "completed", output: "retry completed", error: null, pendingApprovals: [] };
        if (executionStarts === 1) oldRunId = runId;
        runs.set(runId, snapshot);
        return structuredClone(snapshot);
      },
      async getRun({ runId }) {
        if (runId === oldRunId && !releasedOld) {
          oldPollEntered = true;
          return oldPoll;
        }
        return structuredClone(runs.get(runId) ?? null);
      },
      async cancelRun(runId, options) {
        cancelCalls.push({ runId, options });
        // The provider acknowledges cancellation but keeps its old execution
        // alive until the test releases the held result.
        return { ok: true };
      },
      async resolveApproval() { return { ok: true }; },
      async cancelTaskOperation(input) {
        return { ok: true, operationId: input?.operationId ?? null, status: "cancelled", pending: false, runId: null };
      },
      getTaskOperation() { return null; },
      async getTaskCapability() { return { supportsTaskIntentHook: true, supportsScopedFullAllow: true }; },
      releaseOldResult() {
        releasedOld = true;
        const completed = { runId: oldRunId, status: "completed", output: "late old result", error: null, pendingApprovals: [] };
        runs.set(oldRunId, completed);
        resolveOldPoll(completed);
      },
    };
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, {
        allowedWorkers: [],
        contractFinalization: "model-recommended-auto",
      }));
      const running = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => (
        snapshot.run?.status === "running"
        && snapshot.run.primaryAttempts[0]?.personalRunId
        && runtime.oldPollEntered
      ));
      const stopResult = await Promise.race([
        orchestrator.stopTask({ taskRunId: running.run.id }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("stopTask exceeded bounded cancellation timeout")), 500)),
      ]);
      assert.equal(stopResult.run.status, "cancelled");
      assert.equal(stopResult.run.primaryAttempts[0].status, "cancelled");
      assert.equal(stopResult.run.primaryAttempts[0].leaseId, null);
      assert.equal(cancelCalls.some((call) => call.runId === runtime.oldRunId), true);

      const retried = await orchestrator.retryPrimary({
        taskRunId: stopResult.run.id,
        attemptId: stopResult.run.primaryAttemptId,
      });
      assert.equal(retried.run.primaryAttempts.length, 2);
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.primaryAttempts[0].status, "cancelled");
      assert.equal(finished.run.primaryAttempts[1].status, "succeeded");

      runtime.releaseOldResult();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const stable = await orchestrator.getTask({ taskId: started.task.id });
      assert.equal(stable.run.status, "succeeded");
      assert.equal(stable.run.primaryAttempts[0].status, "cancelled");
      assert.equal(stable.run.primaryAttempts[1].status, "succeeded");
      assert.equal(stable.artifacts.some((artifact) => artifact.content === "late old result"), false);
      assert.equal(stable.artifacts.some((artifact) => artifact.content === "retry completed"), true);
    } finally {
      if (!releasedOld) runtime.releaseOldResult();
      await Promise.race([
        orchestrator.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("close did not drain held provider")), 1_000)),
      ]);
    }
  });

  it("revokes the attempt lease on cancellation and ignores a late Personal result", async () => {
    const userDataDir = await temporaryDirectory("task-v2-cancel-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-cancel-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) await input.taskControlPlane.propose_contract({ contract: contract() });
        if (input.taskControlPlane?.spawn_agent) return { status: "running", output: "still running" };
        return { output: "done" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto", allowedWorkers: [] }));
      const running = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "running" && snapshot.run.primaryAttempts[0].personalRunId);
      const cancelled = await orchestrator.stopRun({ taskRunId: running.run.id });
      assert.equal(cancelled.run.status, "cancelled");
      assert.equal(cancelled.run.primaryAttempts[0].status, "cancelled");
      assert.equal(cancelled.run.primaryAttempts[0].leaseId, null);
      assert.equal(runtime.cancelCalls.length >= 1, true);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const stable = await orchestrator.getTask({ taskId: started.task.id });
      assert.equal(stable.run.status, "cancelled");
      assert.equal(stable.run.primaryAttempts[0].status, "cancelled");
    } finally {
      await orchestrator.close();
    }
  });

  it("waits for concurrently running primary and worker attempts to settle on stop", async () => {
    const userDataDir = await temporaryDirectory("task-v2-stop-workers-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-stop-workers-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskTools?.includes("propose_contract")) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        if (input.taskDepth === 1) return { status: "running", output: "worker waiting" };
        if (input.taskTools?.includes("spawn_agent")) {
          await input.taskControlPlane.spawn_agent({ workerProfileId: "worker-1", prompt: "Keep running." });
          return { status: "running", output: "primary waiting" };
        }
        return { output: "done" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto" }));
      const running = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => (
        snapshot.run?.status === "running"
        && snapshot.run.primaryAttempts[0].personalRunId
        && snapshot.run.workerAttempts[0]?.personalRunId
      ));
      const cancelled = await orchestrator.stopRun({ taskRunId: running.run.id });
      assert.equal(cancelled.run.status, "cancelled");
      assert.equal(cancelled.run.primaryAttempts[0].status, "cancelled");
      assert.equal(cancelled.run.workerAttempts[0].status, "cancelled");
      assert.equal(cancelled.run.primaryAttempts[0].leaseId, null);
      assert.equal(cancelled.run.workerAttempts[0].leaseId, null);
      assert.equal(runtime.cancelCalls.length >= 2, true);
      const stable = await orchestrator.getTask({ taskId: started.task.id });
      assert.equal(stable.run.status, "cancelled");
      assert.equal(stable.run.workerAttempts[0].status, "cancelled");
    } finally {
      await orchestrator.close();
    }
  });

  it("fences an interrupted queued run and continues automatically in a fresh primary after restart", async () => {
    const userDataDir = await temporaryDirectory("task-v2-recovery-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-recovery-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime();
    const initial = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    const created = await initial.createTask(taskInput(workspaceRoot));
    await initial.close();

    const store = createTaskOrchestratorStore({ userDataDir });
    await store.initialize();
    const task = await store.requireTask(created.task.id);
    task.contract = contract();
    task.definitionStatus = "ready";
    task.revision += 1;
    const now = Date.now();
    const run = {
      schemaVersion: 2,
      id: "run-recovery",
      taskId: task.id,
      taskRevision: task.revision,
      definition: definitionFromTask(task),
      status: "queued",
      primaryAttemptId: "pending",
      currentAttemptId: null,
      primaryAttempts: [],
      workerAttempts: [],
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      finishedAt: null,
      error: null,
    };
    const primary = createAttempt(defaultId, () => now, run, "primary", task.primary, "recover", null, "ready");
    run.primaryAttemptId = primary.id;
    run.currentAttemptId = primary.id;
    run.primaryAttempts = [primary];
    await store.writeRun(run);
    task.latestRunId = run.id;
    await store.writeTask(task);

    const restarted = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const recovered = await waitForSnapshot(restarted, task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(recovered.run.status, "succeeded");
      assert.equal(recovered.run.primaryAttempts[0].status, "blocked");
      assert.equal(recovered.run.primaryAttempts[1].status, "succeeded");
      assert.match(recovered.run.primaryAttempts[1].prompt, /\[task-center-recovery\]/);
      assert.equal(runtime.startCalls.length, 2); // initial alignment + one fresh recovery primary
      assert.equal(recovered.events.some((event) => event.type === "run-reconciled"), true);
      assert.equal(recovered.events.some((event) => event.type === "primary-recovery-queued"), true);
    } finally {
      await restarted.close();
    }
  });

  it("keeps an interrupted run blocked when a non-idempotent side-effect outcome is unknown", async () => {
    const userDataDir = await temporaryDirectory("task-v2-unsafe-recovery-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-unsafe-recovery-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime();
    const initial = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    const created = await initial.createTask(taskInput(workspaceRoot));
    await initial.close();

    const store = createTaskOrchestratorStore({ userDataDir });
    await store.initialize();
    const task = await store.requireTask(created.task.id);
    task.contract = contract();
    task.definitionStatus = "ready";
    task.revision += 1;
    const timestamp = Date.now();
    const run = {
      schemaVersion: 2,
      id: "run-unsafe-recovery",
      taskId: task.id,
      taskRevision: task.revision,
      definition: definitionFromTask(task),
      status: "running",
      primaryAttemptId: "pending",
      currentAttemptId: null,
      primaryAttempts: [],
      workerAttempts: [],
      sideEffects: [],
      createdAt: timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
      finishedAt: null,
      error: null,
    };
    const primary = createAttempt(defaultId, () => timestamp, run, "primary", task.primary, "unsafe recovery", null, "running");
    primary.leaseId = "lease-unsafe-recovery";
    primary.personalRunId = "personal-unsafe-recovery";
    primary.startedAt = timestamp;
    run.primaryAttemptId = primary.id;
    run.currentAttemptId = primary.id;
    run.primaryAttempts = [primary];
    run.sideEffects = [{
      id: "effect-unknown-write",
      attemptId: primary.id,
      turnId: null,
      toolCallId: "tool-unknown-write",
      operation: "Write proof.txt",
      idempotency: "non-idempotent",
      intentHash: "a".repeat(64),
      intentAt: timestamp,
      receiptStatus: "unknown",
      receiptAt: null,
      resultHash: null,
    }];
    await store.writeRun(run);
    task.latestRunId = run.id;
    await store.writeTask(task);
    await store.close();

    const restarted = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const blocked = await restarted.getTask({ taskId: task.id });
      assert.equal(blocked.run.status, "blocked");
      assert.match(blocked.run.error, /Desktop restarted during an active primary\/worker attempt/i);
      assert.equal(blocked.run.primaryAttempts.length, 1);
      assert.equal(blocked.run.primaryAttempts[0].status, "blocked");
      assert.equal(blocked.run.sideEffects[0].receiptStatus, "unknown");
      assert.equal(runtime.startCalls.length, 1); // original alignment only; no unsafe replay
      assert.equal(blocked.events.some((event) => event.type === "primary-recovery-queued"), false);
    } finally {
      await restarted.close();
    }
  });

  it("redacts provider output and runtime evidence before durable artifact persistence", async () => {
    const marker = `sk-proj-${"a".repeat(24)}`;
    const userDataDir = await temporaryDirectory("task-v2-redaction-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-redaction-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) await input.taskControlPlane.propose_contract({ contract: contract() });
        return {
          output: `Authorization: Bearer ${marker}; password=${marker}`,
          events: [{ type: "tool", text: `api_key=${marker}` }],
          fileChanges: [{ filePath: `/tmp/${marker}/changed.txt`, diff: `+ token=${marker}` }],
        };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto", allowedWorkers: [] }));
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(JSON.stringify(finished.artifacts).includes(marker), false);
      assert.equal(JSON.stringify(finished.task.alignment.messages).includes(marker), false);
      assert.equal(JSON.stringify(finished.artifacts).includes("[REDACTED]"), true);
    } finally {
      await orchestrator.close();
    }
  });
});
