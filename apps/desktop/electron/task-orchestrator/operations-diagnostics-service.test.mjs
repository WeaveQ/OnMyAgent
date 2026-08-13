import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

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

afterEach(async () => cleanupDirectories(temporaryDirectories.splice(0)));

test("operations diagnostics reads the exact run via bounded aggregate and cached health", async () => {
  const userDataDir = await temporaryDirectory("task-operations-diagnostics-user-");
  const workspaceRoot = await temporaryDirectory("task-operations-diagnostics-workspace-");
  temporaryDirectories.push(userDataDir, workspaceRoot);
  const store = createTaskOrchestratorStore({ userDataDir });
  const runtime = createRuntime({
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { output: "alignment complete" };
      }
      return {};
    },
  });
  const orchestrator = createTaskOrchestrator({
    store,
    personalAgentRuntime: runtime,
    pollMs: 1,
    awaitAlignment: true,
  });
  try {
    const created = await orchestrator.createTask(taskInput(workspaceRoot, {
      contractFinalization: "model-recommended-auto",
      allowedWorkers: [],
    }));
    const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
    const taskRunId = finished.run.id;
    const calls = { requireRun: [], diagnosticsAggregate: [], diagnosticsHealth: 0, listProcesses: 0, health: 0 };
    const originalRequireRun = store.requireRun.bind(store);
    const originalDiagnosticsAggregate = store.diagnosticsAggregate.bind(store);
    const originalDiagnosticsHealth = store.diagnosticsHealth.bind(store);
    const originalListProcesses = store.listProcesses.bind(store);
    const originalHealth = store.health.bind(store);
    store.requireRun = async (...args) => {
      calls.requireRun.push(args);
      return originalRequireRun(...args);
    };
    store.diagnosticsAggregate = async (...args) => {
      calls.diagnosticsAggregate.push(args);
      return originalDiagnosticsAggregate(...args);
    };
    store.diagnosticsHealth = async (...args) => {
      calls.diagnosticsHealth += 1;
      return originalDiagnosticsHealth(...args);
    };
    store.listProcesses = async (...args) => {
      calls.listProcesses += 1;
      return originalListProcesses(...args);
    };
    store.health = async (...args) => {
      calls.health += 1;
      return originalHealth(...args);
    };

    const diagnostics = await orchestrator.getOperationsDiagnostics({ taskId: created.task.id, taskRunId });
    assert.equal(diagnostics.version, 1);
    assert.equal(diagnostics.truncated, false);
    assert.deepEqual(calls.diagnosticsAggregate.at(-1), [{ runId: taskRunId }]);
    assert.equal(calls.diagnosticsHealth, 1);
    assert.equal(calls.listProcesses, 0);
    assert.equal(calls.health, 0);
    assert.deepEqual(calls.requireRun.at(-1), [created.task.id, taskRunId]);

    await assert.rejects(
      orchestrator.getOperationsDiagnostics({ taskId: "other-task", taskRunId }),
      /Run not found/,
    );
  } finally {
    await orchestrator.close();
  }
});
