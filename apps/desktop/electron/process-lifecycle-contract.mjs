/**
 * Shared lifecycle vocabulary for desktop-owned child/runtime owners.
 *
 * The contract is intentionally storage-agnostic: each runtime keeps its own
 * process truth, while launch, health, cancellation and teardown expose the
 * same observable state shape to diagnostics and the UI.
 */
export const PROCESS_LIFECYCLE_STATES = Object.freeze([
  "idle",
  "cleaning",
  "starting",
  "healthy",
  "stopping",
  "stopped",
  "error",
]);

function errorDetails(error) {
  if (!error) return null;
  return {
    code: String(error.code ?? "RUNTIME_LIFECYCLE_ERROR"),
    message: error instanceof Error ? error.message : String(error),
  };
}
export function createProcessLifecycleContract(options = {}) {
  const name = String(options.name ?? "runtime").trim() || "runtime";
  const now = typeof options.now === "function" ? options.now : Date.now;
  let state = "idle";
  let operation = null;
  let lastError = null;
  let changedAt = now();
  let transitionCount = 0;

  function transition(nextState, details = {}) {
    const next = String(nextState ?? "").trim();
    if (!PROCESS_LIFECYCLE_STATES.includes(next)) {
      throw new Error(`Unknown ${name} lifecycle state: ${next}`);
    }
    state = next;
    operation = details.operation == null ? operation : String(details.operation);
    lastError = errorDetails(details.error);
    changedAt = now();
    transitionCount += 1;
    return snapshot();
  }

  function snapshot(extra = {}) {
    return {
      name,
      state,
      operation,
      changedAt,
      transitionCount,
      lastError: lastError ? { ...lastError } : null,
      ...extra,
    };
  }

  async function run(operationName, action) {
    if (typeof action !== "function") throw new Error(`${name} lifecycle action is required`);
    transition("starting", { operation: operationName });
    try {
      const result = await action();
      transition("healthy", { operation: operationName });
      return result;
    } catch (error) {
      transition("error", { operation: operationName, error });
      throw error;
    }
  }

  async function stop(operationName, action) {
    if (typeof action !== "function") throw new Error(`${name} lifecycle stop action is required`);
    if (state === "stopped" || state === "idle") {
      transition("stopped", { operation: operationName });
      return { alreadyStopped: true };
    }
    transition("stopping", { operation: operationName });
    try {
      const result = await action();
      transition("stopped", { operation: operationName });
      return result;
    } catch (error) {
      transition("error", { operation: operationName, error });
      throw error;
    }
  }

  return Object.freeze({
    transition,
    run,
    stop,
    state: () => state,
    snapshot,
  });
}
