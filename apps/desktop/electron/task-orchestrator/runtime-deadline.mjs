// @ts-check

const DEFAULT_RUNTIME_CALL_TIMEOUT_MS = 30_000;
const MAX_RUNTIME_CALL_TIMEOUT_MS = 14_400_000;

/**
 * Bound one call into the Personal/ACP runtime. The underlying provider may
 * ignore cancellation, so this helper only fences the caller; the orchestrator
 * must still revoke its durable lease and invoke the cancellation escalator.
 *
 * @template T
 * @param {string} label
 * @param {number | null | undefined} timeoutMs
 * @param {() => Promise<T> | T} operation
 * @param {{setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout}} [options]
 * @returns {Promise<T>}
 */
export async function withRuntimeDeadline(label, timeoutMs, operation, options = {}) {
  if (typeof operation !== "function") throw new TypeError("Runtime deadline operation is required");
  const normalizedLabel = String(label ?? "Personal runtime call").trim() || "Personal runtime call";
  const configured = Number(timeoutMs ?? DEFAULT_RUNTIME_CALL_TIMEOUT_MS);
  const deadlineMs = Math.min(
    MAX_RUNTIME_CALL_TIMEOUT_MS,
    Math.max(1, Number.isFinite(configured) ? Math.round(configured) : DEFAULT_RUNTIME_CALL_TIMEOUT_MS),
  );
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimer(() => {
      reject(Object.assign(new Error(`${normalizedLabel} timed out after ${deadlineMs}ms`), {
        code: "TASK_RUNTIME_CALL_TIMEOUT",
        deadlineMs,
      }));
    }, deadlineMs);
    timer?.unref?.();
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    if (timer !== undefined) clearTimer(timer);
  }
}

export const TASK_RUNTIME_CALL_TIMEOUT_MS = DEFAULT_RUNTIME_CALL_TIMEOUT_MS;
