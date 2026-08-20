import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPersonalAgentLegacyHarness } from "../personal-agent-runtime/legacy-harness.mjs";
import { createPersonalAgentRuntime } from "../personal-agent-runtime/index.mjs";
import {
  resolveTaskSupervisorPersonalAssistantRoot,
  resolveTaskSupervisorPersonalRuntimeStateRoot,
} from "../personal-agent-runtime/runtime-state.mjs";
import { createTaskOrchestrator } from "../task-orchestrator/index.mjs";
import { createProcessLifecycleContract } from "../process-lifecycle-contract.mjs";
import { randomSupervisorEpoch } from "./protocol.mjs";

const TASK_CENTER_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1_000;
const ACTIVE_TASK_RUN_STATUSES = new Set([
  "queued",
  "running",
  "checkpointing",
  "pausing",
  "backoff",
  "waiting-approval",
]);

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Same Personal runtime the Supervisor constructs. Tests inject this instance
 * and write through `createConversation` so persist isolation is locked on
 * the shipped runtime API, not the module-global store helpers.
 */
export function createTaskSupervisorPersonalRuntime(options = {}) {
  const configuredUserDataDir = String(options.userDataDir ?? "").trim();
  if (!configuredUserDataDir) throw new Error("Task Supervisor userDataDir is required");
  const userDataDir = path.resolve(configuredUserDataDir);
  const runtimeStatePath = path.join(userDataDir, "onmyagent-server-state.json");
  const tokenStorePath = path.join(userDataDir, "onmyagent-server-tokens.json");
  const legacy = options.legacy ?? createPersonalAgentLegacyHarness({
    runtimePathEntries: () => [],
  });
  return createPersonalAgentRuntime({
    userDataDir,
    personalAssistantRoot: resolveTaskSupervisorPersonalAssistantRoot(userDataDir),
    legacy,
    // Isolate Task persist (runs / conversations) only. Shared runtime-state
    // keeps managed ACP / extensions resolvable from the interactive install.
    processRegistryFile: path.join(
      resolveTaskSupervisorPersonalRuntimeStateRoot(userDataDir),
      "personal-agent-process-registry.json",
    ),
    processRegistryNamespace: "task-supervisor",
    deferStartupReconcileMs: Number(options.deferStartupReconcileMs ?? 0),
    engineInfo: options.engineInfo ?? (async () => {
      // The main process owns the engine lifecycle.  The Supervisor only needs
      // a read-only endpoint/token view to connect provider adapters.
      const state = await readJson(runtimeStatePath, {});
      return {
        baseUrl: state?.engine?.baseUrl ?? null,
        projectDir: state?.engine?.projectDir ?? null,
        opencodeUsername: state?.engine?.opencodeUsername ?? null,
        opencodePassword: state?.engine?.opencodePassword ?? null,
      };
    }),
    onmyagentServerInfo: options.onmyagentServerInfo ?? (async () => {
      const state = await readJson(runtimeStatePath, {});
      if (state?.baseUrl || state?.clientToken || state?.ownerToken) return state;
      const tokens = await readJson(tokenStorePath, {});
      const first = Object.values(tokens?.workspaces ?? {})[0] ?? {};
      return {
        baseUrl: null,
        clientToken: first.clientToken ?? null,
        ownerToken: first.ownerToken ?? null,
      };
    }),
  });
}

/**
 * Build the Personal runtime inside the detached Supervisor.  The Electron
 * window process deliberately does not pass runtime closures across IPC.
 * Runtime state that is safe to share (the local server endpoint/token) is
 * read from app userData; provider processes and the Task orchestrator are
 * consequently owned by this child for the whole window lifetime.
 */
