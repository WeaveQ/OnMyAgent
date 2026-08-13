import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";

import {
  taskOrchestratorContractSchema,
  taskOrchestratorRunSchema,
  taskOrchestratorTaskSchema,
} from "@onmyagent/types/task-orchestrator";

import { createTaskOrchestratorSqliteStore } from "./sqlite-store.mjs";
import { createTaskOrchestratorRunner } from "./runner.mjs";
import { createRuntime } from "./v2-test-helpers.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root() {
  const value = await mkdtemp(path.join(os.tmpdir(), "task-center-owner-"));
  roots.push(value);
  return value;
}

function serializedQueue() {
  let tail = Promise.resolve();
  return (operation) => {
    const current = tail.then(operation, operation);
    tail = current.catch(() => undefined);
    return current;
  };
}

function controlledTimers() {
  const pending = [];
  return {
    pending,
    setTimeout(callback, delay) {
      const handle = { callback, delay, cleared: false, unref() {} };
      pending.push(handle);
      return handle;
    },
    clearTimeout(handle) { handle.cleared = true; },
    async fireLatest() {
      const handle = [...pending].reverse().find((candidate) => !candidate.cleared);
      assert.ok(handle, "a durable admission wake must be scheduled");
      handle.cleared = true;
      handle.callback();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function testRunner({ store, runtime, now, timers, isClosed }) {
  let sequence = 0;
  return createTaskOrchestratorRunner({
    personalAgentRuntime: runtime,
    store,
    now,
    createId: (prefix) => `${prefix}-${++sequence}`,
    sleep: async () => undefined,
    pollMs: 1,
    serialized: serializedQueue(),
    emit: async () => undefined,
    notify: async () => true,
    isClosed,
    supervisorEpoch: store.supervisorEpoch,
    readyWakeSetTimeout: timers.setTimeout,
    readyWakeClearTimeout: timers.clearTimeout,
  });
}

function profile(id, kind = "primary") {
  return {
    id,
    label: id,
    kind,
    runtime: "personal-local-agent",
    agentId: id,
    provider: kind === "primary" ? "codex" : "claude",
    model: `${id}-model`,
    modelLabel: `${id} model`,
    catalogSource: "personal-registry",
    catalogRevision: null,
    instructions: "",
    approvalMode: "ask",
    sessionStrategy: "fresh",
    timeoutMs: 10_000,
  };
}

function records(workspaceRoot) {
  const contract = taskOrchestratorContractSchema.parse({
    outcome: "Durably own the task.",
    deliverables: ["A recoverable record"],
    acceptance: ["The owner survives restart"],
    scope: { included: ["local"], excluded: ["remote"] },
    verification: ["focused owner test"],
  });
  const task = taskOrchestratorTaskSchema.parse({
    schemaVersion: 2,
    id: "task-owner",
    revision: 1,
    idea: "durable owner",
    workspaceRoot,
    primary: profile("primary"),
    allowedWorkers: [profile("worker", "worker")],
    permissionMode: "restricted",
    contractFinalization: "manual-confirm",
    contract,
    definitionStatus: "ready",
    template: "task-center-v2",
    alignment: { conversationId: null, personalRunId: null, messages: [], proposals: [], latestProposalId: null, latestProposalRevision: null },
    latestRunId: "run-owner",
    createdAt: 1,
    updatedAt: 1,
  });
  const primary = {
    id: "attempt-primary",
    kind: "primary",
    profileId: "primary",
    parentAttemptId: null,
    depth: 0,
    status: "ready",
    leaseId: null,
    personalRunId: null,
    conversationId: null,
    prompt: "run",
    outputArtifactIds: [],
    timeoutMs: 10_000,
    startedAt: null,
    updatedAt: 10,
    finishedAt: null,
    error: null,
  };
  const worker = { ...primary, id: "attempt-worker", kind: "worker", profileId: "worker", parentAttemptId: primary.id, depth: 1, updatedAt: 20 };
  const run = taskOrchestratorRunSchema.parse({
    schemaVersion: 2,
    id: "run-owner",
    taskId: task.id,
    taskRevision: task.revision,
    definition: {
      idea: task.idea,
      workspaceRoot,
      primary: task.primary,
      allowedWorkers: task.allowedWorkers,
      permissionMode: task.permissionMode,
      contractFinalization: task.contractFinalization,
      contract,
      template: task.template,
      executionProtocol: "structured-decisions-v1",
    },
    status: "queued",
    primaryAttemptId: primary.id,
    currentAttemptId: primary.id,
    primaryAttempts: [primary],
    workerAttempts: [worker],
    turns: [{ id: "turn-owner", sequence: 1, status: "pending", reason: "initial", primaryAttemptId: primary.id, workerAttemptIds: [worker.id], decisionId: null, checkpointId: null, capsuleId: null, context: null, startedAt: null, updatedAt: 10, finishedAt: null }],
    currentTurnId: "turn-owner",
    createdAt: 10,
    startedAt: null,
    updatedAt: 20,
    finishedAt: null,
    error: null,
  });
  return { task, run, primary, worker };
}

describe("Task Center durable owner invariants", () => {
  it("replays an outbox row after commit-before-broadcast and acknowledges it once", async () => {
    const userDataDir = await root();
    const first = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-one" });
    await first.initialize();
    const { task } = records(userDataDir);
    await first.writeTask(task);
    await first.appendEvent({ schemaVersion: 2, id: "event-owner", sequence: 1, taskId: task.id, taskRunId: null, attemptId: null, type: "alignment-started", message: "committed", at: 2 });
    assert.equal((await first.listOutbox({ statuses: ["pending"] })).length, 1);
    await first.close();

    const second = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-two" });
    await second.initialize();
    const observed = [];
    assert.deepEqual(await second.replayOutbox({ notify: (event) => observed.push(event.id) }), { claimed: 1, delivered: 1, pending: 0 });
    assert.deepEqual(observed, ["event-owner"]);
    assert.deepEqual(await second.replayOutbox({ notify: (event) => observed.push(event.id) }), { claimed: 0, delivered: 0, pending: 0 });
    await second.close();
  });

  it("fences leases from an old Supervisor epoch and reconstructs ready admission order", async () => {
    const userDataDir = await root();
    const first = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-one" });
    await first.initialize();
    const { task, run, primary } = records(userDataDir);
    run.primaryAttempts[0].status = "running";
    run.primaryAttempts[0].leaseId = "lease-owner";
    run.status = "running";
    await first.writeTask(task);
    await first.writeRun(run);
    const db = new DatabaseSync(first.dbPath);
    assert.equal(db.prepare("SELECT epoch FROM leases WHERE id = ?").get("lease-owner").epoch, "epoch-one");
    db.close();
    await first.close();

    const second = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-two" });
    await second.initialize();
    assert.equal(await second.isLeaseCurrent({ taskRunId: run.id, attemptId: primary.id, leaseId: "lease-owner" }), false);
    await second.close();

    const queued = createTaskOrchestratorSqliteStore({ userDataDir: await root(), supervisorEpoch: "epoch-queue" });
    const queueRoot = queued.rootDirectory;
    const queueRecords = records(queueRoot);
    await queued.initialize();
    await queued.writeTask(queueRecords.task);
    await queued.writeRun(queueRecords.run);
    const ready = await queued.listReadyAttempts();
    assert.deepEqual(ready.items.map((item) => item.attempt.id), ["attempt-primary", "attempt-worker"]);
    assert.equal(ready.hasMore, false);
    assert.deepEqual(await queued.readAdmission({ taskRunId: queueRecords.run.id, attemptId: queueRecords.primary.id }), {
      taskRunId: queueRecords.run.id,
      attemptId: queueRecords.primary.id,
      kind: "primary",
      priority: 100,
      sequence: 1,
      enqueuedAt: 10,
      status: "queued",
    });
    await queued.close();
  });

  it("defaults a legacy attempt without notBefore to immediate eligibility", () => {
    const fixture = records("/tmp/task-center-legacy-not-before");
    const legacy = structuredClone(fixture.run);
    for (const attempt of [...legacy.primaryAttempts, ...legacy.workerAttempts]) delete attempt.notBefore;
    const parsed = taskOrchestratorRunSchema.parse(legacy);
    assert.deepEqual(
      [...parsed.primaryAttempts, ...parsed.workerAttempts].map((attempt) => attempt.notBefore),
      [null, null],
    );
  });

  it("records provider process lifecycle, keeps a Quit tombstone, and marks stale rows on restart", async () => {
    const userDataDir = await root();
    const first = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-one" });
    await first.initialize();
    await first.upsertProcess({ id: "process-owner", runId: null, attemptId: null, pid: 4312, status: "running" });
    await first.close();
    const second = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-two" });
    await second.initialize();
    assert.equal((await second.readProcess("process-owner")).status, "stale");
    await second.tombstoneProcess({ id: "process-owner", status: "terminated" });
    assert.equal((await second.readProcess("process-owner")).status, "terminated");
    await assert.rejects(second.upsertProcess({ id: "process-owner", pid: 4312, status: "running" }), /tombstone is immutable/i);
    await second.close();
  });

  it("requeues a stale admitted ticket when a Supervisor crashes before lease persistence", async () => {
    const userDataDir = await root();
    const first = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-before-crash" });
    await first.initialize();
    const { task, run, primary } = records(userDataDir);
    await first.writeTask(task);
    await first.writeRun(run);
    assert.equal(await first.markAdmission({ taskRunId: run.id, attemptId: primary.id, status: "admitted" }), true);
    assert.equal((await first.readAdmission({ taskRunId: run.id, attemptId: primary.id })).status, "admitted");
    await first.close();

    const recovered = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-after-crash" });
    await recovered.initialize();
    const page = await recovered.listReadyAttempts();
    assert.ok(page.items.some((item) => item.attempt.id === primary.id));
    assert.equal((await recovered.readAdmission({ taskRunId: run.id, attemptId: primary.id })).status, "queued");
    await recovered.close();
  });

  it("paginates more than two hundred durable admissions without changing their original order", async () => {
    const userDataDir = await root();
    const store = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-backlog" });
    await store.initialize();
    const fixture = records(userDataDir);
    fixture.task.endConditions.maxWorkerAttempts = 500;
    fixture.run.definition.endConditions.maxWorkerAttempts = 500;
    await store.writeTask(fixture.task);
    await store.writeRun(fixture.run);
    for (let index = 1; index <= 201; index += 1) {
      const attempt = {
        ...structuredClone(fixture.worker),
        // Persist in the opposite lexical order to prove the durable sequence
        // (not attempt id or timestamp) is the recovery cursor.
        id: `attempt-backlog-${String(202 - index).padStart(3, "0")}`,
        updatedAt: 10,
      };
      fixture.run.workerAttempts.push(attempt);
      fixture.run.currentAttemptId = attempt.id;
      fixture.run.updatedAt += 1;
      await store.writeRun(fixture.run);
    }
    const seen = [];
    let cursor = null;
    do {
      const page = await store.listReadyAttempts({ limit: 200, cursor });
      seen.push(...page.items);
      cursor = page.hasMore ? page.nextCursor : null;
    } while (cursor);
    assert.equal(seen.length, 203);
    assert.equal(new Set(seen.map((item) => item.attempt.id)).size, 203);
    assert.deepEqual(seen.map((item) => item.sequence), Array.from({ length: 203 }, (_, index) => index + 1));

    const firstAdmission = await store.readAdmission({ taskRunId: fixture.run.id, attemptId: fixture.primary.id });
    fixture.run.updatedAt += 1;
    await store.writeRun(fixture.run);
    assert.deepEqual(
      await store.readAdmission({ taskRunId: fixture.run.id, attemptId: fixture.primary.id }),
      firstAdmission,
      "ordinary run writes must not reorder an existing queued ticket",
    );
    await store.close();
  });

  it("restores every durable admission beyond the first startup page", async () => {
    const userDataDir = await root();
    const store = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-runner-backlog" });
    await store.initialize();
    const fixture = records(userDataDir);
    fixture.task.endConditions.maxWorkerAttempts = 500;
    fixture.run.definition.endConditions.maxWorkerAttempts = 500;
    await store.writeTask(fixture.task);
    await store.writeRun(fixture.run);
    for (let index = 1; index <= 201; index += 1) {
      fixture.run.workerAttempts.push({
        ...structuredClone(fixture.worker),
        id: `attempt-runner-backlog-${String(index).padStart(3, "0")}`,
        updatedAt: fixture.run.updatedAt + index,
      });
    }
    fixture.run.updatedAt += 202;
    await store.writeRun(fixture.run);

    const runtime = createRuntime({ start: async () => ({ status: "running" }) });
    const timers = controlledTimers();
    let closed = false;
    const runner = testRunner({ store, runtime, now: Date.now, timers, isClosed: () => closed });
    try {
      const restored = await runner.reconcileReadyAttempts();
      assert.equal(restored.length, 203);
      assert.equal(new Set(restored.map((item) => item.attempt.id)).size, 203);
      const snapshot = runner.schedulerSnapshot();
      assert.equal(snapshot.active + snapshot.queued, 203);
    } finally {
      closed = true;
      runner.closeAdmissions("test complete");
      await runner.awaitActive();
      await store.close();
    }
  });

  it("reports future notBefore rows without hiding later runnable admissions", async () => {
    const userDataDir = await root();
    const store = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-backoff", now: () => 1_000 });
    await store.initialize();
    const fixture = records(userDataDir);
    fixture.run.primaryAttempts[0].notBefore = 5_000;
    fixture.run.workerAttempts[0].notBefore = null;
    await store.writeTask(fixture.task);
    await store.writeRun(fixture.run);

    const page = await store.listReadyAttempts({ readyAt: 1_000, limit: 200 });
    assert.deepEqual(page.items.map((item) => item.attempt.id), [fixture.worker.id]);
    assert.equal(page.nextNotBefore, 5_000);
    assert.equal(page.hasMore, false);

    const awakened = await store.listReadyAttempts({ readyAt: 5_000, limit: 200 });
    assert.deepEqual(awakened.items.map((item) => item.attempt.id), [fixture.primary.id, fixture.worker.id]);
    await store.close();
  });

  it("keeps the durable notBefore fence across a Supervisor restart", async () => {
    const userDataDir = await root();
    const first = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-delay-before", now: () => 1_000 });
    await first.initialize();
    const fixture = records(userDataDir);
    fixture.run.primaryAttempts[0].notBefore = 5_000;
    await first.writeTask(fixture.task);
    await first.writeRun(fixture.run);
    await first.close();

    const recovered = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-delay-after", now: () => 2_000 });
    await recovered.initialize();
    const waiting = await recovered.listReadyAttempts({ readyAt: 2_000 });
    assert.equal(waiting.items.some((item) => item.attempt.id === fixture.primary.id), false);
    assert.equal(waiting.nextNotBefore, 5_000);
    const ready = await recovered.listReadyAttempts({ readyAt: 5_000 });
    assert.equal(ready.items.some((item) => item.attempt.id === fixture.primary.id), true);
    assert.equal(ready.items.find((item) => item.attempt.id === fixture.primary.id).attempt.notBefore, 5_000);
    await recovered.close();
  });

  it("restores a future retry and launches it exactly once at its durable deadline", async () => {
    const userDataDir = await root();
    let clock = 1_000;
    const first = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-wake-before", now: () => clock });
    await first.initialize();
    const fixture = records(userDataDir);
    fixture.run.workerAttempts = [];
    fixture.run.turns[0].workerAttemptIds = [];
    fixture.run.status = "backoff";
    fixture.run.primaryAttempts[0].notBefore = 5_000;
    await first.writeTask(fixture.task);
    await first.writeRun(fixture.run);
    await first.close();

    const recovered = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-wake-after", now: () => clock });
    const runtime = createRuntime();
    const timers = controlledTimers();
    let closed = false;
    const runner = testRunner({ store: recovered, runtime, now: () => clock, timers, isClosed: () => closed });
    try {
      assert.deepEqual(await runner.reconcileReadyAttempts(), []);
      assert.equal(runtime.startCalls.length, 0);
      assert.deepEqual(runner.readyWakeSnapshot(), { scheduledAt: 5_000, reconciling: false });
      assert.equal(timers.pending.at(-1).delay, 4_000);

      clock = 4_999;
      await timers.fireLatest();
      assert.equal(runtime.startCalls.length, 0, "an early wake must re-arm without launching");
      assert.equal(runner.readyWakeSnapshot().scheduledAt, 5_000);

      clock = 5_000;
      await timers.fireLatest();
      await runner.awaitActive();
      assert.equal(runtime.startCalls.length, 1);
      assert.equal((await recovered.requireRun(fixture.task.id, fixture.run.id)).primaryAttempts[0].notBefore, null);
      await runner.reconcileReadyAttempts();
      await runner.awaitActive();
      assert.equal(runtime.startCalls.length, 1, "repeated recovery must not replay a completed admission");
    } finally {
      closed = true;
      runner.closeAdmissions("test complete");
      await runner.awaitActive();
      await recovered.close();
    }
  });

  it("launches an already-due durable retry immediately after restart", async () => {
    const userDataDir = await root();
    let clock = 1_000;
    const first = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-due-before", now: () => clock });
    await first.initialize();
    const fixture = records(userDataDir);
    fixture.run.workerAttempts = [];
    fixture.run.turns[0].workerAttemptIds = [];
    fixture.run.status = "backoff";
    fixture.run.primaryAttempts[0].notBefore = 5_000;
    await first.writeTask(fixture.task);
    await first.writeRun(fixture.run);
    await first.close();

    clock = 5_000;
    const recovered = createTaskOrchestratorSqliteStore({ userDataDir, supervisorEpoch: "epoch-due-after", now: () => clock });
    const runtime = createRuntime();
    const timers = controlledTimers();
    let closed = false;
    const runner = testRunner({ store: recovered, runtime, now: () => clock, timers, isClosed: () => closed });
    try {
      const restored = await runner.reconcileReadyAttempts();
      assert.equal(restored.length, 1);
      await runner.awaitActive();
      assert.equal(runtime.startCalls.length, 1);
      assert.equal(runner.readyWakeSnapshot().scheduledAt, null);
    } finally {
      closed = true;
      runner.closeAdmissions("test complete");
      await runner.awaitActive();
      await recovered.close();
    }
  });
});
