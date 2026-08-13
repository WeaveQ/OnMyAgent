/**
 * The Task Center supervisor database schema.
 *
 * The supervisor deliberately keeps the public v2 records as canonical JSON
 * payloads while also recording the fields needed for ordering, lookup and
 * uniqueness in ordinary SQLite columns.  This lets the store remain
 * backwards compatible with the current JSON-shaped API without giving the
 * renderer a second source of truth.
 */

export const TASK_CENTER_SQLITE_SCHEMA_VERSION = 7;
export const TASK_CENTER_SQLITE_SCHEMA_MIN_VERSION = 0;

/**
 * Every schema transition is recorded before its next transition can run.
 * Keeping the step names here (instead of hiding them in callers) makes a
 * failed startup diagnosable and lets a later restart resume idempotently.
 */
export const TASK_CENTER_SCHEMA_MIGRATIONS = Object.freeze([
  Object.freeze({ from: 0, to: 1, name: "bootstrap-metadata" }),
  Object.freeze({ from: 1, to: 2, name: "outbox-owner-state" }),
  Object.freeze({ from: 2, to: 3, name: "process-owner-state" }),
  Object.freeze({ from: 3, to: 4, name: "durable-admission-queue" }),
  Object.freeze({ from: 4, to: 5, name: "process-tombstones" }),
  Object.freeze({ from: 5, to: 6, name: "outbox-attempt-counters" }),
  Object.freeze({ from: 6, to: 7, name: "explicit-purge-audit" }),
]);

export const TASK_CENTER_PRAGMAS = Object.freeze({
  journalMode: "wal",
  synchronous: "full",
  foreignKeys: true,
  busyTimeoutMs: 5_000,
  trustedSchema: false,
  autoVacuum: "incremental",
});

const DDL = `
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  from_version INTEGER NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  workspace_root TEXT NOT NULL,
  definition_status TEXT NOT NULL,
  latest_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  lease_id TEXT,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  parent_attempt_id TEXT,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leases (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL,
  status TEXT NOT NULL,
  expires_at INTEGER,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(run_id, sequence)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS continuation_capsules (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  from_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_grants (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS side_effects (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  receipt_status TEXT NOT NULL,
  idempotency TEXT NOT NULL,
  intent_at INTEGER NOT NULL,
  receipt_at INTEGER,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gates (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  stream_key TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(stream_key, sequence)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  committed INTEGER NOT NULL DEFAULT 1 CHECK (committed IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  stream_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  owner_epoch TEXT,
  claimed_at INTEGER,
  delivered_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rpc_requests (
  idempotency_key TEXT PRIMARY KEY,
  request_digest TEXT NOT NULL,
  owner_epoch TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed', 'unknown')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  result_json TEXT,
  error_json TEXT
);

CREATE TABLE IF NOT EXISTS processes (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE CASCADE,
  pid INTEGER,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  owner_epoch TEXT,
  process_start_token TEXT,
  tombstoned_at INTEGER
);

CREATE TABLE IF NOT EXISTS admission_queue (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  priority INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  enqueued_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'admitted', 'cancelled', 'released')),
  owner_epoch TEXT,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(run_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS migration_markers (
  id TEXT PRIMARY KEY,
  source_root TEXT NOT NULL,
  source_manifest_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staging', 'active', 'failed')),
  imported_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS migration_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marker_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(marker_id, source_path, category, message)
);

CREATE TABLE IF NOT EXISTS purge_audit (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_revision INTEGER NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  purged_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_runs_task_created ON runs(task_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_run_updated ON attempts(run_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_stream_sequence ON events(stream_key, sequence);
CREATE INDEX IF NOT EXISTS idx_gates_run_requested ON gates(run_id, requested_at, id);
CREATE INDEX IF NOT EXISTS idx_side_effects_run_attempt ON side_effects(run_id, attempt_id, intent_at);
CREATE INDEX IF NOT EXISTS idx_rpc_requests_status_started ON rpc_requests(status, started_at);
CREATE INDEX IF NOT EXISTS idx_outbox_status_created ON outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_processes_status_updated ON processes(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_admission_queue_status_order ON admission_queue(status, priority DESC, sequence ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_admission_queue_run ON admission_queue(run_id, status, sequence ASC);
CREATE INDEX IF NOT EXISTS idx_issues_marker ON migration_issues(marker_id, id);
CREATE INDEX IF NOT EXISTS idx_purge_audit_task ON purge_audit(task_id, purged_at DESC);
`;

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((entry) => String(entry.name) === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function parseSchemaVersion(value, label = "schema_version") {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) throw Object.assign(new Error(`Task Center ${label} is corrupt: expected a non-negative integer`), { code: "TASK_CENTER_SCHEMA_VERSION_CORRUPT" });
  const version = Number(raw);
  if (!Number.isSafeInteger(version)) throw Object.assign(new Error(`Task Center ${label} is corrupt: integer is out of range`), { code: "TASK_CENTER_SCHEMA_VERSION_CORRUPT" });
  return version;
}

