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

describe("Task Center safe recovery continuation", () => {
  it("continues a blocked worker after primary success with a fresh primary and redacted manifest", async () => {
    const userDataDir = await temporaryDirectory("task-v2-safe-recovery-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-safe-recovery-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const initialRuntime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "alignment" };
        }
        await input.taskExecutionObserver?.beforeOperation({
          toolCallId: "tool-test-1",
          operation: "Run npm test",
          kind: "execute",
          input: "npm test",
        });
        return {
          output: "Prior primary output: inspect proof.txt before changing anything.",
          events: [{ type: "tool", toolCall: { id: "tool-test-1", name: "npm test", kind: "execute", status: "completed", input: "npm test", output: "ok" } }],
        };
      },
    });
    const initial = createTaskOrchestrator({ userDataDir, personalAgentRuntime: initialRuntime, pollMs: 1, awaitAlignment: true });
    const started = await initial.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto" }));
    const finished = await waitForSnapshot(initial, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
    await initial.close();

    const store = createTaskOrchestratorStore({ userDataDir });
    await store.initialize();
    const run = await store.requireRun(started.task.id, finished.run.id);
    const primaryBefore = run.primaryAttempts[0];
    const interruptedWorker = createAttempt(defaultId, Date.now, run, "worker", run.definition.allowedWorkers[0], "Inspect worker state after restart.", primaryBefore.id, "blocked");
    interruptedWorker.finishedAt = Date.now();
    run.workerAttempts.push(interruptedWorker);
    run.currentAttemptId = interruptedWorker.id;
    run.status = "blocked";
    run.error = "Desktop restarted during an active primary/worker attempt; the run was blocked and was not replayed.";
    run.updatedAt = Date.now();
    await store.writeRun(run);

    let recoveryInput;
    const recoveryRuntime = createRuntime({
      start: async ({ input }) => {
        if (input.taskTools?.includes("spawn_agent")) recoveryInput = input;
        return { output: "Fresh primary inspected the current workspace and continued safely." };
      },
    });
    const recoveredOrchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: recoveryRuntime, pollMs: 1, awaitAlignment: true });
    try {
      const queued = await recoveredOrchestrator.continueRecovery({ taskRunId: run.id, attemptId: interruptedWorker.id });
      assert.equal(queued.task.id, started.task.id);
      const recovered = await waitForSnapshot(recoveredOrchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(recovered.run.primaryAttempts.length, 2);
      assert.equal(recovered.run.primaryAttempts[0].status, "succeeded");
      assert.equal(recovered.run.workerAttempts[0].status, "blocked");
      assert.equal(recovered.run.workerAttempts[0].id, interruptedWorker.id);
      assert.equal(recovered.run.primaryAttempts[1].status, "succeeded");
      assert.match(recoveryRuntime.startCalls.at(-1).input.prompt, /Prior primary output/);
      assert.match(recoveryRuntime.startCalls.at(-1).input.prompt, /npm test \(completed\)/);
      assert.match(recoveryRuntime.startCalls.at(-1).input.prompt, /fresh primary Personal conversation/i);
      assert.match(recoveryRuntime.startCalls.at(-1).input.prompt, /inspect the actual bound workspace/i);
      assert.equal(recoveryInput?.taskPermissionMode, "restricted");

      const duplicate = await recoveredOrchestrator.continueRecovery({ taskRunId: run.id, attemptId: interruptedWorker.id });
      assert.equal(duplicate.run.primaryAttempts.length, 2);
      assert.equal(duplicate.run.primaryAttempts[1].id, recovered.run.primaryAttempts[1].id);
    } finally {
      await recoveredOrchestrator.close();
    }
  });

  it("rejects a non-blocked target and enforces frozen continuation limits", async () => {
    const userDataDir = await temporaryDirectory("task-v2-safe-recovery-limit-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-safe-recovery-limit-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) await input.taskControlPlane.propose_contract({ contract: contract() });
        return { output: "done" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto", allowedWorkers: [] }));
    const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
    const store = createTaskOrchestratorStore({ userDataDir });
    const run = await store.requireRun(started.task.id, finished.run.id);
    run.status = "blocked";
    run.error = "A provider returned a blocked result.";
    await store.writeRun(run);
    await assert.rejects(orchestrator.continueRecovery({ taskRunId: run.id }), /desktop shutdown\/restart interruption/);
    run.error = "Desktop restarted during an active primary/worker attempt; the run was blocked and was not replayed.";
    const current = run.primaryAttempts.at(-1);
    current.status = "blocked";
    current.finishedAt = Date.now();
    current.updatedAt = Date.now();
    run.currentAttemptId = current.id;
    await store.writeRun(run);
    try {
      await orchestrator.continueRecovery({ taskRunId: run.id, attemptId: current.id });
      await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      const secondRun = await store.requireRun(started.task.id, run.id);
      secondRun.status = "blocked";
      secondRun.error = "Desktop restarted during an active primary/worker attempt; the run was blocked and was not replayed.";
      const secondCurrent = secondRun.primaryAttempts.at(-1);
      secondCurrent.status = "blocked";
      secondCurrent.finishedAt = Date.now();
      secondCurrent.updatedAt = Date.now();
      secondRun.currentAttemptId = secondCurrent.id;
      await store.writeRun(secondRun);
      await orchestrator.continueRecovery({ taskRunId: run.id, attemptId: secondCurrent.id });
      await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      const thirdRun = await store.requireRun(started.task.id, run.id);
      assert.equal(thirdRun.primaryAttempts.length, 3);
      thirdRun.status = "blocked";
      thirdRun.error = "Desktop restarted during an active primary/worker attempt; the run was blocked and was not replayed.";
      const thirdCurrent = thirdRun.primaryAttempts.at(-1);
      thirdCurrent.status = "blocked";
      thirdCurrent.finishedAt = Date.now();
      thirdCurrent.updatedAt = Date.now();
      thirdRun.currentAttemptId = thirdCurrent.id;
      await store.writeRun(thirdRun);
      await assert.rejects(orchestrator.continueRecovery({ taskRunId: run.id, attemptId: thirdCurrent.id }), /Cannot continue task|recovery limit exhausted/i);
    } finally {
      await orchestrator.close();
    }
  });
});
