const RUN_PERSIST_DEBOUNCE_MS = 250;
const RUN_STATE_RETENTION_MS = 5 * 60_000;

export function createRunPersistence({
  persistRun,
  runs,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  function schedulePersistRun(state) {
    state.persistDirty = true;
    if (state.persistFlushPromise || state.persistTimer) return;
    state.persistTimer = setTimer(() => {
      state.persistTimer = null;
      void flushPersistRun(state).catch(() => undefined);
    }, RUN_PERSIST_DEBOUNCE_MS);
    state.persistTimer.unref?.();
  }

  function flushPersistRun(state, force = false) {
    if (force) state.persistDirty = true;
    if (state.persistFlushPromise) return state.persistFlushPromise;
    if (state.persistTimer) {
      clearTimer(state.persistTimer);
      state.persistTimer = null;
    }
    const flush = (async () => {
      while (state.persistDirty) {
        state.persistDirty = false;
        await persistRun(state);
      }
    })();
    state.persistFlushPromise = flush.finally(() => {
      state.persistFlushPromise = null;
      if (state.persistDirty) schedulePersistRun(state);
    });
    return state.persistFlushPromise;
  }

  function retainCompletedRunBriefly(state) {
    const timer = setTimer(() => {
      if (runs.get(state.runId) === state && state.status !== "running") runs.delete(state.runId);
    }, RUN_STATE_RETENTION_MS);
    timer.unref?.();
  }

  return { schedulePersistRun, flushPersistRun, retainCompletedRunBriefly };
}
