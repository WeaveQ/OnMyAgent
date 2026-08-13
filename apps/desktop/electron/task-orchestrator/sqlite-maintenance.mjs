const DAY_MS = 24 * 60 * 60 * 1_000;
const TASK_CENTER_STORAGE_BUDGET_BYTES = 10 * 1024 * 1024 * 1024;
const TASK_CENTER_STORAGE_WARNING_BYTES = 8 * 1024 * 1024 * 1024;

export const TASK_CENTER_MAINTENANCE_DEFAULTS = Object.freeze({
  retentionMs: 30 * DAY_MS,
  maxTerminalRowsPerTable: 2_000,
  incrementalVacuumPages: 256,
});

const OPERATIONAL_TABLES = Object.freeze({
  rpcRequests: {
    table: "rpc_requests",
    idColumn: "idempotency_key",
    timeColumn: "COALESCE(finished_at, started_at)",
    terminal: ["completed", "failed", "unknown"],
  },
  outbox: {
    table: "outbox",
    idColumn: "id",
    timeColumn: "created_at",
    terminal: ["completed", "delivered", "cancelled"],
  },
  processTombstones: {
    table: "processes",
    idColumn: "id",
    timeColumn: "updated_at",
    terminal: ["exited", "failed", "cancelled", "stopped", "terminated", "tombstoned", "stale"],
  },
});

const DEFAULT_DIAGNOSTICS_PID_LIMIT = 32;
const MAX_DIAGNOSTICS_PID_LIMIT = 64;
const DEFAULT_DIAGNOSTICS_STATE_LIMIT = 24;
const MAX_DIAGNOSTICS_STATE_LIMIT = 64;
const ACTIVE_PROCESS_STATUSES = Object.freeze(["starting", "running", "stopping", "active"]);

