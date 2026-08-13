import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createTaskOrchestratorRunner } from "./runner.mjs";
import { createAttempt, defaultId, profileFromSelection } from "./definitions.mjs";
import { createTaskOrchestratorStore } from "./store-factory.mjs";
import { cleanupDirectories, contract, selection, temporaryDirectory } from "./v2-test-helpers.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await cleanupDirectories(temporaryDirectories.splice(0));
});

function createSerialized() {
  let tail = Promise.resolve();
  return (operation) => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

async function writeTaskForRun(store, run) {
  await store.writeTask({
    schemaVersion: 2,
    id: run.taskId,
    revision: run.taskRevision,
    idea: run.definition.idea,
    workspaceRoot: run.definition.workspaceRoot,
    primary: run.definition.primary,
    allowedWorkers: run.definition.allowedWorkers,
    permissionMode: run.definition.permissionMode,
    contractFinalization: run.definition.contractFinalization,
    contract: run.definition.contract,
    definitionStatus: "ready",
    template: "task-center-v2",
    alignment: {
      conversationId: null,
      personalRunId: null,
      messages: [],
      proposals: [],
      latestProposalId: null,
      latestProposalRevision: null,
    },
    latestRunId: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });
}

async function createReadyPrimaryFixture(store, workspaceRoot, suffix) {
  const primary = profileFromSelection("primary", selection());
  const timestamp = Date.now();
  const run = {
    schemaVersion: 2,
    id: `run-${suffix}`,
    taskId: `task-${suffix}`,
    taskRevision: 1,
    definition: {
      idea: "A local task",
      workspaceRoot,
      primary,
      allowedWorkers: [],
      permissionMode: "restricted",
      contractFinalization: "manual-confirm",
      contract: contract(),
      template: "task-center-v2",
    },
    status: "queued",
    primaryAttemptId: "pending",
    currentAttemptId: null,
    primaryAttempts: [],
    workerAttempts: [],
    createdAt: timestamp,
    startedAt: null,
    updatedAt: timestamp,
    finishedAt: null,
    error: null,
  };
  const attempt = createAttempt(defaultId, Date.now, run, "primary", primary, "Execute the frozen contract.", null, "ready");
  run.primaryAttemptId = attempt.id;
  run.currentAttemptId = attempt.id;
  run.primaryAttempts.push(attempt);
  await writeTaskForRun(store, run);
  await store.writeRun(run);
  return { run, attempt };
}

describe("Task Center v2 attempt execution lifecycle", () => {
  it("deduplicates repeated launch calls for one attempt", async () => {
    const userDataDir = await temporaryDirectory("task-v2-launch-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-launch-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const store = createTaskOrchestratorStore({ userDataDir });
    await store.initialize();
    const primary = profileFromSelection("primary", selection());
    const run = {
      schemaVersion: 2,
      id: "run-launch-dedupe",
      taskId: "task-launch-dedupe",
      taskRevision: 1,
      definition: {
        idea: "A local task",
        workspaceRoot,
        primary,
        allowedWorkers: [],
        permissionMode: "restricted",
        contractFinalization: "manual-confirm",
        contract: contract(),
        template: "task-center-v2",
      },
      status: "queued",
      primaryAttemptId: "pending",
      currentAttemptId: null,
      primaryAttempts: [],
      workerAttempts: [],
      createdAt: Date.now(),
      startedAt: null,
      updatedAt: Date.now(),
      finishedAt: null,
      error: null,
    };
    const attempt = createAttempt(defaultId, Date.now, run, "primary", primary, "Execute the frozen contract.", null, "ready");
    run.primaryAttemptId = attempt.id;
    run.currentAttemptId = attempt.id;
    run.primaryAttempts.push(attempt);
    await writeTaskForRun(store, run);
    await store.writeRun(run);

    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    let starts = 0;
    const personalAgentRuntime = {
      async createConversation() { return { conversation: { id: "conversation-primary" } }; },
      async startMessage() {
        starts += 1;
        await hold;
        return { runId: "personal-primary", status: "completed", output: "done" };
      },
      async getRun() { return { runId: "personal-primary", status: "completed", output: "done" }; },
      async cancelRun() { return { ok: true }; },
      async resolveApproval() { return { ok: true }; },
      async cancelTaskOperation(input) { return { ok: true, operationId: input?.operationId ?? null, status: "cancelled", pending: false }; },
      getTaskOperation() { return null; },
    };
    const runner = createTaskOrchestratorRunner({
      personalAgentRuntime,
      store,
      now: Date.now,
      createId: defaultId,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      pollMs: 1, awaitAlignment: true,
      serialized: createSerialized(),
      emit: async () => undefined,
      isClosed: () => false,
    });

    const first = runner.launch(run.taskId, run.id, attempt.id);
    const second = runner.launch(run.taskId, run.id, attempt.id);
    assert.strictEqual(second, first);
    release();
    await Promise.all([first, second]);
    const finished = await store.requireRun(run.taskId, run.id);
    assert.equal(starts, 1);
    assert.equal(finished.status, "succeeded");
    assert.equal(finished.primaryAttempts[0].status, "succeeded");
  });

  it("releases process observations after both successful and failed terminal attempts", async () => {
    const userDataDir = await temporaryDirectory("task-v2-process-observation-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-process-observation-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const store = createTaskOrchestratorStore({ userDataDir });
    await store.initialize();
    const successful = await createReadyPrimaryFixture(store, workspaceRoot, "process-success");

    let starts = 0;
    const personalAgentRuntime = {
      async createConversation() { return { conversation: { id: `conversation-${starts + 1}` } }; },
      async startMessage() {
        starts += 1;
        return starts === 1
          ? { runId: "personal-success", status: "completed", output: "done", pid: 4_321, process: { pid: 4_321, state: "exited", terminationConfirmed: true } }
          : { runId: "personal-failure", status: "failed", error: "provider failed", pid: 4_322, process: { pid: 4_322, state: "exited", terminationConfirmed: true } };
      },
      async getRun() { throw new Error("terminal startMessage result should not be polled"); },
      async cancelRun() { return { ok: true }; },
      async resolveApproval() { return { ok: true }; },
      async cancelTaskOperation(input) { return { ok: true, operationId: input?.operationId ?? null, status: "cancelled", pending: false }; },
      getTaskOperation() { return null; },
    };
    let runner;
    const observed = [];
    const upsertProcess = store.upsertProcess.bind(store);
    store.upsertProcess = async (record) => {
      observed.push(runner.processObservationSnapshot());
      return upsertProcess(record);
    };
    runner = createTaskOrchestratorRunner({
      personalAgentRuntime,
      store,
      now: Date.now,
      createId: defaultId,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      pollMs: 1, awaitAlignment: true,
      serialized: createSerialized(),
      emit: async () => undefined,
      isClosed: () => false,
    });

    await runner.launch(successful.run.taskId, successful.run.id, successful.attempt.id);
    assert.deepEqual(runner.processObservationSnapshot(), { records: 0, snapshots: 0 });
    assert.equal((await store.requireRun(successful.run.taskId, successful.run.id)).status, "succeeded");

    const failed = await createReadyPrimaryFixture(store, workspaceRoot, "process-failure");
    await runner.launch(failed.run.taskId, failed.run.id, failed.attempt.id);
    assert.deepEqual(runner.processObservationSnapshot(), { records: 0, snapshots: 0 });
    assert.equal((await store.requireRun(failed.run.taskId, failed.run.id)).status, "failed");
    assert.equal(observed.some((snapshot) => snapshot.records === 1 && snapshot.snapshots === 1), true);
  });

  it("returns a bounded terminal result when stop races before a worker beginAttempt", async () => {
    const userDataDir = await temporaryDirectory("task-v2-wait-race-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-wait-race-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const store = createTaskOrchestratorStore({ userDataDir });
    await store.initialize();
    const primary = profileFromSelection("primary", selection());
    const worker = profileFromSelection("worker", selection("worker-agent", "claude", "worker-model", "Worker"));
    const now = Date.now();
    const run = {
      schemaVersion: 2,
      id: "run-wait-race",
      taskId: "task-wait-race",
      taskRevision: 1,
      definition: {
        idea: "A local task",
        workspaceRoot,
        primary,
        allowedWorkers: [worker],
        permissionMode: "restricted",
        contractFinalization: "manual-confirm",
        contract: contract(),
        template: "task-center-v2",
      },
      status: "running",
      primaryAttemptId: "pending",
      currentAttemptId: null,
      primaryAttempts: [],
      workerAttempts: [],
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      error: null,
    };
    const primaryAttempt = createAttempt(defaultId, () => now, run, "primary", primary, "Execute the frozen contract.", null, "running");
    primaryAttempt.leaseId = "lease-primary";
    primaryAttempt.startedAt = now;
    const workerAttempt = createAttempt(defaultId, () => now, run, "worker", worker, "Keep working.", primaryAttempt.id, "ready");
    run.primaryAttemptId = primaryAttempt.id;
    run.currentAttemptId = workerAttempt.id;
    run.primaryAttempts.push(primaryAttempt);
    run.workerAttempts.push(workerAttempt);
    await writeTaskForRun(store, run);
    await store.writeRun(run);

    let releaseGate;
    let signalGateEntered;
    const gateEntered = new Promise((resolve) => { signalGateEntered = resolve; });
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    let tail = Promise.resolve();
    const serialized = (operation) => {
      const result = tail.then(async () => {
        signalGateEntered();
        await gate;
        return operation();
      }, async () => {
        signalGateEntered();
        await gate;
        return operation();
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    };
    let starts = 0;
    const personalAgentRuntime = {
      async createConversation() { return { conversation: { id: "conversation-worker" } }; },
      async startMessage() { starts += 1; return { runId: "personal-worker", status: "completed", output: "unexpected" }; },
      async getRun() { return { runId: "personal-worker", status: "completed", output: "unexpected" }; },
      async cancelRun() { return { ok: true }; },
      async resolveApproval() { return { ok: true }; },
      async cancelTaskOperation(input) { return { ok: true, operationId: input?.operationId ?? null, status: "cancelled", pending: false }; },
      getTaskOperation() { return null; },
    };
    const runner = createTaskOrchestratorRunner({
      personalAgentRuntime,
      store,
      now: Date.now,
      createId: defaultId,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      pollMs: 1, awaitAlignment: true,
      serialized,
      emit: async () => undefined,
      isClosed: () => false,
    });

    const launched = runner.launch(run.taskId, run.id, workerAttempt.id);
    await gateEntered;
    const waiting = runner.invokeTool(run, primaryAttempt, "wait_agent", { attemptId: workerAttempt.id });
    const cancelled = structuredClone(run);
    cancelled.status = "cancelled";
    cancelled.error = "Cancelled by test stop race.";
    cancelled.updatedAt = Date.now();
    cancelled.finishedAt = Date.now();
    for (const attempt of cancelled.primaryAttempts) {
      attempt.status = "cancelled";
      attempt.leaseId = null;
      attempt.error = "Cancelled by test stop race.";
      attempt.updatedAt = Date.now();
      attempt.finishedAt = Date.now();
    }
    await store.writeRun(cancelled);
    releaseGate();

    const waited = await Promise.race([
      waiting,
      new Promise((_, reject) => setTimeout(() => reject(new Error("wait_agent exceeded race timeout")), 1_000)),
    ]);
    await launched;
    await runner.awaitActive(run.id);
    assert.ok(["cancelled", "blocked"].includes(waited.status));
    const final = await store.requireRun(run.taskId, run.id);
    assert.ok(["cancelled", "blocked"].includes(final.workerAttempts[0].status));
    assert.equal(final.workerAttempts[0].leaseId, null);
    assert.equal(starts, 0);
  });

  it("fails closed after admission when the frozen deadline passes before provider creation", async () => {
    const userDataDir = await temporaryDirectory("task-v2-deadline-fence-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-deadline-fence-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const store = createTaskOrchestratorStore({ userDataDir });
    await store.initialize();
    const fixture = await createReadyPrimaryFixture(store, workspaceRoot, "deadline-fence");
    fixture.run = await store.requireRun(fixture.run.taskId, fixture.run.id);
    fixture.attempt = fixture.run.primaryAttempts[0];
    fixture.run.definition.endConditions.deadlineAt = 2_000;
    fixture.run.definition.endConditions.maxElapsedMs = null;
    fixture.run.updatedAt = 1_000;
    fixture.attempt.updatedAt = 1_000;
    await store.writeRun(fixture.run);

    let clock = 1_000;
    let creates = 0;
    let starts = 0;
    const runtime = {
      async createConversation() { creates += 1; return { conversation: { id: "too-late" } }; },
      async startMessage() { starts += 1; return { status: "completed", output: "too late" }; },
      async getRun() { return null; }, async cancelRun() { return { ok: true }; },
      async resolveApproval() { return { ok: true }; },
      async cancelTaskOperation(input) { return { ok: true, operationId: input?.operationId ?? null, status: "cancelled", pending: false }; },
      getTaskOperation() { return null; },
    };
    const runner = createTaskOrchestratorRunner({
      personalAgentRuntime: runtime,
      store,
      now: () => clock,
      createId: defaultId,
      sleep: async () => undefined,
      pollMs: 1,
      serialized: createSerialized(),
      emit: async () => undefined,
      isClosed: () => false,
      preflightAttempt: async () => { clock = 2_000; },
    });

    await runner.launch(fixture.run.taskId, fixture.run.id, fixture.attempt.id);
    const blocked = await store.requireRun(fixture.run.taskId, fixture.run.id);
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.error, /deadline/i);
    assert.equal(blocked.primaryAttempts[0].leaseId, null);
    assert.equal(creates, 0);
    assert.equal(starts, 0);
  });

  it("reconciles a persisted notBefore attempt only after the remaining restart delay", async () => {
    const userDataDir = await temporaryDirectory("task-v2-not-before-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-not-before-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let clock = 2_000;
    const store = createTaskOrchestratorStore({ userDataDir, now: () => clock });
    await store.initialize();
    const fixture = await createReadyPrimaryFixture(store, workspaceRoot, "not-before");
    const persisted = await store.requireRun(fixture.run.taskId, fixture.run.id);
    persisted.status = "backoff";
    persisted.primaryAttempts[0].notBefore = 5_000;
    await store.writeRun(persisted);

    let starts = 0;
    const runtime = {
      async createConversation() { return { conversation: { id: "after-backoff" } }; },
      async startMessage() { starts += 1; return { status: "completed", output: "done" }; },
      async getRun() { return null; }, async cancelRun() { return { ok: true }; },
      async resolveApproval() { return { ok: true }; },
      async cancelTaskOperation(input) { return { ok: true, operationId: input?.operationId ?? null, status: "cancelled", pending: false }; },
      getTaskOperation() { return null; },
    };
    const runner = createTaskOrchestratorRunner({
      personalAgentRuntime: runtime,
      store,
      now: () => clock,
      createId: defaultId,
      sleep: async () => undefined,
      pollMs: 1,
      serialized: createSerialized(),
      emit: async () => undefined,
      isClosed: () => false,
    });

    assert.deepEqual(await runner.reconcileReadyAttempts(), []);
    assert.deepEqual(runner.readyWakeSnapshot(), { scheduledAt: 5_000, reconciling: false });
    assert.equal(starts, 0);
    clock = 5_000;
    const restored = await runner.reconcileReadyAttempts();
    assert.equal(restored.length, 1);
    await runner.awaitActive(persisted.id);
    assert.equal(starts, 1);
    assert.equal((await store.requireRun(persisted.taskId, persisted.id)).primaryAttempts[0].notBefore, null);
    runner.closeAdmissions();
  });
});
