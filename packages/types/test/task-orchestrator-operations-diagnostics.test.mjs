import assert from "node:assert/strict";
import test from "node:test";

import {
  taskOrchestratorDiagnosticsHealthResultSchema,
  taskOrchestratorOperationsDiagnosticsSchema,
} from "@onmyagent/types/task-orchestrator";

test("operations diagnostics schema keeps provider transport and connection mode separate", () => {
  const value = taskOrchestratorOperationsDiagnosticsSchema.parse({
    version: 1,
    generatedAt: 1,
    terminalReason: { code: "RUN_ACTIVE", category: "active", message: "Active" },
    attempt: { attemptId: null, status: "running", leaseId: null, leaseAgeMs: null, leaseExpiresAt: null, progressAt: null, progressAgeMs: null },
    context: { usedTokens: null, totalTokens: null, percent: null, source: "unknown", modelId: null, observedAt: null, observed: false },
    retries: { transportRetries: 0, consecutiveFailures: 0, primaryTurnsUsed: 0, workerAttemptsUsed: 0 },
    provider: { session: null, effectiveModel: null, transport: null, connectionMode: "ACP session", requestId: null, fallbackCount: 0, observed: true },
    processes: { count: 0, active: 0, states: {}, pids: [] },
    storage: { observed: false, observedAt: null, stale: false, healthy: null, databaseBytes: null, reclaimableBytes: null, outboxCount: null, processCount: null, lastMaintenanceAt: null },
    truncated: false,
  });
  assert.equal(value.provider.transport, null);
  assert.equal(value.provider.connectionMode, "ACP session");
  assert.equal(value.storage.healthy, null);
});

test("diagnostics health schema requires observation metadata and bounded process aggregate", () => {
  const result = taskOrchestratorDiagnosticsHealthResultSchema.parse({
    observed: true,
    observedAt: 10,
    stale: false,
    healthy: true,
    rows: { tasks: 0, runs: 0, artifacts: 0, events: 0, gates: 0, rpcRequests: 0, outbox: 0, processes: 0, rpcRequestTerminal: 0, outboxTerminal: 0, processTombstones: 0 },
    storage: { pageSize: 4_096, pageCount: 1, freelistCount: 0, databaseBytes: 4_096, reclaimableBytes: 0, autoVacuum: "incremental" },
    processes: { count: 0, active: 0, states: {}, pids: [] },
    lastMaintenance: null,
  });
  assert.equal(result.observed, true);
  assert.deepEqual(result.processes.pids, []);
});
