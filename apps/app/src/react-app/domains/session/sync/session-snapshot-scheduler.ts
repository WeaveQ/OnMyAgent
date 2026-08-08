export type SessionSnapshotPriority = "interactive" | "prefetch" | "background";

export type SessionSnapshotScheduleInput<T> = {
  workspaceId: string;
  requestKey: string;
  priority: SessionSnapshotPriority;
  signal?: AbortSignal;
  run: (signal: AbortSignal) => Promise<T>;
};

type SnapshotSubscriber<T> = {
  settle: (result: SnapshotResult<T>) => void;
  signal?: AbortSignal;
};

type SnapshotResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

type ScheduledTask<T> = {
  requestKey: string;
  execute: () => Promise<void>;
  cancel: () => void;
  isSettled: () => boolean;
  onSettled: (listener: () => void) => void;
  subscribe: (signal?: AbortSignal) => Promise<T>;
};

type Lane = {
  active: ScheduledTask<unknown> | null;
  queue: ScheduledTask<unknown>[];
  draining: boolean;
};

type WorkspaceSchedulerState = {
  interactive: Lane;
  background: Lane;
  activeExecutions: number;
  executionSlotWaiters: Array<() => void>;
  tasksByRequestKey: Map<string, ScheduledTask<unknown>>;
};

const schedulerByWorkspace = new Map<string, WorkspaceSchedulerState>();
const BACKGROUND_QUEUE_LIMIT = 2;
const WORKSPACE_EXECUTION_LIMIT = 2;

function createLane(): Lane {
  return { active: null, queue: [], draining: false };
}

function createWorkspaceState(): WorkspaceSchedulerState {
  return {
    interactive: createLane(),
    background: createLane(),
    activeExecutions: 0,
    executionSlotWaiters: [],
    tasksByRequestKey: new Map(),
  };
}

function abortError(): Error {
  const error = new Error("Request aborted.");
  error.name = "AbortError";
  return error;
}

function acquireExecutionSlot(
  workspaceId: string,
  state: WorkspaceSchedulerState,
  signal: AbortSignal,
): Promise<() => void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      state.activeExecutions -= 1;
      state.executionSlotWaiters.shift()?.();
      if (isWorkspaceIdle(state) && schedulerByWorkspace.get(workspaceId) === state) {
        schedulerByWorkspace.delete(workspaceId);
      }
    };
    const grant = () => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      state.activeExecutions += 1;
      resolve(release);
    };
    const onAbort = () => {
      const index = state.executionSlotWaiters.indexOf(grant);
      if (index >= 0) state.executionSlotWaiters.splice(index, 1);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (state.activeExecutions < WORKSPACE_EXECUTION_LIMIT) grant();
    else state.executionSlotWaiters.push(grant);
  });
}

function createScheduledTask<T>(
  input: SessionSnapshotScheduleInput<T>,
  state: WorkspaceSchedulerState,
): ScheduledTask<T> {
  const controller = new AbortController();
  const subscribers = new Set<SnapshotSubscriber<T>>();
  let settled = false;
  let releaseExecution: () => void = () => undefined;
  let settledListener: (() => void) | null = null;
  const executionReleased = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });

  const settle = (result: SnapshotResult<T>): boolean => {
    if (settled) return false;
    settled = true;
    for (const subscriber of subscribers) {
      subscriber.signal?.removeEventListener("abort", onSubscriberAbort);
      subscriber.settle(result);
    }
    subscribers.clear();
    settledListener?.();
    return true;
  };

  const cancelTransportWhenUnobserved = () => {
    if (settled || subscribers.size > 0) return;
    controller.abort();
    if (settle({ ok: false, error: abortError() })) releaseExecution();
  };

  const onSubscriberAbort = (event: Event) => {
    const signal = event.target;
    const abortedSubscribers = [...subscribers].filter(
      (subscriber) => subscriber.signal === signal,
    );
    for (const subscriber of abortedSubscribers) {
      subscribers.delete(subscriber);
      subscriber.signal?.removeEventListener("abort", onSubscriberAbort);
      subscriber.settle({ ok: false, error: abortError() });
    }
    cancelTransportWhenUnobserved();
  };

  const cancel = () => {
    controller.abort();
    if (settle({ ok: false, error: abortError() })) releaseExecution();
  };

  const task: ScheduledTask<T> = {
    requestKey: input.requestKey,
    execute: async () => {
      if (settled) return;
      const run = (async () => {
        let releaseSlot: (() => void) | null = null;
        try {
          releaseSlot = await acquireExecutionSlot(
            input.workspaceId,
            state,
            controller.signal,
          );
          if (settled) return;
          const value = await input.run(controller.signal);
          settle({ ok: true, value });
        } catch (error) {
          settle({ ok: false, error });
        } finally {
          releaseSlot?.();
        }
      })();
      await Promise.race([run, executionReleased]);
    },
    cancel,
    isSettled: () => settled,
    onSettled: (listener) => {
      settledListener = listener;
    },
    subscribe: (signal?: AbortSignal) =>
      new Promise<T>((resolve, reject) => {
        if (settled || signal?.aborted) {
          reject(abortError());
          return;
        }
        const subscriber: SnapshotSubscriber<T> = {
          signal,
          settle: (result) => {
            if (result.ok) resolve(result.value);
            else reject(result.error);
          },
        };
        subscribers.add(subscriber);
        signal?.addEventListener("abort", onSubscriberAbort, { once: true });
      }),
  };

  return task;
}

