import { createHash } from "node:crypto";

const EXPORT_MANIFEST_VERSION = 1;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function pageInteger(value, fallback, { min, max, label }) {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function payloadEntry({ kind, id, taskRunId = null, sequence = null, payload }) {
  const value = String(payload);
  return {
    kind,
    id: String(id),
    taskRunId: taskRunId == null ? null : String(taskRunId),
    sequence: sequence == null ? null : Number(sequence),
    recordBytes: bytes(value),
    recordSha256: sha256(value),
    contentBytes: null,
    contentSha256: null,
  };
}

function artifactEntry(row) {
  const contentBytes = Number(row.content_bytes ?? 0);
  const contentSha256 = String(row.content_sha256 ?? "");
  const metadata = String(row.metadata_json);
  const digestMaterial = `artifact\n${metadata}\n${contentSha256}\n${contentBytes}`;
  return {
    kind: "artifact",
    id: String(row.id),
    taskRunId: String(row.run_id),
    sequence: null,
    recordBytes: bytes(metadata) + contentBytes,
    recordSha256: sha256(digestMaterial),
    contentBytes,
    contentSha256,
  };
}

function countsForTask(db, taskId) {
  const count = (table, extra = "") => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE task_id = ? ${extra}`).get(taskId)?.count ?? 0);
  return { tasks: 1, runs: count("runs"), events: count("events"), artifacts: count("artifacts", "AND committed = 1"), gates: count("gates") };
}

function *manifestEntries(db, taskId) {
  const task = db.prepare("SELECT payload_json FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  let index = 0;
  yield { index: index++, ...payloadEntry({ kind: "task", id: taskId, payload: task.payload_json }) };
  for (const row of db.prepare("SELECT id, payload_json FROM runs WHERE task_id = ? ORDER BY created_at, id").iterate(taskId)) {
    yield { index: index++, ...payloadEntry({ kind: "run", id: row.id, taskRunId: row.id, payload: row.payload_json }) };
  }
  for (const row of db.prepare(`SELECT id, run_id, sequence, payload_json FROM events WHERE task_id = ?
    ORDER BY CASE WHEN run_id IS NULL THEN 0 ELSE 1 END, COALESCE(run_id, ''), sequence, id`).iterate(taskId)) {
    yield { index: index++, ...payloadEntry({ kind: "event", id: row.id, taskRunId: row.run_id, sequence: row.sequence, payload: row.payload_json }) };
  }
  for (const row of db.prepare(`SELECT id, run_id, metadata_json, content_sha256,
    length(CAST(content AS BLOB)) AS content_bytes FROM artifacts
    WHERE task_id = ? AND committed = 1 ORDER BY created_at, id`).iterate(taskId)) {
    yield { index: index++, ...artifactEntry(row) };
  }
  for (const row of db.prepare("SELECT id, run_id, payload_json FROM gates WHERE task_id = ? ORDER BY requested_at, id").iterate(taskId)) {
    yield { index: index++, ...payloadEntry({ kind: "gate", id: row.id, taskRunId: row.run_id, payload: row.payload_json }) };
  }
}

/**
 * Return only bounded integrity metadata. Full task/run/event/artifact records
 * remain available through the existing paginated history APIs, avoiding a
 * single export response that could exceed the Supervisor frame limit.
 */
export function createTaskExportManifestPage(db, input = {}) {
  const taskId = String(input.taskId ?? "").trim();
  const taskRevision = Number(input.taskRevision);
  const cursor = pageInteger(input.cursor, 0, { min: 0, max: Number.MAX_SAFE_INTEGER, label: "cursor" });
  const limit = pageInteger(input.limit, DEFAULT_PAGE_SIZE, { min: 1, max: MAX_PAGE_SIZE, label: "limit" });
  const counts = countsForTask(db, taskId);
  const totalEntries = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (cursor > totalEntries) throw new Error("Export manifest cursor is beyond the immutable task history");
  const entries = manifestEntries(db, taskId);
  const digest = createHash("sha256");
  digest.update(`${EXPORT_MANIFEST_VERSION}\n${taskId}\n${taskRevision}\n${JSON.stringify(counts)}\n`);
  const page = [];
  for (const entry of entries) {
    digest.update(`${JSON.stringify(entry)}\n`);
    if (entry.index >= cursor && page.length < limit) page.push(entry);
  }
  const nextCursor = cursor + page.length;
  return {
    manifestVersion: EXPORT_MANIFEST_VERSION,
    taskId,
    taskRevision,
    manifestSha256: digest.digest("hex"),
    totalEntries,
    counts,
    entries: page,
    nextCursor: nextCursor < totalEntries ? nextCursor : null,
    hasMore: nextCursor < totalEntries,
  };
}

export { EXPORT_MANIFEST_VERSION as TASK_CENTER_EXPORT_MANIFEST_VERSION };
