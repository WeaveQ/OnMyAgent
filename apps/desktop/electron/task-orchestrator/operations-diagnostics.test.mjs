import assert from "node:assert/strict";
import test from "node:test";

import { buildOperationsDiagnostics, projectOperationsDiagnostics } from "./operations-diagnostics.mjs";

const NOW = 100_000;

function health(overrides = {}) {
  return {
    healthy: true,
    rows: { outbox: 7, processes: 3 },
    storage: { databaseBytes: 12_288, reclaimableBytes: 4_096 },
    lastMaintenance: { ranAt: 90_000 },
    ...overrides,
  };
}

test("projects active lease, progress, provider, process, and storage diagnostics from a fake clock", () => {
  const result = projectOperationsDiagnostics({
    now: NOW,
    run: {
      status: "running",
      currentAttemptId: "attempt-primary",
      primaryAttempts: [{
        id: "attempt-primary",
        status: "running",
        leaseId: "lease-primary",
        leaseAcquiredAt: 10_000,
        leaseExpiresAt: 200_000,
        progressAt: 90_000,
        providerDiagnostics: {
          providerSessionId: "session-1",
          effectiveModel: "gpt-5.6-sol",
          transport: "stdio",
          requestId: "request-1",
          fallbackCount: 2,
        },
      }],
    },
    processRows: [
      { status: "running", pid: 4312, command: "curl --header authorization=secret" },
      { status: "starting", pid: 4313, payload: { path: "/Users/secret/project" } },
      { status: "exited", pid: 4314 },
    ],
    health: health(),
  });

  assert.deepEqual(result.terminalReason, {
    code: "RUN_ACTIVE",
    category: "active",
    message: "The task run is still active.",
  });
  assert.deepEqual(result.attempt, {
    attemptId: "attempt-primary",
    status: "running",
    leaseId: "lease-primary",
    leaseAgeMs: 90_000,
    leaseExpiresAt: 200_000,
    progressAt: 90_000,
    progressAgeMs: 10_000,
  });
  assert.deepEqual(result.provider, {
    session: "session-1",
    effectiveModel: "gpt-5.6-sol",
    transport: "stdio",
    connectionMode: null,
    requestId: "request-1",
    fallbackCount: 2,
    observed: true,
  });
  assert.deepEqual(result.processes, {
    count: 3,
    active: 2,
    states: { running: 1, starting: 1, exited: 1 },
    pids: [4312, 4313, 4314],
  });
  assert.deepEqual(result.storage, {
    observed: true,
    observedAt: null,
    stale: false,
    healthy: true,
    databaseBytes: 12_288,
    reclaimableBytes: 4_096,
    outboxCount: 7,
    processCount: 3,
    lastMaintenanceAt: 90_000,
  });
  assert.equal(result.truncated, false);
  assert.doesNotMatch(JSON.stringify(result), /authorization|secret|Users\/secret|command|payload/);
  assert.equal(buildOperationsDiagnostics, projectOperationsDiagnostics);
});

test("maps terminal error patterns to stable reasons without copying raw errors", () => {
  const result = projectOperationsDiagnostics({
    now: NOW,
    run: {
      status: "failed",
      error: "Personal startMessage timed out after 5ms; token=sk-live-secret at /Users/huangchunan/project",
      primaryAttempts: [{ id: "attempt-failed", status: "failed", error: "same raw error" }],
    },
  });
  assert.deepEqual(result.terminalReason, {
    code: "TASK_RUNTIME_TIMEOUT",
    category: "timeout",
    message: "The task runtime deadline was exceeded.",
  });
  assert.doesNotMatch(JSON.stringify(result), /sk-live-secret|huangchunan|Personal startMessage/);
});