export async function createTaskSupervisorService(options = {}) {
  if (typeof options.serviceFactory === "function") {
    return options.serviceFactory(options);
  }
  const configuredUserDataDir = String(options.userDataDir ?? "").trim();
  if (!configuredUserDataDir) throw new Error("Task Supervisor userDataDir is required");
  const userDataDir = path.resolve(configuredUserDataDir);
  const structuredLog = options.structuredLog;
  const supervisorEpoch = String(options.supervisorEpoch ?? randomSupervisorEpoch());
  const personalAgentRuntime = options.personalAgentRuntime
    ?? createTaskSupervisorPersonalRuntime(options);
  const store = options.store ?? (typeof options.storeFactory === "function"
    ? await options.storeFactory({ userDataDir, supervisorEpoch })
    : undefined);
  const orchestrator = options.orchestrator ?? createTaskOrchestrator({
    userDataDir,
    personalAgentRuntime,
    supervisorEpoch,
    ...(store ? { store } : {}),
  });
  const lifecycle = createProcessLifecycleContract({ name: "task-supervisor" });
  lifecycle.transition("starting", { operation: "service-create" });
  const maintenanceOptions = options.maintenance && typeof options.maintenance === "object" ? options.maintenance : {};
  const maintenanceEnabled = maintenanceOptions.enabled ?? options.maintenanceEnabled !== false;
  const requestedMaintenanceIntervalMs = Number(maintenanceOptions.intervalMs ?? options.maintenanceIntervalMs ?? TASK_CENTER_MAINTENANCE_INTERVAL_MS);
  const maintenanceIntervalMs = Number.isFinite(requestedMaintenanceIntervalMs) && requestedMaintenanceIntervalMs >= 0
    ? requestedMaintenanceIntervalMs
    : TASK_CENTER_MAINTENANCE_INTERVAL_MS;
  const maintenancePolicy = maintenanceOptions.policy && typeof maintenanceOptions.policy === "object"
    ? maintenanceOptions.policy
    : options.maintenancePolicy ?? {};
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let maintenanceTimer = null;
  let maintenanceStartupTimer = null;
  let maintenanceInFlight = null;
  const maintenanceState = {
    enabled: maintenanceEnabled === true,
    intervalMs: maintenanceIntervalMs,
    running: false,
    runs: 0,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastPressure: "unknown",
  };
  lifecycle.transition("healthy", { operation: "service-create" });

  async function resolveMaintenancePolicy() {
    const base = { ...maintenancePolicy };
    if (typeof orchestrator.getSupervisorRuntimeHealth !== "function") return base;
    try {
      const runtimeHealth = await orchestrator.getSupervisorRuntimeHealth();
      const storage = runtimeHealth?.store?.storage;
      const warnings = Array.isArray(storage?.warnings) ? storage.warnings : [];
      const exhausted = storage?.exhausted === true;
      const reclaimableBytes = Number(storage?.reclaimableBytes ?? 0);
      const pageSize = Number(storage?.pageSize ?? 0);
      const reclaimablePages = pageSize > 0 ? Math.floor(reclaimableBytes / pageSize) : 0;
      const requestedPages = Number(base.incrementalVacuumPages ?? 256);
      const boundedPages = Number.isInteger(requestedPages) ? requestedPages : 256;
      if (exhausted) {
        maintenanceState.lastPressure = "exhausted";
        return { ...base, incrementalVacuumPages: Math.max(boundedPages, 4_096) };
      }
      if (warnings.length > 0 || reclaimablePages >= 1_024) {
        maintenanceState.lastPressure = "high";
        return { ...base, incrementalVacuumPages: Math.min(4_096, Math.max(boundedPages, 1_024)) };
      }
      maintenanceState.lastPressure = reclaimablePages > 256 ? "moderate" : "normal";
    } catch {
      maintenanceState.lastPressure = "unknown";
    }
    return base;
  }

  async function runAutomaticMaintenance(reason = "supervisor-maintenance") {
    if (!maintenanceState.enabled || typeof orchestrator.runMaintenance !== "function") return null;
    if (maintenanceInFlight) return maintenanceInFlight;
    maintenanceState.running = true;
    maintenanceState.runs += 1;
    maintenanceState.lastRunAt = Date.now();
    maintenanceInFlight = Promise.resolve()
      .then(() => resolveMaintenancePolicy())
      .then((policy) => orchestrator.runMaintenance(policy))
      .then((result) => {
        maintenanceState.lastSuccessAt = Date.now();
        maintenanceState.lastError = null;
        void structuredLog?.write?.("info", "maintenance-succeeded", { reason, runs: maintenanceState.runs });
        return result;
      })
      .catch((error) => {
        maintenanceState.lastError = {
          code: String(error?.code ?? "TASK_CENTER_MAINTENANCE_FAILED"),
          message: error instanceof Error ? error.message : String(error),
          reason,
          at: Date.now(),
        };
        // Maintenance is operational hygiene, not task execution. A failed
        // pass must be diagnosable while leaving the Supervisor available.
        void structuredLog?.write?.("error", "maintenance-failed", maintenanceState.lastError);
        return null;
      })
      .finally(() => {
        maintenanceState.running = false;
        maintenanceInFlight = null;
      });
    return maintenanceInFlight;
  }

  function scheduleAutomaticMaintenance() {
    if (!maintenanceState.enabled || typeof orchestrator.runMaintenance !== "function") return;
    maintenanceStartupTimer = setTimeoutFn(() => {
      maintenanceStartupTimer = null;
      void runAutomaticMaintenance("supervisor-startup");
    }, Math.max(0, Number(maintenanceOptions.startupDelayMs ?? options.maintenanceStartupDelayMs ?? 0)));
    maintenanceStartupTimer?.unref?.();
    if (maintenanceIntervalMs > 0) {
      maintenanceTimer = setIntervalFn(() => { void runAutomaticMaintenance("supervisor-interval"); }, maintenanceIntervalMs);
      maintenanceTimer?.unref?.();
    }
  }

  function clearAutomaticMaintenance() {
    if (maintenanceStartupTimer) clearTimeoutFn(maintenanceStartupTimer);
    if (maintenanceTimer) clearIntervalFn(maintenanceTimer);
    maintenanceStartupTimer = null;
    maintenanceTimer = null;
  }

  scheduleAutomaticMaintenance();
  async function activeWorkStatus() {
    const summaries = [];
    let cursor = null;
    do {
      const page = await orchestrator.listTasks({ cursor, limit: 200 });
      summaries.push(...page.tasks);
      cursor = page.hasMore ? page.nextCursor ?? null : null;
    } while (cursor !== null);
    const active = [];
    for (const summary of summaries) {
      const runStatus = String(summary.latestRunStatus ?? "");
      if (ACTIVE_TASK_RUN_STATUSES.has(runStatus)) {
        active.push({
          taskId: summary.id,
          taskRunId: summary.latestRunId ?? null,
          kind: "run",
          status: runStatus,
        });
        continue;
      }
      // Alignment provider turns can be active before a first run exists and
      // are therefore absent from the summary's latestRunStatus projection.
      if (summary.definitionStatus !== "alignment") continue;
      const snapshot = await orchestrator.getTask({ taskId: summary.id });
      if (snapshot?.task?.alignment?.status === "running") {
        active.push({
          taskId: summary.id,
          taskRunId: null,
          kind: "alignment",
          status: "running",
        });
      }
    }
    return {
      active: active.length > 0,
      activeCount: active.length,
      tasks: active.slice(0, 100),
      truncated: active.length > 100,
    };
  }
  async function operationalHealth() {
    const runtime = typeof orchestrator.getSupervisorRuntimeHealth === "function"
      ? await orchestrator.getSupervisorRuntimeHealth()
      : { observedAt: Date.now() };
    const activeWork = await activeWorkStatus();
    return {
      supervisorEpoch,
      observedAt: Date.now(),
      lifecycle: lifecycle.snapshot(),
      maintenance: { ...maintenanceState, lastError: maintenanceState.lastError ? { ...maintenanceState.lastError } : null },
      activeWork,
      runtime,
    };
  }
  let drained = false;
  async function pauseAllAndDrain(reason = "explicit_quit") {
    if (drained) return { ok: true, reason, alreadyDrained: true };
    lifecycle.transition("stopping", { operation: reason });
    clearAutomaticMaintenance();
    try {
      await maintenanceInFlight?.catch(() => undefined);
      const pause = typeof orchestrator.pauseAllAndDrain === "function"
        ? orchestrator.pauseAllAndDrain.bind(orchestrator)
        : orchestrator.close.bind(orchestrator);
      await pause(reason);
      await personalAgentRuntime.close?.();
      drained = true;
      lifecycle.transition("stopped", { operation: reason });
      return { ok: true, reason };
    } catch (error) {
      lifecycle.transition("error", { operation: reason, error });
      throw error;
    }
  }
  return {
    ...orchestrator,
    pauseAllAndDrain,
    close: pauseAllAndDrain,
    runAutomaticMaintenance,
    activeWorkStatus,
    operationalHealth,
    maintenanceStatus: () => ({ ...maintenanceState, lastError: maintenanceState.lastError ? { ...maintenanceState.lastError } : null }),
    supervisorEpoch,
    rootDirectory: orchestrator.rootDirectory,
  };
}

export function createSupervisorRuntimeStub(userDataDir) {
  const root = path.resolve(String(userDataDir ?? os.tmpdir()));
  return {
    userDataDir: root,
    runtimePathEntries: () => [],
    engineInfo: async () => ({ baseUrl: null, projectDir: null }),
    onmyagentServerInfo: async () => ({ baseUrl: null, clientToken: null, ownerToken: null }),
  };
}
