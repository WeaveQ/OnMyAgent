import { createDurableMessagingTaskRouter, createMessagingTaskEventEnqueuer } from "./channels/durable-messaging-task-router.mjs";
import { createMessagingTaskDeliveryPump } from "./channels/messaging-task-delivery-pump.mjs";
import { createMessagingTaskStore } from "./channels/messaging-task-store.mjs";

const SIGNIFICANT_EVENTS = new Set(["approval-required", "run-blocked", "run-succeeded", "run-failed", "run-cancelled", "run-paused"]);

export function createDeferredMessagingTaskRouter() {
  let runtimePromise = null;
  return {
    setRuntimePromise(value) { runtimePromise = value; },
    getRuntimePromise() { return runtimePromise; },
    async route(envelope) {
      const runtime = await runtimePromise;
      if (!runtime) throw Object.assign(new Error("Messaging Task runtime is not ready"), { code: "MESSAGING_TASK_NOT_READY" });
      return runtime.router(envelope);
    },
  };
}

export function createChannelTaskCreateInputResolver({ readWorkspaceState, personalAgentRuntime }) {
  return async function resolve(envelope) {
    const state = await readWorkspaceState();
    const selectedId = state.selectedId || state.activeId || state.workspaces?.[0]?.id || "";
    const selected = state.workspaces?.find((entry) => entry?.id === selectedId) ?? state.workspaces?.[0] ?? null;
    const workspaceRoot = String(selected?.path ?? "").trim();
    if (!workspaceRoot || selected?.workspaceType === "remote") throw Object.assign(new Error("A selected local workspace is required for a durable channel Task"), { code: "LOCAL_WORKSPACE_REQUIRED" });
    const catalog = await personalAgentRuntime.listAvailableAgentMetadata({ workspaceRoot, includeModels: true, refresh: true });
    const agents = Array.isArray(catalog?.agents) ? catalog.agents : [];
    const agent = agents.find((item) => item.id === "codex") ?? agents.find((item) => item.backend === "codex" || item.provider === "codex") ?? agents[0];
    if (!agent) throw Object.assign(new Error("No available local agent can run this Task"), { code: "LOCAL_AGENT_UNAVAILABLE" });
    const models = Array.isArray(agent?.handshake?.available_models) ? agent.handshake.available_models : [];
    const model = models.find((item) => item?.id === "gpt-5.6-sol") ?? models[0] ?? null;
    const attachments = Array.isArray(envelope.attachments) ? envelope.attachments : [];
    const attachmentSummary = attachments.length ? `\n\nSource attachments (metadata only):\n${attachments.map((item) => `- ${item.name} (${item.mimeType}, ${item.size ?? "unknown"} bytes, sha256=${item.sha256 ?? "unknown"})`).join("\n")}` : "";
    return {
      idea: `${String(envelope.command.args ?? "").trim()}${attachmentSummary}`.slice(0, 24_000),
      workspaceRoot,
      primary: {
        agentId: String(agent.id), provider: String(agent.backend ?? agent.provider), label: String(agent.name ?? agent.id),
        model: model?.id ? String(model.id) : null, modelLabel: model?.label ? String(model.label) : model?.id ? String(model.id) : null,
        catalogSource: "personal-registry", catalogRevision: agent?.agent_source_info?.package_version ?? agent?.agent_source_info?.version ?? null,
        capabilitySnapshot: null, timeoutMs: 7_200_000,
      },
      allowedWorkers: [], independentChecker: { mode: "primary-only", profile: null, maxRounds: 1 },
      permissionMode: "restricted", contractFinalization: "model-recommended-auto",
      endConditions: {
        deadlineAt: null, maxElapsedMs: 259_200_000, maxPrimaryTurns: 72, maxWorkerAttempts: 100,
        maxWorkerConcurrency: 3, maxConsecutiveFailures: 3, contextRolloverPercent: 80,
        stallTimeoutMs: 900_000, maxTurnRuntimeMs: 7_200_000, maxTransportRetries: 5,
        maxTokens: null, maxCostMicros: null, completionAuthority: "model-recommended",
      },
    };
  };
}

export async function createTaskBackgroundRuntime(options) {
  const store = await createMessagingTaskStore({ userDataDir: options.userDataDir });
  const router = createDurableMessagingTaskRouter({ store, taskClient: options.taskClient, resolveCreateInput: options.resolveCreateInput });
  const eventEnqueuer = createMessagingTaskEventEnqueuer({ store, taskClient: options.taskClient });
  const deliveryPump = createMessagingTaskDeliveryPump({ store, deliver: options.deliver });
  deliveryPump.start();
  return { store, router, eventEnqueuer, deliveryPump };
}

export async function handleTaskBackgroundEvent({ event, runtimePromise, mainWindow, Notification, setDockUnreadBadge }) {
  const runtime = await runtimePromise.catch(() => null);
  if (!runtime) return;
  if (event?.type === "task-supervisor-resync") await runtime.eventEnqueuer.replay().catch(() => undefined);
  else {
    runtime.eventEnqueuer.handle(event);
    const windowUnavailable = !mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible?.() !== true;
    if (windowUnavailable && SIGNIFICANT_EVENTS.has(String(event?.type))) {
      try {
        if (Notification.isSupported()) {
          const notification = new Notification({ title: "OnMyAgent Task Center", body: `${String(event.type)}: ${String(event.message ?? "").slice(0, 240)}` });
          notification.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
          notification.show();
        }
      } catch { /* durable row and badge remain the fallback */ }
    }
  }
  setDockUnreadBadge(runtime.store.unreadNotificationCount());
  runtime.deliveryPump.trigger();
}

export function subscribeTaskBackgroundEvents({ taskClient, runtimePromise, getMainWindow, Notification, setDockUnreadBadge, setKeepAwakeActive }) {
  async function refreshKeepAwake() {
    try {
      const status = await taskClient.getActiveWork();
      setKeepAwakeActive(Boolean(status?.active));
    } catch { /* retaining the existing blocker is safer while health is unknown */ }
  }
  const unsubscribe = taskClient.subscribe(async (event) => {
    void refreshKeepAwake();
    const mainWindow = getMainWindow();
    await handleTaskBackgroundEvent({ event, runtimePromise, mainWindow, Notification, setDockUnreadBadge });
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send("onmyagent:task-orchestrator:event", event);
  });
  return { unsubscribe, refreshKeepAwake };
}

export function wireTaskSupervisorPowerMonitor({ powerMonitor, taskClient }) {
  powerMonitor.on("suspend", () => { void taskClient.reportPowerEvent("suspend").catch(() => undefined); });
  powerMonitor.on("resume", () => { void taskClient.reportPowerEvent("resume").catch(() => undefined); });
}

export async function startTaskSupervisorBackground({ runtimeBootstrap, taskClient, powerMonitor, refreshKeepAwake }) {
  await awaitRuntimeBootstrapForSupervisor(runtimeBootstrap);
  await taskClient.ensureConnected();
  taskClient.startWatchdog();
  wireTaskSupervisorPowerMonitor({ powerMonitor, taskClient });
  await refreshKeepAwake();
}

export async function awaitRuntimeBootstrapForSupervisor(runtimeBootstrap, timeoutMs = 30_000) {
  if (!runtimeBootstrap) return { ready: true, skipped: true };
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ready: false, timedOut: true }), Math.max(1, timeoutMs));
    timer.unref?.();
  });
  try {
    return await Promise.race([Promise.resolve(runtimeBootstrap).then(() => ({ ready: true })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
