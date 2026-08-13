const MAX_TASK_OPERATION_ID_LENGTH = 160;
const TASK_OPERATION_RETENTION_MS = 5 * 60_000;
const MAX_RETAINED_TASK_OPERATIONS = 256;
const SAFE_TASK_OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

export function normalizeTaskOperationId(value) {
  const id = String(value ?? "").trim();
  if (!id) return null;
  if (id.length > MAX_TASK_OPERATION_ID_LENGTH || !SAFE_TASK_OPERATION_ID.test(id)) return null;
  return id;
}

export function taskOperationInputValue(input) {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";
  return input.operationId ?? input.taskOperationId ?? input.id ?? "";
}

export function taskOperationCancellationResult(operation, extra = {}) {
  return {
    ok: false,
    cancelled: true,
    status: "cancelled",
    operationId: operation?.operationId ?? null,
    error: "task operation cancelled",
    ...extra,
  };
}

function isAbortSignal(value) {
  return Boolean(value && typeof value === "object" && typeof value.addEventListener === "function");
}

export function createTaskOperationRegistry({ createId, cancelOperation }) {
  const operations = new Map();
  const timers = new Map();

  function snapshot(operation) {
    if (!operation) return null;
    const state = operation.state;
    return {
      ok: operation.status !== "failed",
      operationId: operation.operationId,
      kind: operation.kind,
      status: operation.status,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      finishedAt: operation.finishedAt ?? null,
      cancelReason: operation.cancelReason ?? null,
      runId: String(operation.runId ?? state?.runId ?? "").trim() || null,
      conversationId: String(operation.conversationId ?? state?.conversationId ?? "").trim() || null,
      resultStatus: String(state?.status ?? operation.resultStatus ?? "").trim() || null,
    };
  }

  function retain(operation) {
    if (!operation) return;
    const existingTimer = timers.get(operation.operationId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      timers.delete(operation.operationId);
      if (operations.get(operation.operationId) === operation) operations.delete(operation.operationId);
    }, TASK_OPERATION_RETENTION_MS);
    timer.unref?.();
    timers.set(operation.operationId, timer);
    while (operations.size > MAX_RETAINED_TASK_OPERATIONS) {
      const oldest = [...operations.values()].find((candidate) => candidate.status !== "cancelling");
      if (!oldest) break;
      const oldestTimer = timers.get(oldest.operationId);
      if (oldestTimer) clearTimeout(oldestTimer);
      timers.delete(oldest.operationId);
      operations.delete(oldest.operationId);
    }
  }

  function begin(kind, input = {}) {
    const requestedId = taskOperationInputValue(input);
    const hasSignal = isAbortSignal(input?.signal);
    if (!requestedId && !hasSignal) return null;
    const operationId = normalizeTaskOperationId(requestedId) ?? (requestedId ? null : `op-${createId()}`);
    if (!operationId) throw new Error("operationId must be a bounded safe identifier");
    const previous = operations.get(operationId);
    if (previous && ["pending", "cancelling"].includes(previous.status)) throw new Error(`task operation is already active: ${operationId}`);
    if (previous) {
      const previousTimer = timers.get(operationId);
      if (previousTimer) clearTimeout(previousTimer);
      timers.delete(operationId);
    }
    const controller = new AbortController();
    const operation = {
      operationId, kind, status: "pending", createdAt: Date.now(), updatedAt: Date.now(),
      finishedAt: null, cancelReason: null, cancelPromise: null, cancelSettled: true,
      state: null, runId: null, conversationId: null, controller, signal: controller.signal,
      sourceSignal: hasSignal ? input.signal : null, removeAbortListener: null,
    };
    operations.set(operationId, operation);
    if (hasSignal) {
      const abort = () => {
        operation.cancelReason = "aborted";
        try { controller.abort(); } catch { /* already aborted */ }
        void cancelOperation(operationId, { reason: "aborted" }).catch(() => undefined);
      };
      if (input.signal.aborted) abort();
      else {
        input.signal.addEventListener("abort", abort, { once: true });
        operation.removeAbortListener = () => input.signal.removeEventListener?.("abort", abort);
      }
    }
    return operation;
  }

  function markCancelled(operation, reason = "caller-cancelled") {
    if (!operation) return;
    operation.cancelReason = String(reason || "caller-cancelled").slice(0, 120);
    operation.updatedAt = Date.now();
    if (operation.status === "pending") operation.status = "cancelling";
    try { operation.controller.abort(); } catch { /* already aborted */ }
  }

  function finish(operation, result = null, error = null) {
    if (!operation) return;
    if (!error && operation.kind === "startMessage" && operation.state?.taskStarted === true && operation.state.taskSettled !== true) {
      operation.updatedAt = Date.now();
      if (!operation.cancelReason) operation.status = "pending";
      return;
    }
    if (!error && operation.kind === "startMessage" && operation.state?.status === "running" && !operation.cancelReason) {
      operation.status = "pending";
      operation.updatedAt = Date.now();
      return;
    }
    operation.updatedAt = Date.now();
    operation.finishedAt = Date.now();
    operation.removeAbortListener?.();
    if (error || result?.status === "failed") operation.status = operation.status === "cancelling" ? "cancelled" : "failed";
    else if (operation.status === "cancelling" || operation.cancelReason) operation.status = "cancelled";
    else operation.status = "completed";
    operation.resultStatus = result?.status ?? operation.state?.status ?? null;
    operation.runId = operation.runId ?? result?.runId ?? operation.state?.runId ?? null;
    operation.conversationId = operation.conversationId ?? result?.conversationId ?? operation.state?.conversationId ?? null;
    retain(operation);
  }

  function maybeFinish(operation, result = null, error = null) {
    if (!operation) return;
    if (operation.cancelSettled === false || (operation.kind === "startMessage" && operation.state?.taskStarted === true && operation.state.taskSettled !== true)) {
      operation.updatedAt = Date.now();
      return;
    }
    finish(operation, result, error);
  }

  function lookup(input = {}) {
    const operationId = normalizeTaskOperationId(taskOperationInputValue(input));
    return operationId ? snapshot(operations.get(operationId)) : null;
  }

  return { begin, finish, get: (id) => operations.get(id), lookup, markCancelled, maybeFinish, retain };
}
