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

test("a timed-out alignment start is fenced without leaving an active task", async () => {
  const workspaceRoot = await temporaryDirectory("task-runtime-timeout-alignment-workspace-");
  const userDataDir = await temporaryDirectory("task-runtime-timeout-alignment-user-");
  const runtime = createRuntime({ start: async ({ input }) => {
    if (input.taskTools?.includes("propose_contract")) return new Promise(() => undefined);
    return { output: "unused" };
  } });
  const orchestrator = createTaskOrchestrator({
    userDataDir,
    personalAgentRuntime: runtime,
    runtimeCallTimeoutMs: 5,
    pollMs: 1,
    awaitAlignment: true,
  });
  try {
    const snapshot = await orchestrator.createTask(taskInput(workspaceRoot));
    assert.equal(snapshot.task.alignment.status, "failed");
    assert.match(snapshot.task.alignment.error, /timed out/i);
    assert.equal(snapshot.task.alignment.personalRunId, null);
  } finally {
    await orchestrator.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});

test("a late startMessage result is fenced after cancellation and cannot resurrect the attempt", async () => {
  const workspaceRoot = await temporaryDirectory("task-runtime-timeout-start-workspace-");
  const userDataDir = await temporaryDirectory("task-runtime-timeout-start-user-");
  const store = createTaskOrchestratorStore({ userDataDir });
  let releaseLateStart;
  let lateStartRunId = null;
  let lateStartOperationId = null;
  const runtime = createRuntime({
    autoCompletePrimary: false,
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { output: "aligned", status: "completed" };
      }
      return { output: "unused", status: "running" };
    },
  });
  const baseStartMessage = runtime.startMessage.bind(runtime);
  runtime.startMessage = async (input) => {
    const tools = input.taskControlPlane?.describe?.().tools ?? [];
    if (tools.length === 1 && tools[0] === "propose_contract") return baseStartMessage(input);

    lateStartOperationId = input.operationId;
    lateStartRunId = `late-provider-run-${Date.now()}`;
    runtime.taskOperations.set(lateStartOperationId, {
      operationId: lateStartOperationId,
      status: "running",
      pending: true,
      runId: lateStartRunId,
    });
    return new Promise((resolve) => {
      releaseLateStart = () => {
        const snapshot = {
          runId: lateStartRunId,
          status: "completed",
          output: "late provider completion must be ignored",
          providerSessionId: "late-provider-session",
          pid: 4312,
          process: { pid: 4312, pgid: 4312, processStartToken: "late-start-token" },
          error: null,
          pendingApprovals: [],
        };
        runtime.runs.set(lateStartRunId, snapshot);
        // Preserve the cancellation acknowledgement even when the provider
        // finally resolves the original startMessage promise.
        const operation = runtime.taskOperations.get(lateStartOperationId);
        if (operation?.status !== "cancelled") {
          runtime.taskOperations.set(lateStartOperationId, {
            operationId: lateStartOperationId,
            status: "completed",
            pending: false,
            runId: lateStartRunId,
          });
        }
        runtime.startCalls.push({ input, runId: lateStartRunId });
        resolve(structuredClone(snapshot));
      };
    });
  };
  const orchestrator = createTaskOrchestrator({
    store,
    userDataDir,
    personalAgentRuntime: runtime,
    runtimeCallTimeoutMs: 5,
    pollMs: 1,
    awaitAlignment: true,
  });
  try {
    const created = await orchestrator.createTask(taskInput(workspaceRoot, {
      contractFinalization: "model-recommended-auto",
      allowedWorkers: [],
    }));
    const failed = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "failed");
    const attempt = failed.run.primaryAttempts[0];
    assert.equal(runtime.cancelCalls.some((call) => call.operationId === lateStartOperationId && call.options?.taskOperation === true), true);
    assert.equal(runtime.getTaskOperation({ operationId: lateStartOperationId })?.status, "cancelled");
    assert.equal(attempt.status, "failed");
    assert.equal(attempt.leaseId, null);
    assert.match(attempt.error, /Personal startMessage.*timed out/i);
    assert.match(failed.run.error, /Personal startMessage.*timed out/i);
    assert.equal(failed.artifacts.length, 0);
    assert.equal(attempt.providerDiagnostics, null);
    assert.deepEqual(await store.listProcesses({ runId: failed.run.id, includeTerminal: true }), []);

    releaseLateStart?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const afterLate = await orchestrator.getTask({ taskId: created.task.id });
    assert.equal(afterLate.run.status, "failed");
    assert.equal(afterLate.run.primaryAttempts[0].status, "failed");
    assert.equal(afterLate.artifacts.length, 0);
    assert.equal(afterLate.run.primaryAttempts.length, 1);
    assert.deepEqual(await store.listProcesses({ runId: failed.run.id, includeTerminal: true }), []);

    await orchestrator.close();
    const recoveryRuntime = createRuntime({ autoCompletePrimary: false });
    const recovery = createTaskOrchestrator({ userDataDir, personalAgentRuntime: recoveryRuntime, pollMs: 1 });
    try {
      const persisted = await recovery.getTask({ taskId: created.task.id });
      assert.equal(persisted.run.status, "failed");
      assert.equal(persisted.run.primaryAttempts.length, 1);
      assert.equal(recoveryRuntime.startCalls.length, 0);
    } finally {
      await recovery.close();
    }
  } finally {
    releaseLateStart?.();
    await orchestrator.close();
    const restartedStore = createTaskOrchestratorStore({ userDataDir });
    await restartedStore.initialize();
    assert.deepEqual(await restartedStore.listProcesses({ includeTerminal: true }), []);
    await restartedStore.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});

