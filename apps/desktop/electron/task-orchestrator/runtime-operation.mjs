// @ts-check

import { withRuntimeDeadline } from "./runtime-deadline.mjs";

const SAFE_OPERATION_ID = /^[A-Za-z0-9_.:-]{1,160}$/;

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @typedef {Error & { code?: string, operationId?: string, runtimeCleanupAttempted?: boolean, runtimeCleanupOk?: boolean }} RuntimeOperationError */

/**
 * Caller-owned Personal runtime operations. A deadline must cancel the
 * underlying provider-owned operation before the orchestrator releases its
 * lease; Promise.race alone is not a cancellation boundary.
 */
export function createTaskRuntimeOperationController(options) {
  const { personalAgentRuntime, createId, timeoutMs } = options;
  if (typeof createId !== "function") throw new Error("Task runtime operation id factory is required");
  for (const method of ["cancelTaskOperation", "getTaskOperation"]) {
    if (typeof personalAgentRuntime?.[method] !== "function") {
      throw new Error(`personalAgentRuntime.${method} is required for caller-owned task operations`);
    }
  }

  function nextOperationId(kind = "runtime") {
    const value = String(createId(`task-${kind}`) ?? "").trim();
    if (!SAFE_OPERATION_ID.test(value)) throw new Error("Task runtime operation id is invalid");
    return value;
  }

  async function cancel(operationId, reason = "runtime-deadline") {
    if (!SAFE_OPERATION_ID.test(String(operationId ?? ""))) {
      return { ok: false, operationId: null, pending: true, error: "Task runtime operation id is invalid" };
    }
    let result;
    try {
      result = await withRuntimeDeadline(
        `Personal cancelTaskOperation (${reason})`,
        timeoutMs,
        () => personalAgentRuntime.cancelTaskOperation({ operationId, reason }, {
          cancelHandlerTimeoutMs: timeoutMs,
          cancelEscalationTimeoutMs: timeoutMs,
        }),
      );
    } catch (error) {
      return { ok: false, operationId, pending: true, error: messageOf(error) };
    }
    const snapshot = await Promise.resolve(personalAgentRuntime.getTaskOperation({ operationId })).catch(() => null);
    const pending = result?.pending === true || snapshot?.pending === true || snapshot?.status === "running";
    const ok = result?.ok === true && !pending;
    return {
      ok,
      operationId,
      pending,
      status: snapshot?.status ?? result?.status ?? null,
      runId: snapshot?.runId ?? result?.runId ?? null,
      error: ok ? null : messageOf(result?.error || "Personal task operation cancellation was not confirmed"),
    };
  }

  async function call(label, kind, invoke) {
    if (typeof invoke !== "function") throw new Error("Task runtime operation callback is required");
    const operationId = nextOperationId(kind);
    const controller = new AbortController();
    try {
      const value = await withRuntimeDeadline(label, timeoutMs, () => invoke({
        operationId,
        signal: controller.signal,
      }));
      return { value, operationId };
    } catch (error) {
      const next = /** @type {RuntimeOperationError} */ (error instanceof Error ? error : new Error(messageOf(error)));
      next.operationId = operationId;
      if (next.code !== "TASK_RUNTIME_CALL_TIMEOUT") throw next;
      controller.abort(next);
      const cancellation = await cancel(operationId, "runtime-deadline");
      next.runtimeCleanupAttempted = true;
      next.runtimeCleanupOk = cancellation.ok;
      if (!cancellation.ok) {
        next.message = `${next.message}; provider operation cancellation was not confirmed: ${cancellation.error}`;
      }
      throw next;
    }
  }

  return Object.freeze({ call, cancel, nextOperationId });
}
