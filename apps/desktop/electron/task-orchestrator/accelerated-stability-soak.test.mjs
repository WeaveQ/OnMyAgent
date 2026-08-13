import assert from "node:assert/strict";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { createTaskOrchestrator } from "./index.mjs";
import { createTaskOrchestratorStore } from "./store-factory.mjs";
import { cleanupDirectories, contract, createRuntime, taskInput, temporaryDirectory, waitForSnapshot } from "./v2-test-helpers.mjs";

test("accelerated 72h/high-cardinality stability soak emits a machine-readable report", async (t) => {
  const roots = [];
  t.after(() => cleanupDirectories(roots));
  const userDataDir = await temporaryDirectory("task-72h-soak-user-");
  const workspaceRoot = await temporaryDirectory("task-72h-soak-workspace-");
  roots.push(userDataDir, workspaceRoot);
  const store = createTaskOrchestratorStore({ userDataDir });
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const heapStart = process.memoryUsage().heapUsed;
  const heapSamples = [heapStart];
  const cpuStart = process.cpuUsage();
  const handleStart = process._getActiveHandles().length;
  const turnLatenciesMs = [];
  const queryLatenciesMs = [];
  let clock = 1;
  let turns = 0;
  const targetTurns = 72;
  const runtime = createRuntime({
    autoCompletePrimary: false,
    start: async ({ input }) => {
      const turnStartedAt = performance.now();
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { output: "aligned" };
      }
      turns += 1;
      const state = await input.taskControlPlane.get_task_state();
      if (turns < targetTurns) {
        await input.taskControlPlane.continue_task({ summary: `hour ${turns}`, nextAction: `hour ${turns + 1}`, acceptanceResults: [] });
      } else {
        await input.taskControlPlane.complete_task({
          summary: "accelerated 72h complete",
          acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
            criterionIndex, status: "passed", summary: criterion, evidenceArtifactIds: [],
          })),
        });
      }
      clock += 60 * 60_000;
      turnLatenciesMs.push(performance.now() - turnStartedAt);
      if (turns % 12 === 0) heapSamples.push(process.memoryUsage().heapUsed);
      return { output: `hour ${turns}` };
    },
  });
  const orchestrator = createTaskOrchestrator({
    store,
    userDataDir,
    personalAgentRuntime: runtime,
    now: () => clock,
    pollMs: 1,
    awaitAlignment: true,
    maxGlobalActiveAttempts: 4,
  });
  const unsubscribe = orchestrator.subscribe(() => undefined);
  try {
    const created = await orchestrator.createTask(taskInput(workspaceRoot, {
      allowedWorkers: [],
      contractFinalization: "model-recommended-auto",
      endConditions: { maxPrimaryTurns: targetTurns, maxWorkerAttempts: 0, maxElapsedMs: 7 * 24 * 60 * 60_000 },
    }));
    const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded", 30_000);
    let runtimeHealth = await orchestrator.getSupervisorRuntimeHealth();
    const drainDeadline = Date.now() + 2_000;
    while ((runtimeHealth.scheduler.active > 0 || runtimeHealth.scheduler.queued > 0) && Date.now() < drainDeadline) {
      await new Promise((resolve) => setImmediate(resolve));
      runtimeHealth = await orchestrator.getSupervisorRuntimeHealth();
    }
    for (let index = 0; index < 25; index += 1) {
      let startedAt = performance.now();
      await orchestrator.listTasks({ limit: 50 });
      queryLatenciesMs.push(performance.now() - startedAt);
      startedAt = performance.now();
      await orchestrator.getTask({ taskId: created.task.id, taskRunId: finished.run.id });
      queryLatenciesMs.push(performance.now() - startedAt);
    }
    const health = await store.health();
    delay.disable();
    const report = {
      schemaVersion: 1,
      simulatedWallClockHours: 72,
      turns,
      status: finished.run.status,
      heap: {
        startBytes: heapStart,
        endBytes: process.memoryUsage().heapUsed,
        deltaBytes: process.memoryUsage().heapUsed - heapStart,
        samplesBytes: heapSamples,
        lastQuarterGrowthBytes: heapSamples.at(-1) - heapSamples[Math.max(0, heapSamples.length - 3)],
      },
      cpuMicros: process.cpuUsage(cpuStart),
      eventLoopDelayMs: { mean: Number(delay.mean / 1e6) || 0, max: Number(delay.max / 1e6) || 0, p99: Number(delay.percentile(99) / 1e6) || 0 },
      storage: health.storage,
      rows: health.rows,
      scheduler: runtimeHealth.scheduler,
      processObservations: runtimeHealth.processObservations,
      providerConversations: runtime.conversations.length,
      turnLatencyMs: {
        mean: turnLatenciesMs.reduce((sum, value) => sum + value, 0) / turnLatenciesMs.length,
        max: Math.max(...turnLatenciesMs),
        p99: [...turnLatenciesMs].sort((left, right) => left - right)[Math.min(turnLatenciesMs.length - 1, Math.floor(turnLatenciesMs.length * 0.99))],
      },
      queryLatencyMs: {
        samples: queryLatenciesMs.length,
        mean: queryLatenciesMs.reduce((sum, value) => sum + value, 0) / queryLatenciesMs.length,
        max: Math.max(...queryLatenciesMs),
        p99: [...queryLatenciesMs].sort((left, right) => left - right)[Math.min(queryLatenciesMs.length - 1, Math.floor(queryLatenciesMs.length * 0.99))],
      },
      taskControlFs: runtimeHealth.taskControlFs ?? { pollCount: null, watchWakeups: null, poisonRequests: null, unknownOutcomeRecoveries: null },
      activeHandles: { start: handleStart, end: process._getActiveHandles().length },
      generatedAt: new Date().toISOString(),
    };
    const reportPath = String(process.env.ONMYAGENT_SOAK_REPORT ?? "").trim()
      || path.join(userDataDir, "accelerated-72h-soak-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    assert.equal(report.status, "succeeded");
    assert.equal(report.turns, targetTurns);
    assert.equal(report.scheduler.active, 0);
    assert.equal(report.scheduler.queued, 0);
    assert.deepEqual(report.processObservations, { records: 0, snapshots: 0 });
    assert.equal(report.storage.exhausted, false);
    assert.equal(report.activeHandles.end <= report.activeHandles.start + 8, true);
  } finally {
    unsubscribe();
    await orchestrator.close();
  }
});
