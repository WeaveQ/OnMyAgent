import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createTaskOrchestrator } from "./index.mjs";
import {
  cleanupDirectories,
  contract,
  createRuntime,
  taskInput,
  temporaryDirectory,
  waitForSnapshot,
} from "./v2-test-helpers.mjs";

describe("Task Center SQLite Turn History API", () => {
  const temporaryDirectories = [];
  afterEach(async () => cleanupDirectories(temporaryDirectories.splice(0)));

  it("paginates immutable turns by keyset and deep-links an older run", async () => {
    const userDataDir = await temporaryDirectory("task-turn-history-user-");
    const workspaceRoot = await temporaryDirectory("task-turn-history-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let executionTurn = 0;
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "alignment complete" };
        }
        executionTurn += 1;
        const state = await input.taskControlPlane.get_task_state();
        if (executionTurn % 2 === 1) {
          await input.taskControlPlane.continue_task({
            summary: "Bounded inspection completed.",
            nextAction: "Verify in a fresh turn.",
            acceptanceResults: [],
          });
        } else {
          await input.taskControlPlane.complete_task({
            summary: "Verification completed.",
            acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
              criterionIndex,
              status: "passed",
              summary: `Verified: ${criterion}`,
              evidenceArtifactIds: [],
            })),
          });
        }
        return { output: `execution turn ${executionTurn}` };
      },
    });
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
      }));
      const firstFinished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      const firstRunId = firstFinished.run.id;

      const firstPage = await orchestrator.listTurnHistory({
        taskId: created.task.id,
        taskRunId: firstRunId,
        limit: 1,
      });
      assert.equal(firstPage.items.length, 1);
      assert.equal(firstPage.items[0].turn.sequence, 2);
      assert.equal(firstPage.hasMore, true);
      assert.ok(firstPage.nextCursor);
      assert.equal("prompt" in firstPage.items[0].primaryAttempt, false);

      const secondPage = await orchestrator.listTurnHistory({
        taskId: created.task.id,
        taskRunId: firstRunId,
        cursor: firstPage.nextCursor,
        limit: 1,
      });
      assert.equal(secondPage.items.length, 1);
      assert.equal(secondPage.items[0].turn.sequence, 1);
      assert.equal(secondPage.hasMore, false);
      assert.equal(secondPage.items[0].decision.kind, "continue");
      assert.equal(secondPage.items[0].checkpoint.turnId, secondPage.items[0].turn.id);
      assert.equal(secondPage.items[0].capsule.fromTurnId, secondPage.items[0].turn.id);

      await orchestrator.startTask({ taskId: created.task.id });
      const latest = await waitForSnapshot(
        orchestrator,
        created.task.id,
        (snapshot) => snapshot.run?.status === "succeeded" && snapshot.run.id !== firstRunId,
      );
      assert.notEqual(latest.run.id, firstRunId);
      const oldRunDeepLink = await orchestrator.listTurnHistory({
        taskId: created.task.id,
        taskRunId: firstRunId,
        limit: 20,
      });
      assert.equal(oldRunDeepLink.taskRunId, firstRunId);
      assert.deepEqual(oldRunDeepLink.items.map((item) => item.turn.sequence), [2, 1]);
    } finally {
      await orchestrator.close();
    }
  });
});
