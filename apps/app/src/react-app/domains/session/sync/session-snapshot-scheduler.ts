export type SessionSnapshotPriority = "interactive" | "prefetch" | "background";

export type SessionSnapshotScheduleInput<T> = {
  workspaceId: string;
  requestKey: string;
  priority: SessionSnapshotPriority;
  signal?: AbortSignal;
  run: (signal: AbortSignal) => Promise<T>;
};

type ScheduledTask = {
  requestKey: string;
  promise: Promise<unknown>;
  execute: () => Promise<void>;
  cancel: () => void;
  isSettled: () => boolean;
  onSettled: (listener: () => void) => void;
};

type Lane = {
  active: ScheduledTask | null;
  queue: ScheduledTask[];
  draining: boolean;
};

type WorkspaceSchedulerState = {
  interactive: Lane;
  background: Lane;
  activeExecutions: number;
  executionSlotWaiters: Array<() => void>;
  tasksByRequestKey: Map<string, ScheduledTask>;
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
): {
  task: ScheduledTask;
  promise: Promise<T>;
} {
  const controller = new AbortController();
  let settled = false;
  let resolveRequest: (value: T | PromiseLike<T>) => void = () => undefined;
  let rejectRequest: (reason?: unknown) => void = () => undefined;
  let releaseExecution: () => void = () => undefined;
  let settledListener: (() => void) | null = null;
  const executionReleased = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });

  const removeAbortListener = () => {
    input.signal?.removeEventListener("abort", cancel);
  };

  const settle = (): boolean => {
    if (settled) return false;
    settled = true;
    removeAbortListener();
    settledListener?.();
    return true;
  };

  const cancel = () => {
    controller.abort();
    if (settle()) rejectRequest(abortError());
    // Do not let an uncooperative transport hold the interactive lane until
    // its own timeout. Its result remains observed below, but new work can run.
    releaseExecution();
  };

  const task: ScheduledTask = {
    requestKey: input.requestKey,
    promise: Promise.resolve(),
    execute: async () => undefined,
    cancel,
    isSettled: () => settled,
    onSettled: (listener) => {
      settledListener = listener;
    },
  };

  const promise = new Promise<T>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
    if (input.signal?.aborted) {
      cancel();
      return;
    }
    input.signal?.addEventListener("abort", cancel, { once: true });
  });
  task.promise = promise;

  task.execute = async () => {
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
        if (settle()) resolveRequest(value);
      } catch (error) {
        if (settle()) rejectRequest(error);
      } finally {
        releaseSlot?.();
      }
    })();
    await Promise.race([run, executionReleased]);
  };

  return { task, promise };
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

  const state = schedulerByWorkspace.get(workspaceId) ?? createWorkspaceState();
  schedulerByWorkspace.set(workspaceId, state);
  const existing = state.tasksByRequestKey.get(requestKey);
  if (existing && !existing.isSettled()) return existing.promise as Promise<T>;
  if (existing) state.tasksByRequestKey.delete(requestKey);

  const { task, promise } = createScheduledTask(
    { ...input, workspaceId, requestKey },
    state,
  );
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
    if (lane.active && lane.active.requestKey !== requestKey) lane.active.cancel();
    for (const queued of lane.queue) {
      if (queued.requestKey !== requestKey) queued.cancel();
    }
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