test("a timed-out execution poll cancels, revokes the lease, and never replays the attempt", async () => {
  const workspaceRoot = await temporaryDirectory("task-runtime-timeout-execution-workspace-");
  const userDataDir = await temporaryDirectory("task-runtime-timeout-execution-user-");
  let executionStarts = 0;
  const runtime = createRuntime({
    start: async ({ input }) => {
      if (input.taskTools?.includes("propose_contract")) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { output: "aligned" };
      }
      executionStarts += 1;
      return { status: "running", output: "held" };
    },
    getRun: async ({ current }) => current?.status === "running" ? new Promise(() => undefined) : current,
  });
  const orchestrator = createTaskOrchestrator({
    userDataDir,
    personalAgentRuntime: runtime,
    runtimeCallTimeoutMs: 5,
    pollMs: 1,
    awaitAlignment: true,
  });
  try {
    const created = await orchestrator.createTask(taskInput(workspaceRoot, {
      contractFinalization: "model-recommended-auto",
      allowedWorkers: [],
    }));
    const failed = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => ["failed", "blocked"].includes(snapshot.run?.status));
    assert.equal(executionStarts, 1);
    assert.equal(failed.run.primaryAttempts.length, 1);
    assert.equal(failed.run.primaryAttempts[0].leaseId, null);
    assert.match(failed.run.error, /timed out|Personal getRun/i);
  } finally {
    await orchestrator.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});

