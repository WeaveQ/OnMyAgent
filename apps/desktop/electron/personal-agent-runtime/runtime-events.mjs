/** Push-first event delivery for the Personal Local Agent runtime. */
export function createRuntimeEventPublisher(options = {}) {
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : null;
  const eventState = new WeakMap();
  const timers = new Map();
  const finishedRuns = new Set();
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;

  function publish(state, type = "run.delta") {
    if (!onEvent || !state?.runId) return;
    const id = String(state.runId);
    if (type === "run.finished" && finishedRuns.has(id)) return;
    const emit = () => {
      timers.delete(id);
      if (type === "run.finished") finishedRuns.add(id);
      try {
        onEvent({
          type,
          runId: id,
          workspaceRoot: state.workspaceRoot,
          conversationId: state.conversationId ?? null,
          status: state.status,
          updatedAt: state.updatedAt ?? Date.now(),
        });
      } catch {
        // Renderer delivery is best-effort; runtime state remains authoritative.
      }
    };
    if (type !== "run.delta" || state.status !== "running") {
      const pending = timers.get(id);
      if (pending) clearTimer(pending);
      emit();
      return;
    }
    if (timers.has(id)) return;
    const timer = setTimer(emit, 75);
    timer?.unref?.();
    timers.set(id, timer);
  }

  function register(events, state) {
    eventState.set(events, state);
  }

  function invalidateCatalog(workspaceRoot = "") {
    if (!onEvent) return;
    try {
      onEvent({
        type: "catalog.invalidated",
        runId: null,
        workspaceRoot: String(workspaceRoot ?? ""),
        conversationId: null,
        status: "completed",
        updatedAt: Date.now(),
      });
    } catch {
      // Renderer delivery is best-effort; catalog reads remain authoritative.
    }
  }

  function append(appendRaw, events, event) {
    const normalized = appendRaw(events, event);
    const state = eventState.get(events);
    if (state) publish(state);
    return normalized;
  }

  function wrapCatalogMutation(method) {
    return async (input = {}) => {
      const result = await method(input);
      invalidateCatalog(input.workspaceRoot);
      return result;
    };
  }

  return { append, invalidateCatalog, publish, register, wrapCatalogMutation };
}
