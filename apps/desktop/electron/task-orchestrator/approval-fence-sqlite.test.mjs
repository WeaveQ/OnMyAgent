import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";

import {
  taskOrchestratorContractSchema,
  taskOrchestratorHumanGateSchema,
  taskOrchestratorRunSchema,
  taskOrchestratorTaskSchema,
} from "@onmyagent/types/task-orchestrator";

import { createTaskOrchestratorSqliteStore } from "./sqlite-store.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function profile(id, kind) {
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
    catalogRevision: "catalog-1",
    capabilitySnapshot: null,
    instructions: "",
    approvalMode: "ask",
    sessionStrategy: "fresh",
    timeoutMs: 10_000,
  };
}

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "approval-fence-sqlite-"));
  roots.push(root);
  const primary = profile("primary", "primary");
  const worker = profile("worker", "worker");
  const contract = taskOrchestratorContractSchema.parse({
    outcome: "Fence the approval transition.",
    deliverables: ["A durable terminal transition"],
    acceptance: ["The transition is atomic"],
    scope: { included: ["The local workspace"], excluded: ["Remote systems"] },
    verification: ["Run the SQLite fence test"],
  });
  const task = taskOrchestratorTaskSchema.parse({
    schemaVersion: 2,
    id: "task-approval-fence",
    revision: 1,
    idea: "Fence an approval.",
    workspaceRoot: root,
    primary,
    allowedWorkers: [worker],
    permissionMode: "restricted",
    contractFinalization: "manual-confirm",
    contract,
    definitionStatus: "ready",
    template: "task-center-v2",
    alignment: { conversationId: null, personalRunId: null, messages: [], proposals: [], latestProposalId: null, latestProposalRevision: null },
    latestRunId: "run-approval-fence",
    createdAt: 1,
    updatedAt: 2,
  });
  const activeAttempt = {
    id: "attempt-primary",
    kind: "primary",
    profileId: primary.id,
    parentAttemptId: null,
    depth: 0,
    status: "running",
    leaseId: "lease-primary",
    personalRunId: "personal-primary",
    conversationId: "conversation-primary",
    prompt: "Run the task.",
    outputArtifactIds: [],
    timeoutMs: 10_000,
    startedAt: 3,
    progressAt: 4,
    updatedAt: 5,
    finishedAt: null,
    error: null,
  };
  const run = taskOrchestratorRunSchema.parse({
    schemaVersion: 2,
    id: "run-approval-fence",
    taskId: task.id,
    taskRevision: task.revision,
    definition: {
      idea: task.idea,
      workspaceRoot: task.workspaceRoot,
      primary: task.primary,
      allowedWorkers: task.allowedWorkers,
      permissionMode: task.permissionMode,
      contractFinalization: task.contractFinalization,
      contract: task.contract,
      template: task.template,
    },
    status: "waiting-approval",
    primaryAttemptId: activeAttempt.id,
    currentAttemptId: activeAttempt.id,
    primaryAttempts: [activeAttempt],
    workerAttempts: [],
    createdAt: 3,
    startedAt: 3,
    updatedAt: 5,
    finishedAt: null,
    error: null,
  });
  const gate = taskOrchestratorHumanGateSchema.parse({
    schemaVersion: 2,
    id: "gate-primary",
    kind: "personal-runtime-approval",
    status: "pending",
    taskId: task.id,
    taskRunId: run.id,
    taskRevision: task.revision,
    attemptId: activeAttempt.id,
    turnId: null,
    leaseId: activeAttempt.leaseId,
    personalRunId: activeAttempt.personalRunId,
    personalApprovalId: "approval-1",
    expiresAt: 100,
    title: "Approve operation",
    summary: "The agent requested an operation approval.",
    risk: "careful",
    operation: { method: "tool", kind: "read", command: null, cwd: root, params: [], diff: null, readOnly: true },
    requestedAt: 6,
    decisionRequestedAt: null,
    resolvedAt: null,
    decision: null,
  });
  const fencedAttempt = { ...activeAttempt, status: "blocked", leaseId: null, updatedAt: 20, finishedAt: 20, error: "Approval expired." };
  const terminalRun = taskOrchestratorRunSchema.parse({
    ...run,
    status: options.runStatus ?? "blocked",
    primaryAttempts: [fencedAttempt],
    updatedAt: 20,
    finishedAt: 20,
    error: "Approval expired.",
  });
  const terminalGate = taskOrchestratorHumanGateSchema.parse({
    ...gate,
    status: "cancelled",
    decisionRequestedAt: null,
    resolvedAt: 20,
    decision: null,
  });
  const events = [
    { schemaVersion: 2, id: "event-approval-expired", sequence: 1, taskId: task.id, taskRunId: run.id, attemptId: activeAttempt.id, turnId: null, type: "approval-expired", message: "Approval gate expired.", at: 20 },
    { schemaVersion: 2, id: "event-run-blocked", sequence: 2, taskId: task.id, taskRunId: run.id, attemptId: activeAttempt.id, turnId: null, type: "run-blocked", message: "Run blocked after approval expiry.", at: 20 },
  ];
  const store = createTaskOrchestratorSqliteStore({ userDataDir: root, ...options });
  await store.initialize();
  await store.writeTask(task);
  await store.writeRun(run);
  await store.writeGate(gate);
  return { root, store, task, run, gate, terminalRun, terminalGate, events, input: {
    taskId: task.id,
    taskRunId: run.id,
    expectedRun: {
      id: run.id,
      taskId: run.taskId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      status: run.status,
      currentAttemptId: run.currentAttemptId,
      attempts: [{
        id: activeAttempt.id,
        status: activeAttempt.status,
        leaseId: activeAttempt.leaseId,
        personalRunId: activeAttempt.personalRunId,
        updatedAt: activeAttempt.updatedAt,
      }],
    },
    expectedGates: [{ id: gate.id, status: gate.status, taskId: task.id, taskRunId: run.id, leaseId: gate.leaseId, personalRunId: gate.personalRunId, decisionRequestedAt: null }],
    gates: [terminalGate],
    run: terminalRun,
    events,
  } };
}

