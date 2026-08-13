import assert from "node:assert/strict";
import test from "node:test";

import { createTaskRuntimeOperationController } from "./runtime-operation.mjs";

function controller(runtime, options = {}) {
  let sequence = 0;
  return createTaskRuntimeOperationController({
    personalAgentRuntime: runtime,
    createId: (prefix) => `${prefix}:${++sequence}`,
    timeoutMs: options.timeoutMs ?? 5,
  });
}

test("caller-owned runtime call passes a safe operation id and signal", async () => {
  const runtime = {
    async cancelTaskOperation() { return { ok: true, pending: false }; },
    getTaskOperation() { return null; },
  };
  const owner = controller(runtime, { timeoutMs: 100 });
  const result = await owner.call("Personal start", "message", ({ operationId, signal }) => ({ operationId, aborted: signal.aborted }));
  assert.deepEqual(result, {
    value: { operationId: "task-message:1", aborted: false },
    operationId: "task-message:1",
  });
});

test("deadline aborts and confirms the underlying provider operation", async () => {
  let cancelled = 0;
  let operation = { status: "running", pending: true, runId: "personal-1" };
  const runtime = {
    async cancelTaskOperation({ operationId }) {
      cancelled += 1;
      operation = { operationId, status: "cancelled", pending: false, runId: "personal-1" };
      return { ok: true, ...operation };
    },
    getTaskOperation() { return operation; },
  };
  const owner = controller(runtime);
  await assert.rejects(
    owner.call("Personal held start", "message", () => new Promise(() => undefined)),
    (error) => {
      assert.equal(error.code, "TASK_RUNTIME_CALL_TIMEOUT");
      assert.equal(error.operationId, "task-message:1");
      assert.equal(error.runtimeCleanupAttempted, true);
      assert.equal(error.runtimeCleanupOk, true);
      return true;
    },
  );
  assert.equal(cancelled, 1);
});

test("deadline fails closed when cancellation is not confirmed", async () => {
  const runtime = {
    async cancelTaskOperation() { return { ok: false, pending: true, error: "provider still alive" }; },
    getTaskOperation() { return { status: "running", pending: true }; },
  };
  const owner = controller(runtime);
  await assert.rejects(
    owner.call("Personal held create", "conversation", () => new Promise(() => undefined)),
    (error) => {
      assert.equal(error.runtimeCleanupAttempted, true);
      assert.equal(error.runtimeCleanupOk, false);
      assert.match(error.message, /cancellation was not confirmed.*provider still alive/i);
      return true;
    },
  );
});

test("invalid generated operation ids are rejected before provider invocation", async () => {
  let invoked = false;
  const runtime = {
    async cancelTaskOperation() { return { ok: true }; },
    getTaskOperation() { return null; },
  };
  const owner = createTaskRuntimeOperationController({
    personalAgentRuntime: runtime,
    createId: () => "unsafe operation id with spaces",
    timeoutMs: 5,
  });
  await assert.rejects(owner.call("Personal start", "message", () => { invoked = true; }), /operation id is invalid/i);
  assert.equal(invoked, false);
});