function discardSettled(lane: Lane) {
  lane.queue = lane.queue.filter((task) => !task.isSettled());
}

function isWorkspaceIdle(state: WorkspaceSchedulerState): boolean {
  return (
    state.interactive.active === null &&
    state.interactive.queue.length === 0 &&
    state.background.active === null &&
    state.background.queue.length === 0 &&
    state.activeExecutions === 0 &&
    state.executionSlotWaiters.length === 0
  );
}

async function drainWorkspaceLane(
  workspaceId: string,
  state: WorkspaceSchedulerState,
  lane: Lane,
) {
  if (lane.draining) return;
  lane.draining = true;
  try {
    while (true) {
      discardSettled(lane);
      const task = lane.queue.shift();
      if (!task) return;
      lane.active = task;
      await task.execute();
      lane.active = null;
    }
  } finally {
    lane.active = null;
    lane.draining = false;
    discardSettled(lane);
    if (isWorkspaceIdle(state)) schedulerByWorkspace.delete(workspaceId);
  }
}

function cancelSupersededInteractiveWork(lane: Lane, requestKey: string) {
  if (lane.active && lane.active.requestKey !== requestKey) lane.active.cancel();
  for (const queued of lane.queue) {
    if (queued.requestKey !== requestKey) queued.cancel();
  }
}

function promoteQueuedTask(
  task: ScheduledTask<unknown>,
  from: Lane,
  to: Lane,
): boolean {
  const index = from.queue.indexOf(task);
  if (index < 0) return false;
  from.queue.splice(index, 1);
  to.queue.push(task);
  return true;
}

export function scheduleSessionSnapshot<T>(
  input: SessionSnapshotScheduleInput<T>,
): Promise<T> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    return Promise.reject(new Error("workspaceId is required."));
  }
  const requestKey = input.requestKey.trim();
  if (!requestKey) {
    return Promise.reject(new Error("requestKey is required."));
  }
  if (input.signal?.aborted) return Promise.reject(abortError());

  const state = schedulerByWorkspace.get(workspaceId) ?? createWorkspaceState();
  schedulerByWorkspace.set(workspaceId, state);
  const existing = state.tasksByRequestKey.get(requestKey);
  if (existing && !existing.isSettled()) {
    if (input.priority === "interactive") {
      cancelSupersededInteractiveWork(state.interactive, requestKey);
      if (promoteQueuedTask(existing, state.background, state.interactive)) {
        void drainWorkspaceLane(workspaceId, state, state.interactive);
      }
    }
    // requestKey identifies a single snapshot contract within one workspace.
    // The map intentionally erases that contract so unrelated keys can share
    // scheduler state; restoring it here is the sole generic boundary.
    const sharedTask = existing as ScheduledTask<T>;
    return sharedTask.subscribe(input.signal);
  }
  if (existing) state.tasksByRequestKey.delete(requestKey);

  const task = createScheduledTask({ ...input, workspaceId, requestKey }, state);
  const promise = task.subscribe(input.signal);
  if (!task.isSettled()) {
    state.tasksByRequestKey.set(requestKey, task);
    task.onSettled(() => {
      if (state.tasksByRequestKey.get(requestKey) === task) {
        state.tasksByRequestKey.delete(requestKey);
      }
    });
  }
  const lane = input.priority === "interactive" ? state.interactive : state.background;

  if (input.priority === "interactive") {
    cancelSupersededInteractiveWork(lane, requestKey);
  } else {
    discardSettled(lane);
    while (lane.queue.length >= BACKGROUND_QUEUE_LIMIT) {
      lane.queue.shift()?.cancel();
      discardSettled(lane);
    }
  }

  lane.queue.push(task);
  void drainWorkspaceLane(workspaceId, state, lane);
  return promise;
}
