import assert from "node:assert/strict";
import test from "node:test";

import { taskOrchestratorHumanGateSchema } from "@onmyagent/types/task-orchestrator";

import {
  approvalGateExpiryAt,
  createApprovalDecisionReconciler,
  createApprovalGateExpirationReconciler,
  reconcileApprovalGateStates,
  frozenRunHardDeadline,
  terminalGateForInterruptedRun,
} from "./approval-gates.mjs";

function runFixture(overrides = {}) {
  return {
    taskId: "task-1",
    id: "run-1",
    status: "waiting-approval",
    currentAttemptId: "attempt-1",
    primaryAttempts: [{
      id: "attempt-1",
      kind: "primary",
      status: "waiting-approval",
      leaseId: "lease-current",
      personalRunId: "personal-current",
    }],
    workerAttempts: [],
    checkerAttempts: [],
    definition: { endConditions: { deadlineAt: 1_000, maxElapsedMs: 500 } },
    createdAt: 100,
    updatedAt: 100,
    finishedAt: null,
    error: null,
    ...overrides,
  };
}

function gateFixture(overrides = {}) {
  return {
    id: "gate-1",
    kind: "personal-runtime-approval",
    status: "pending",
    taskId: "task-1",
    taskRunId: "run-1",
    taskRevision: 1,
    attemptId: "attempt-1",
    leaseId: "lease-current",
    personalRunId: "personal-current",
    personalApprovalId: "approval-1",
    expiresAt: 900,
    ...overrides,
  };
}

function storeFixture(run, gates) {
  const writes = { gates: [], runs: [] };
  return {
    writes,
    async allRuns() { return [run]; },
    async readGates() { return gates.map((gate) => structuredClone(gate)); },
    async writeGate(gate) {
      const index = gates.findIndex((candidate) => candidate.id === gate.id);
      if (index >= 0) gates[index] = structuredClone(gate);
      writes.gates.push(structuredClone(gate));
      return gate;
    },
    async writeRun(next) { Object.assign(run, structuredClone(next)); writes.runs.push(structuredClone(next)); return next; },
    async findRun() { return { taskId: run.taskId, run }; },
  };
}

test("provider approval expiry is bounded by the frozen run deadline", () => {
  const run = runFixture();
  assert.equal(frozenRunHardDeadline(run), 600);
  assert.equal(approvalGateExpiryAt(run, { expiresAt: 550 }), 550);
  assert.equal(approvalGateExpiryAt(run, { expiresAt: 700 }), 600);
  assert.equal(approvalGateExpiryAt(run, {}, "manual-review"), 600);
});

