/**
 * Main-owned gate that coordinates destructive and engine lifecycle changes
 * with the detached Task Supervisor. The renderer is advisory; this boundary
 * is authoritative even when an IPC caller bypasses UI disabled states.
 */
export function createTaskLifecycleCoordinator(options = {}) {
  const taskOrchestrator = options.taskOrchestrator;
  if (!taskOrchestrator) throw new Error("taskOrchestrator is required");
  const stopDependentRuntimes = options.stopDependentRuntimes ?? (async () => undefined);
  const readAdditionalActiveWork = options.readAdditionalActiveWork ?? (async () => ({ active: false, items: [] }));
  const blockAdditionalWork = options.blockAdditionalWork ?? (() => () => undefined);
  const onDrained = options.onDrained ?? (() => undefined);
  let destructivePromise = null;
  let lifecycleOperation = null;

  function lifecycleBusyError(operation) {
    return Object.assign(
      new Error(`Task Center lifecycle operation ${lifecycleOperation?.operation ?? "unknown"} is already in progress`),
      {
        code: "TASK_CENTER_LIFECYCLE_BUSY",
        operation,
        activeOperation: lifecycleOperation?.operation ?? null,
      },
    );
  }

  async function readActiveTaskWork(operation) {
    const [active, additional] = await Promise.all([
      taskOrchestrator.getActiveWork(),
      readAdditionalActiveWork(),
    ]);
    const tasks = Array.isArray(active?.tasks) ? active.tasks : [];
    const otherItems = Array.isArray(additional?.items) ? additional.items : [];
    const activeCount = (Number(active?.activeCount) || tasks.length) + (Number(additional?.activeCount) || otherItems.length);
    if (active?.active || additional?.active || activeCount > 0) {
      throw Object.assign(
        new Error(`Pause or stop ${activeCount} active local task(s) before ${operation}`),
        {
          code: "LOCAL_AGENT_ACTIVE_WORK",
          operation,
          taskIds: tasks.slice(0, 20).map((task) => task.taskId),
          runIds: otherItems.slice(0, 20).map((item) => item.runId).filter(Boolean),
          activeCount,
        },
      );
    }
    return { ok: true, operation, activeCount: 0 };
  }

  async function assertNoActiveTaskWork(operation = "runtime_lifecycle") {
    if (lifecycleOperation) throw lifecycleBusyError(operation);
    return readActiveTaskWork(operation);
  }

  async function withNoActiveTaskWork(operation, action) {
    if (lifecycleOperation) throw lifecycleBusyError(operation);
    const identity = { operation, destructive: false };
    lifecycleOperation = identity;
    let release = null;
    let releaseAdditional = null;
    try {
      release = taskOrchestrator.blockMutations(operation);
      releaseAdditional = blockAdditionalWork(operation);
      await taskOrchestrator.awaitMutationsIdle();
      await readActiveTaskWork(operation);
      return await action();
    } finally {
      releaseAdditional?.();
      release?.();
      if (lifecycleOperation === identity) lifecycleOperation = null;
    }
  }

  async function prepareDestructiveReset(reason = "full_reset") {
    if (destructivePromise) return destructivePromise;
    if (lifecycleOperation) throw lifecycleBusyError(reason);
    const identity = { operation: reason, destructive: true };
    lifecycleOperation = identity;
    let release = null;
    let releaseAdditional = null;
    try {
      release = taskOrchestrator.blockMutations(reason);
      releaseAdditional = blockAdditionalWork(reason);
      taskOrchestrator.stopWatchdog();
    } catch (error) {
      releaseAdditional?.();
      release?.();
      if (lifecycleOperation === identity) lifecycleOperation = null;
      throw error;
    }
    destructivePromise = (async () => {
      await taskOrchestrator.awaitMutationsIdle();
      await taskOrchestrator.pauseAllAndDrain(reason);
      await stopDependentRuntimes(reason);
      onDrained(reason);
      release();
      return { ok: true, reason };
    })().catch((error) => {
      releaseAdditional?.();
      release();
      destructivePromise = null;
      if (lifecycleOperation === identity) lifecycleOperation = null;
      // A failed strict drain leaves the Supervisor/client retryable. Restore
      // autonomous health monitoring before returning the failure; a client
      // that did close successfully will reject startWatchdog and stays closed.
      try { taskOrchestrator.startWatchdog(); } catch { /* already safely closed */ }
      throw error;
    });
    return destructivePromise;
  }

  return Object.freeze({
    assertNoActiveTaskWork,
    withNoActiveTaskWork,
    prepareDestructiveReset,
    destructiveInFlight: () => Boolean(destructivePromise),
    lifecycleStatus: () => lifecycleOperation ? { ...lifecycleOperation } : null,
  });
}
