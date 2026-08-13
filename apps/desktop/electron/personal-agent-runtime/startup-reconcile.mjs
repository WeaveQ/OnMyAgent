import { cleanupRegisteredAgentProcesses, recoverAgentProcesses } from "./process-registry.mjs";
import { reconcileChannelActiveRuns } from "./reconcile-channel-active-runs.mjs";

/**
 * Queue startup process recovery before current-session registrations can
 * replace the persisted restart snapshot, while deferring destructive cleanup
 * off the desktop cold path.
 */
export function schedulePersonalAgentStartupReconcile(options) {
  let closed = false;
  let timer = null;
  const reconcileCutoffMs = Number(options.reconcileCutoffMs);
  const startupProcessRecovery = recoverAgentProcesses({
    startedBeforeMs: reconcileCutoffMs,
  }).catch(() => ({ processes: [] }));

  const run = async () => {
    if (closed) return;
    // Keep this sequence ordered: current-session ACP records are protected by
    // the cutoff before old trees are reaped and orphan state is finalized.
    await startupProcessRecovery;
    await cleanupRegisteredAgentProcesses({ startedBeforeMs: reconcileCutoffMs }).catch(() => undefined);
    await options.reconcileOrphanRuns().catch(() => undefined);
    await reconcileChannelActiveRuns({
      userDataDir: String(options.userDataDir ?? "").trim(),
      getRun: options.getRun,
      reconcileCutoffMs,
    }).catch(() => undefined);
  };

  const deferMs = Math.max(0, Number(options.deferMs ?? 0) || 0);
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const start = () => {
    timer = null;
    void run().finally(resolveReady);
  };
  if (deferMs > 0) {
    timer = setTimeout(start, deferMs);
    timer.unref?.();
  } else {
    start();
  }
  return {
    ready,
    async close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
        resolveReady();
      }
      // recoverAgentProcesses is deliberately queued immediately so it
      // snapshots persisted ownership before current-session registrations.
      // Even when the deferred destructive pass never starts, close must drain
      // that already-owned read/write before callers remove or repoint the
      // runtime-state root.
      await startupProcessRecovery;
      await ready;
    },
  };
}