test("legacy and missing input is safe, explicit provider absence remains unobserved", () => {
  const blocked = projectOperationsDiagnostics({
    now: NOW,
    snapshot: { run: { status: "blocked", error: "legacy run state" } },
    providerDiagnostics: { metadata: { apiKey: "secret" } },
    processes: null,
    health: null,
  });
  assert.equal(blocked.terminalReason.code, "TASK_BLOCKED");
  assert.deepEqual(blocked.provider, {
    session: null,
    effectiveModel: null,
    transport: null,
    connectionMode: null,
    requestId: null,
    fallbackCount: 0,
    observed: false,
  });
  assert.deepEqual(blocked.attempt, {
    attemptId: null,
    status: "unknown",
    leaseId: null,
    leaseAgeMs: null,
    leaseExpiresAt: null,
    progressAt: null,
    progressAgeMs: null,
  });
  assert.equal(blocked.storage.observed, false);
  assert.equal(blocked.storage.healthy, null);
  assert.equal(blocked.storage.outboxCount, null);
  assert.equal(projectOperationsDiagnostics({ now: NOW }).terminalReason.code, "RUN_UNKNOWN");
});

test("active primary wins over a terminal current worker and paused runs are explicit", () => {
  const result = projectOperationsDiagnostics({
    now: NOW,
    run: {
      status: "running",
      currentAttemptId: "worker-terminal",
      primaryAttempts: [{ id: "primary-running", kind: "primary", status: "running", leaseId: "lease-primary", updatedAt: 90_000 }],
      workerAttempts: [{ id: "worker-terminal", kind: "worker", status: "succeeded", updatedAt: 99_000 }],
    },
  });
  assert.equal(result.attempt.attemptId, "primary-running");

  const paused = projectOperationsDiagnostics({ run: { status: "paused", pause: { status: "paused" } } });
  assert.equal(paused.terminalReason.code, "RUN_PAUSED");
});

test("provider transport and connection mode stay separate and unsafe values are dropped", () => {
  const result = projectOperationsDiagnostics({
    run: {
      status: "running",
      currentAttemptId: "attempt-provider",
      primaryAttempts: [{
        id: "attempt-provider",
        status: "running",
        providerDiagnostics: {
          transport: "stdio",
          connectionMode: "ACP session",
          providerSessionId: "../../Users/private-token",
          effectiveModel: "model\u0000name",
          requestId: "request/secret",
        },
      }],
    },
  });
  assert.deepEqual(result.provider, {
    session: null,
    effectiveModel: null,
    transport: "stdio",
    connectionMode: "ACP session",
    requestId: null,
    fallbackCount: 0,
    observed: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /Users|private-token|model\u0000|secret/);
});

test("aggregated process metrics avoid materializing process payloads", () => {
  const result = projectOperationsDiagnostics({
    processAggregate: {
      count: 10_000,
      active: 2,
      states: { running: 2, exited: 9_998 },
      pids: [4321, 4321, 7, 2_147_483_648],
    },
  });
  assert.deepEqual(result.processes, { count: 10_000, active: 2, states: { exited: 9_998, running: 2 }, pids: [7, 4321] });
});

test("large process and provider input is returned within the requested UTF-8 byte bound", () => {
  const result = projectOperationsDiagnostics({
    maxBytes: 400,
    now: NOW,
    run: {
      status: "failed",
      error: "provider failed",
      currentAttemptId: "attempt-large",
      primaryAttempts: [{
        id: "attempt-large",
        status: "failed",
        providerDiagnostics: {
          providerSessionId: "session-large",
          effectiveModel: "model-large",
          transport: "stdio",
          requestId: "request-large",
          fallbackCount: 99,
        },
      }],
    },
    processRows: Array.from({ length: 500 }, (_, index) => ({
      id: `process-${index}`,
      status: index % 2 ? "running" : "exited",
      pid: 10_000 + index,
      command: "do-not-copy-this-command",
    })),
    health: health({ rows: { outbox: 500, processes: 500 } }),
  });
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 1_024);
  assert.equal(result.truncated, true);
  assert.doesNotMatch(JSON.stringify(result), /do-not-copy-this-command/);
});
