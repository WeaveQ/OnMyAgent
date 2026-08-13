import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  TASK_ORCHESTRATOR_SCHEMA_VERSION,
  taskOrchestratorEventSchema,
  taskOrchestratorHandoffArtifactSchema,
  taskOrchestratorHumanGateSchema,
  taskOrchestratorLegacyTaskSchema,
  taskOrchestratorRunSchema,
  taskOrchestratorTaskSchema,
} from "@onmyagent/types/task-orchestrator";

import {
  sanitizeArtifact,
  sanitizeEvent,
  sanitizeGate,
  sanitizeRun,
  sanitizeTask,
} from "./store-sanitization.mjs";

const MARKER_ID = "legacy-json-v2";
const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "checkpointing", "pausing", "backoff", "waiting-approval"]);
const ACTIVE_ATTEMPT_STATUSES = new Set(["pending", "ready", "running", "waiting-approval"]);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fileEntries(root) {
  const result = [];
  async function visit(current) {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) result.push(target);
    }
  }
  await visit(root);
  return result.sort((left, right) => left.localeCompare(right));
}

/**
 * Hash both file names and bytes.  Names are included so a rename cannot be
 * mistaken for an unchanged source, while sorting keeps the value stable.
 */
export async function computeSourceManifest(sourceRoot) {
  const root = path.resolve(String(sourceRoot));
  const files = await fileEntries(root);
  const digest = createHash("sha256");
  const entries = [];
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const bytes = await readFile(file);
    const contentHash = sha256(bytes);
    digest.update(`${relative}\0${contentHash}\n`);
    entries.push({ path: relative, sha256: contentHash, size: bytes.byteLength });
  }
  return { sha256: digest.digest("hex"), files: entries };
}

function parseJson(raw, label) {
  try { return JSON.parse(raw); } catch (error) { throw new Error(`${label} contains invalid JSON: ${errorMessage(error)}`); }
}

/** Parse JSONL and ignore only a final unterminated line after a crash. */
export function parseJsonlWithTruncatedTail(raw, label = "event stream") {
  const source = String(raw ?? "");
  const lines = source.split("\n");
  const values = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line));
    } catch (error) {
      if (index === lines.length - 1 && !source.endsWith("\n")) break;
      const failure = new Error(`${label} line ${index + 1} is invalid JSON: ${errorMessage(error)}`);
      // Keep valid history before the malformed line; the caller records the
      // issue but should not discard those earlier audit records.
      Object.assign(failure, { values });
      throw failure;
    }
  }
  return values;
}

function partialValues(error) {
  return error && typeof error === "object" && "values" in error && Array.isArray(error.values) ? error.values : [];
}

