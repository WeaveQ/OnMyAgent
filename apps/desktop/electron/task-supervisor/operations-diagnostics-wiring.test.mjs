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

test("Operations diagnostics is wired through the Supervisor protocol and lazy client", () => {
  const method = "taskOrchestratorOperationsDiagnosticsGet";
  assert.ok(TASK_SUPERVISOR_METHODS.includes(method));
  assert.equal(TASK_SUPERVISOR_METHOD_ALIASES[method], "getOperationsDiagnostics");
  const client = createTaskSupervisorClient({ userDataDir: "/tmp/onmyagent-operations-diagnostics-contract" });
  assert.equal(typeof client[method], "function");
  assert.equal(client.getOperationsDiagnostics, client[method]);
});

test("desktop Operations diagnostics handler forwards the exact task/run pair", async () => {
  const input = { taskId: "task-1", taskRunId: "run-1" };
  const expected = { version: 1, generatedAt: 123, truncated: true };
  let observed = null;
  const handlers = createTaskOrchestratorDomainHandlers({
    taskOrchestrator: {
      getOperationsDiagnostics: async (value) => {
        observed = value;
        return expected;
      },
    },
  });
  assert.ok(HANDLER_COMMAND_NAMES.includes("taskOrchestratorOperationsDiagnosticsGet"));
  assert.equal(await handlers.taskOrchestratorOperationsDiagnosticsGet(null, [input]), expected);
  assert.deepEqual(observed, input);
});