test("pauseAllAndDrain waits for a held gate resolution and ignores stale completion", async () => {
  const workspaceRoot = await temporaryDirectory("task-runtime-gate-drain-workspace-");
  const userDataDir = await temporaryDirectory("task-runtime-gate-drain-user-");
  let releaseApproval;
  let approvalStarted;
  const runtime = createRuntime({
    start: async ({ input }) => {
      if (input.taskTools?.includes("propose_contract")) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { output: "aligned" };
      }
      return { status: "running", pendingApprovals: [{ id: "held-approval", kind: "command", command: "pnpm test" }], output: "waiting" };
    },
    resolveApproval: async ({ input, runs }) => {
      approvalStarted?.(input);
      await new Promise((resolve) => { releaseApproval = resolve; });
      const current = runs.get(input.runId);
      runs.set(input.runId, { ...current, status: "completed", pendingApprovals: [], output: "late completion" });
      return { ok: true };
    },
  });
  const orchestrator = createTaskOrchestrator({
    userDataDir,
    personalAgentRuntime: runtime,
    runtimeCallTimeoutMs: 100,
    pollMs: 1,
    awaitAlignment: true,
  });
  try {
    const created = await orchestrator.createTask(taskInput(workspaceRoot, {
      contractFinalization: "model-recommended-auto",
      allowedWorkers: [],
    }));
    const waiting = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "waiting-approval");
    const approvalReady = new Promise((resolve) => { approvalStarted = resolve; });
    const resolution = orchestrator.resolveGate({ taskRunId: waiting.run.id, gateId: waiting.gates[0].id, decision: "approve" });
    await approvalReady;
    let drained = false;
    const drain = orchestrator.pauseAllAndDrain("explicit_quit").then(() => { drained = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(drained, false);
    releaseApproval();
    await resolution;
    await drain;
    const final = await orchestrator.getTask({ taskId: created.task.id });
    assert.notEqual(final.run.status, "succeeded");
    assert.equal(final.run.primaryAttempts[0].leaseId, null);
  } finally {
    releaseApproval?.();
    await orchestrator.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});

test("an in-flight approval cannot finalize after TTL expiry and cancels the retained Personal run", async () => {
  const workspaceRoot = await temporaryDirectory("task-runtime-approval-expiry-race-workspace-");
  const userDataDir = await temporaryDirectory("task-runtime-approval-expiry-race-user-");
  const store = createTaskOrchestratorStore({ userDataDir });
  let releaseApproval;
  let approvalStarted;
  const runtime = createRuntime({
    start: async ({ input }) => {
      if (input.taskTools?.includes("propose_contract")) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { output: "aligned" };
      }
      return { status: "running", pendingApprovals: [{ id: "race-approval", kind: "command", command: "pnpm test" }], output: "waiting" };
    },
    resolveApproval: async ({ input }) => {
      approvalStarted?.(input);
      await new Promise((resolve) => { releaseApproval = resolve; });
      return { ok: true };
    },
  });
  const orchestrator = createTaskOrchestrator({
    store,
    userDataDir,
    personalAgentRuntime: runtime,
    runtimeCallTimeoutMs: 500,
    pollMs: 1_000,
    awaitAlignment: true,
  });
  try {
    const created = await orchestrator.createTask(taskInput(workspaceRoot, {
      contractFinalization: "model-recommended-auto",
      allowedWorkers: [],
    }));
    const waiting = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "waiting-approval");
    const approvalReady = new Promise((resolve) => { approvalStarted = resolve; });
    const resolution = orchestrator.resolveGate({ taskRunId: waiting.run.id, gateId: waiting.gates[0].id, decision: "approve" });
    const providerContext = await approvalReady;
    const gates = await store.readGates(created.task.id, waiting.run.id);
    assert.equal(gates[0].status, "resolving");
    await store.writeGate({ ...gates[0], expiresAt: Date.now() - 1 });
    releaseApproval();
    await assert.rejects(resolution, /expired|stale/i);
    const blocked = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "blocked");
    assert.equal(blocked.gates[0].status, "cancelled");
    assert.equal(blocked.run.primaryAttempts[0].status, "blocked");
    assert.equal(blocked.run.primaryAttempts[0].leaseId, null);
    assert.equal(runtime.cancelCalls.filter((call) => call.runId === providerContext.runId).length, 1);
    assert.equal(blocked.events.some((event) => event.type === "approval-expired"), true);
    assert.equal(blocked.events.some((event) => event.type === "approval-resolved"), false);
  } finally {
    releaseApproval?.();
    await orchestrator.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});

test("approval expiry remains blocked with a cancellation-unconfirmed diagnostic", async () => {
  const workspaceRoot = await temporaryDirectory("task-runtime-approval-cancel-failure-workspace-");
  const userDataDir = await temporaryDirectory("task-runtime-approval-cancel-failure-user-");
  const store = createTaskOrchestratorStore({ userDataDir });
  let releaseApproval;
  let approvalStarted;
  const runtime = createRuntime({
    start: async ({ input }) => {
      if (input.taskTools?.includes("propose_contract")) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { output: "aligned" };
      }
      return { status: "running", pendingApprovals: [{ id: "cancel-failure-approval", kind: "command", command: "pnpm test" }], output: "waiting" };
    },
    resolveApproval: async ({ input }) => {
      approvalStarted?.(input);
      await new Promise((resolve) => { releaseApproval = resolve; });
      return { ok: true };
    },
    cancel: async () => ({ ok: false, error: "provider refused cancellation" }),
  });
  const orchestrator = createTaskOrchestrator({
    store,
    userDataDir,
    personalAgentRuntime: runtime,
    runtimeCallTimeoutMs: 500,
    pollMs: 1_000,
    awaitAlignment: true,
  });
  try {
    const created = await orchestrator.createTask(taskInput(workspaceRoot, {
      contractFinalization: "model-recommended-auto",
      allowedWorkers: [],
    }));
    const waiting = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "waiting-approval");
    const approvalReady = new Promise((resolve) => { approvalStarted = resolve; });
    const resolution = orchestrator.resolveGate({ taskRunId: waiting.run.id, gateId: waiting.gates[0].id, decision: "approve" });
    await approvalReady;
    const gates = await store.readGates(created.task.id, waiting.run.id);
    await store.writeGate({ ...gates[0], expiresAt: Date.now() - 1 });
    releaseApproval();
    await assert.rejects(resolution, /expired|stale|not confirmed/i);
    const blocked = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "blocked");
    assert.equal(blocked.gates[0].status, "cancelled");
    assert.equal(blocked.run.primaryAttempts[0].status, "blocked");
    assert.match(blocked.run.error, /cancellation was not confirmed/i);
    assert.equal(blocked.events.some((event) => event.type === "approval-resolved"), false);
  } finally {
    releaseApproval?.();
    await orchestrator.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});
