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

describe("Task Center storage failure convergence", () => {
  it("fails closed when an artifact commit runs out of disk and never replays the terminal attempt", async () => {
    const userDataDir = await temporaryDirectory("task-storage-full-user-");
    const workspaceRoot = await temporaryDirectory("task-storage-full-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);

    const store = createTaskOrchestratorStore({ userDataDir });
    const writeArtifact = store.writeArtifact;
    let failArtifactCommit = true;
    store.writeArtifact = async (artifact) => {
      if (failArtifactCommit) {
        failArtifactCommit = false;
        throw Object.assign(new Error("SQLITE_FULL: database or disk is full"), {
          code: "SQLITE_FULL",
        });
      }
      return writeArtifact(artifact);
    };

    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        }
        return { output: "provider completed" };
      },
    });
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      store,
      personalAgentRuntime: runtime,
      pollMs: 1,
      awaitAlignment: true,
    });
    let taskId;
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        allowedWorkers: [],
        contractFinalization: "model-recommended-auto",
      }));
      taskId = created.task.id;
      const failed = await waitForSnapshot(
        orchestrator,
        taskId,
        (snapshot) => snapshot.run?.status === "failed",
      );
      assert.match(failed.run.error, /SQLITE_FULL|disk is full/i);
      assert.equal(failed.run.primaryAttempts.length, 1);
      assert.equal(failed.run.primaryAttempts[0].status, "failed");
      assert.equal(failed.run.primaryAttempts[0].leaseId, null);
      assert.equal(failed.artifacts.length, 0);
      assert.equal(runtime.cancelCalls.length, 1);
      assert.equal(runtime.cancelCalls[0].options.reason, "orchestrator-attempt-error");
    } finally {
      await orchestrator.close();
    }

    const restartRuntime = createRuntime();
    const restarted = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: restartRuntime,
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      const stable = await restarted.getTask({ taskId });
      assert.equal(stable.run.status, "failed");
      assert.equal(stable.run.primaryAttempts.length, 1);
      assert.equal(restartRuntime.startCalls.length, 0);
    } finally {
      await restarted.close();
    }
  });
});
