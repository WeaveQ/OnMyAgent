/** Push-first event delivery for the Personal Local Agent runtime. */
export function createRuntimeEventPublisher(options = {}) {
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : null;
  const eventState = new WeakMap();
  const timers = new Map();
  const pendingDeltas = new Map();
  const finishedRuns = new Map();
  const MAX_FINISHED_RUNS = 2_048;
  const MAX_PENDING_EVENTS = 128;
  const DELTA_COALESCE_MS = 40;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;

  function emit(state, type, payload = {}) {
    if (!onEvent || !state?.runId) return;
    const id = String(state.runId);
    try {
      onEvent({
        type,
        runId: id,
        workspaceRoot: state.workspaceRoot,
        conversationId: state.conversationId ?? null,
        status: state.status,
        updatedAt: state.updatedAt ?? Date.now(),
        revision: Number(state.eventRevision) || 0,
        ...(payload.revisionStart === undefined ? {} : { revisionStart: payload.revisionStart }),
        ...(payload.events?.length ? { events: payload.events } : {}),
        ...(payload.snapshotRequired ? { snapshotRequired: true } : {}),
      });
    } catch {
      // Renderer delivery is best-effort; runtime state remains authoritative.
    }
  }

  function flushDelta(state, type = "run.delta") {
    const id = String(state.runId);
    const pending = pendingDeltas.get(id);
    pendingDeltas.delete(id);
    emit(state, type, pending ?? {});
  }

  function queueDelta(state, event) {
    if (!onEvent) return;
    const id = String(state.runId);
    const revision = Number(state.eventRevision) || 0;
    const pending = pendingDeltas.get(id) ?? {
      revisionStart: revision,
      events: [],
      snapshotRequired: false,
    };
    if (!pending.snapshotRequired) {
      pending.events.push(event);
      if (pending.events.length > MAX_PENDING_EVENTS) {
        pending.events = [];
        pending.snapshotRequired = true;
      }
    }
    pendingDeltas.set(id, pending);
    if (timers.has(id)) return;
    const timer = setTimer(() => {
      timers.delete(id);
      flushDelta(state);
    }, DELTA_COALESCE_MS);
    timer?.unref?.();
    timers.set(id, timer);
  }

  function publish(state, type = "run.delta") {
    if (!onEvent || !state?.runId || type === "run.delta") return;
    const id = String(state.runId);
    if (type === "run.finished") {
      const revision = Number(state.eventRevision) || 0;
      if (finishedRuns.get(id) === revision) return;
      const pendingTimer = timers.get(id);
      if (pendingTimer) clearTimer(pendingTimer);
      timers.delete(id);
      flushDelta(state, type);
      finishedRuns.delete(id);
      finishedRuns.set(id, revision);
      while (finishedRuns.size > MAX_FINISHED_RUNS) {
        const oldest = finishedRuns.keys().next().value;
        if (oldest === undefined) break;
        finishedRuns.delete(oldest);
      }
      return;
    }
    emit(state, type);
  }

  function register(events, state) {
    if (!Number.isSafeInteger(Number(state?.eventRevision))) {
      state.eventRevision = Array.isArray(events) ? events.length : 0;
    }
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
    if (state) {
      state.eventRevision = (Number(state.eventRevision) || 0) + 1;
      const stored = events.at(-1) ?? normalized;
      const eventId = String(stored?.eventId ?? "").trim() || `${state.runId}:${state.eventRevision}`;
      if (stored && typeof stored === "object") stored.eventId = eventId;
      if (normalized && typeof normalized === "object") normalized.eventId = eventId;
      queueDelta(state, stored);
    }
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
