import assert from "node:assert/strict";
import test from "node:test";

import { createTaskOrchestrator } from "./index.mjs";
import { createTaskOrchestratorStore } from "./store-factory.mjs";
import {
  cleanupDirectories,
  contract,
  createRuntime,
  taskInput,
  temporaryDirectory,
  waitForSnapshot,
} from "./v2-test-helpers.mjs";

async function waitingHarness(options = {}) {
  const workspaceRoot = await temporaryDirectory("oma-approval-cancel-workspace-");
  const userDataDir = await temporaryDirectory("oma-approval-cancel-user-data-");
  const store = createTaskOrchestratorStore({ userDataDir });
  const runtime = createRuntime({
    autoCompletePrimary: false,
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { status: "completed", output: "aligned" };
      }
      return {
        status: "running",
        pendingApprovals: [{ id: "approval-cancel-eligibility", kind: "command", command: "pnpm test" }],
        output: "waiting",
      };
    },
  });
  const orchestrator = createTaskOrchestrator({
    store,
    userDataDir,
    personalAgentRuntime: runtime,
    // These tests trigger expiry through resolveGate so assertions never race
    // the periodic background sweep on slower shared CI hosts.
    approvalExpirySweepMs: 60_000,
    pollMs: 25,
    runtimeCallTimeoutMs: options.runtimeCallTimeoutMs,
    awaitAlignment: true,
  });
  const created = await orchestrator.createTask(taskInput(workspaceRoot, {
    contractFinalization: "model-recommended-auto",
    allowedWorkers: [],
  }));
  const waiting = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "waiting-approval");
  const processRows = await store.listProcesses({ runId: waiting.run.id, includeTerminal: false });
  assert.equal(processRows.length > 0, true, "the retained Personal process row should be durable before expiry");
  return { workspaceRoot, userDataDir, store, runtime, orchestrator, waiting, processRows };
}

async function expireGate(harness) {
  const gate = (await harness.store.readGates(harness.waiting.task.id, harness.waiting.run.id))[0];
  await harness.store.writeGate({ ...gate, expiresAt: Date.now() - 1 });
  await assert.rejects(
    harness.orchestrator.resolveGate({
      taskRunId: harness.waiting.run.id,
      gateId: gate.id,
      decision: "approve",
    }),
    /expired|stale/i,
  );
}

test("approval expiry cancels a live matching process once and tombstones it", async () => {
  const harness = await waitingHarness();
  try {
    await expireGate(harness);
    const blocked = await waitForSnapshot(harness.orchestrator, harness.waiting.task.id, (snapshot) => snapshot.run?.status === "blocked");
    assert.equal(harness.runtime.cancelCalls.filter((call) => call.runId === harness.waiting.run.primaryAttempts[0].personalRunId).length, 1);
    const rows = await harness.store.listProcesses({ runId: blocked.run.id, includeTerminal: true });
    assert.equal(rows.some((row) => row.personalRunId === harness.waiting.run.primaryAttempts[0].personalRunId && row.status === "cancelled"), true);
  } finally {
    await harness.orchestrator.close();
    await cleanupDirectories([harness.workspaceRoot, harness.userDataDir]);
  }
});

test("approval expiry with no live process row is a safe skip, not a cancellation failure", async () => {
  const harness = await waitingHarness();
  try {
    const row = harness.processRows[0];
    await harness.store.tombstoneProcess({ id: row.id, status: "cancelled" });
    // No process row remains and the provider has already disappeared.
    harness.runtime.getRun = async () => ({ status: "missing" });
    await expireGate(harness);
    const blocked = await waitForSnapshot(harness.orchestrator, harness.waiting.task.id, (snapshot) => snapshot.run?.status === "blocked");
    assert.equal(harness.runtime.cancelCalls.some((call) => call.runId === harness.waiting.run.primaryAttempts[0].personalRunId), false);
    assert.equal(String(blocked.run.error ?? "").includes("Provider cancellation was not confirmed"), false);
    assert.equal((await harness.store.listProcesses({ runId: blocked.run.id, includeTerminal: true })).find((candidate) => candidate.id === row.id)?.status, "cancelled");
  } finally {
    await harness.orchestrator.close();
    await cleanupDirectories([harness.workspaceRoot, harness.userDataDir]);
  }
});

test("approval expiry fails closed when Personal liveness is unknown, without tombstoning", async () => {
  for (const mode of ["throw", "timeout", "null", "empty"]) {
    const harness = await waitingHarness({ runtimeCallTimeoutMs: 5 });
    try {
      const row = harness.processRows[0];
      await harness.store.tombstoneProcess({ id: row.id, status: "cancelled" });
      harness.runtime.getRun = async () => {
        if (mode === "throw") throw new Error("provider status unavailable");
        if (mode === "timeout") return new Promise(() => undefined);
        if (mode === "null") return null;
        return {};
      };
      await expireGate(harness);
      const blocked = await waitForSnapshot(
        harness.orchestrator,
        harness.waiting.task.id,
        (snapshot) => snapshot.run?.status === "blocked" && /Provider cancellation was not confirmed/i.test(snapshot.run?.error ?? ""),
      );
      assert.equal(harness.runtime.cancelCalls.some((call) => call.runId === harness.waiting.run.primaryAttempts[0].personalRunId), false);
      assert.match(blocked.run.error, /Provider cancellation was not confirmed/i);
      assert.equal((await harness.store.listProcesses({ runId: blocked.run.id, includeTerminal: true })).find((candidate) => candidate.id === row.id)?.status, "cancelled");
    } finally {
      await harness.orchestrator.close();
      await cleanupDirectories([harness.workspaceRoot, harness.userDataDir]);
    }
  }
});

test("approval expiry never cancels or tombstones an unmatched process row", async () => {
  const harness = await waitingHarness();
  try {
    const row = harness.processRows[0];
    await harness.store.tombstoneProcess({ id: row.id, status: "cancelled" });
    await harness.store.upsertProcess({
      id: "unmatched-approval-process",
      runId: harness.waiting.run.id,
      attemptId: row.attemptId,
      personalRunId: "personal-unmatched",
      status: "running",
      updatedAt: Date.now(),
    });
    harness.runtime.getRun = async () => ({ status: "missing" });
    await expireGate(harness);
    const blocked = await waitForSnapshot(harness.orchestrator, harness.waiting.task.id, (snapshot) => snapshot.run?.status === "blocked");
    assert.equal(harness.runtime.cancelCalls.some((call) => call.runId === harness.waiting.run.primaryAttempts[0].personalRunId), false);
    assert.equal(harness.runtime.cancelCalls.some((call) => call.runId === "personal-unmatched"), false);
    const unmatched = (await harness.store.listProcesses({ runId: blocked.run.id, includeTerminal: true })).find((candidate) => candidate.id === "unmatched-approval-process");
    assert.equal(unmatched?.status, "running");
  } finally {
    await harness.orchestrator.close();
    await cleanupDirectories([harness.workspaceRoot, harness.userDataDir]);
  }
});
