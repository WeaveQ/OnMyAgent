import { statSync } from "node:fs";

import {
  taskOrchestratorDiagnosticsHealthResultSchema,
  taskOrchestratorDiagnosticsProcessAggregateSchema,
  taskOrchestratorMaintenanceResultSchema,
  taskOrchestratorStoreHealthResultSchema,
} from "@onmyagent/types/task-orchestrator";

import {
  configureTaskCenterDatabase,
  readTaskCenterMigrationHistory,
  readTaskCenterSchemaVersion,
  taskCenterQuickCheck,
} from "./sqlite-schema.mjs";
import { sqliteCorruptionMarkerPath } from "./sqlite-corruption.mjs";
import {
  maintainTaskCenterStorage,
  normalizeTaskCenterMaintenancePolicy,
  pruneTaskCenterOperationalRows,
  taskCenterDiagnosticsAggregate,
  taskCenterRowCounts,
} from "./sqlite-maintenance.mjs";

const DIAGNOSTICS_HEALTH_CACHE_TTL_MS = 5_000;

/**
 * Keep read-model and maintenance concerns outside the authoritative CRUD
 * store. The callbacks are deliberately injected so this module cannot open
 * a second SQLite connection or bypass the store's serialized mutation gate.
 */
export function createTaskCenterHealthRuntime(options = {}) {
  const {
    initialize,
    now,
    serialized,
    requireDb,
    withTransaction,
    dbPath,
    storageMetrics,
    getStorageFailure,
    parseJson,
    fileSize = (target) => statSync(target).size,
  } = options;
  if (typeof initialize !== "function") throw new Error("initialize callback is required");
  if (typeof now !== "function") throw new Error("now callback is required");
  if (typeof serialized !== "function") throw new Error("serialized callback is required");
  if (typeof requireDb !== "function") throw new Error("requireDb callback is required");
  if (typeof withTransaction !== "function") throw new Error("withTransaction callback is required");
  if (typeof storageMetrics !== "function") throw new Error("storageMetrics callback is required");
  if (typeof getStorageFailure !== "function") throw new Error("getStorageFailure callback is required");
  if (typeof parseJson !== "function") throw new Error("parseJson callback is required");

  let diagnosticsHealthCache = null;

  function readLastMaintenance(connection) {
    const row = connection.prepare("SELECT value FROM metadata WHERE key = 'last_maintenance'").get();
    return row ? parseJson(row.value, "last maintenance metrics") : null;
  }

  /**
   * Bounded process/storage aggregate for high-frequency diagnostics. This
   * never selects process payloads and does not run SQLite quick_check.
   */
  async function diagnosticsAggregate(input = {}) {
    await initialize();
    const runId = input.runId == null ? null : String(input.runId).trim();
    if (runId === "") throw new Error("runId is invalid");
    const aggregate = await serialized(() => taskCenterDiagnosticsAggregate(requireDb(), {
      runId,
      pidLimit: input.pidLimit,
      stateLimit: input.stateLimit,
      dbPath,
      fileSize,
    }));
    return {
      ...aggregate,
      processes: taskOrchestratorDiagnosticsProcessAggregateSchema.parse(aggregate.processes),
    };
  }

  /**
   * Cached, integrity-check-free health for active diagnostics polling. The
   * explicit `health()` method remains the quick_check boundary.
   */
  async function diagnosticsHealth(input = {}) {
    await initialize();
    const observedAt = now();
    const maxAgeMs = input.maxAgeMs == null ? DIAGNOSTICS_HEALTH_CACHE_TTL_MS : Number(input.maxAgeMs);
    if (!Number.isInteger(maxAgeMs) || maxAgeMs < 0 || maxAgeMs > DIAGNOSTICS_HEALTH_CACHE_TTL_MS) {
      throw new Error(`maxAgeMs must be an integer between 0 and ${DIAGNOSTICS_HEALTH_CACHE_TTL_MS}`);
    }
    if (diagnosticsHealthCache && observedAt - diagnosticsHealthCache.observedAt <= maxAgeMs) {
      return { ...diagnosticsHealthCache, stale: false };
    }
    const aggregate = await diagnosticsAggregate();
    const value = taskOrchestratorDiagnosticsHealthResultSchema.parse({
      observed: true,
      observedAt,
      stale: false,
      // Availability only: a full PRAGMA quick_check is reserved for health.
      healthy: getStorageFailure() === null,
      rows: aggregate.rows,
      storage: aggregate.storage,
      processes: aggregate.processes,
      lastMaintenance: readLastMaintenance(requireDb()),
    });
    diagnosticsHealthCache = value;
    return value;
  }

  async function health() {
    await initialize();
    const connection = requireDb();
    const pragmas = configureTaskCenterDatabase(connection);
    const quickCheck = taskCenterQuickCheck(connection);
    return taskOrchestratorStoreHealthResultSchema.parse({
      dbPath,
      corruptionMarkerPath: sqliteCorruptionMarkerPath(dbPath),
      pragmas,
      quickCheck,
      healthy: quickCheck.length === 1 && quickCheck[0].toLowerCase() === "ok",
      rows: taskCenterRowCounts(connection),
      storage: storageMetrics(connection),
      maintenancePolicy: normalizeTaskCenterMaintenancePolicy(),
      lastMaintenance: readLastMaintenance(connection),
    });
  }

  async function schemaVersion() {
    await initialize();
    return readTaskCenterSchemaVersion(requireDb());
  }

  async function migrationHistory() {
    await initialize();
    return readTaskCenterMigrationHistory(requireDb());
  }

  async function runMaintenance(input = {}) {
    await initialize();
    const timestamp = now();
    return serialized(() => {
      const connection = requireDb();
      const pruned = withTransaction((transaction) => pruneTaskCenterOperationalRows(transaction, {
        ...input,
        now: timestamp,
      }));
      const storage = maintainTaskCenterStorage(connection, pruned.policy.incrementalVacuumPages, {
        dbPath,
        fileSize,
      });
      const result = {
        ranAt: timestamp,
        policy: pruned.policy,
        cutoff: pruned.cutoff,
        before: pruned.before,
        after: pruned.after,
        deleted: pruned.deleted,
        protectedRows: pruned.protectedRows,
        storage,
      };
      withTransaction((transaction) => {
        transaction.prepare(
          `INSERT INTO metadata(key, value, updated_at) VALUES('last_maintenance', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
        ).run(JSON.stringify(result), timestamp);
      });
      return taskOrchestratorMaintenanceResultSchema.parse(result);
    });
  }

  return Object.freeze({ diagnosticsAggregate, diagnosticsHealth, health, schemaVersion, migrationHistory, runMaintenance });
}