async function counts(store) {
  const db = new DatabaseSync(store.dbPath);
  const result = {
    gates: Number(db.prepare("SELECT COUNT(*) AS count FROM gates").get().count),
    events: Number(db.prepare("SELECT COUNT(*) AS count FROM events").get().count),
    outbox: Number(db.prepare("SELECT COUNT(*) AS count FROM outbox").get().count),
    run: db.prepare("SELECT status, payload_json FROM runs WHERE id = ?").get("run-approval-fence"),
  };
  db.close();
  return result;
}

describe("SQLite approval fence", () => {
  it("commits terminal gates, fenced run, audit events, and outbox intents together", async () => {
    const { store, input } = await fixture();
    const result = await store.commitApprovalFence(input);
    assert.equal(result.committed, true);
    assert.equal(result.idempotent, false);
    assert.equal(result.gates[0].status, "cancelled");
    assert.equal(result.run.status, "blocked");
    assert.deepEqual(result.events.map((event) => event.type), ["approval-expired", "run-blocked"]);
    const persisted = await counts(store);
    assert.deepEqual({ gates: persisted.gates, events: persisted.events, outbox: persisted.outbox }, { gates: 1, events: 2, outbox: 2 });
    assert.equal(persisted.run.status, "blocked");
    await store.close();
  });

  it("rolls back every mutation stage when the injected failure fires", async () => {
    for (const stage of ["after-gates", "after-run", "after-events"]) {
      const { store, input } = await fixture({ approvalFenceFailureAt: stage });
      await assert.rejects(store.commitApprovalFence(input), new RegExp(`Injected approval fence failure at ${stage}`));
      const persisted = await counts(store);
      assert.equal(persisted.gates, 1, stage);
      assert.equal(persisted.events, 0, stage);
      assert.equal(persisted.outbox, 0, stage);
      assert.equal(persisted.run.status, "waiting-approval", stage);
      await store.close();
    }
  });

  it("rejects a stale gate CAS without mutating the run or notification rows", async () => {
    const { store, input } = await fixture();
    const stale = structuredClone(input);
    stale.expectedGates[0].status = "resolving";
    await assert.rejects(store.commitApprovalFence(stale), /expected state is stale/);
    const persisted = await counts(store);
    assert.equal(persisted.gates, 1);
    assert.equal(persisted.events, 0);
    assert.equal(persisted.outbox, 0);
    assert.equal(persisted.run.status, "waiting-approval");
    await store.close();
  });

  it("rejects a stale run CAS after a new active sibling is persisted", async () => {
    const { store, input, run } = await fixture();
    const worker = {
      id: "attempt-worker",
      kind: "worker",
      profileId: "worker",
      parentAttemptId: run.primaryAttemptId,
      depth: 1,
      status: "running",
      leaseId: "lease-worker",
      personalRunId: "personal-worker",
      conversationId: "conversation-worker",
      prompt: "Run the worker.",
      outputArtifactIds: [],
      timeoutMs: 10_000,
      startedAt: 10,
      progressAt: 10,
      updatedAt: 11,
      finishedAt: null,
      error: null,
    };
    await store.writeRun(taskOrchestratorRunSchema.parse({ ...run, workerAttempts: [worker], updatedAt: 11 }));
    await assert.rejects(store.commitApprovalFence(input), /expected state is stale/);
    const persisted = await store.readRun(run.taskId, run.id);
    assert.equal(persisted.workerAttempts[0].id, worker.id);
    assert.equal(persisted.workerAttempts[0].leaseId, worker.leaseId);
    const countsAfter = await counts(store);
    assert.equal(countsAfter.events, 0);
    assert.equal(countsAfter.outbox, 0);
    await store.close();
  });

  it("rejects an undefined decision timestamp instead of coercing it to zero", async () => {
    const { store, input } = await fixture();
    const malformed = structuredClone(input);
    malformed.expectedGates[0].decisionRequestedAt = undefined;
    await assert.rejects(store.commitApprovalFence(malformed), /decisionRequestedAt is invalid/);
    const persisted = await counts(store);
    assert.equal(persisted.events, 0);
    assert.equal(persisted.outbox, 0);
    assert.equal(persisted.run.status, "waiting-approval");
    await store.close();
  });

  it("rejects a null expected run cursor instead of bypassing run CAS", async () => {
    const { store, input } = await fixture();
    const malformed = structuredClone(input);
    malformed.expectedRun = null;
    await assert.rejects(store.commitApprovalFence(malformed), /expectedRun is required/);
    const persisted = await counts(store);
    assert.equal(persisted.events, 0);
    assert.equal(persisted.outbox, 0);
    assert.equal(persisted.run.status, "waiting-approval");
    await store.close();
  });

  it("replays an exact committed transition once and rejects a mismatched retry", async () => {
    const { store, input } = await fixture();
    const first = await store.commitApprovalFence(input);
    const retry = await store.commitApprovalFence(structuredClone(input));
    assert.equal(retry.idempotent, true);
    assert.equal(retry.committed, false);
    assert.deepEqual(retry.events, first.events);
    const persisted = await counts(store);
    assert.equal(persisted.events, 2);
    assert.equal(persisted.outbox, 2);

    const mismatch = structuredClone(input);
    mismatch.gates[0].summary = "Different terminal payload";
    await assert.rejects(store.commitApprovalFence(mismatch), /expected state is stale|mismatch|terminal/);
    const afterMismatch = await counts(store);
    assert.equal(afterMismatch.events, 2);
    assert.equal(afterMismatch.outbox, 2);
    await store.close();
  });
});
