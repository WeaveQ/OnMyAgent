import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HANDLER_COMMAND_NAMES,
  createTaskOrchestratorDomainHandlers,
} from "../desktop-handlers/task-orchestrator.mjs";
import { createTaskSupervisorClient } from "./client.mjs";
import {
  TASK_SUPERVISOR_METHOD_ALIASES,
  TASK_SUPERVISOR_METHODS,
} from "./protocol.mjs";

test("Turn History is wired through Supervisor protocol and lazy client", () => {
  assert.ok(TASK_SUPERVISOR_METHODS.includes("taskOrchestratorTurnHistoryList"));
  assert.equal(TASK_SUPERVISOR_METHOD_ALIASES.taskOrchestratorTurnHistoryList, "listTurnHistory");
  const client = createTaskSupervisorClient({ userDataDir: "/tmp/onmyagent-turn-history-contract" });
  assert.equal(typeof client.taskOrchestratorTurnHistoryList, "function");
  assert.equal(client.listTurnHistory, client.taskOrchestratorTurnHistoryList);
});

test("desktop Turn History handler forwards the complete page contract", async () => {
  const input = { taskId: "task-1", taskRunId: "run-1", cursor: null, limit: 20 };
  const expected = { historyVersion: 1, taskId: "task-1", taskRunId: "run-1", items: [] };
  let observed = null;
  const handlers = createTaskOrchestratorDomainHandlers({
    taskOrchestrator: {
      listTurnHistory: async (value) => {
        observed = value;
        return expected;
      },
    },
  });
  assert.ok(HANDLER_COMMAND_NAMES.includes("taskOrchestratorTurnHistoryList"));
  assert.equal(await handlers.taskOrchestratorTurnHistoryList(null, [input]), expected);
  assert.deepEqual(observed, input);
});
