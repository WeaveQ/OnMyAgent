import type { SidebarRuntimeUpdate } from "./runtime-session-state";

export type SidebarRuntimeUpdateBucket = {
  workspaceId: string;
  sessionId: string;
  updates: SidebarRuntimeUpdate[];
};

type AnimationFrameScheduler = {
  schedule: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

/**
 * Coalesce noisy session metadata/status events into one renderer commit per
 * animation frame. Events for one workspace/session retain arrival order;
 * different sessions can safely share the same commit.
 */
export function createSidebarRuntimeUpdateCoordinator(input: {
  flush: (buckets: SidebarRuntimeUpdateBucket[]) => void;
  scheduler: AnimationFrameScheduler;
}) {
  const bucketsByKey = new Map<string, SidebarRuntimeUpdateBucket>();
  let frameHandle: number | null = null;
  let disposed = false;

  const flush = () => {
    frameHandle = null;
    if (disposed || bucketsByKey.size === 0) return;
    const buckets = [...bucketsByKey.values()];
    bucketsByKey.clear();
    input.flush(buckets);
  };

  const enqueue = (event: SidebarRuntimeUpdate) => {
    if (disposed) return;
    const sessionId = event.update.sessionId.trim();
    const workspaceId = event.workspaceId.trim();
    if (!workspaceId || !sessionId) return;
    const key = `${workspaceId}\u0000${sessionId}`;
    const existing = bucketsByKey.get(key);
    if (existing) {
      existing.updates.push(event);
    } else {
      bucketsByKey.set(key, { workspaceId, sessionId, updates: [event] });
    }
    if (frameHandle === null) frameHandle = input.scheduler.schedule(flush);
  };

  const dispose = () => {
    disposed = true;
    if (frameHandle !== null) input.scheduler.cancel(frameHandle);
    frameHandle = null;
    bucketsByKey.clear();
  };

  return { enqueue, dispose };
}
