import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { createRuntime } from "../task-orchestrator/v2-test-helpers.mjs";
import { createTaskOrchestratorSqliteStore } from "../task-orchestrator/sqlite-store.mjs";
import { createTaskSupervisorService } from "./service.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "task-supervisor-maintenance-"));
  roots.push(root);
  return root;
}

async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for maintenance");
}

describe("detached Supervisor bounded maintenance", () => {
  it("reports active run and alignment work for main-owned lifecycle guards", async () => {
    const root = await temporaryRoot();
    const orchestrator = {
      listTasks: async () => ({
        tasks: [
          { id: "running-task", latestRunId: "run-1", latestRunStatus: "running", definitionStatus: "ready" },
          { id: "alignment-task", latestRunId: null, latestRunStatus: null, definitionStatus: "alignment" },
          { id: "idle-task", latestRunId: "run-2", latestRunStatus: "paused", definitionStatus: "ready" },
        ],
      }),
      getTask: async ({ taskId }) => ({
        task: { id: taskId, alignment: { status: taskId === "alignment-task" ? "running" : "idle" } },
      }),
      close: async () => undefined,
      pauseAllAndDrain: async () => undefined,
    };
    const service = await createTaskSupervisorService({
      userDataDir: root,
      personalAgentRuntime: createRuntime(),
      maintenanceEnabled: false,
      orchestrator,
    });
    assert.deepEqual(await service.activeWorkStatus(), {
      active: true,
      activeCount: 2,
      tasks: [
        { taskId: "running-task", taskRunId: "run-1", kind: "run", status: "running" },
        { taskId: "alignment-task", taskRunId: null, kind: "alignment", status: "running" },
      ],
      truncated: false,
    });
    await service.close("test-close");
  });

  it("defaults operational maintenance to an hourly watchdog", async () => {
    const root = await temporaryRoot();
    const service = await createTaskSupervisorService({
      userDataDir: root,
      personalAgentRuntime: createRuntime(),
      maintenanceStartupDelayMs: 60_000,
    });
    assert.equal(service.maintenanceStatus().intervalMs, 60 * 60 * 1_000);
    await service.close("test-close");
  });

  it("runs startup/interval maintenance without overlap and drains it on close", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root });
    const original = store.runMaintenance;
    let calls = 0;
    let active = 0;
    let peak = 0;
    store.runMaintenance = async (input) => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      try { return await original(input); } finally { active -= 1; }
    };
    const service = await createTaskSupervisorService({
      userDataDir: root,
      store,
      personalAgentRuntime: createRuntime(),
      supervisorEpoch: "maintenance-epoch",
      maintenanceIntervalMs: 10,
    });
    await waitUntil(() => calls >= 1);
    await service.close("test-close");
    const callsAtClose = calls;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls, callsAtClose);
    assert.equal(active, 0);
    assert.equal(peak, 1);
    assert.equal(service.maintenanceStatus().running, false);
  });

  it("keeps maintenance failures diagnosable and nonfatal, and supports disable", async () => {
    const root = await temporaryRoot();
    const store = createTaskOrchestratorSqliteStore({ userDataDir: root });
    const structuredEntries = [];
    store.runMaintenance = async () => { throw Object.assign(new Error("maintenance unavailable"), { code: "MAINTENANCE_UNAVAILABLE" }); };
    const service = await createTaskSupervisorService({
      userDataDir: root,
      store,
      personalAgentRuntime: createRuntime(),
      maintenanceIntervalMs: 10,
      structuredLog: { write: async (level, type, data) => structuredEntries.push({ level, type, data }) },
    });
    await waitUntil(() => service.maintenanceStatus().lastError?.code === "MAINTENANCE_UNAVAILABLE");
    assert.equal(service.maintenanceStatus().enabled, true);
    assert.equal(structuredEntries.some((entry) => entry.type === "maintenance-failed" && entry.data.code === "MAINTENANCE_UNAVAILABLE"), true);
    const operational = await service.operationalHealth();
    assert.equal(operational.maintenance.lastError.code, "MAINTENANCE_UNAVAILABLE");
    assert.equal(typeof operational.runtime.scheduler.queued, "number");
    assert.equal(typeof operational.runtime.store.storage.totalFileBytes, "number");
    await service.close("test-close");

    const disabledRoot = await temporaryRoot();
    const disabledStore = createTaskOrchestratorSqliteStore({ userDataDir: disabledRoot });
    let disabledCalls = 0;
    disabledStore.runMaintenance = async () => { disabledCalls += 1; };
    const disabled = await createTaskSupervisorService({
      userDataDir: disabledRoot,
      store: disabledStore,
      personalAgentRuntime: createRuntime(),
      maintenanceEnabled: false,
      maintenanceIntervalMs: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(disabledCalls, 0);
    await disabled.close("test-close");
  });

  it("raises vacuum work when storage diagnostics report pressure", async () => {
    const root = await temporaryRoot();
    const policies = [];
    const orchestrator = {
      getSupervisorRuntimeHealth: async () => ({
        store: {
          storage: {
            exhausted: false,
            warnings: ["task-center-storage-high-watermark"],
            reclaimableBytes: 1_024 * 4_096,
            pageSize: 4_096,
          },
        },
      }),
      runMaintenance: async (policy) => {
        policies.push(policy);
        return { ok: true };
      },
      close: async () => undefined,
      pauseAllAndDrain: async () => undefined,
    };
    const service = await createTaskSupervisorService({
      userDataDir: root,
      personalAgentRuntime: createRuntime(),
      orchestrator,
      maintenanceStartupDelayMs: 0,
      maintenanceIntervalMs: 0,
    });
    await waitUntil(() => policies.length >= 1);
    assert.equal(policies[0].incrementalVacuumPages, 1_024);
    assert.equal(service.maintenanceStatus().lastPressure, "high");
    await service.close("test-close");
  });
});