test("legacy gates parse with nullable TTL and lease identity defaults", () => {
  const parsed = taskOrchestratorHumanGateSchema.safeParse({
    schemaVersion: 2,
    id: "gate-legacy",
    kind: "manual-review",
    status: "pending",
    taskId: "task-1",
    taskRunId: "run-1",
    taskRevision: 1,
    attemptId: "attempt-1",
    personalApprovalId: null,
    title: "Review",
    summary: "Review",
    risk: "careful",
    operation: { method: null, kind: null, command: null, cwd: null, params: [], diff: null, readOnly: true },
    requestedAt: 1,
    decisionRequestedAt: null,
    resolvedAt: null,
    decision: null,
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.expiresAt, null);
  assert.equal(parsed.data.leaseId, null);
  assert.equal(parsed.data.personalRunId, null);
});

test("expired provider gate is terminalized, audited, and cancels the retained Personal run exactly once", async () => {
  const run = runFixture();
  const gates = [gateFixture()];
  const store = storeFixture(run, gates);
  const events = [];
  const cancellations = [];
  const reconcile = createApprovalGateExpirationReconciler({
    store,
    now: () => 1_000,
    serialized: (operation) => operation(),
    emit: async (_run, type, message, attemptId) => events.push({ type, message, attemptId }),
    cancelAttempt: async (request) => { cancellations.push(request); return { ok: true }; },
  });

  const first = await reconcile();
  assert.equal(gates[0].status, "cancelled");
  assert.equal(run.status, "blocked");
  assert.equal(run.primaryAttempts[0].leaseId, null);
  assert.deepEqual(cancellations.map((item) => item.personalRunId), ["personal-current"]);
  assert.deepEqual(events.map((event) => event.type), ["approval-expired", "run-blocked"]);
  assert.equal(first.cancellationFailures.length, 0);

  await reconcile();
  assert.equal(cancellations.length, 1);
});

test("stale provider lease is rejected and old Personal identity is cancelled", async () => {
  const run = runFixture();
  const gates = [gateFixture({ leaseId: "lease-old", personalRunId: "personal-old", expiresAt: null })];
  const store = storeFixture(run, gates);
  const cancellations = [];
  const reconcile = createApprovalGateExpirationReconciler({
    store,
    now: () => 200,
    serialized: (operation) => operation(),
    emit: async () => undefined,
    cancelAttempt: async (request) => { cancellations.push(request); return { ok: true }; },
  });
  await reconcile();
  assert.equal(gates[0].status, "cancelled");
  assert.equal(run.status, "blocked");
  assert.equal(cancellations[0].personalRunId, "personal-old");
  assert.equal(cancellations[0].reason, "task-approval-stale");
});

test("fence retry rebuilds from a concurrent sibling and cancels only active Personal identities", async () => {
  const historical = {
    id: "attempt-history",
    kind: "worker",
    status: "succeeded",
    leaseId: null,
    personalRunId: "personal-history",
    updatedAt: 90,
  };
  const run = runFixture({
    workerAttempts: [historical],
  });
  const gates = [gateFixture()];
  let firstCommit = true;
  let commits = 0;
  const store = {
    async readGates() { return gates.map((gate) => structuredClone(gate)); },
    async readRun() { return structuredClone(run); },
    async commitApprovalFence(plan) {
      commits += 1;
      if (firstCommit) {
        firstCommit = false;
        run.workerAttempts.push({ id: "attempt-worker", kind: "worker", status: "running", leaseId: "lease-worker", personalRunId: "personal-worker", updatedAt: 101 });
        throw new Error("Approval fence run expected state is stale");
      }
      gates.splice(0, gates.length, ...plan.gates.map((gate) => structuredClone(gate)));
      Object.assign(run, structuredClone(plan.run));
      return { committed: true, idempotent: false, run: plan.run, gates: plan.gates, events: plan.events };
    },
  };
  const cancellations = [];
  const result = await reconcileApprovalGateStates({ store, run, gates, now: () => 1_000, emit: async () => undefined, createId: (kind) => `${kind}-id` });
  // The first stale CAS is retried against the sibling-inclusive run.
  assert.equal(commits, 2);
  assert.equal(result.run.status, "blocked");
  assert.deepEqual(result.cancelRequests.map((request) => request.personalRunId).sort(), ["personal-current", "personal-worker"]);
  assert.equal(result.cancelRequests.some((request) => request.personalRunId === "personal-history"), false);
  cancellations.push(...result.cancelRequests);
  assert.equal(cancellations.length, 2);
});

test("confirmed expiry cancellation invokes tombstone callback; unconfirmed does not", async () => {
  const run = runFixture();
  const gates = [gateFixture()];
  const store = storeFixture(run, gates);
  const confirmed = [];
  const reconcile = createApprovalGateExpirationReconciler({
    store,
    now: () => 1_000,
    serialized: (operation) => operation(),
    emit: async () => undefined,
    cancelAttempt: async () => ({ ok: true }),
    onCancellationConfirmed: async (request) => { confirmed.push(request.personalRunId); },
  });
  await reconcile();
  assert.deepEqual(confirmed, ["personal-current"]);

  const runFailure = runFixture();
  const gatesFailure = [gateFixture()];
  const failures = [];
  const reconcileFailure = createApprovalGateExpirationReconciler({
    store: storeFixture(runFailure, gatesFailure),
    now: () => 1_000,
    serialized: (operation) => operation(),
    emit: async () => undefined,
    cancelAttempt: async () => ({ ok: false, error: "provider still running" }),
    onCancellationConfirmed: async () => { failures.push("unexpected"); },
  });
  const result = await reconcileFailure();
  assert.equal(result.cancellationFailures.length, 1);
  assert.deepEqual(failures, []);
});

test("manual review expires without a click and is not replayed after restart", async () => {
  const run = runFixture({
    status: "waiting-approval",
    primaryAttempts: [{ id: "attempt-1", kind: "primary", status: "succeeded", leaseId: null, personalRunId: null, updatedAt: 20 }],
  });
  const gates = [gateFixture({ kind: "manual-review", leaseId: null, personalRunId: null, personalApprovalId: null, status: "resolving", decision: "approve", expiresAt: 50 })];
  const store = storeFixture(run, gates);
  store.allRuns = async () => [run];
  const events = [];
  const reconcile = createApprovalDecisionReconciler({
    store,
    now: () => 100,
    serialized: (operation) => operation(),
    emit: async (_run, type) => { events.push(type); },
  });
  const first = await reconcile();
  assert.equal(run.status, "blocked");
  assert.equal(gates[0].status, "cancelled");
  assert.deepEqual(events, ["approval-expired", "run-blocked"]);
  const second = await reconcile();
  assert.deepEqual(second.cancelRequests, []);
  assert.deepEqual(events, ["approval-expired", "run-blocked"]);
  assert.deepEqual(first.cancelRequests, []);
});

test("decision reconciliation fences and cancels a provider gate that expires at the final boundary", async () => {
  const run = runFixture();
  const gates = [gateFixture({ status: "resolving", decision: "approve", expiresAt: 50 })];
  const store = storeFixture(run, gates);
  store.allRuns = async () => [run];
  const cancellations = [];
  const reconcile = createApprovalDecisionReconciler({
    store,
    now: () => 100,
    serialized: (operation) => operation(),
    emit: async () => undefined,
    cancelAttempt: async (request) => { cancellations.push(request.personalRunId); return { ok: true }; },
  });
  const result = await reconcile();
  assert.equal(run.status, "blocked");
  assert.equal(gates[0].status, "cancelled");
  assert.deepEqual(cancellations, ["personal-current"]);
  assert.deepEqual(result.cancellationFailures, []);
});

test("restart interruption never replays a resolving provider approval", () => {
  const provider = terminalGateForInterruptedRun(gateFixture({ status: "resolving", decision: "approve", decisionRequestedAt: 150 }), 200);
  assert.equal(provider.status, "cancelled");
  assert.equal(provider.decision, null);
  const manual = terminalGateForInterruptedRun(gateFixture({ kind: "manual-review", personalApprovalId: null, leaseId: null, personalRunId: null, status: "resolving", decision: "approve", decisionRequestedAt: 150 }), 200);
  assert.equal(manual.status, "approved");
});
