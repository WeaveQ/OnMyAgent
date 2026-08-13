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

describe("Task Center accelerated overnight soak", () => {
  const temporaryDirectories = [];
  afterEach(async () => cleanupDirectories(temporaryDirectories.splice(0)));

  it("converges after one hundred fresh bounded turns without leases or duplicate sessions", { timeout: 120_000 }, async () => {
    const userDataDir = await temporaryDirectory("task-overnight-soak-user-");
    const workspaceRoot = await temporaryDirectory("task-overnight-soak-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const store = createTaskOrchestratorStore({ userDataDir });
    let executionTurn = 0;
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "alignment completed" };
        }
        executionTurn += 1;
        const state = await input.taskControlPlane.get_task_state();
        if (executionTurn < 100) {
          await input.taskControlPlane.continue_task({
            summary: `Bounded soak turn ${executionTurn} completed.`,
            nextAction: `Continue with soak turn ${executionTurn + 1}.`,
            acceptanceResults: [],
          });
        } else {
          await input.taskControlPlane.complete_task({
            summary: "The one-hundred-turn accelerated soak completed.",
            acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
              criterionIndex,
              status: "passed",
              summary: `Verified after 100 bounded turns: ${criterion}`,
              evidenceArtifactIds: [],
            })),
          });
        }
        return { output: `soak turn ${executionTurn}` };
      },
    });
    const orchestrator = createTaskOrchestrator({
      store,
      userDataDir,
      personalAgentRuntime: runtime,
      pollMs: 1,
      awaitAlignment: true,
      maxGlobalActiveAttempts: 4,
      reservedWorkerSlots: 1,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        allowedWorkers: [],
        contractFinalization: "model-recommended-auto",
        endConditions: {
          maxPrimaryTurns: 100,
          maxWorkerAttempts: 0,
          maxElapsedMs: 86_400_000,
        },
      }));
      const finished = await waitForSnapshot(
        orchestrator,
        created.task.id,
        (snapshot) => snapshot.run?.status === "succeeded",
        90_000,
      );
      const fullRun = await store.requireRun(finished.task.id, finished.run.id);
      assert.equal(executionTurn, 100);
      assert.equal(fullRun.turns.length, 100);
      assert.equal(fullRun.primaryAttempts.length, 100);
      assert.equal(fullRun.workerAttempts.length, 0);
      assert.equal(fullRun.primaryDecisions.length, 100);
      assert.equal(fullRun.primaryDecisions.at(-1)?.kind, "complete");
      assert.equal(fullRun.budget.primaryTurnsUsed, 100);
      assert.equal(fullRun.primaryAttempts.every((attempt) => attempt.status === "succeeded" && attempt.leaseId === null), true);
      const executionConversations = runtime.conversations.filter((conversation) => (
        conversation.source === "task-orchestrator-v2" && conversation.metadata?.kind === "primary"
      ));
      assert.equal(executionConversations.length, 100);
      assert.equal(new Set(executionConversations.map((conversation) => conversation.id)).size, 100);
      const events = await store.readEvents(finished.task.id, finished.run.id);
      assert.equal(events.some((event) => event.type === "run-succeeded"), true);
      assert.equal((await store.health()).healthy, true);
    } finally {
      await orchestrator.close();
    }
  });
});