async function readOptional(file) {
  try { return await readFile(file, "utf8"); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function issue(issues, sourcePath, category, message) {
  issues.push({ sourcePath, category, message: String(message).slice(0, 4_000) });
}

function activeAttempt(attempt) {
  return ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || Boolean(attempt.leaseId);
}

function safePausedRun(run, now) {
  if (!ACTIVE_RUN_STATUSES.has(run.status) && !run.primaryAttempts.some(activeAttempt) && !run.workerAttempts.some(activeAttempt)) return run;
  const transformed = { ...run, status: "blocked", error: [run.error, "Imported active legacy state; replay is disabled until explicit recovery."].filter(Boolean).join(" "), updatedAt: now() };
  const transformAttempt = (attempt) => activeAttempt(attempt)
    ? { ...attempt, status: "blocked", leaseId: null, error: [attempt.error, "Imported active legacy attempt; replay is disabled."].filter(Boolean).join(" "), updatedAt: now(), finishedAt: attempt.finishedAt ?? now() }
    : attempt;
  transformed.primaryAttempts = transformed.primaryAttempts.map(transformAttempt);
  transformed.workerAttempts = transformed.workerAttempts.map(transformAttempt);
  if (transformed.currentAttemptId && [...transformed.primaryAttempts, ...transformed.workerAttempts].some((attempt) => attempt.id === transformed.currentAttemptId && attempt.status === "blocked")) {
    // Keep the current attempt for diagnostics, but no lease/process can be resumed.
    transformed.currentAttemptId = transformed.currentAttemptId;
  }
  return transformed;
}

async function collectTask(sourceRoot, taskId, issues, now) {
  const taskDirectory = path.join(sourceRoot, "tasks", taskId);
  const taskPath = path.join(taskDirectory, "task.json");
  const rawTask = await readOptional(taskPath);
  if (rawTask === null) return null;
  const decoded = parseJson(rawTask, taskPath);
  if (taskOrchestratorLegacyTaskSchema.safeParse(decoded).success) {
    issue(issues, taskPath, "legacy-v1", "Legacy Task Center v1 state is retained read-only and was not imported.");
    return { taskId, task: null, runs: [], events: [], artifacts: [], gates: [] };
  }
  const taskParsed = taskOrchestratorTaskSchema.safeParse(decoded);
  if (!taskParsed.success) {
    issue(issues, taskPath, "invalid-v2-task", taskParsed.error.message);
    return { taskId, task: null, runs: [], events: [], artifacts: [], gates: [] };
  }
  const task = taskOrchestratorTaskSchema.parse(sanitizeTask(taskParsed.data));
  const result = { taskId, task, runs: [], events: [], artifacts: [], gates: [] };
  const runsDirectory = path.join(taskDirectory, "runs");
  let runEntries = [];
  try { runEntries = (await readdir(runsDirectory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  for (const runEntry of runEntries) {
    const runPath = path.join(runsDirectory, runEntry.name, "run.json");
    const rawRun = await readOptional(runPath);
    if (rawRun === null) continue;
    const decodedRun = parseJson(rawRun, runPath);
    const runParsed = taskOrchestratorRunSchema.safeParse(decodedRun);
    if (!runParsed.success) { issue(issues, runPath, "invalid-v2-run", runParsed.error.message); continue; }
    const run = safePausedRun(taskOrchestratorRunSchema.parse(sanitizeRun(runParsed.data)), now);
    result.runs.push(run);

    const runDirectory = path.dirname(runPath);
    const eventPath = path.join(runDirectory, "events.jsonl");
    const rawEvents = await readOptional(eventPath);
    if (rawEvents !== null) {
      let decodedEvents;
      try { decodedEvents = parseJsonlWithTruncatedTail(rawEvents, eventPath); } catch (error) { issue(issues, eventPath, "invalid-jsonl", errorMessage(error)); decodedEvents = partialValues(error); }
      for (const value of decodedEvents) {
        const parsedEvent = taskOrchestratorEventSchema.safeParse(value);
        if (parsedEvent.success) result.events.push(taskOrchestratorEventSchema.parse(sanitizeEvent(parsedEvent.data)));
        else issue(issues, eventPath, "invalid-event", parsedEvent.error.message);
      }
    }
    const gatesDirectory = path.join(runDirectory, "gates");
    let gateEntries = [];
    try { gateEntries = (await readdir(gatesDirectory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    for (const entry of gateEntries) {
      const gatePath = path.join(gatesDirectory, entry.name);
      const rawGate = await readOptional(gatePath);
      if (rawGate === null) continue;
      const parsedGate = taskOrchestratorHumanGateSchema.safeParse(parseJson(rawGate, gatePath));
      if (parsedGate.success) result.gates.push(taskOrchestratorHumanGateSchema.parse(sanitizeGate(parsedGate.data)));
      else issue(issues, gatePath, "invalid-gate", parsedGate.error.message);
    }
    const artifactsDirectory = path.join(runDirectory, "artifacts");
    let artifactEntries = [];
    try { artifactEntries = (await readdir(artifactsDirectory, { withFileTypes: true })).filter((entry) => entry.isDirectory()); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    for (const entry of artifactEntries) {
      const artifactDirectory = path.join(artifactsDirectory, entry.name);
      const metadataPath = path.join(artifactDirectory, "metadata.json");
      const contentPath = path.join(artifactDirectory, "content.txt");
      const metadataRaw = await readOptional(metadataPath);
      const content = await readOptional(contentPath);
      // Metadata is the old filesystem commit marker.  Do not make a partial
      // artifact appear complete merely because content.txt survived a crash.
      if (metadataRaw === null || content === null) {
        issue(issues, artifactDirectory, "missing-artifact-marker", "Artifact content or metadata commit marker is missing; artifact was not imported.");
        continue;
      }
      const parsedArtifact = taskOrchestratorHandoffArtifactSchema.safeParse({ ...parseJson(metadataRaw, metadataPath), content });
      if (parsedArtifact.success) result.artifacts.push(taskOrchestratorHandoffArtifactSchema.parse(sanitizeArtifact(parsedArtifact.data)));
      else issue(issues, artifactDirectory, "invalid-artifact", parsedArtifact.error.message);
    }
  }

  const alignmentEventPath = path.join(taskDirectory, "alignment-events.jsonl");
  const rawAlignmentEvents = await readOptional(alignmentEventPath);
  if (rawAlignmentEvents !== null) {
    let decodedEvents;
    try { decodedEvents = parseJsonlWithTruncatedTail(rawAlignmentEvents, alignmentEventPath); } catch (error) { issue(issues, alignmentEventPath, "invalid-jsonl", errorMessage(error)); decodedEvents = partialValues(error); }
    for (const value of decodedEvents) {
      const parsedEvent = taskOrchestratorEventSchema.safeParse(value);
      if (parsedEvent.success) result.events.push(taskOrchestratorEventSchema.parse(sanitizeEvent(parsedEvent.data)));
      else issue(issues, alignmentEventPath, "invalid-event", parsedEvent.error.message);
    }
  }
  return result;
}

async function collectRecords(sourceRoot, now) {
  const issues = [];
  const taskRoot = path.join(sourceRoot, "tasks");
  let taskEntries = [];
  try { taskEntries = (await readdir(taskRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const records = [];
  for (const entry of taskEntries) records.push(await collectTask(sourceRoot, entry.name, issues, now));
  return { records: records.filter(Boolean), issues };
}

function insertImportedRecord(connection, table, columns, values) {
  const placeholders = columns.map(() => "?").join(", ");
  const names = columns.join(", ");
  connection.prepare(`INSERT OR IGNORE INTO ${table}(${names}) VALUES(${placeholders})`).run(...values);
}

function insertRun(connection, run) {
  insertImportedRecord(connection, "runs", ["id", "task_id", "status", "created_at", "updated_at", "payload_json"], [run.id, run.taskId, run.status, run.createdAt, run.updatedAt, JSON.stringify(run)]);
  for (const attempt of [...run.primaryAttempts, ...run.workerAttempts]) {
    insertImportedRecord(connection, "attempts", ["id", "run_id", "task_id", "kind", "status", "lease_id", "updated_at", "payload_json"], [attempt.id, run.id, run.taskId, attempt.kind, attempt.status, attempt.leaseId, attempt.updatedAt, JSON.stringify(attempt)]);
    if (attempt.kind === "worker") insertImportedRecord(connection, "workers", ["id", "run_id", "parent_attempt_id", "status", "updated_at", "payload_json"], [attempt.id, run.id, attempt.parentAttemptId, attempt.status, attempt.updatedAt, JSON.stringify(attempt)]);
  }
  for (const turn of run.turns ?? []) insertImportedRecord(connection, "turns", ["id", "run_id", "sequence", "status", "updated_at", "payload_json"], [turn.id, run.id, turn.sequence, turn.status, turn.updatedAt, JSON.stringify(turn)]);
  for (const capsule of run.continuationCapsules ?? []) insertImportedRecord(connection, "continuation_capsules", ["id", "run_id", "from_turn_id", "created_at", "payload_json"], [capsule.id, run.id, capsule.fromTurnId, capsule.createdAt, JSON.stringify(capsule)]);
  for (const checkpoint of run.checkpoints ?? []) insertImportedRecord(connection, "checkpoints", ["id", "run_id", "turn_id", "created_at", "payload_json"], [checkpoint.id, run.id, checkpoint.turnId, checkpoint.createdAt, JSON.stringify(checkpoint)]);
  if (run.budget) insertImportedRecord(connection, "budgets", ["run_id", "updated_at", "payload_json"], [run.id, run.budget.updatedAt, JSON.stringify(run.budget)]);
}

/**
 * Import v2 JSON state exactly once.  All records and the active marker are
 * committed in one transaction after quick_check, so an injected failure (or
 * process crash before COMMIT) leaves neither a partial import nor a marker
 * that could trigger an unsafe JSON fallback.
 */
export async function migrateLegacyJsonV2(options = {}) {
  const store = options.store;
  if (!store || typeof store._database !== "function" || typeof store.withTransaction !== "function") throw new Error("A SQLite Task Center store is required");
  if (options.skipInitialize !== true) await store.initialize();
  const sourceRoot = path.resolve(String(options.sourceRoot ?? store.legacyRootDirectory));
  const manifest = await computeSourceManifest(sourceRoot);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const connection = store._database();
  const existing = connection.prepare("SELECT source_root, source_manifest_sha256, status, payload_json FROM migration_markers WHERE id = ?").get(MARKER_ID);
  if (existing?.status === "active") {
    if (existing.source_manifest_sha256 !== manifest.sha256) throw new Error(`Legacy Task Center source hash drifted after migration: expected ${existing.source_manifest_sha256}, found ${manifest.sha256}`);
    return { status: "already-active", markerId: MARKER_ID, sourceRoot, sourceManifestSha256: manifest.sha256, issues: await store.migrationIssues() };
  }

  const { records, issues } = await collectRecords(sourceRoot, now);
  const injectFailure = options.injectFailure ?? options.failAt;
  const transact = typeof store._serializedTransaction === "function" ? store._serializedTransaction.bind(store) : store.withTransaction.bind(store);
  return transact((db) => {
    db.prepare("DELETE FROM migration_issues WHERE marker_id = ?").run(MARKER_ID);
    db.prepare("DELETE FROM migration_markers WHERE id = ?").run(MARKER_ID);
    db.prepare(
      "INSERT INTO migration_markers(id, source_root, source_manifest_sha256, status, imported_at, payload_json) VALUES(?, ?, ?, 'staging', ?, ?)",
    ).run(MARKER_ID, sourceRoot, manifest.sha256, now(), JSON.stringify({ markerId: MARKER_ID, sourceRoot, sourceManifestSha256: manifest.sha256, files: manifest.files.length }));
    if (injectFailure === "before-records" || injectFailure === "stage") throw new Error("Injected migration failure before records");
    for (const record of records) {
      if (!record.task) continue;
      const task = record.task;
      insertImportedRecord(db, "tasks", ["id", "revision", "workspace_root", "definition_status", "latest_run_id", "created_at", "updated_at", "payload_json"], [task.id, task.revision, task.workspaceRoot, task.definitionStatus, task.latestRunId, task.createdAt, task.updatedAt, JSON.stringify(task)]);
      if (injectFailure === "after-task") throw new Error("Injected migration failure after task");
      for (const run of record.runs) insertRun(db, run);
      for (const event of record.events) {
        const key = event.taskRunId ? `run:${event.taskId}:${event.taskRunId}` : `task:${event.taskId}`;
        insertImportedRecord(db, "events", ["id", "task_id", "run_id", "stream_key", "sequence", "at", "payload_json"], [event.id, event.taskId, event.taskRunId, key, event.sequence, event.at, JSON.stringify(event)]);
      }
      for (const artifact of record.artifacts) {
        const { content, ...metadata } = artifact;
        insertImportedRecord(db, "artifacts", ["id", "task_id", "run_id", "attempt_id", "content", "content_sha256", "metadata_json", "committed", "created_at"], [artifact.id, artifact.taskId, artifact.taskRunId, artifact.attemptId, content, sha256(content), JSON.stringify(metadata), 1, artifact.createdAt]);
      }
      for (const gate of record.gates) insertImportedRecord(db, "gates", ["id", "task_id", "run_id", "status", "requested_at", "updated_at", "payload_json"], [gate.id, gate.taskId, gate.taskRunId, gate.status, gate.requestedAt, gate.resolvedAt ?? gate.requestedAt, JSON.stringify(gate)]);
    }
    if (injectFailure === "after-records") throw new Error("Injected migration failure after records");
    for (const entry of issues) db.prepare("INSERT OR IGNORE INTO migration_issues(marker_id, source_path, category, message, created_at) VALUES(?, ?, ?, ?, ?)").run(MARKER_ID, entry.sourcePath, entry.category, entry.message, now());
    const checkRows = db.prepare("PRAGMA quick_check").all().map((row) => String(Object.values(row)[0] ?? ""));
    if (options.forceQuickCheckFailure || checkRows.length !== 1 || checkRows[0].toLowerCase() !== "ok") throw new Error(`Task Center SQLite quick_check failed during migration: ${checkRows.join(", ") || "no result"}`);
    db.prepare("UPDATE migration_markers SET status = 'active', imported_at = ?, payload_json = ? WHERE id = ?").run(now(), JSON.stringify({ markerId: MARKER_ID, sourceRoot, sourceManifestSha256: manifest.sha256, files: manifest.files.length, issues: issues.length, schemaVersion: TASK_ORCHESTRATOR_SCHEMA_VERSION }), MARKER_ID);
    return { status: "active", markerId: MARKER_ID, sourceRoot, sourceManifestSha256: manifest.sha256, imported: records.filter((record) => record.task).length, issues: issues.length };
  });
}

export const importLegacyJson = migrateLegacyJsonV2;
export const migrateJsonV2ToSqlite = migrateLegacyJsonV2;
export const LEGACY_MIGRATION_MARKER_ID = MARKER_ID;