function boundedInteger(value, fallback, { min, max, label }) {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function normalizeTaskCenterMaintenancePolicy(input = {}) {
  return {
    retentionMs: boundedInteger(input.retentionMs, TASK_CENTER_MAINTENANCE_DEFAULTS.retentionMs, {
      min: 0,
      max: 365 * DAY_MS,
      label: "retentionMs",
    }),
    maxTerminalRowsPerTable: boundedInteger(
      input.maxTerminalRowsPerTable,
      TASK_CENTER_MAINTENANCE_DEFAULTS.maxTerminalRowsPerTable,
      { min: 1, max: 20_000, label: "maxTerminalRowsPerTable" },
    ),
    incrementalVacuumPages: boundedInteger(
      input.incrementalVacuumPages,
      TASK_CENTER_MAINTENANCE_DEFAULTS.incrementalVacuumPages,
      { min: 1, max: 4_096, label: "incrementalVacuumPages" },
    ),
  };
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function tableCount(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0);
}

function boundedLimit(value, fallback, maximum, label) {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function terminalCount(db, definition) {
  return Number(db.prepare(
    `SELECT COUNT(*) AS count FROM ${definition.table} WHERE status IN (${placeholders(definition.terminal)})`,
  ).get(...definition.terminal)?.count ?? 0);
}

export function taskCenterRowCounts(db) {
  return {
    tasks: tableCount(db, "tasks"),
    runs: tableCount(db, "runs"),
    artifacts: tableCount(db, "artifacts"),
    events: tableCount(db, "events"),
    gates: tableCount(db, "gates"),
    rpcRequests: tableCount(db, "rpc_requests"),
    outbox: tableCount(db, "outbox"),
    processes: tableCount(db, "processes"),
    rpcRequestTerminal: terminalCount(db, OPERATIONAL_TABLES.rpcRequests),
    outboxTerminal: terminalCount(db, OPERATIONAL_TABLES.outbox),
    processTombstones: terminalCount(db, OPERATIONAL_TABLES.processTombstones),
  };
}

/**
 * Return the bounded, read-only aggregate used by high-frequency operations
 * diagnostics.  Unlike `health()`, this deliberately does not run
 * `PRAGMA quick_check` and never selects process payload rows.  Process state
 * counts are grouped in SQLite and only a bounded set of positive PIDs is
 * materialized for display.
 */
export function taskCenterDiagnosticsAggregate(db, input = {}) {
  const runId = input.runId == null ? null : String(input.runId).trim();
  if (runId === "") throw new Error("runId is invalid");
  const pidLimit = boundedLimit(input.pidLimit, DEFAULT_DIAGNOSTICS_PID_LIMIT, MAX_DIAGNOSTICS_PID_LIMIT, "pidLimit");
  const stateLimit = boundedLimit(input.stateLimit, DEFAULT_DIAGNOSTICS_STATE_LIMIT, MAX_DIAGNOSTICS_STATE_LIMIT, "stateLimit");
  const predicate = runId === null ? "" : " WHERE run_id = ?";
  const params = runId === null ? [] : [runId];
  const processCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM processes${predicate}`).get(...params)?.count ?? 0);
  const activePredicate = runId === null
    ? `WHERE status IN (${ACTIVE_PROCESS_STATUSES.map(() => "?").join(", ")})`
    : `WHERE run_id = ? AND status IN (${ACTIVE_PROCESS_STATUSES.map(() => "?").join(", ")})`;
  const activeParams = runId === null ? [...ACTIVE_PROCESS_STATUSES] : [runId, ...ACTIVE_PROCESS_STATUSES];
  const active = Number(db.prepare(`SELECT COUNT(*) AS count FROM processes ${activePredicate}`).get(...activeParams)?.count ?? 0);
  const stateRows = db.prepare(
    `SELECT status, COUNT(*) AS count FROM processes${predicate}
     GROUP BY status ORDER BY count DESC, status ASC LIMIT ?`,
  ).all(...params, stateLimit);
  const pidRows = db.prepare(
    `SELECT pid FROM processes${predicate}${predicate ? " AND" : " WHERE"}
       pid IS NOT NULL AND pid > 0 AND pid <= 2147483647
     ORDER BY updated_at DESC, id DESC LIMIT ?`,
  ).all(...params, pidLimit);
  const rowCounts = taskCenterRowCounts(db);
  const storage = taskCenterStorageMetrics(db, input);
  return {
    rows: rowCounts,
    storage,
    processes: {
      count: processCount,
      active,
      states: Object.fromEntries(stateRows.map((row) => [String(row.status ?? "unknown"), Number(row.count ?? 0)])),
      pids: [...new Set(pidRows.map((row) => Number(row.pid)).filter((pid) => Number.isInteger(pid) && pid > 0))]
        .slice(0, pidLimit),
    },
  };
}

function deleteExpired(db, definition, cutoff) {
  return Number(db.prepare(
    `DELETE FROM ${definition.table}
     WHERE status IN (${placeholders(definition.terminal)}) AND ${definition.timeColumn} < ?`,
  ).run(...definition.terminal, cutoff).changes ?? 0);
}

function trimTerminalOverflow(db, definition, maxRows) {
  return Number(db.prepare(
    `DELETE FROM ${definition.table}
     WHERE ${definition.idColumn} IN (
       SELECT ${definition.idColumn} FROM ${definition.table}
       WHERE status IN (${placeholders(definition.terminal)})
       ORDER BY ${definition.timeColumn} DESC, ${definition.idColumn} DESC
       LIMIT -1 OFFSET ?
     )`,
  ).run(...definition.terminal, maxRows).changes ?? 0);
}

/** Delete only bounded operational state. Task, run and artifact rows are never touched. */
export function pruneTaskCenterOperationalRows(db, input = {}) {
  const timestamp = boundedInteger(input.now, Date.now(), { min: 0, max: Number.MAX_SAFE_INTEGER, label: "now" });
  const policy = normalizeTaskCenterMaintenancePolicy(input);
  const cutoff = Math.max(0, timestamp - policy.retentionMs);
  const protectedBefore = {
    tasks: tableCount(db, "tasks"),
    runs: tableCount(db, "runs"),
    artifacts: tableCount(db, "artifacts"),
  };
  const before = taskCenterRowCounts(db);
  const deleted = {};
  for (const [key, definition] of Object.entries(OPERATIONAL_TABLES)) {
    deleted[key] = deleteExpired(db, definition, cutoff)
      + trimTerminalOverflow(db, definition, policy.maxTerminalRowsPerTable);
  }
  const protectedAfter = {
    tasks: tableCount(db, "tasks"),
    runs: tableCount(db, "runs"),
    artifacts: tableCount(db, "artifacts"),
  };
  if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) {
    throw new Error("Task Center maintenance attempted to mutate protected task history");
  }
  return {
    policy,
    cutoff,
    before,
    after: taskCenterRowCounts(db),
    deleted,
    protectedRows: protectedAfter,
  };
}

function pragmaScalar(db, name) {
  const row = db.prepare(`PRAGMA ${name}`).get();
  return Number(Object.values(row ?? {})[0] ?? 0);
}

export function taskCenterStorageMetrics(db, input = {}) {
  const pageSize = pragmaScalar(db, "page_size");
  const pageCount = pragmaScalar(db, "page_count");
  const freelistCount = pragmaScalar(db, "freelist_count");
  const dbPath = typeof input.dbPath === "string" ? input.dbPath : null;
  const fileSize = typeof input.fileSize === "function" ? input.fileSize : null;
  const fileBytes = (suffix) => {
    if (!dbPath || !fileSize) return 0;
    try {
      const value = Number(fileSize(`${dbPath}${suffix}`));
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    } catch {
      return 0;
    }
  };
  const databaseFileBytes = fileBytes("");
  const walBytes = fileBytes("-wal");
  const shmBytes = fileBytes("-shm");
  const totalFileBytes = databaseFileBytes + walBytes + shmBytes;
  const warnings = [];
  if (totalFileBytes >= TASK_CENTER_STORAGE_BUDGET_BYTES) warnings.push("task-center-storage-budget-exhausted");
  else if (totalFileBytes >= TASK_CENTER_STORAGE_WARNING_BYTES) warnings.push("task-center-storage-high-watermark");
  if (walBytes >= 1024 * 1024 * 1024) warnings.push("task-center-wal-high-watermark");
  return {
    pageSize,
    pageCount,
    freelistCount,
    databaseBytes: pageSize * pageCount,
    databaseFileBytes,
    walBytes,
    shmBytes,
    totalFileBytes,
    reclaimableBytes: pageSize * freelistCount,
    autoVacuum: pragmaScalar(db, "auto_vacuum") === 2 ? "incremental" : "disabled",
    budgetBytes: TASK_CENTER_STORAGE_BUDGET_BYTES,
    warningBytes: TASK_CENTER_STORAGE_WARNING_BYTES,
    exhausted: totalFileBytes >= TASK_CENTER_STORAGE_BUDGET_BYTES,
    warnings,
  };
}

export function taskCenterStorageMetricsForPath(db, dbPath, fileSize) {
  return taskCenterStorageMetrics(db, { dbPath, fileSize });
}

/** WAL checkpoint and bounded incremental vacuum run outside a transaction. */
export function maintainTaskCenterStorage(db, incrementalVacuumPages, input = {}) {
  const pages = boundedInteger(
    incrementalVacuumPages,
    TASK_CENTER_MAINTENANCE_DEFAULTS.incrementalVacuumPages,
    { min: 1, max: 4_096, label: "incrementalVacuumPages" },
  );
  const before = taskCenterStorageMetrics(db, input);
  const checkpointRow = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get() ?? {};
  db.exec(`PRAGMA incremental_vacuum(${pages})`);
  const after = taskCenterStorageMetrics(db, input);
  return {
    before,
    after,
    checkpoint: {
      busy: Number(checkpointRow.busy ?? Object.values(checkpointRow)[0] ?? 0),
      logFrames: Number(checkpointRow.log ?? Object.values(checkpointRow)[1] ?? 0),
      checkpointedFrames: Number(checkpointRow.checkpointed ?? Object.values(checkpointRow)[2] ?? 0),
    },
    incrementalVacuumPages: pages,
  };
}