function schemaVersionRow(db) {
  if (!tableExists(db, "metadata")) return null;
  return db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() ?? null;
}

function migrationRows(db) {
  if (!tableExists(db, "schema_migrations")) return [];
  return db.prepare("SELECT version, name, from_version, applied_at FROM schema_migrations ORDER BY version ASC").all();
}

function migrationStepFor(version) {
  return TASK_CENTER_SCHEMA_MIGRATIONS.find((step) => step.from === version) ?? null;
}

function migrationFailureRequested(options, step) {
  const requested = options.failMigrationStep ?? options.migrationFailureStep ?? options.injectFailureStep ?? options.failStep;
  if (typeof requested === "function") return requested(step) === true;
  if (requested == null) return false;
  return Number(requested) === step.to || String(requested) === step.name;
}

function ensureMigrationHistory(db, version, timestamp) {
  const rows = migrationRows(db);
  if (rows.length === 0 && version > 0) {
    const insert = db.prepare(
      "INSERT INTO schema_migrations(version, name, from_version, applied_at) VALUES(?, ?, ?, ?)",
    );
    for (let baseline = 1; baseline <= version; baseline += 1) {
      const step = TASK_CENTER_SCHEMA_MIGRATIONS.find((candidate) => candidate.to === baseline);
      insert.run(baseline, step?.name ?? "legacy-baseline", step?.from ?? Math.max(0, baseline - 1), timestamp);
    }
    return;
  }
  let expected = 1;
  for (const row of rows) {
    const rowVersion = parseSchemaVersion(row.version, "schema_migrations.version");
    if (rowVersion !== expected || rowVersion > version) {
      throw Object.assign(new Error(`Task Center schema migration history is inconsistent at version ${rowVersion}; expected ${expected} through ${version}`), { code: "TASK_CENTER_SCHEMA_HISTORY_CORRUPT" });
    }
    expected += 1;
  }
  if (expected <= version) {
    const insert = db.prepare(
      "INSERT INTO schema_migrations(version, name, from_version, applied_at) VALUES(?, ?, ?, ?)",
    );
    for (let baseline = expected; baseline <= version; baseline += 1) {
      const step = TASK_CENTER_SCHEMA_MIGRATIONS.find((candidate) => candidate.to === baseline);
      insert.run(baseline, step?.name ?? "legacy-baseline", step?.from ?? Math.max(0, baseline - 1), timestamp);
    }
  }
}

function applyMigrationStep(db, step, timestamp) {
  switch (step.to) {
    case 1:
      // The DDL above creates metadata and the history table for fresh files.
      return;
    case 2:
      ensureColumn(db, "outbox", "owner_epoch", "TEXT");
      ensureColumn(db, "outbox", "claimed_at", "INTEGER");
      ensureColumn(db, "outbox", "delivered_at", "INTEGER");
      return;
    case 3:
      ensureColumn(db, "processes", "owner_epoch", "TEXT");
      ensureColumn(db, "processes", "process_start_token", "TEXT");
      return;
    case 4:
      // `CREATE TABLE IF NOT EXISTS` in the DDL is idempotent for upgrades.
      db.exec("CREATE INDEX IF NOT EXISTS idx_admission_queue_status_order ON admission_queue(status, priority DESC, sequence ASC, id ASC)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_admission_queue_run ON admission_queue(run_id, status, sequence ASC)");
      return;
    case 5:
      ensureColumn(db, "processes", "tombstoned_at", "INTEGER");
      return;
    case 6:
      ensureColumn(db, "outbox", "attempts", "INTEGER NOT NULL DEFAULT 0");
      return;
    case 7:
      db.exec("CREATE INDEX IF NOT EXISTS idx_purge_audit_task ON purge_audit(task_id, purged_at DESC)");
      return;
    default:
      throw new Error(`Unsupported Task Center schema migration step: ${step.from}->${step.to}`);
  }
}

function pragmaValue(db, statement) {
  const row = db.prepare(statement).get();
  if (!row) return null;
  return Object.values(row)[0];
}

