import { createTaskLifecycleCoordinator } from "./task-lifecycle-coordinator.mjs";

export function createDesktopTaskLifecycle(options) {
  let disposed = false;

  async function stopDependents({ suppressErrors = false } = {}) {
    const messaging = await options.getMessagingRuntime().catch(() => null);
    const calls = [
      () => messaging?.deliveryPump.stop(),
      () => options.heartbeatScheduler.close(),
      () => options.channelInfrastructure.dispose(),
      () => options.runtimeManager.dispose(),
      () => options.cleanupRegisteredProcesses(),
    ];
    for (const call of calls) {
      const promise = Promise.resolve().then(call);
      if (suppressErrors) await promise.catch(() => undefined);
      else await promise;
    }
    messaging?.store.close();
  }

  const coordinator = createTaskLifecycleCoordinator({
    taskOrchestrator: options.taskOrchestrator,
    blockAdditionalWork: (reason) => options.personalAgentRuntime.blockStarts(reason),
    readAdditionalActiveWork: async () => {
      const items = (options.personalAgentRuntime.listProcesses()?.processes ?? [])
        .filter((process) => ["starting", "running", "waiting-approval", "stopping"].includes(String(process?.status ?? "running")))
        .map((process) => ({ runId: process.runId, provider: process.provider, status: process.status }));
      return { active: items.length > 0, activeCount: items.length, items };
    },
    stopDependentRuntimes: stopDependents,
    onDrained: () => { disposed = true; },
  });

  async function disposeBeforeQuit(reason = "explicit_quit") {
    if (disposed) return;
    await options.taskOrchestrator.pauseAllAndDrain(reason);
    options.unsubscribeTaskEvents();
    await stopDependents({ suppressErrors: true });
    disposed = true;
  }

  return { coordinator, disposeBeforeQuit, isDisposed: () => disposed };
}