/** Configure a DatabaseSync connection before any application writes. */
export function configureTaskCenterDatabase(db) {
  // This must precede both schema creation and WAL activation for a new file.
  // Existing databases retain their current mode; maintenance reports it and
  // never performs a blocking full VACUUM implicitly.
  db.exec("PRAGMA auto_vacuum=INCREMENTAL");
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=FULL");
  // Keep SQLite's bounded automatic checkpoint explicit. The detached
  // Supervisor additionally runs low-frequency PASSIVE checkpoints and
  // incremental vacuum, but correctness must not depend on a once-daily
  // maintenance pass to keep the WAL reusable during an overnight run.
  db.exec("PRAGMA wal_autocheckpoint=1000");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec("PRAGMA trusted_schema=OFF");
  return {
    journalMode: String(pragmaValue(db, "PRAGMA journal_mode") ?? "").toLowerCase(),
    synchronous: Number(pragmaValue(db, "PRAGMA synchronous")),
    walAutoCheckpointPages: Number(pragmaValue(db, "PRAGMA wal_autocheckpoint")),
    foreignKeys: Number(pragmaValue(db, "PRAGMA foreign_keys")) === 1,
    busyTimeoutMs: Number(pragmaValue(db, "PRAGMA busy_timeout")),
    trustedSchema: Number(pragmaValue(db, "PRAGMA trusted_schema")) === 1,
    autoVacuum: Number(pragmaValue(db, "PRAGMA auto_vacuum")) === 2 ? "incremental" : "disabled",
  };
}

/**
 * Create/upgrade all durable Task Center tables and indexes.
 *
 * A newer or malformed metadata version is rejected before any DDL runs. Each
 * supported transition updates schema_version and schema_migrations in the
 * same transaction, so an injected failure leaves the prior version/history
 * pair intact and a restart can safely retry the step.
 */
export function createTaskCenterSchema(db, options = {}) {
  const requestedTimestamp = typeof options.now === "function" ? options.now() : options.now;
  const timestamp = Number.isSafeInteger(Number(requestedTimestamp)) ? Number(requestedTimestamp) : Date.now();
  const existingVersionRow = schemaVersionRow(db);
  const existingVersion = existingVersionRow ? parseSchemaVersion(existingVersionRow.value) : TASK_CENTER_SQLITE_SCHEMA_MIN_VERSION;
  if (existingVersion > TASK_CENTER_SQLITE_SCHEMA_VERSION) {
    throw Object.assign(new Error(`Task Center SQLite schema ${existingVersion} is newer than supported ${TASK_CENTER_SQLITE_SCHEMA_VERSION}`), { code: "TASK_CENTER_SCHEMA_VERSION_NEWER" });
  }
  db.exec(DDL);
  // DDL is intentionally idempotent; it creates tables that old versions did
  // not have, while migration steps below add columns to existing tables.
  ensureMigrationHistory(db, existingVersion, timestamp);
  let version = existingVersion;
  while (version < TASK_CENTER_SQLITE_SCHEMA_VERSION) {
    const step = migrationStepFor(version);
    if (!step) throw new Error(`No Task Center schema migration from version ${version}`);
    if (migrationFailureRequested(options, step)) {
      throw Object.assign(new Error(`Injected Task Center schema migration failure at ${step.name}`), { code: "TASK_CENTER_SCHEMA_MIGRATION_FAILED", migration: step });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      applyMigrationStep(db, step, timestamp);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, from_version, applied_at) VALUES(?, ?, ?, ?)",
      ).run(step.to, step.name, step.from, timestamp);
      db.prepare(
        "INSERT INTO metadata(key, value, updated_at) VALUES('schema_version', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
      ).run(String(step.to), timestamp);
      db.exec("COMMIT");
      version = step.to;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* preserve the migration failure */ }
      throw error;
    }
  }
  if (version === TASK_CENTER_SQLITE_SCHEMA_VERSION) {
    db.prepare(
      "INSERT INTO metadata(key, value, updated_at) VALUES('schema_version', ?, ?) ON CONFLICT(key) DO NOTHING",
    ).run(String(version), timestamp);
  }
  return { version, history: migrationRows(db) };
}

export function readTaskCenterSchemaVersion(db) {
  const row = schemaVersionRow(db);
  return row ? parseSchemaVersion(row.value) : TASK_CENTER_SQLITE_SCHEMA_MIN_VERSION;
}

export function readTaskCenterMigrationHistory(db) {
  return migrationRows(db).map((row) => ({
    version: parseSchemaVersion(row.version, "schema_migrations.version"),
    name: String(row.name),
    fromVersion: parseSchemaVersion(row.from_version, "schema_migrations.from_version"),
    appliedAt: Number(row.applied_at),
  }));
}

/** Return SQLite's integrity result; a non-`ok` result is fail-closed. */
export function taskCenterQuickCheck(db) {
  const rows = db.prepare("PRAGMA quick_check").all();
  return rows.map((row) => String(Object.values(row)[0] ?? ""));
}

export const TASK_CENTER_SCHEMA_DDL = DDL;
