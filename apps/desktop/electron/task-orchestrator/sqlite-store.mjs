import { createHash, randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET,
  taskOrchestratorArtifactContentResultSchema,
  taskOrchestratorArtifactMetadataSchema,
  taskOrchestratorArtifactsListResultSchema,
  taskOrchestratorDiagnosticsHealthResultSchema,
  taskOrchestratorDiagnosticsProcessAggregateSchema,
  taskOrchestratorEventSchema,
  taskOrchestratorEventsListResultSchema,
  taskOrchestratorHandoffArtifactSchema,
  taskOrchestratorHumanGateSchema,
  taskOrchestratorLegacyTaskSchema,
  taskOrchestratorMaintenanceResultSchema,
  taskOrchestratorRunsListResultSchema,
  taskOrchestratorRunSummarySchema,
  taskOrchestratorRunSchema,
  taskOrchestratorSnapshotSchema,
  taskOrchestratorStoreHealthResultSchema,
  taskOrchestratorTaskExportManifestResultSchema,
  taskOrchestratorTaskPurgeResultSchema,
  taskOrchestratorTaskListResultSchema,
  taskOrchestratorTaskSchema,
  taskOrchestratorTaskSummarySchema,
  taskOrchestratorTurnHistoryListResultSchema,
} from "@onmyagent/types/task-orchestrator";

import {
  configureTaskCenterDatabase,
  createTaskCenterSchema,
  readTaskCenterMigrationHistory,
  readTaskCenterSchemaVersion,
  taskCenterQuickCheck,
} from "./sqlite-schema.mjs";
import {
  assertNoSqliteCorruptionMarker,
  isSqliteCorruptionError,
  preserveCorruptSqliteDatabase,
  sqliteCorruptionMarkerPath,
} from "./sqlite-corruption.mjs";
import { createTaskExportManifestPage } from "./sqlite-export-manifest.mjs";
import {
  maintainTaskCenterStorage,
  normalizeTaskCenterMaintenancePolicy,
  pruneTaskCenterOperationalRows,
  taskCenterDiagnosticsAggregate,
  taskCenterRowCounts,
  taskCenterStorageMetricsForPath,
} from "./sqlite-maintenance.mjs";
import {
  sanitizeArtifact,
  sanitizeEvent,
  sanitizeGate,
  sanitizeRun,
  sanitizeTask,
} from "./store-sanitization.mjs";
import { redactSensitiveText } from "./durable-redaction.mjs";
import {
  createTurnHistoryItem,
  createTurnHistoryPage,
  decodeTurnHistoryCursor,
} from "./turn-history.mjs";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const DEFAULT_HISTORY_PAGE_SIZE = 50;
const MAX_HISTORY_PAGE_SIZE = 200;
const DEFAULT_TASK_LIST_PAGE_SIZE = 100;
const HISTORY_PAGE_BYTE_BUDGET = 700 * 1_024;
const SNAPSHOT_EVENT_LIMIT = 100;
const SNAPSHOT_ARTIFACT_LIMIT = 6;
const SNAPSHOT_GATE_LIMIT = 10;
const SNAPSHOT_ARTIFACT_CONTENT_BYTES = 12_000;
const SNAPSHOT_EVIDENCE_LIMIT = 5;
const SNAPSHOT_EVIDENCE_VALUE_BYTES = 1_000;
const DEFAULT_ARTIFACT_CONTENT_CHUNK_CHARS = 32_000;
const MAX_ARTIFACT_CONTENT_CHUNK_CHARS = 64_000;
const LEGACY_MARKER_ID = "legacy-json-v2";

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "checkpointing", "pausing", "backoff", "waiting-approval"]);
const ACTIVE_ATTEMPT_STATUSES = new Set(["pending", "ready", "running", "waiting-approval"]);
const ACTIVE_CHECKER_ATTEMPT_STATUSES = new Set(["ready", "running"]);
const READY_RUN_STATUSES = new Set(["queued", "running", "checkpointing", "backoff"]);
const TERMINAL_PROCESS_STATUSES = new Set(["exited", "failed", "cancelled", "stopped", "terminated", "tombstoned", "stale"]);
const ACTIVE_PROCESS_STATUSES = new Set(["starting", "running", "stopping"]);
const DIAGNOSTICS_HEALTH_CACHE_TTL_MS = 5_000;

function requireSafeId(value, label) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 120 || !SAFE_ID.test(id)) throw new Error(`${label} is invalid`);
  return id;
}

function nonNegativeTimestamp(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function json(value) {
  return JSON.stringify(value);
}

function parseJson(value, label) {
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`${label} contains invalid JSON: ${errorMessage(error)}`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function encodeTaskListCursor(updatedAt, id) {
  return Buffer.from(JSON.stringify([updatedAt, id]), "utf8").toString("base64url");
}

function decodeTaskListCursor(value) {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || parsed[0] < 0 || !SAFE_ID.test(String(parsed[1]))) throw new Error();
    return { updatedAt: parsed[0], id: String(parsed[1]) };
  } catch {
    throw new Error("task list cursor is invalid");
  }
}

function requireRequestKey(value, label = "idempotencyKey") {
  const key = String(value ?? "").trim();
  if (!key || key.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(key)) {
    throw new Error(`${label} is invalid`);
  }
  return key;
}

function requireDigest(value) {
  const digest = String(value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("requestDigest is invalid");
  return digest;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

/**
 * Compare canonical JSON payloads without relying on insertion order. Zod
 * parsing normally gives us a stable key order, but the approval fence is an
 * idempotency boundary and must also be safe for callers that reconstructed a
 * payload with a different object insertion order.
 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameCanonicalJson(left, right) {
  return stableJson(left) === stableJson(right);
}

function canonicalApprovalFenceRunExpectation(value, taskId, taskRunId) {
  if (value == null) return null;
  if (!value || typeof value !== "object") throw new Error("expectedRun is invalid");
  const id = requireSafeId(value.id, "expectedRun.id");
  const expectedTaskId = requireSafeId(value.taskId, "expectedRun.taskId");
  if (id !== taskRunId || expectedTaskId !== taskId) throw new Error("expectedRun identity is invalid");
  const createdAt = nonNegativeTimestamp(value.createdAt);
  const updatedAt = nonNegativeTimestamp(value.updatedAt);
  if (createdAt === null || updatedAt === null) throw new Error("expectedRun timestamps are invalid");
  const status = String(value.status ?? "").trim();
  if (!status) throw new Error("expectedRun.status is invalid");
  const currentAttemptId = value.currentAttemptId == null ? null : requireSafeId(value.currentAttemptId, "expectedRun.currentAttemptId");
  if (!Array.isArray(value.attempts)) throw new Error("expectedRun.attempts is required");
  const attempts = value.attempts.map((attempt, index) => {
    if (!attempt || typeof attempt !== "object") throw new Error(`expectedRun.attempts[${index}] is invalid`);
    const attemptId = requireSafeId(attempt.id, `expectedRun.attempts[${index}].id`);
    const attemptUpdatedAt = nonNegativeTimestamp(attempt.updatedAt);
    if (attemptUpdatedAt === null) throw new Error(`expectedRun.attempts[${index}].updatedAt is invalid`);
    const attemptStatus = String(attempt.status ?? "").trim();
    if (!attemptStatus) throw new Error(`expectedRun.attempts[${index}].status is invalid`);
    const leaseId = attempt.leaseId == null ? null : requireSafeId(attempt.leaseId, `expectedRun.attempts[${index}].leaseId`);
    const personalRunId = attempt.personalRunId == null ? null : String(attempt.personalRunId).trim();
    if (personalRunId !== null && (!personalRunId || personalRunId.length > 240)) throw new Error(`expectedRun.attempts[${index}].personalRunId is invalid`);
    return { id: attemptId, status: attemptStatus, leaseId, personalRunId, updatedAt: attemptUpdatedAt };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(attempts.map((attempt) => attempt.id)).size !== attempts.length) throw new Error("expectedRun.attempts contains duplicate ids");
  return { id, taskId: expectedTaskId, createdAt, updatedAt, status, currentAttemptId, attempts };
}

function approvalFenceRunMatches(run, expected) {
  if (!expected) return true;
  const actualAttempts = [
    ...(run.primaryAttempts ?? []),
    ...(run.workerAttempts ?? []),
    ...(run.checkerAttempts ?? []),
  ].map((attempt) => ({
    id: attempt.id,
    status: attempt.status,
    leaseId: attempt.leaseId ?? null,
    personalRunId: attempt.personalRunId ?? null,
    updatedAt: attempt.updatedAt,
  })).sort((left, right) => left.id.localeCompare(right.id));
  return sameCanonicalJson({
    id: run.id,
    taskId: run.taskId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.status,
    currentAttemptId: run.currentAttemptId ?? null,
    attempts: actualAttempts,
  }, expected);
}

function streamKey(taskId, taskRunId) {
  return taskRunId ? `run:${taskId}:${taskRunId}` : `task:${taskId}`;
}

function rowPayload(row, label) {
  return parseJson(row.payload_json, label);
}

function newestFirst(left, right) {
  if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;
  return left.id === right.id ? 0 : left.id < right.id ? 1 : -1;
}

function canonicalTask(task) {
  return taskOrchestratorTaskSchema.parse(sanitizeTask(task));
}

function canonicalRun(run) {
  return taskOrchestratorRunSchema.parse(sanitizeRun(run));
}

function canonicalEvent(event) {
  return taskOrchestratorEventSchema.parse(sanitizeEvent(event));
}

function canonicalArtifact(artifact) {
  return taskOrchestratorHandoffArtifactSchema.parse(sanitizeArtifact(artifact));
}

function canonicalGate(gate) {
  return taskOrchestratorHumanGateSchema.parse(sanitizeGate(gate));
}

function requirePageLimit(value) {
  const limit = value == null ? DEFAULT_HISTORY_PAGE_SIZE : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_PAGE_SIZE) {
    throw new Error(`limit must be an integer between 1 and ${MAX_HISTORY_PAGE_SIZE}`);
  }
  return limit;
}

function requireExpectedRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) throw new Error("expectedRevision must be a positive integer");
  return revision;
}

function encodeHistoryCursor(createdAt, id) {
  return `${Number(createdAt)}:${requireSafeId(id, "cursor id")}`;
}

function decodeHistoryCursor(value) {
  if (value == null || value === "") return null;
  const cursor = String(value).trim();
  const separator = cursor.indexOf(":");
  const createdAt = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (separator < 1 || !Number.isInteger(createdAt) || createdAt < 0) throw new Error("cursor is invalid");
  return { createdAt, id: requireSafeId(id, "cursor id") };
}

function truncateUtf8(value, maxBytes) {
  const source = String(value ?? "");
  if (Buffer.byteLength(source, "utf8") <= maxBytes) return source;
  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(source.slice(0, middle), "utf8") <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return source.slice(0, low);
}

function pageFits(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= HISTORY_PAGE_BYTE_BUDGET;
}

function compactContract(contract, { itemLimit = 12, textBytes = 1_000 } = {}) {
  if (!contract) return contract;
  const compactRequired = (items) => items.slice(0, itemLimit).map((item) => truncateUtf8(item, textBytes));
  return {
    ...contract,
    outcome: truncateUtf8(contract.outcome, textBytes * 4),
    deliverables: compactRequired(contract.deliverables),
    acceptance: compactRequired(contract.acceptance),
    scope: {
      included: contract.scope.included.slice(0, itemLimit).map((item) => truncateUtf8(item, textBytes)),
      excluded: contract.scope.excluded.slice(0, itemLimit).map((item) => truncateUtf8(item, textBytes)),
    },
    verification: compactRequired(contract.verification),
  };
}

function compactProfile(profile, instructionBytes) {
  return { ...profile, instructions: truncateUtf8(profile.instructions, instructionBytes) };
}

function runSummaryFromRow(row) {
  return taskOrchestratorRunSummarySchema.parse({
    id: row.id,
    taskId: row.task_id,
    taskRevision: Number(row.task_revision),
    status: row.status,
    currentAttemptId: row.current_attempt_id ?? null,
    currentTurn: row.current_turn == null ? null : Number(row.current_turn),
    primaryAttemptCount: Number(row.primary_attempt_count ?? 0),
    workerAttemptCount: Number(row.worker_attempt_count ?? 0),
    pauseReason: row.pause_reason ?? null,
    resumeEligible: Number(row.resume_eligible ?? 0) === 1,
    createdAt: Number(row.created_at),
    startedAt: row.started_at == null ? null : Number(row.started_at),
    updatedAt: Number(row.updated_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    error: row.error == null ? null : truncateUtf8(row.error, 4_000),
  });
}

function compactTaskForSnapshot(task, tight = false) {
  const itemLimit = tight ? 2 : 12;
  const textBytes = tight ? 256 : 1_000;
  const latestProposal = task.alignment.latestProposalId === null
    ? null
    : task.alignment.proposals.find((proposal) => proposal.id === task.alignment.latestProposalId) ?? null;
  return canonicalTask({
    ...task,
    idea: truncateUtf8(task.idea, tight ? 1_000 : 8_000),
    primary: compactProfile(task.primary, tight ? 256 : 2_000),
    allowedWorkers: task.allowedWorkers.map((profile) => compactProfile(profile, tight ? 128 : 1_000)),
    independentChecker: task.independentChecker?.profile
      ? { ...task.independentChecker, profile: compactProfile(task.independentChecker.profile, tight ? 256 : 2_000) }
      : task.independentChecker,
    contract: compactContract(task.contract, { itemLimit, textBytes }),
    alignment: {
      ...task.alignment,
      error: task.alignment.error === null ? null : truncateUtf8(task.alignment.error, tight ? 512 : 2_000),
      messages: task.alignment.messages.slice(tight ? -2 : -20).map((message) => ({
        ...message,
        text: truncateUtf8(message.text, tight ? 512 : 2_000),
      })),
      proposals: latestProposal ? [{
        ...latestProposal,
        contract: compactContract(latestProposal.contract, { itemLimit, textBytes }),
      }] : [],
    },
  });
}

function compactRunForSnapshot(run, tight = false) {
  if (!run) return null;
  const selectedTurns = tight
    ? run.turns.filter((turn) => turn.id === run.currentTurnId)
    : run.turns.slice(-5);
  if (!tight && run.currentTurnId && !selectedTurns.some((turn) => turn.id === run.currentTurnId)) {
    const currentTurn = run.turns.find((turn) => turn.id === run.currentTurnId);
    if (currentTurn) selectedTurns.push(currentTurn);
  }

  const primaryIds = new Set([run.primaryAttemptId]);
  const workerIds = new Set();
  const current = [...run.primaryAttempts, ...run.workerAttempts].find((attempt) => attempt.id === run.currentAttemptId);
  if (current?.kind === "primary") primaryIds.add(current.id);
  if (current?.kind === "worker") workerIds.add(current.id);
  for (const turn of selectedTurns) {
    primaryIds.add(turn.primaryAttemptId);
    for (const workerId of turn.workerAttemptIds) workerIds.add(workerId);
  }
  if (!tight) {
    for (const attempt of run.primaryAttempts.slice(-5)) primaryIds.add(attempt.id);
    for (const attempt of run.workerAttempts.slice(-10)) workerIds.add(attempt.id);
  }
  for (const worker of run.workerAttempts) {
    if (workerIds.has(worker.id) && worker.parentAttemptId) primaryIds.add(worker.parentAttemptId);
  }

  const turns = selectedTurns.filter((turn) => primaryIds.has(turn.primaryAttemptId));
  const turnIds = new Set(turns.map((turn) => turn.id));
  const primaryAttempts = run.primaryAttempts
    .filter((attempt) => primaryIds.has(attempt.id))
    .map((attempt) => ({
      ...attempt,
      turnId: attempt.turnId && turnIds.has(attempt.turnId) ? attempt.turnId : null,
      prompt: truncateUtf8(attempt.prompt, tight ? 256 : 2_000),
      error: attempt.error === null ? null : truncateUtf8(attempt.error, tight ? 256 : 2_000),
    }));
  const workerAttempts = run.workerAttempts
    .filter((attempt) => workerIds.has(attempt.id) && attempt.parentAttemptId && primaryIds.has(attempt.parentAttemptId))
    .map((attempt) => ({
      ...attempt,
      turnId: attempt.turnId && turnIds.has(attempt.turnId) ? attempt.turnId : null,
      prompt: truncateUtf8(attempt.prompt, tight ? 256 : 2_000),
      error: attempt.error === null ? null : truncateUtf8(attempt.error, tight ? 256 : 2_000),
    }));
  const checkerAttempts = (run.checkerAttempts ?? []).map((attempt) => ({
    ...attempt,
    prompt: truncateUtf8(attempt.prompt, tight ? 256 : 2_000),
    error: attempt.error === null ? null : truncateUtf8(attempt.error, tight ? 256 : 2_000),
  }));
  const checkerVerdicts = (run.checkerVerdicts ?? []).map((verdict) => ({
    ...verdict,
    summary: truncateUtf8(verdict.summary, tight ? 512 : 1_000),
    feedback: verdict.feedback === null ? null : truncateUtf8(verdict.feedback, tight ? 512 : 2_000),
    criterionResults: verdict.criterionResults.map((result) => ({ ...result, summary: truncateUtf8(result.summary, tight ? 256 : 1_000) })),
  }));
  const attemptIds = new Set([...primaryAttempts, ...workerAttempts].map((attempt) => attempt.id));
  const primaryDecisions = (tight ? [] : run.primaryDecisions.slice(-5))
    .filter((decision) => primaryIds.has(decision.attemptId))
    .map((decision) => ({
      ...decision,
      turnId: decision.turnId && turnIds.has(decision.turnId) ? decision.turnId : null,
      summary: truncateUtf8(decision.summary, 1_000),
      nextAction: decision.nextAction === null ? null : truncateUtf8(decision.nextAction, 1_000),
      acceptanceResults: decision.acceptanceResults.slice(0, 10).map((result) => ({
        ...result,
        summary: truncateUtf8(result.summary, 512),
      })),
    }));
  const decisionIds = new Set(primaryDecisions.map((decision) => decision.id));
  const compactTurns = turns.map((turn) => ({
    ...turn,
    workerAttemptIds: turn.workerAttemptIds.filter((id) => attemptIds.has(id)),
    decisionId: turn.decisionId && decisionIds.has(turn.decisionId) ? turn.decisionId : null,
    checkpointId: null,
    capsuleId: null,
  }));
  const retainedTurnIds = new Set(compactTurns.map((turn) => turn.id));
  const sideEffects = (tight ? [] : run.sideEffects.slice(-20))
    .filter((effect) => attemptIds.has(effect.attemptId))
    .map((effect) => ({
      ...effect,
      turnId: effect.turnId && retainedTurnIds.has(effect.turnId) ? effect.turnId : null,
    }));
  return canonicalRun({
    ...run,
    definition: {
      ...run.definition,
      idea: truncateUtf8(run.definition.idea, tight ? 1_000 : 8_000),
      primary: compactProfile(run.definition.primary, tight ? 256 : 2_000),
      allowedWorkers: run.definition.allowedWorkers.map((profile) => compactProfile(profile, tight ? 128 : 1_000)),
      independentChecker: run.definition.independentChecker?.profile
        ? { ...run.definition.independentChecker, profile: compactProfile(run.definition.independentChecker.profile, tight ? 256 : 2_000) }
        : run.definition.independentChecker,
      contract: compactContract(run.definition.contract, { itemLimit: tight ? 2 : 12, textBytes: tight ? 256 : 1_000 }),
    },
    primaryAttempts,
    workerAttempts,
    checkerAttempts,
    checkerVerdicts,
    primaryDecisions,
    latestDecisionId: primaryDecisions.at(-1)?.id ?? null,
    sideEffects,
    turns: compactTurns,
    currentTurnId: run.currentTurnId && retainedTurnIds.has(run.currentTurnId) ? run.currentTurnId : null,
    checkpoints: [],
    continuationCapsules: [],
    pause: run.pause ? { ...run.pause, checkpointId: null } : null,
    error: run.error === null ? null : truncateUtf8(run.error, tight ? 512 : 2_000),
  });
}

function previewArtifact(artifact) {
  const content = truncateUtf8(artifact.content, SNAPSHOT_ARTIFACT_CONTENT_BYTES);
  const evidence = artifact.evidence.slice(0, SNAPSHOT_EVIDENCE_LIMIT).map((item) => ({
    ...item,
    value: truncateUtf8(item.value, SNAPSHOT_EVIDENCE_VALUE_BYTES),
  }));
  return canonicalArtifact({ ...artifact, content, evidence });
}

function previewEvent(event) {
  return canonicalEvent({ ...event, message: truncateUtf8(event.message, 2_000) });
}

function previewGate(gate) {
  return canonicalGate({
    ...gate,
    summary: truncateUtf8(gate.summary, 2_000),
    operation: {
      ...gate.operation,
      command: gate.operation.command === null ? null : truncateUtf8(gate.operation.command, 2_000),
      cwd: gate.operation.cwd === null ? null : truncateUtf8(gate.operation.cwd, 1_000),
      params: gate.operation.params.slice(0, 20).map((entry) => ({ ...entry, value: truncateUtf8(entry.value, 1_000) })),
      diff: gate.operation.diff === null ? null : truncateUtf8(gate.operation.diff, 4_000),
    },
  });
}

function refreshSnapshotMetadata(snapshot, context) {
  const artifactContentBytes = snapshot.artifacts.reduce(
    (total, artifact) => total + Buffer.byteLength(artifact.content, "utf8"),
    0,
  );
  const artifactEvidence = snapshot.artifacts.reduce((total, artifact) => total + artifact.evidence.length, 0);
  const omitted = {
    events: Math.max(0, context.eventCount - snapshot.events.length),
    artifacts: Math.max(0, context.artifactCount - snapshot.artifacts.length),
    gates: Math.max(0, context.gateCount - snapshot.gates.length),
    alignmentMessages: Math.max(0, context.alignmentMessageCount - snapshot.task.alignment.messages.length),
    contractProposals: Math.max(0, context.contractProposalCount - snapshot.task.alignment.proposals.length),
    primaryAttempts: Math.max(0, context.primaryAttemptCount - (snapshot.run?.primaryAttempts.length ?? 0)),
    workerAttempts: Math.max(0, context.workerAttemptCount - (snapshot.run?.workerAttempts.length ?? 0)),
    primaryDecisions: Math.max(0, context.primaryDecisionCount - (snapshot.run?.primaryDecisions.length ?? 0)),
    sideEffects: Math.max(0, context.sideEffectCount - (snapshot.run?.sideEffects.length ?? 0)),
    turns: Math.max(0, context.turnCount - (snapshot.run?.turns.length ?? 0)),
    checkpoints: Math.max(0, context.checkpointCount - (snapshot.run?.checkpoints.length ?? 0)),
    continuationCapsules: Math.max(0, context.continuationCapsuleCount - (snapshot.run?.continuationCapsules.length ?? 0)),
    artifactContentBytes: Math.max(0, context.artifactContentBytes - artifactContentBytes),
    artifactEvidence: Math.max(0, context.artifactEvidenceCount - artifactEvidence),
  };
  const artifactContentTruncatedIds = snapshot.artifacts
    .filter((artifact) => Buffer.byteLength(artifact.content, "utf8") < (context.artifactBytesById.get(artifact.id) ?? 0))
    .map((artifact) => artifact.id);
  const truncated = context.compactedTask
    || context.compactedRun
    || context.eventMessagesTruncated > 0
    || context.gateDetailsTruncated > 0
    || artifactContentTruncatedIds.length > 0
    || Object.values(omitted).some((count) => count > 0);
  snapshot.truncation = {
    truncated,
    byteBudget: TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET,
    serializedBytes: snapshot.truncation?.serializedBytes ?? 0,
    omitted,
    compactedTask: context.compactedTask,
    compactedRun: context.compactedRun,
    eventMessagesTruncated: context.eventMessagesTruncated,
    gateDetailsTruncated: context.gateDetailsTruncated,
    artifactContentTruncatedIds,
  };
  let serializedBytes = snapshot.truncation.serializedBytes;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    snapshot.truncation.serializedBytes = serializedBytes;
    const next = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
    if (next === serializedBytes) break;
    serializedBytes = next;
  }
  snapshot.truncation.serializedBytes = serializedBytes;
  return serializedBytes;
}

function fitSnapshotToBudget(snapshot, context) {
  let size = refreshSnapshotMetadata(snapshot, context);
  if (size > TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET) {
    snapshot.task = compactTaskForSnapshot(snapshot.task);
    snapshot.run = compactRunForSnapshot(snapshot.run);
    context.compactedTask = true;
    context.compactedRun = snapshot.run !== null;
    size = refreshSnapshotMetadata(snapshot, context);
  }
  while (size > TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET && snapshot.events.length > 25) {
    snapshot.events.shift();
    size = refreshSnapshotMetadata(snapshot, context);
  }
  while (size > TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET && snapshot.artifacts.length > 2) {
    snapshot.artifacts.shift();
    size = refreshSnapshotMetadata(snapshot, context);
  }
  while (size > TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET && snapshot.gates.length > 3) {
    snapshot.gates.shift();
    size = refreshSnapshotMetadata(snapshot, context);
  }
  if (size > TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET) {
    snapshot.task = compactTaskForSnapshot(snapshot.task, true);
    snapshot.run = compactRunForSnapshot(snapshot.run, true);
    context.compactedTask = true;
    context.compactedRun = snapshot.run !== null;
    size = refreshSnapshotMetadata(snapshot, context);
  }
  if (size > TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET) {
    snapshot.events = [];
    snapshot.artifacts = [];
    snapshot.gates = [];
    size = refreshSnapshotMetadata(snapshot, context);
  }
  if (size > TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET) {
    throw Object.assign(new Error("Task snapshot cannot fit the Supervisor frame budget"), {
      code: "TASK_SNAPSHOT_BUDGET_EXCEEDED",
    });
  }
  return taskOrchestratorSnapshotSchema.parse(snapshot);
}

/**
 * Open the authoritative supervisor store.  DatabaseSync is intentionally
 * held by this module only; callers use the JSON-shaped asynchronous API.
 */
export function createTaskOrchestratorSqliteStore(options = {}) {
  const userDataDir = String(options.userDataDir ?? "").trim();
  if (!userDataDir) throw new Error("userDataDir is required");

  const rootDirectory = path.join(userDataDir, "runtime-state", "task-center-supervisor");
  const dbPath = path.join(rootDirectory, "task-center.sqlite");
  const storageMetrics = (connection) => taskCenterStorageMetricsForPath(
    connection,
    dbPath,
    (target) => statSync(target).size,
  );
  const legacyRootDirectory = String(options.legacyRootDirectory ?? path.join(userDataDir, "runtime-state", "task-center"));
  const autoMigrate = options.autoMigrate !== false;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const supervisorEpoch = String(options.supervisorEpoch ?? `store-${process.pid}-${randomUUID()}`).trim();
  if (!supervisorEpoch) throw new Error("supervisorEpoch is required");
  // Test-only fault injection for the approval fence. Keeping this option on
  // the store boundary lets tests prove SQLite rollback at each mutation
  // stage without exposing a production callback or changing runtime code.
  const approvalFenceFailureAt = String(options.approvalFenceFailureAt ?? "").trim();
  let db = null;
  let initialized = false;
  let closed = false;
  let storageFailure = null;
  let initializePromise = null;
  let mutationTail = Promise.resolve();
  let replayInFlight = null;
  let diagnosticsHealthCache = null;

  function requireDb() {
    if (!db || closed) throw new Error("Task Center SQLite store is not initialized");
    if (storageFailure) {
      throw Object.assign(new Error(`Task Center SQLite storage is fail-closed: ${errorMessage(storageFailure)}`), {
        code: "TASK_CENTER_STORAGE_FAILED",
        cause: storageFailure,
      });
    }
    return db;
  }

  /**
   * @template T
   * @param {() => T} operation
   * @returns {Promise<T>}
   */
  function serialized(operation) {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  function withTransaction(operation) {
    const connection = requireDb();
    try {
      connection.exec("BEGIN IMMEDIATE");
    } catch (error) {
      if (isStorageFailure(error)) storageFailure = error;
      throw error;
    }
    let result;
    try {
      result = operation(connection);
    } catch (error) {
      if (isStorageFailure(error)) storageFailure = error;
      try { connection.exec("ROLLBACK"); } catch { /* preserve the original storage error */ }
      throw error;
    }
    try {
      connection.exec("COMMIT");
      return result;
    } catch (error) {
      // A failed commit means the caller cannot know whether the durable
      // mutation reached disk. Keep this owner fail-closed until a fresh
      // Supervisor epoch reopens the database.
      storageFailure = error;
      try { connection.exec("ROLLBACK"); } catch { /* best effort */ }
      throw Object.assign(new Error(`Task Center SQLite commit failed: ${errorMessage(error)}`), {
        code: error?.code ?? "TASK_CENTER_COMMIT_FAILED",
        cause: error,
      });
    }
  }

  function isStorageFailure(error) {
    const code = String(error?.code ?? "").toUpperCase();
    const message = errorMessage(error).toLowerCase();
    return code.includes("SQLITE_BUSY")
      || code.includes("SQLITE_IO")
      || code.includes("SQLITE_FULL")
      || message.includes("database is locked")
      || message.includes("disk i/o")
      || message.includes("database or disk is full");
  }

  function assertTaskHistoryWritable(connection, taskId) {
    const row = connection.prepare("SELECT definition_status FROM tasks WHERE id = ?").get(taskId);
    if (row?.definition_status === "archived") {
      throw new Error(`Archived task history is immutable; restore the task before mutation: ${taskId}`);
    }
  }

  function upsertTaskRow(connection, parsed, { allowArchivedTransition = false } = {}) {
    const existingRow = connection.prepare("SELECT created_at, definition_status, payload_json FROM tasks WHERE id = ?").get(parsed.id);
    if (existingRow && Number(existingRow.created_at) !== parsed.createdAt) {
      throw new Error(`Task identity is immutable: ${parsed.id}`);
    }
    if (existingRow?.definition_status === "archived" && !allowArchivedTransition) {
      const unchanged = String(existingRow.payload_json) === json(parsed);
      if (!unchanged) throw new Error(`Archived task history is immutable; restore the task before mutation: ${parsed.id}`);
      return canonicalTask(rowPayload(existingRow, `task ${parsed.id}`));
    }
    connection.prepare(
      `INSERT INTO tasks(id, revision, workspace_root, definition_status, latest_run_id, created_at, updated_at, payload_json)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, workspace_root=excluded.workspace_root,
         definition_status=excluded.definition_status, latest_run_id=excluded.latest_run_id,
         updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
    ).run(parsed.id, parsed.revision, parsed.workspaceRoot, parsed.definitionStatus, parsed.latestRunId, parsed.createdAt, parsed.updatedAt, json(parsed));
    return parsed;
  }

  function appendEventRow(connection, event, { allowArchivedTask = false } = {}) {
    const parsed = canonicalEvent(event);
    if (!allowArchivedTask) assertTaskHistoryWritable(connection, parsed.taskId);
    const key = streamKey(parsed.taskId, parsed.taskRunId);
    const existing = connection.prepare("SELECT payload_json FROM events WHERE id = ?").get(parsed.id);
    if (existing) return canonicalEvent(rowPayload(existing, "event"));
    const row = connection.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM events WHERE stream_key = ?").get(key);
    const stored = { ...parsed, sequence: Number(row?.next ?? 1) };
    connection.prepare(
      `INSERT INTO events(id, task_id, run_id, stream_key, sequence, at, payload_json) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    ).run(stored.id, stored.taskId, stored.taskRunId, key, stored.sequence, stored.at, json(stored));
    // The event and its notification intent commit together. Broadcast is
    // deliberately outside this transaction; a Supervisor crash after this
    // commit leaves the row pending for deterministic replay on restart.
    connection.prepare(
      `INSERT INTO outbox(id, stream_key, status, created_at, payload_json, owner_epoch, claimed_at, delivered_at, attempts)
       VALUES(?, ?, 'pending', ?, ?, NULL, NULL, NULL, 0)
       ON CONFLICT(id) DO NOTHING`,
    ).run(stored.id, key, stored.at, json(stored));
    return stored;
  }

  function ensureQuickCheck() {
    const result = taskCenterQuickCheck(requireDb());
    if (result.length !== 1 || result[0].toLowerCase() !== "ok") {
      throw new Error(`Task Center SQLite quick_check failed: ${result.join(", ") || "no result"}`);
    }
    return true;
  }

  function fenceSupervisorEpoch(connection) {
    const previous = connection.prepare("SELECT value FROM metadata WHERE key = 'supervisor_epoch'").get()?.value ?? null;
    const changed = previous !== null && String(previous) !== supervisorEpoch;
    if (changed) {
      const timestamp = now();
      // Never let a lease from a dead Supervisor remain admissible. Attempts
      // stay in their immutable history; the orchestrator startup reconciler
      // decides whether to block or safely queue a fresh continuation.
      connection.prepare(
        "UPDATE leases SET status = 'revoked' WHERE status = 'active' AND (epoch IS NULL OR epoch <> ?)",
      ).run(supervisorEpoch);
      connection.prepare(
        `UPDATE outbox SET status = 'pending', owner_epoch = NULL, claimed_at = NULL
         WHERE status = 'processing' AND (owner_epoch IS NULL OR owner_epoch <> ?)`,
      ).run(supervisorEpoch);
      // A crash can occur after the process-local scheduler grants a ticket
      // and marks it admitted but before beginAttempt persists a lease. The
      // old owner can no longer start it, so return that durable ticket to the
      // queue; listReadyAttempts still verifies ready + lease-null ownership.
      connection.prepare(
        `UPDATE admission_queue SET status = 'queued', owner_epoch = ?, updated_at = ?
         WHERE status = 'admitted' AND (owner_epoch IS NULL OR owner_epoch <> ?)`,
      ).run(supervisorEpoch, timestamp, supervisorEpoch);
    }
    connection.prepare(
      `INSERT INTO metadata(key, value, updated_at) VALUES('supervisor_epoch', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    ).run(supervisorEpoch, now());
    return { previous, current: supervisorEpoch, changed };
  }

  async function initialize() {
    if (initialized) return;
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      closed = false;
      await mkdir(rootDirectory, { recursive: true });
      await assertNoSqliteCorruptionMarker(dbPath);
      const databaseExisted = await fileExists(dbPath);
      try {
        db = new DatabaseSync(dbPath);
        configureTaskCenterDatabase(db);
        createTaskCenterSchema(db, {
          now: now(),
          failMigrationStep: options.failMigrationStep ?? options.migrationFailureStep ?? options.injectMigrationFailure,
        });
        ensureQuickCheck();
        withTransaction((connection) => fenceSupervisorEpoch(connection));
        withTransaction((connection) => {
          const staleRows = connection.prepare("SELECT id, payload_json FROM processes WHERE status IN ('starting','running','stopping') AND (owner_epoch IS NULL OR owner_epoch <> ?)").all(supervisorEpoch);
          for (const row of staleRows) {
            let payload = {};
            try { payload = parseJson(row.payload_json, "process payload"); } catch { /* preserve a tombstone even for malformed diagnostics */ }
            connection.prepare("UPDATE processes SET status = 'stale', owner_epoch = ?, updated_at = ?, tombstoned_at = ?, payload_json = ? WHERE id = ?").run(supervisorEpoch, now(), now(), json({ ...payload, status: "stale", staleReason: "supervisor_epoch_changed" }), row.id);
          }
        });
        initialized = true;
        if (autoMigrate) {
          const { migrateLegacyJsonV2 } = await import("./json-import.mjs");
          await migrateLegacyJsonV2({ store: api, sourceRoot: legacyRootDirectory, now, skipInitialize: true });
        }
      } catch (error) {
        initialized = false;
        if (db) {
          try { db.close(); } catch { /* best effort close on failed boot */ }
          db = null;
        }
        if (databaseExisted && isSqliteCorruptionError(error)) {
          const quarantine = await preserveCorruptSqliteDatabase({ dbPath, error, timestamp: now() });
          throw Object.assign(
            new Error(`Task Center SQLite corruption was preserved at ${quarantine.preservedPath}; startup remains fail-closed until manual recovery. Original error: ${errorMessage(error)}`),
            { cause: error, code: "TASK_CENTER_SQLITE_CORRUPT", quarantine },
          );
        }
        throw error;
      }
    })();
    try {
      await initializePromise;
    } finally {
      initializePromise = null;
    }
  }

  function migrationMarker() {
    const row = requireDb().prepare("SELECT * FROM migration_markers WHERE id = ?").get(LEGACY_MARKER_ID);
    if (!row) return null;
    return {
      ...row,
      markerId: row.id,
      sourceRoot: row.source_root,
      sourceManifestSha256: row.source_manifest_sha256,
      importedAt: row.imported_at,
      payload: parseJson(row.payload_json, "migration marker"),
    };
  }

  function migrationIssues() {
    return requireDb().prepare(
      "SELECT id, marker_id AS markerId, source_path AS sourcePath, category, message, created_at AS createdAt FROM migration_issues WHERE marker_id = ? ORDER BY id",
    ).all(LEGACY_MARKER_ID);
  }

  function legacyIssueForTask(taskId) {
    return requireDb().prepare(
      "SELECT 1 FROM migration_issues WHERE marker_id = ? AND category = 'legacy-v1' AND source_path LIKE ? LIMIT 1",
    ).get(LEGACY_MARKER_ID, `%/tasks/${taskId}/%`);
  }

  async function readTask(taskId) {
    const id = requireSafeId(taskId, "taskId");
    await initialize();
    const row = requireDb().prepare("SELECT payload_json FROM tasks WHERE id = ?").get(id);
    if (row) return canonicalTask(rowPayload(row, `task ${id}`));
    if (legacyIssueForTask(id)) throw new Error(`Task ${id} is legacy Task Center v1 state and is read-only; migrate it explicitly before using Task Center v2`);
    return null;
  }

  async function isLegacyTask(taskId) {
    const id = requireSafeId(taskId, "taskId");
    await initialize();
    if (legacyIssueForTask(id)) return true;
    const row = requireDb().prepare("SELECT payload_json FROM tasks WHERE id = ?").get(id);
    return Boolean(row && taskOrchestratorLegacyTaskSchema.safeParse(rowPayload(row, `task ${id}`)).success);
  }

  async function requireTask(taskId) {
    const task = await readTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  async function writeTask(task) {
    const parsed = canonicalTask(task);
    await initialize();
    return serialized(() => withTransaction((connection) => upsertTaskRow(connection, parsed)));
  }

  async function archiveTask(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const row = connection.prepare("SELECT payload_json FROM tasks WHERE id = ?").get(taskId);
      if (!row) throw new Error(`Task not found: ${taskId}`);
      const task = canonicalTask(rowPayload(row, `task ${taskId}`));
      if (task.revision !== expectedRevision) {
        throw new Error(`Task revision conflict: expected ${expectedRevision}, found ${task.revision}`);
      }
      if (task.definitionStatus === "archived") throw new Error("Task is already archived");
      if (task.definitionStatus === "legacy-readonly") throw new Error("Legacy read-only tasks cannot be archived through Task Center v2");
      if (task.alignment.status === "running") throw new Error("Cannot archive a task while alignment is active");
      const activeRun = connection.prepare(
        `SELECT id FROM runs WHERE task_id = ?
         AND status IN ('queued', 'running', 'checkpointing', 'pausing', 'backoff', 'waiting-approval') LIMIT 1`,
      ).get(taskId);
      if (activeRun) throw new Error(`Cannot archive a task with an active run: ${activeRun.id}`);
      const unresolvedGate = connection.prepare(
        "SELECT id FROM gates WHERE task_id = ? AND status IN ('pending', 'resolving') LIMIT 1",
      ).get(taskId);
      if (unresolvedGate) throw new Error(`Cannot archive a task with an unresolved approval gate: ${unresolvedGate.id}`);
      const archived = canonicalTask({
        ...task,
        definitionStatus: "archived",
        revision: task.revision + 1,
        updatedAt: now(),
      });
      upsertTaskRow(connection, archived, { allowArchivedTransition: true });
      appendEventRow(connection, {
        schemaVersion: archived.schemaVersion,
        id: `event-${randomUUID()}`,
        sequence: 1,
        taskId,
        taskRunId: null,
        attemptId: null,
        type: "task-archived",
        message: `Task archived at revision ${archived.revision}; durable history remains immutable and auditable.`,
        at: archived.updatedAt,
      }, { allowArchivedTask: true });
      return archived;
    }));
  }

  async function restoreTask(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const row = connection.prepare("SELECT payload_json FROM tasks WHERE id = ?").get(taskId);
      if (!row) throw new Error(`Task not found: ${taskId}`);
      const task = canonicalTask(rowPayload(row, `task ${taskId}`));
      if (task.revision !== expectedRevision) {
        throw new Error(`Task revision conflict: expected ${expectedRevision}, found ${task.revision}`);
      }
      if (task.definitionStatus !== "archived") throw new Error("Only an archived task can be restored");
      const restoredStatus = task.contract
        ? "ready"
        : task.alignment.latestProposalId
          ? "awaiting-confirmation"
          : "alignment";
      const restored = canonicalTask({
        ...task,
        definitionStatus: restoredStatus,
        revision: task.revision + 1,
        updatedAt: now(),
      });
      upsertTaskRow(connection, restored, { allowArchivedTransition: true });
      appendEventRow(connection, {
        schemaVersion: restored.schemaVersion,
        id: `event-${randomUUID()}`,
        sequence: 1,
        taskId,
        taskRunId: null,
        attemptId: null,
        type: "task-restored",
        message: `Task restored to ${restoredStatus} at revision ${restored.revision}.`,
        at: restored.updatedAt,
      });
      return restored;
    }));
  }

  async function purgeTask(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const expectedRevision = requireExpectedRevision(input.expectedRevision);
    const expectedConfirmation = `PURGE ${taskId}`;
    if (String(input.confirmation ?? "") !== expectedConfirmation) {
      throw new Error(`Explicit purge confirmation must exactly equal ${expectedConfirmation}`);
    }
    const manifestSha256 = String(input.manifestSha256 ?? "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(manifestSha256)) throw new Error("manifestSha256 is invalid");
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const row = connection.prepare("SELECT revision, definition_status FROM tasks WHERE id = ?").get(taskId);
      if (!row) throw new Error(`Task not found: ${taskId}`);
      if (Number(row.revision) !== expectedRevision) {
        throw new Error(`Task revision conflict: expected ${expectedRevision}, found ${row.revision}`);
      }
      if (row.definition_status !== "archived") throw new Error("Only an archived task can be purged");
      const actualManifest = createTaskExportManifestPage(connection, {
        taskId,
        taskRevision: expectedRevision,
        cursor: 0,
        limit: 1,
      }).manifestSha256;
      if (actualManifest !== manifestSha256) throw new Error("Purge manifest digest does not match the current immutable task history");
      const purgedAt = now();
      const auditId = `purge-${randomUUID()}`;
      const result = taskOrchestratorTaskPurgeResultSchema.parse({
        ok: true, taskId, taskRevision: expectedRevision, manifestSha256, auditId, purgedAt,
      });
      connection.prepare(`INSERT INTO purge_audit(id,task_id,task_revision,manifest_sha256,purged_at,payload_json)
        VALUES (?,?,?,?,?,?)`).run(auditId, taskId, expectedRevision, manifestSha256, purgedAt, json(result));
      const deleted = connection.prepare("DELETE FROM tasks WHERE id = ? AND revision = ? AND definition_status = 'archived'")
        .run(taskId, expectedRevision);
      if (Number(deleted.changes) !== 1) throw new Error("Task purge lost its archived revision fence");
      return result;
    }));
  }

  async function readRun(taskId, taskRunId) {
    const task = requireSafeId(taskId, "taskId");
    const id = requireSafeId(taskRunId, "taskRunId");
    await initialize();
    const row = requireDb().prepare("SELECT payload_json FROM runs WHERE id = ? AND task_id = ?").get(id, task);
    return row ? canonicalRun(rowPayload(row, `run ${id}`)) : null;
  }

  async function requireRun(taskId, taskRunId) {
    const run = await readRun(taskId, taskRunId);
    if (!run) throw new Error(`Run not found: ${taskRunId}`);
    return run;
  }

  function upsertRunRows(connection, parsed) {
    assertTaskHistoryWritable(connection, parsed.taskId);
    const existingRun = connection.prepare("SELECT task_id, created_at FROM runs WHERE id = ?").get(parsed.id);
    if (existingRun && (existingRun.task_id !== parsed.taskId || Number(existingRun.created_at) !== parsed.createdAt)) {
      throw new Error(`Run identity and history cursor are immutable: ${parsed.id}`);
    }
    connection.prepare(
      `INSERT INTO runs(id, task_id, status, created_at, updated_at, payload_json) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id, status=excluded.status,
         updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
    ).run(parsed.id, parsed.taskId, parsed.status, parsed.createdAt, parsed.updatedAt, json(parsed));
    // Attempts are append-only execution history. Do not delete/reinsert them:
    // artifacts reference attempts with ON DELETE CASCADE, so replacement would
    // silently erase already committed evidence on every run status update.
    connection.prepare("DELETE FROM checkpoints WHERE run_id = ?").run(parsed.id);
    connection.prepare("DELETE FROM continuation_capsules WHERE run_id = ?").run(parsed.id);
    connection.prepare("DELETE FROM turns WHERE run_id = ?").run(parsed.id);
    connection.prepare("DELETE FROM budgets WHERE run_id = ?").run(parsed.id);
    connection.prepare("DELETE FROM leases WHERE run_id = ?").run(parsed.id);
    connection.prepare("DELETE FROM admission_queue WHERE run_id = ? AND status IN ('admitted', 'released')").run(parsed.id);
    connection.prepare("DELETE FROM side_effects WHERE run_id = ?").run(parsed.id);
    for (const attempt of [...parsed.primaryAttempts, ...parsed.workerAttempts, ...(parsed.checkerAttempts ?? [])]) {
      const attemptKind = attempt.kind ?? "checker";
      connection.prepare(
        `INSERT INTO attempts(id, run_id, task_id, kind, status, lease_id, updated_at, payload_json)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, task_id=excluded.task_id,
           kind=excluded.kind, status=excluded.status, lease_id=excluded.lease_id,
           updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
      ).run(attempt.id, parsed.id, parsed.taskId, attemptKind, attempt.status, attempt.leaseId, attempt.updatedAt, json(attempt));
      if (attempt.leaseId) {
        connection.prepare(
          "INSERT INTO leases(id, run_id, attempt_id, epoch, status, expires_at, payload_json) VALUES(?, ?, ?, ?, 'active', ?, ?)",
        ).run(
          attempt.leaseId,
          parsed.id,
          attempt.id,
          supervisorEpoch,
          attempt.startedAt === null ? null : attempt.startedAt + attempt.timeoutMs,
          json({ leaseId: attempt.leaseId, attemptId: attempt.id, runId: parsed.id, status: "active", supervisorEpoch }),
        );
      }
      if (attempt.status === "ready" && !attempt.leaseId && READY_RUN_STATUSES.has(parsed.status)) {
        const priority = attemptKind === "worker" ? 0 : attemptKind === "checker" ? 90 : 100;
        const queueId = `admission-${parsed.id}-${attempt.id}`;
        const existingAdmission = connection.prepare(
          "SELECT sequence, enqueued_at FROM admission_queue WHERE run_id = ? AND attempt_id = ?",
        ).get(parsed.id, attempt.id);
        let sequence = existingAdmission ? Number(existingAdmission.sequence) : null;
        if (sequence === null) {
          const persisted = Number(connection.prepare("SELECT value FROM metadata WHERE key = 'admission_sequence'").get()?.value ?? 0);
          const observed = Number(connection.prepare("SELECT COALESCE(MAX(sequence), 0) AS value FROM admission_queue").get()?.value ?? 0);
          sequence = Math.max(Number.isSafeInteger(persisted) ? persisted : 0, observed) + 1;
          connection.prepare(
            `INSERT INTO metadata(key, value, updated_at) VALUES('admission_sequence', ?, ?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
          ).run(String(sequence), now());
        }
        const enqueuedAt = existingAdmission
          ? Number(existingAdmission.enqueued_at)
          : Number(attempt.updatedAt ?? parsed.updatedAt ?? parsed.createdAt ?? now());
        connection.prepare(
          `INSERT INTO admission_queue(id, run_id, attempt_id, kind, priority, sequence, enqueued_at, status, owner_epoch, updated_at, payload_json)
           VALUES(?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
           ON CONFLICT(run_id, attempt_id) DO UPDATE SET kind=excluded.kind, priority=excluded.priority,
             status='queued', owner_epoch=excluded.owner_epoch, updated_at=excluded.updated_at,
             payload_json=excluded.payload_json`,
        ).run(queueId, parsed.id, attempt.id, attemptKind, priority, sequence, enqueuedAt, supervisorEpoch, parsed.updatedAt, json({
          runId: parsed.id,
          taskId: parsed.taskId,
          attemptId: attempt.id,
          kind: attemptKind,
          priority,
          sequence,
          enqueuedAt,
          notBefore: attempt.notBefore ?? null,
          supervisorEpoch,
        }));
      } else {
        connection.prepare("UPDATE admission_queue SET status = CASE WHEN status = 'queued' THEN 'released' ELSE status END, updated_at = ? WHERE run_id = ? AND attempt_id = ?").run(parsed.updatedAt, parsed.id, attempt.id);
      }
      if (attemptKind === "worker") {
        connection.prepare(
          `INSERT INTO workers(id, run_id, parent_attempt_id, status, updated_at, payload_json)
           VALUES(?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,
             parent_attempt_id=excluded.parent_attempt_id, status=excluded.status,
             updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
        ).run(attempt.id, parsed.id, attempt.parentAttemptId, attempt.status, attempt.updatedAt, json(attempt));
      }
    }
    for (const turn of parsed.turns ?? []) {
      connection.prepare(
        "INSERT INTO turns(id, run_id, sequence, status, updated_at, payload_json) VALUES(?, ?, ?, ?, ?, ?)",
      ).run(turn.id, parsed.id, turn.sequence, turn.status, turn.updatedAt, json(turn));
    }
    for (const capsule of parsed.continuationCapsules ?? []) {
      connection.prepare(
        "INSERT INTO continuation_capsules(id, run_id, from_turn_id, created_at, payload_json) VALUES(?, ?, ?, ?, ?)",
      ).run(capsule.id, parsed.id, capsule.fromTurnId, capsule.createdAt, json(capsule));
    }
    for (const checkpoint of parsed.checkpoints ?? []) {
      connection.prepare(
        "INSERT INTO checkpoints(id, run_id, turn_id, created_at, payload_json) VALUES(?, ?, ?, ?, ?)",
      ).run(checkpoint.id, parsed.id, checkpoint.turnId, checkpoint.createdAt, json(checkpoint));
    }
    if (parsed.budget) {
      connection.prepare("INSERT INTO budgets(run_id, updated_at, payload_json) VALUES(?, ?, ?)").run(parsed.id, parsed.budget.updatedAt, json(parsed.budget));
    }
    if (parsed.permissionGrant) {
      connection.prepare(
        `INSERT INTO permission_grants(id, run_id, expires_at, payload_json) VALUES(?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,
           expires_at=excluded.expires_at, payload_json=excluded.payload_json`,
      ).run(parsed.permissionGrant.id, parsed.id, parsed.permissionGrant.expiresAt, json(parsed.permissionGrant));
    } else {
      connection.prepare("DELETE FROM permission_grants WHERE run_id = ?").run(parsed.id);
    }
    for (const effect of parsed.sideEffects ?? []) {
      connection.prepare(
        `INSERT INTO side_effects(id, run_id, attempt_id, receipt_status, idempotency, intent_at, receipt_at, payload_json)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        effect.id,
        parsed.id,
        effect.attemptId,
        effect.receiptStatus,
        effect.idempotency,
        effect.intentAt,
        effect.receiptAt,
        json(effect),
      );
    }
  }

  function failApprovalFenceAt(stage) {
    if (approvalFenceFailureAt !== stage) return;
    throw Object.assign(new Error(`Injected approval fence failure at ${stage}`), {
      code: "TASK_APPROVAL_FENCE_INJECTED_FAILURE",
      stage,
    });
  }

  function canonicalApprovalFenceInput(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const taskRunId = requireSafeId(input.taskRunId, "taskRunId");
    if (!Array.isArray(input.expectedGates) || input.expectedGates.length === 0) {
      throw new Error("expectedGates must be a non-empty array");
    }
    if (!Array.isArray(input.gates) || input.gates.length === 0) {
      throw new Error("gates must be a non-empty array");
    }
    if (!input.run || typeof input.run !== "object") throw new Error("run is required");
    if (!Array.isArray(input.events) || input.events.length < 2) {
      throw new Error("events must include the approval and run audit events");
    }

    const expectedGates = input.expectedGates.map((entry, index) => {
      if (!entry || typeof entry !== "object") throw new Error(`expectedGates[${index}] is invalid`);
      const id = requireSafeId(entry.id, `expectedGates[${index}].id`);
      if (!hasOwn(entry, "status")) throw new Error(`expectedGates[${index}].status is required`);
      const status = String(entry.status ?? "").trim();
      if (!status) throw new Error(`expectedGates[${index}].status is invalid`);
      const expected = { id, status };
      for (const key of ["taskId", "taskRunId", "leaseId", "personalRunId", "decisionRequestedAt"]) {
        if (!hasOwn(entry, key)) continue;
        const value = entry[key];
        if (key === "taskId" || key === "taskRunId") {
          expected[key] = requireSafeId(value, `expectedGates[${index}].${key}`);
        } else if (key === "leaseId") {
          expected[key] = value === null ? null : requireSafeId(value, `expectedGates[${index}].leaseId`);
        } else if (key === "personalRunId") {
          expected[key] = value === null ? null : String(value).trim();
          if (expected[key] !== null && (!expected[key] || expected[key].length > 240)) {
            throw new Error(`expectedGates[${index}].personalRunId is invalid`);
          }
        } else {
          expected[key] = value === null ? null : nonNegativeTimestamp(value);
          if (expected[key] === null && value !== null) throw new Error(`expectedGates[${index}].decisionRequestedAt is invalid`);
        }
      }
      if (hasOwn(expected, "taskId") && expected.taskId !== taskId) throw new Error(`expected gate ${id} task identity is invalid`);
      if (hasOwn(expected, "taskRunId") && expected.taskRunId !== taskRunId) throw new Error(`expected gate ${id} run identity is invalid`);
      return expected;
    });
    const expectedIds = new Set(expectedGates.map((gate) => gate.id));
    if (expectedIds.size !== expectedGates.length) throw new Error("expectedGates contains duplicate gate ids");

    const gates = input.gates.map((gate, index) => {
      let parsed;
      try { parsed = canonicalGate(gate); } catch (error) { throw new Error(`gates[${index}] is invalid: ${errorMessage(error)}`); }
      if (!["approved", "rejected", "cancelled"].includes(parsed.status)) {
        throw new Error(`approval fence gate ${parsed.id} must be terminal`);
      }
      if (parsed.taskId !== taskId || parsed.taskRunId !== taskRunId) {
        throw new Error(`approval fence gate ${parsed.id} has the wrong task/run identity`);
      }
      return parsed;
    });
    const gateIds = new Set(gates.map((gate) => gate.id));
    if (gateIds.size !== gates.length) throw new Error("gates contains duplicate gate ids");
    if (gateIds.size !== expectedIds.size || [...gateIds].some((id) => !expectedIds.has(id))) {
      throw new Error("gates and expectedGates must contain the exact same gate ids");
    }

    const run = canonicalRun(input.run);
    if (run.id !== taskRunId || run.taskId !== taskId) throw new Error("approval fence run has the wrong task/run identity");
    if (!["blocked", "cancelled"].includes(run.status)) {
      throw new Error("approval fence requires a blocked or cancelled terminal run");
    }
    if (run.finishedAt === null) throw new Error("approval fence terminal run requires finishedAt");
    const attempts = [...run.primaryAttempts, ...run.workerAttempts, ...(run.checkerAttempts ?? [])];
    if (attempts.some((attempt) => ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || ACTIVE_CHECKER_ATTEMPT_STATUSES.has(attempt.status))) {
      throw new Error("approval fence run still contains an active attempt");
    }
    if (attempts.some((attempt) => attempt.leaseId !== null)) {
      throw new Error("approval fence run still contains an active lease");
    }

    const events = input.events.map((event, index) => {
      let parsed;
      try { parsed = canonicalEvent(event); } catch (error) { throw new Error(`events[${index}] is invalid: ${errorMessage(error)}`); }
      if (parsed.taskId !== taskId || parsed.taskRunId !== taskRunId) {
        throw new Error(`approval fence event ${parsed.id} has the wrong task/run identity`);
      }
      return parsed;
    });
    const eventIds = new Set(events.map((event) => event.id));
    if (eventIds.size !== events.length) throw new Error("events contains duplicate event ids");
    const eventTypes = new Set(events.map((event) => event.type));
    if (!eventTypes.has("approval-expired") || !eventTypes.has("run-blocked")) {
      throw new Error("approval fence events must include approval-expired and run-blocked");
    }
    if (!hasOwn(input, "expectedRun") || input.expectedRun == null) throw new Error("expectedRun is required");
    const expectedRun = canonicalApprovalFenceRunExpectation(input.expectedRun, taskId, taskRunId);
    return { taskId, taskRunId, expectedGates, expectedRun, gates, run, events };
  }

  function readGateRow(connection, gateId) {
    const row = connection.prepare("SELECT task_id, run_id, payload_json FROM gates WHERE id = ?").get(gateId);
    if (!row) return null;
    const gate = canonicalGate(rowPayload(row, `gate ${gateId}`));
    if (gate.taskId !== row.task_id || gate.taskRunId !== row.run_id) {
      throw new Error(`Gate ${gateId} payload identity is corrupt`);
    }
    return gate;
  }

  function expectedGateMatches(gate, expected) {
    if (!gate || gate.id !== expected.id || gate.status !== expected.status) return false;
    for (const key of ["taskId", "taskRunId", "leaseId", "personalRunId", "decisionRequestedAt"]) {
      if (hasOwn(expected, key) && !sameCanonicalJson(gate[key], expected[key])) return false;
    }
    return true;
  }

  function writeApprovalFenceGateRow(connection, gate) {
    const updatedAt = Math.max(gate.requestedAt, gate.decisionRequestedAt ?? 0, gate.resolvedAt ?? 0);
    connection.prepare(
      `INSERT INTO gates(id, task_id, run_id, status, requested_at, updated_at, payload_json) VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id, run_id=excluded.run_id,
         status=excluded.status, updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
    ).run(gate.id, gate.taskId, gate.taskRunId, gate.status, gate.requestedAt, updatedAt, json(gate));
  }

  function readApprovalFenceEvent(connection, eventId) {
    const eventRow = connection.prepare("SELECT stream_key, payload_json FROM events WHERE id = ?").get(eventId);
    if (!eventRow) return null;
    const event = canonicalEvent(rowPayload(eventRow, `event ${eventId}`));
    const outbox = connection.prepare("SELECT stream_key, payload_json FROM outbox WHERE id = ?").get(eventId);
    return { event, eventRow, outbox };
  }

  function appendApprovalFenceEventRow(connection, event) {
    if (readApprovalFenceEvent(connection, event.id)) {
      throw new Error(`Approval fence event id already exists: ${event.id}`);
    }
    const key = streamKey(event.taskId, event.taskRunId);
    const next = connection.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM events WHERE stream_key = ?").get(key);
    const stored = { ...event, sequence: Number(next?.next ?? 1) };
    const orphanOutbox = connection.prepare("SELECT id FROM outbox WHERE id = ?").get(event.id);
    if (orphanOutbox) throw new Error(`Approval fence outbox id already exists: ${event.id}`);
    connection.prepare(
      "INSERT INTO events(id, task_id, run_id, stream_key, sequence, at, payload_json) VALUES(?, ?, ?, ?, ?, ?, ?)",
    ).run(stored.id, stored.taskId, stored.taskRunId, key, stored.sequence, stored.at, json(stored));
    connection.prepare(
      `INSERT INTO outbox(id, stream_key, status, created_at, payload_json, owner_epoch, claimed_at, delivered_at, attempts)
       VALUES(?, ?, 'pending', ?, ?, NULL, NULL, NULL, 0)`,
    ).run(stored.id, key, stored.at, json(stored));
    return stored;
  }

  function exactApprovalFenceTransition(connection, parsed) {
    const runRow = connection.prepare("SELECT task_id, created_at, payload_json FROM runs WHERE id = ?").get(parsed.taskRunId);
    if (!runRow || runRow.task_id !== parsed.taskId) return null;
    const run = canonicalRun(rowPayload(runRow, `run ${parsed.taskRunId}`));
    if (!sameCanonicalJson(run, parsed.run)) return null;
    const gates = parsed.gates.map((gate) => readGateRow(connection, gate.id));
    if (gates.some((gate) => !gate) || gates.some((gate, index) => !sameCanonicalJson(gate, parsed.gates[index]))) return null;
    const events = [];
    for (const requested of parsed.events) {
      const record = readApprovalFenceEvent(connection, requested.id);
      if (!record || !record.outbox) return null;
      if (record.eventRow.stream_key !== streamKey(parsed.taskId, parsed.taskRunId)) return null;
      const expected = { ...requested, sequence: record.event.sequence };
      const canonicalExpected = canonicalEvent(expected);
      const outboxEvent = canonicalEvent(rowPayload(record.outbox, `outbox ${requested.id}`));
      if (!sameCanonicalJson(record.event, canonicalExpected) || !sameCanonicalJson(outboxEvent, record.event)) return null;
      events.push(record.event);
    }
    return { taskId: parsed.taskId, taskRunId: parsed.taskRunId, gates, run, events, idempotent: true, committed: false };
  }

  async function commitApprovalFence(input = {}) {
    const parsed = canonicalApprovalFenceInput(input);
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const taskRow = connection.prepare("SELECT definition_status FROM tasks WHERE id = ?").get(parsed.taskId);
      if (!taskRow) throw new Error(`Task not found: ${parsed.taskId}`);
      if (taskRow.definition_status === "archived") {
        throw new Error(`Archived task history is immutable; restore the task before approval fencing: ${parsed.taskId}`);
      }

      // A committed transition is safe to replay only when every terminal
      // payload, event ID, and outbox intent is byte-for-byte canonical equal.
      // This check intentionally precedes the expected-state CAS because the
      // expected gate status is necessarily stale after the first commit.
      const idempotent = exactApprovalFenceTransition(connection, parsed);
      if (idempotent) return idempotent;

      const currentRunRow = connection.prepare("SELECT task_id, created_at, payload_json FROM runs WHERE id = ?").get(parsed.taskRunId);
      if (!currentRunRow) throw new Error(`Run not found: ${parsed.taskRunId}`);
      if (currentRunRow.task_id !== parsed.taskId) throw new Error("Approval fence run identity is stale");
      if (Number(currentRunRow.created_at) !== parsed.run.createdAt) throw new Error("Approval fence run history cursor is immutable");
      const currentRun = canonicalRun(rowPayload(currentRunRow, `run ${parsed.taskRunId}`));
      if (!approvalFenceRunMatches(currentRun, parsed.expectedRun)) {
        throw new Error("Approval fence run expected state is stale");
      }

      const currentGates = new Map();
      for (const expected of parsed.expectedGates) {
        const gate = readGateRow(connection, expected.id);
        if (!gate) throw new Error(`Approval fence gate not found: ${expected.id}`);
        if (gate.taskId !== parsed.taskId || gate.taskRunId !== parsed.taskRunId) {
          throw new Error(`Approval fence gate ${expected.id} identity is stale`);
        }
        if (!expectedGateMatches(gate, expected)) {
          throw new Error(`Approval fence gate ${expected.id} expected state is stale`);
        }
        currentGates.set(gate.id, gate);
      }

      for (const gate of parsed.gates) writeApprovalFenceGateRow(connection, gate);
      failApprovalFenceAt("after-gates");
      upsertRunRows(connection, parsed.run);
      failApprovalFenceAt("after-run");
      const storedEvents = parsed.events.map((event) => appendApprovalFenceEventRow(connection, event));
      failApprovalFenceAt("after-events");
      return {
        taskId: parsed.taskId,
        taskRunId: parsed.taskRunId,
        gates: parsed.gates,
        run: parsed.run,
        events: storedEvents,
        idempotent: false,
        committed: true,
      };
    }));
  }

  async function writeRun(run) {
    const parsed = canonicalRun(run);
    await initialize();
    return serialized(() => withTransaction((connection) => {
      upsertRunRows(connection, parsed);
      return parsed;
    }));
  }

  async function runsForTask(taskId) {
    const id = requireSafeId(taskId, "taskId");
    await initialize();
    const rows = requireDb().prepare("SELECT payload_json FROM runs WHERE task_id = ? ORDER BY created_at DESC, id DESC").all(id);
    return rows.map((row) => canonicalRun(rowPayload(row, "run"))).sort(newestFirst);
  }

  async function listRuns(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const cursor = decodeHistoryCursor(input.cursor);
    const limit = requirePageLimit(input.limit);
    await initialize();
    await requireTask(taskId);
    const selection = `SELECT r.id, r.task_id, r.status, r.created_at, r.updated_at,
      json_extract(r.payload_json, '$.taskRevision') AS task_revision,
      json_extract(r.payload_json, '$.currentAttemptId') AS current_attempt_id,
      (SELECT t.sequence FROM turns t
        WHERE t.run_id = r.id AND t.id = json_extract(r.payload_json, '$.currentTurnId') LIMIT 1) AS current_turn,
      COALESCE(json_array_length(json_extract(r.payload_json, '$.primaryAttempts')), 0) AS primary_attempt_count,
      COALESCE(json_array_length(json_extract(r.payload_json, '$.workerAttempts')), 0) AS worker_attempt_count,
      json_extract(r.payload_json, '$.pause.reason') AS pause_reason,
      COALESCE(json_extract(r.payload_json, '$.pause.resumeEligible'), 0) AS resume_eligible,
      json_extract(r.payload_json, '$.startedAt') AS started_at,
      json_extract(r.payload_json, '$.finishedAt') AS finished_at,
      json_extract(r.payload_json, '$.error') AS error
      FROM runs r`;
    const rows = cursor
      ? requireDb().prepare(
        `${selection} WHERE r.task_id = ? AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))
         ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
      ).all(taskId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
      : requireDb().prepare(
        `${selection} WHERE r.task_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?`,
      ).all(taskId, limit + 1);
    let hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((row) => ({
      row,
      summary: runSummaryFromRow(row),
    }));
    while (page.length > 1 && !pageFits({ runs: page.map((item) => item.summary) })) {
      page.pop();
      hasMore = true;
    }
    const result = {
      runs: page.map((item) => item.summary),
      nextCursor: page.length ? encodeHistoryCursor(page.at(-1).row.created_at, page.at(-1).row.id) : input.cursor ?? null,
      hasMore,
    };
    return taskOrchestratorRunsListResultSchema.parse(result);
  }

  async function listTurnHistory(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const taskRunId = requireSafeId(input.taskRunId, "taskRunId");
    const cursor = decodeTurnHistoryCursor(input.cursor);
    const limit = requirePageLimit(input.limit);
    await initialize();
    const run = await requireRun(taskId, taskRunId);
    const selection = "SELECT id, sequence, payload_json FROM turns";
    const rows = cursor
      ? requireDb().prepare(
        `${selection} WHERE run_id = ? AND (sequence < ? OR (sequence = ? AND id < ?))
         ORDER BY sequence DESC, id DESC LIMIT ?`,
      ).all(taskRunId, cursor.sequence, cursor.sequence, cursor.id, limit + 1)
      : requireDb().prepare(
        `${selection} WHERE run_id = ? ORDER BY sequence DESC, id DESC LIMIT ?`,
      ).all(taskRunId, limit + 1);
    const attempts = [...run.primaryAttempts, ...run.workerAttempts];
    const entries = rows.slice(0, limit).map((row) => ({
      id: row.id,
      sequence: Number(row.sequence),
      item: createTurnHistoryItem({
        taskId,
        taskRunId,
        turn: rowPayload(row, `turn ${row.id}`),
        attempts,
        checkerAttempts: run.checkerAttempts ?? [],
        decisions: run.primaryDecisions ?? [],
        checkpoints: run.checkpoints ?? [],
        capsules: run.continuationCapsules ?? [],
      }),
    }));
    return taskOrchestratorTurnHistoryListResultSchema.parse(createTurnHistoryPage({
      taskId,
      taskRunId,
      entries,
      requestedLimit: limit,
      priorCursor: input.cursor ?? null,
      sourceHasMore: rows.length > limit,
    }));
  }

  async function reconcileLatestRunPointer(taskId) {
    const task = await requireTask(taskId);
    const runs = await runsForTask(task.id);
    const latestRunId = runs[0]?.id ?? null;
    if (task.latestRunId === latestRunId) return { task, runs, changed: false };
    const repaired = { ...task, latestRunId };
    await writeTask(repaired);
    return { task: repaired, runs, changed: true };
  }

  async function reconcileLatestRunPointers() {
    await initialize();
    const rows = requireDb().prepare("SELECT id FROM tasks ORDER BY id").all();
    const results = [];
    for (const row of rows) results.push(await reconcileLatestRunPointer(row.id));
    return results;
  }

  function readEventsSync(taskId, taskRunId) {
    const key = streamKey(taskId, taskRunId);
    const rows = requireDb().prepare("SELECT payload_json FROM events WHERE stream_key = ? ORDER BY sequence").all(key);
    return rows.map((row) => canonicalEvent(rowPayload(row, "event")));
  }

  async function readEvents(taskId, taskRunId) {
    const id = requireSafeId(taskId, "taskId");
    const runId = taskRunId == null ? null : requireSafeId(taskRunId, "taskRunId");
    await initialize();
    return readEventsSync(id, runId);
  }

  async function listEvents(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const taskRunId = input.taskRunId == null ? null : requireSafeId(input.taskRunId, "taskRunId");
    const cursor = input.cursor == null ? 0 : Number(input.cursor);
    const limit = requirePageLimit(input.limit);
    if (!Number.isInteger(cursor) || cursor < 0) throw new Error("cursor must be a non-negative event sequence");
    await initialize();
    await requireTask(taskId);
    if (taskRunId) await requireRun(taskId, taskRunId);
    const rows = requireDb().prepare(
      `SELECT sequence, payload_json FROM events
       WHERE stream_key = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?`,
    ).all(streamKey(taskId, taskRunId), cursor, limit + 1);
    let hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map((row) => canonicalEvent(rowPayload(row, "event")));
    while (events.length > 1 && !pageFits({ events })) {
      events.pop();
      hasMore = true;
    }
    return taskOrchestratorEventsListResultSchema.parse({
      events,
      nextCursor: events.at(-1)?.sequence ?? cursor,
      hasMore,
    });
  }

  async function nextEventSequence(taskId, taskRunId) {
    const id = requireSafeId(taskId, "taskId");
    const runId = taskRunId == null ? null : requireSafeId(taskRunId, "taskRunId");
    await initialize();
    const row = requireDb().prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM events WHERE stream_key = ?").get(streamKey(id, runId));
    return Number(row?.next ?? 1);
  }

  async function appendEvent(event) {
    const parsed = canonicalEvent(event);
    await initialize();
    return serialized(() => withTransaction((connection) => appendEventRow(connection, parsed)));
  }

  async function writeArtifact(artifact) {
    const parsed = canonicalArtifact(artifact);
    await initialize();
    return serialized(() => withTransaction((connection) => {
      assertTaskHistoryWritable(connection, parsed.taskId);
      const existing = connection.prepare("SELECT id FROM artifacts WHERE id = ?").get(parsed.id);
      if (existing) throw new Error(`Artifact already exists and is immutable: ${parsed.id}`);
      const { content, ...metadata } = parsed;
      connection.prepare(
        `INSERT INTO artifacts(id, task_id, run_id, attempt_id, content, content_sha256, metadata_json, committed, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(parsed.id, parsed.taskId, parsed.taskRunId, parsed.attemptId, content, sha256(content), json(metadata), parsed.createdAt);
      return parsed;
    }));
  }

  async function readArtifacts(taskId, taskRunId) {
    const task = requireSafeId(taskId, "taskId");
    const run = requireSafeId(taskRunId, "taskRunId");
    await initialize();
    const rows = requireDb().prepare(
      "SELECT content, content_sha256, metadata_json, committed FROM artifacts WHERE task_id = ? AND run_id = ? ORDER BY created_at, id",
    ).all(task, run);
    return rows.filter((row) => Number(row.committed) === 1).map((row) => {
      if (row.content_sha256 && sha256(row.content) !== row.content_sha256) throw new Error("Artifact content hash mismatch; refusing to read mutable/corrupt artifact");
      return canonicalArtifact({ ...parseJson(row.metadata_json, "artifact metadata"), content: row.content });
    });
  }

  /**
   * Return only the ordering watermark needed when assigning the next
   * immutable artifact timestamp. This avoids loading and hashing every prior
   * artifact body on the write hot path as a long run accumulates evidence.
   */
  async function latestArtifactCreatedAt(taskId, taskRunId) {
    const task = requireSafeId(taskId, "taskId");
    const run = requireSafeId(taskRunId, "taskRunId");
    await initialize();
    const row = requireDb().prepare(
      "SELECT MAX(created_at) AS created_at FROM artifacts WHERE task_id = ? AND run_id = ? AND committed = 1",
    ).get(task, run);
    return row?.created_at == null ? null : Number(row.created_at);
  }

  function artifactMetadata(row) {
    return taskOrchestratorArtifactMetadataSchema.parse({
      schemaVersion: Number(row.schema_version),
      id: row.id,
      taskId: row.task_id,
      taskRunId: row.run_id,
      taskRevision: Number(row.task_revision),
      attemptId: row.attempt_id,
      turnId: row.turn_id ?? null,
      kind: row.kind,
      summary: row.summary,
      evidenceCount: Number(row.evidence_count ?? 0),
      contentBytes: Number(row.content_bytes ?? 0),
      contentSha256: String(row.content_sha256 ?? ""),
      createdAt: Number(row.created_at),
    });
  }

  async function listArtifacts(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const taskRunId = requireSafeId(input.taskRunId, "taskRunId");
    const cursor = decodeHistoryCursor(input.cursor);
    const limit = requirePageLimit(input.limit);
    await initialize();
    await requireRun(taskId, taskRunId);
    const selection = `SELECT id, task_id, run_id, attempt_id, created_at, content_sha256,
      length(CAST(content AS BLOB)) AS content_bytes,
      json_extract(metadata_json, '$.schemaVersion') AS schema_version,
      json_extract(metadata_json, '$.taskRevision') AS task_revision,
      json_extract(metadata_json, '$.turnId') AS turn_id,
      json_extract(metadata_json, '$.kind') AS kind,
      json_extract(metadata_json, '$.summary') AS summary,
      COALESCE(json_array_length(json_extract(metadata_json, '$.evidence')), 0) AS evidence_count
      FROM artifacts`;
    const rows = cursor
      ? requireDb().prepare(
        `${selection} WHERE task_id = ? AND run_id = ? AND committed = 1
         AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).all(taskId, taskRunId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
      : requireDb().prepare(
        `${selection} WHERE task_id = ? AND run_id = ? AND committed = 1
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).all(taskId, taskRunId, limit + 1);
    let hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((row) => ({ row, metadata: artifactMetadata(row) }));
    while (page.length > 1 && !pageFits({ artifacts: page.map((item) => item.metadata) })) {
      page.pop();
      hasMore = true;
    }
    return taskOrchestratorArtifactsListResultSchema.parse({
      artifacts: page.map((item) => item.metadata),
      nextCursor: page.length ? encodeHistoryCursor(page.at(-1).row.created_at, page.at(-1).row.id) : input.cursor ?? null,
      hasMore,
    });
  }

  async function getArtifact(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const taskRunId = requireSafeId(input.taskRunId, "taskRunId");
    const artifactId = requireSafeId(input.artifactId, "artifactId");
    await initialize();
    await requireRun(taskId, taskRunId);
    const row = requireDb().prepare(
      `SELECT content, content_sha256, metadata_json FROM artifacts
       WHERE id = ? AND task_id = ? AND run_id = ? AND committed = 1`,
    ).get(artifactId, taskId, taskRunId);
    if (!row) throw new Error(`Artifact not found: ${artifactId}`);
    if (sha256(row.content) !== row.content_sha256) {
      throw new Error("Artifact content hash mismatch; refusing to read mutable/corrupt artifact");
    }
    const artifact = canonicalArtifact({ ...parseJson(row.metadata_json, "artifact metadata"), content: row.content });
    if (!pageFits({ artifact })) {
      throw Object.assign(
        new Error("Artifact exceeds the bounded Supervisor response; use taskOrchestratorArtifactContentGet"),
        { code: "TASK_ARTIFACT_REQUIRES_CHUNKS" },
      );
    }
    return artifact;
  }

  async function getArtifactContent(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const taskRunId = requireSafeId(input.taskRunId, "taskRunId");
    const artifactId = requireSafeId(input.artifactId, "artifactId");
    const offset = input.offset == null ? 0 : Number(input.offset);
    const limitChars = input.limitChars == null ? DEFAULT_ARTIFACT_CONTENT_CHUNK_CHARS : Number(input.limitChars);
    const evidenceOffset = input.evidenceOffset == null ? 0 : Number(input.evidenceOffset);
    const evidenceLimit = input.evidenceLimit == null ? 2 : Number(input.evidenceLimit);
    if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
    if (!Number.isInteger(limitChars) || limitChars < 1 || limitChars > MAX_ARTIFACT_CONTENT_CHUNK_CHARS) {
      throw new Error(`limitChars must be an integer between 1 and ${MAX_ARTIFACT_CONTENT_CHUNK_CHARS}`);
    }
    if (!Number.isInteger(evidenceOffset) || evidenceOffset < 0) throw new Error("evidenceOffset must be a non-negative integer");
    if (!Number.isInteger(evidenceLimit) || evidenceLimit < 1 || evidenceLimit > 2) {
      throw new Error("evidenceLimit must be an integer between 1 and 2");
    }
    await initialize();
    await requireRun(taskId, taskRunId);
    const row = requireDb().prepare(
      `SELECT id, task_id, run_id, attempt_id, created_at, content, content_sha256, metadata_json,
         length(CAST(content AS BLOB)) AS content_bytes,
         json_extract(metadata_json, '$.schemaVersion') AS schema_version,
         json_extract(metadata_json, '$.taskRevision') AS task_revision,
         json_extract(metadata_json, '$.turnId') AS turn_id,
         json_extract(metadata_json, '$.kind') AS kind,
         json_extract(metadata_json, '$.summary') AS summary,
         COALESCE(json_array_length(json_extract(metadata_json, '$.evidence')), 0) AS evidence_count
       FROM artifacts WHERE id = ? AND task_id = ? AND run_id = ? AND committed = 1`,
    ).get(artifactId, taskId, taskRunId);
    if (!row) throw new Error(`Artifact not found: ${artifactId}`);
    if (sha256(row.content) !== row.content_sha256) {
      throw new Error("Artifact content hash mismatch; refusing to read mutable/corrupt artifact");
    }
    if (offset > row.content.length) throw new Error("offset is beyond the immutable artifact content");
    const artifactPayload = parseJson(row.metadata_json, "artifact metadata");
    const allEvidence = Array.isArray(artifactPayload.evidence) ? artifactPayload.evidence : [];
    if (evidenceOffset > allEvidence.length) throw new Error("evidenceOffset is beyond the immutable artifact evidence");
    const contentChunk = row.content.slice(offset, offset + limitChars);
    const consumed = contentChunk.length;
    const nextOffset = offset + consumed;
    const evidence = allEvidence.slice(evidenceOffset, evidenceOffset + evidenceLimit);
    const consumedEvidenceOffset = evidenceOffset + evidence.length;
    const result = {
      artifact: artifactMetadata(row),
      offset,
      contentChunk,
      nextOffset: nextOffset < row.content.length ? nextOffset : null,
      complete: nextOffset >= row.content.length,
      totalChars: row.content.length,
      evidenceOffset,
      evidence,
      nextEvidenceOffset: consumedEvidenceOffset < allEvidence.length ? consumedEvidenceOffset : null,
      evidenceComplete: consumedEvidenceOffset >= allEvidence.length,
      totalEvidence: allEvidence.length,
    };
    if (!pageFits(result)) throw new Error("Artifact content chunk exceeded the bounded Supervisor response budget");
    return taskOrchestratorArtifactContentResultSchema.parse(result);
  }

  async function writeGate(gate) {
    const parsed = canonicalGate(gate);
    await initialize();
    return serialized(() => withTransaction((connection) => {
      assertTaskHistoryWritable(connection, parsed.taskId);
      const updatedAt = Math.max(parsed.requestedAt, parsed.decisionRequestedAt ?? 0, parsed.resolvedAt ?? 0);
      connection.prepare(
        `INSERT INTO gates(id, task_id, run_id, status, requested_at, updated_at, payload_json) VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
      ).run(parsed.id, parsed.taskId, parsed.taskRunId, parsed.status, parsed.requestedAt, updatedAt, json(parsed));
      return parsed;
    }));
  }

  async function readGates(taskId, taskRunId) {
    const task = requireSafeId(taskId, "taskId");
    const run = requireSafeId(taskRunId, "taskRunId");
    await initialize();
    const rows = requireDb().prepare("SELECT payload_json FROM gates WHERE task_id = ? AND run_id = ? ORDER BY requested_at, id").all(task, run);
    return rows.map((row) => canonicalGate(rowPayload(row, "gate")));
  }

  async function snapshot(taskId, requestedRunId) {
    const task = await requireTask(taskId);
    const taskRunId = requestedRunId ?? task.latestRunId;
    const run = taskRunId ? await requireRun(task.id, taskRunId) : null;
    await initialize();
    const connection = requireDb();
    const key = streamKey(task.id, run?.id ?? null);
    const eventCount = Number(connection.prepare("SELECT COUNT(*) AS count FROM events WHERE stream_key = ?").get(key)?.count ?? 0);
    const eventRows = connection.prepare(
      "SELECT payload_json FROM events WHERE stream_key = ? ORDER BY sequence DESC LIMIT ?",
    ).all(key, SNAPSHOT_EVENT_LIMIT).reverse();
    let eventMessagesTruncated = 0;
    const events = eventRows.map((row) => {
      const event = canonicalEvent(rowPayload(row, "event"));
      const preview = previewEvent(event);
      if (preview.message !== event.message) eventMessagesTruncated += 1;
      return preview;
    });

    let artifacts = [];
    let artifactCount = 0;
    let artifactContentBytes = 0;
    let artifactEvidenceCount = 0;
    const artifactBytesById = new Map();
    if (run) {
      const metadataRows = connection.prepare(
        `SELECT id, length(CAST(content AS BLOB)) AS content_bytes,
           COALESCE(json_array_length(json_extract(metadata_json, '$.evidence')), 0) AS evidence_count
         FROM artifacts WHERE task_id = ? AND run_id = ? AND committed = 1`,
      ).all(task.id, run.id);
      artifactCount = metadataRows.length;
      for (const row of metadataRows) {
        const contentBytes = Number(row.content_bytes ?? 0);
        artifactBytesById.set(row.id, contentBytes);
        artifactContentBytes += contentBytes;
        artifactEvidenceCount += Number(row.evidence_count ?? 0);
      }
      const artifactRows = connection.prepare(
        `SELECT content, content_sha256, metadata_json FROM artifacts
         WHERE task_id = ? AND run_id = ? AND committed = 1
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).all(task.id, run.id, SNAPSHOT_ARTIFACT_LIMIT).reverse();
      artifacts = artifactRows.map((row) => {
        if (sha256(row.content) !== row.content_sha256) {
          throw new Error("Artifact content hash mismatch; refusing to read mutable/corrupt artifact");
        }
        return previewArtifact(canonicalArtifact({ ...parseJson(row.metadata_json, "artifact metadata"), content: row.content }));
      });
    }

    let gates = [];
    let gateCount = 0;
    let gateDetailsTruncated = 0;
    if (run) {
      gateCount = Number(connection.prepare(
        "SELECT COUNT(*) AS count FROM gates WHERE task_id = ? AND run_id = ?",
      ).get(task.id, run.id)?.count ?? 0);
      const gateRows = connection.prepare(
        `SELECT payload_json FROM gates WHERE task_id = ? AND run_id = ?
         ORDER BY CASE WHEN status IN ('pending', 'resolving') THEN 0 ELSE 1 END,
           requested_at DESC, id DESC LIMIT ?`,
      ).all(task.id, run.id, SNAPSHOT_GATE_LIMIT);
      gates = gateRows.map((row) => {
        const gate = canonicalGate(rowPayload(row, "gate"));
        const preview = previewGate(gate);
        if (json(preview) !== json(gate)) gateDetailsTruncated += 1;
        return preview;
      }).sort((left, right) => left.requestedAt - right.requestedAt || left.id.localeCompare(right.id));
    }

    const bounded = {
      task,
      run,
      artifacts,
      events,
      gates,
      truncation: {
        truncated: false,
        byteBudget: TASK_ORCHESTRATOR_SNAPSHOT_BYTE_BUDGET,
        serializedBytes: 0,
        omitted: {
          events: 0, artifacts: 0, gates: 0, alignmentMessages: 0, contractProposals: 0,
          primaryAttempts: 0, workerAttempts: 0, primaryDecisions: 0, sideEffects: 0,
          turns: 0, checkpoints: 0, continuationCapsules: 0, artifactContentBytes: 0,
          artifactEvidence: 0,
        },
        compactedTask: false,
        compactedRun: false,
        eventMessagesTruncated: 0,
        gateDetailsTruncated: 0,
        artifactContentTruncatedIds: [],
      },
    };
    return fitSnapshotToBudget(bounded, {
      eventCount,
      artifactCount,
      gateCount,
      alignmentMessageCount: task.alignment.messages.length,
      contractProposalCount: task.alignment.proposals.length,
      primaryAttemptCount: run?.primaryAttempts.length ?? 0,
      workerAttemptCount: run?.workerAttempts.length ?? 0,
      primaryDecisionCount: run?.primaryDecisions.length ?? 0,
      sideEffectCount: run?.sideEffects.length ?? 0,
      turnCount: run?.turns.length ?? 0,
      checkpointCount: run?.checkpoints.length ?? 0,
      continuationCapsuleCount: run?.continuationCapsules.length ?? 0,
      artifactContentBytes,
      artifactEvidenceCount,
      artifactBytesById,
      compactedTask: false,
      compactedRun: false,
      eventMessagesTruncated,
      gateDetailsTruncated,
    });
  }

  async function exportTaskManifest(input = {}) {
    const taskId = requireSafeId(input.taskId, "taskId");
    const task = await requireTask(taskId);
    if (task.definitionStatus !== "archived") {
      throw new Error("Task history must be archived before producing an immutable export manifest");
    }
    return taskOrchestratorTaskExportManifestResultSchema.parse(createTaskExportManifestPage(requireDb(), {
      taskId,
      taskRevision: task.revision,
      cursor: input.cursor,
      limit: input.limit,
    }));
  }

  async function listTasks(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const limit = input.limit == null ? DEFAULT_TASK_LIST_PAGE_SIZE : requirePageLimit(input.limit);
    const cursor = decodeTaskListCursor(input.cursor);
    await initialize();
    const predicates = [];
    const params = [];
    if (workspaceRoot) { predicates.push("t.workspace_root = ?"); params.push(workspaceRoot); }
    if (cursor) {
      predicates.push("(t.updated_at < ? OR (t.updated_at = ? AND t.id < ?))");
      params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const rows = requireDb().prepare(
      `SELECT t.id, t.updated_at, t.payload_json, r.payload_json AS latest_run_payload
       FROM tasks t LEFT JOIN runs r ON r.id = t.latest_run_id
       ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""}
       ORDER BY t.updated_at DESC, t.id DESC LIMIT ?`,
    ).all(...params, limit + 1);
    const hasMore = rows.length > limit;
    const tasks = [];
    // Legacy/v1 migration issues are exposed through migrationIssues(); keep
    // the existing task-list contract focused on malformed v2 task rows.
    const issues = [];
    for (const row of rows.slice(0, limit)) {
      try {
        const task = canonicalTask(rowPayload(row, "task"));
        const latestRun = row.latest_run_payload
          ? canonicalRun(parseJson(row.latest_run_payload, `run ${task.latestRunId}`))
          : null;
        const current = latestRun?.currentAttemptId
          ? [...latestRun.primaryAttempts, ...latestRun.workerAttempts, ...(latestRun.checkerAttempts ?? [])]
              .find((attempt) => attempt.id === latestRun.currentAttemptId)
          : null;
        tasks.push(taskOrchestratorTaskSummarySchema.parse({
          id: task.id, revision: task.revision, idea: task.idea, workspaceRoot: task.workspaceRoot,
          definitionStatus: task.definitionStatus, latestRunId: task.latestRunId,
          latestRunStatus: latestRun?.status ?? null, permissionMode: task.permissionMode,
          contractFinalization: task.contractFinalization,
          currentActor: current ? ("kind" in current ? current.kind : "checker") : null,
          updatedAt: task.updatedAt,
        }));
      } catch (error) {
        issues.push(`${String(row.id ?? "task")}: ${errorMessage(error)}`);
      }
    }
    const last = rows.slice(0, limit).at(-1);
    return taskOrchestratorTaskListResultSchema.parse({
      tasks,
      issues,
      nextCursor: hasMore && last ? encodeTaskListCursor(Number(last.updated_at), String(last.id)) : null,
      hasMore,
    });
  }

  async function findRun(taskRunId) {
    const id = requireSafeId(taskRunId, "taskRunId");
    await initialize();
    const row = requireDb().prepare("SELECT task_id, payload_json FROM runs WHERE id = ?").get(id);
    return row ? { taskId: row.task_id, run: canonicalRun(rowPayload(row, `run ${id}`)) } : null;
  }

  async function allRuns() {
    await initialize();
    const rows = requireDb().prepare("SELECT payload_json FROM runs ORDER BY created_at DESC, id DESC").all();
    return rows.map((row) => canonicalRun(rowPayload(row, "run"))).sort(newestFirst);
  }

  function outboxEntry(row) {
    return {
      id: row.id,
      streamKey: row.stream_key,
      status: row.status,
      createdAt: Number(row.created_at),
      ownerEpoch: row.owner_epoch ?? null,
      claimedAt: row.claimed_at == null ? null : Number(row.claimed_at),
      deliveredAt: row.delivered_at == null ? null : Number(row.delivered_at),
      attempts: Number(row.attempts ?? 0),
      event: parseJson(row.payload_json, "outbox payload"),
    };
  }

  async function listOutbox(input = {}) {
    const limit = requirePageLimit(input.limit ?? 100);
    const statuses = Array.isArray(input.statuses) && input.statuses.length
      ? input.statuses.map((status) => String(status))
      : ["pending", "processing"];
    await initialize();
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = requireDb().prepare(
      `SELECT * FROM outbox WHERE status IN (${placeholders}) ORDER BY created_at ASC, id ASC LIMIT ?`,
    ).all(...statuses, limit);
    return rows.map(outboxEntry);
  }

  /** @returns {Promise<Array<{id: string, streamKey: string, status: string, event: object}>>} */
  async function claimOutbox(input = {}) {
    const ownerEpoch = String(input.ownerEpoch ?? supervisorEpoch).trim();
    if (!ownerEpoch) throw new Error("ownerEpoch is required");
    const limit = requirePageLimit(input.limit ?? 100);
    const reclaimProcessing = input.reclaimProcessing === true;
    const processingClaimTtlMs = Math.max(0, Number(input.processingClaimTtlMs ?? 30_000));
    if (!Number.isFinite(processingClaimTtlMs)) throw new Error("processingClaimTtlMs must be finite");
    const ids = Array.isArray(input.ids) ? input.ids.map((id) => requireSafeId(id, "outbox id")) : null;
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const claimTimestamp = now();
      const staleBefore = claimTimestamp - processingClaimTtlMs;
      const statePredicates = ["status = 'pending'"];
      const selectParams = [];
      if (reclaimProcessing) {
        statePredicates.push("(status = 'processing' AND ((owner_epoch IS NULL OR owner_epoch <> ?) OR claimed_at IS NULL OR claimed_at < ?))");
        selectParams.push(ownerEpoch, staleBefore);
      } else {
        statePredicates.push("(status = 'processing' AND (owner_epoch IS NULL OR owner_epoch <> ?))");
        selectParams.push(ownerEpoch);
      }
      let idPredicate = "";
      if (ids?.length) {
        idPredicate = ` AND id IN (${ids.map(() => "?").join(", ")})`;
        selectParams.push(...ids);
      }
      const rows = connection.prepare(
        `SELECT * FROM outbox
         WHERE (${statePredicates.join(" OR ")})${idPredicate}
         ORDER BY created_at ASC, id ASC LIMIT ?`,
      ).all(...selectParams, limit);
      const claimed = [];
      for (const row of rows) {
        const updateStatePredicates = ["status = 'pending'"];
        const updateParams = [];
        if (reclaimProcessing) {
          updateStatePredicates.push("(status = 'processing' AND ((owner_epoch IS NULL OR owner_epoch <> ?) OR claimed_at IS NULL OR claimed_at < ?))");
          updateParams.push(ownerEpoch, staleBefore);
        } else {
          updateStatePredicates.push("(status = 'processing' AND (owner_epoch IS NULL OR owner_epoch <> ?))");
          updateParams.push(ownerEpoch);
        }
        const changed = connection.prepare(
          `UPDATE outbox SET status = 'processing', owner_epoch = ?, claimed_at = ?, attempts = COALESCE(attempts, 0) + 1
           WHERE id = ? AND (${updateStatePredicates.join(" OR ")})`,
        ).run(ownerEpoch, claimTimestamp, row.id, ...updateParams);
        if (Number(changed.changes) !== 1) continue;
        const next = connection.prepare("SELECT * FROM outbox WHERE id = ?").get(row.id);
        if (next) claimed.push(outboxEntry(next));
      }
      return claimed;
    }));
  }

  /** @returns {Promise<boolean>} */
  async function ackOutbox(input = {}) {
    const id = requireSafeId(input.id, "outbox id");
    const ownerEpoch = String(input.ownerEpoch ?? supervisorEpoch).trim();
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const row = connection.prepare("SELECT status, owner_epoch FROM outbox WHERE id = ?").get(id);
      if (!row) return false;
      if (row.status === "delivered") return true;
      if (row.status !== "processing" || (row.owner_epoch && row.owner_epoch !== ownerEpoch)) return false;
      const changed = connection.prepare(
        `UPDATE outbox SET status = 'delivered', delivered_at = ?, owner_epoch = ?
         WHERE id = ? AND status = 'processing' AND (owner_epoch IS NULL OR owner_epoch = ?)`,
      ).run(now(), ownerEpoch, id, ownerEpoch);
      return Number(changed.changes) === 1;
    }));
  }

  /** Release a claimed notification when no recipient observed it. */
  /** @returns {Promise<boolean>} */
  async function releaseOutbox(input = {}) {
    const id = requireSafeId(input.id, "outbox id");
    const ownerEpoch = String(input.ownerEpoch ?? supervisorEpoch).trim();
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const changed = connection.prepare(
        `UPDATE outbox SET status = 'pending', owner_epoch = NULL, claimed_at = NULL
         WHERE id = ? AND status = 'processing' AND (owner_epoch IS NULL OR owner_epoch = ?)`,
      ).run(id, ownerEpoch);
      return Number(changed.changes) === 1;
    }));
  }

  /** @returns {Promise<{claimed: number, delivered: number, pending: number}>} */
  async function replayOutbox(input = {}) {
    if (replayInFlight) return replayInFlight;
    replayInFlight = (async () => {
      const ownerEpoch = String(input.ownerEpoch ?? supervisorEpoch).trim();
      const notify = input.notify ?? input.onEvent;
      if (typeof notify !== "function") throw new TypeError("replayOutbox requires notify(event, entry)");
      const entries = await claimOutbox({
        ownerEpoch,
        limit: input.limit ?? 100,
        ids: input.ids,
        // Reclaim only processing rows owned by another epoch or older than
        // the claim TTL.  A same-epoch in-flight delivery is protected by the
        // per-store single-flight above; a stale row becomes recoverable after
        // a crash without allowing concurrent client replays to duplicate it.
        reclaimProcessing: input.reclaimProcessing !== false,
        processingClaimTtlMs: input.processingClaimTtlMs,
      });
      let delivered = 0;
      for (const entry of entries) {
        try {
          const result = await notify(entry.event, entry);
          if (result === false) {
            await releaseOutbox({ id: entry.id, ownerEpoch });
            continue;
          }
          if (await ackOutbox({ id: entry.id, ownerEpoch })) delivered += 1;
        } catch {
          // A failed notification is explicitly returned to pending so a
          // later client/restart can retry without reclaiming a slow claim.
          await releaseOutbox({ id: entry.id, ownerEpoch }).catch(() => undefined);
        }
      }
      return { claimed: entries.length, delivered, pending: entries.length - delivered };
    })().finally(() => { replayInFlight = null; });
    return replayInFlight;
  }

  async function listReadyAttempts(input = {}) {
    await initialize();
    const limit = requirePageLimit(input.limit ?? MAX_HISTORY_PAGE_SIZE);
    const readyAt = Number(input.readyAt ?? now());
    if (!Number.isSafeInteger(readyAt) || readyAt < 0) throw new Error("readyAt is invalid");
    const cursorSequence = input.cursor?.sequence == null ? null : Number(input.cursor.sequence);
    const cursorId = input.cursor?.id == null ? null : requireSafeId(input.cursor.id, "admission cursor id");
    if (cursorSequence !== null && (!Number.isSafeInteger(cursorSequence) || cursorSequence < 1 || !cursorId)) {
      throw new Error("admission cursor is invalid");
    }
    const selection = `SELECT q.id AS queue_id, q.priority, q.sequence, q.enqueued_at,
              a.id AS attempt_id, a.run_id, a.task_id, a.kind, a.payload_json AS attempt_payload,
              r.payload_json AS run_payload
       FROM admission_queue q
       JOIN attempts a ON a.id = q.attempt_id AND a.run_id = q.run_id
       JOIN runs r ON r.id = q.run_id
       WHERE q.status = 'queued' AND a.status = 'ready' AND a.lease_id IS NULL
         AND r.status IN ('queued', 'running', 'checkpointing', 'backoff')`;
    const rows = cursorSequence === null
      ? requireDb().prepare(`${selection} ORDER BY q.sequence ASC, q.id ASC LIMIT ?`).all(limit + 1)
      : requireDb().prepare(`${selection} AND (q.sequence > ? OR (q.sequence = ? AND q.id > ?))
          ORDER BY q.sequence ASC, q.id ASC LIMIT ?`).all(cursorSequence, cursorSequence, cursorId, limit + 1);
    const page = rows.slice(0, limit);
    let nextNotBefore = null;
    const items = page.flatMap((row) => {
      const run = canonicalRun(parseJson(row.run_payload, `run ${row.run_id}`));
      const attempt = [...run.primaryAttempts, ...run.workerAttempts, ...(run.checkerAttempts ?? [])].find((candidate) => candidate.id === row.attempt_id)
        ?? parseJson(row.attempt_payload, `attempt ${row.attempt_id}`);
      if (attempt.notBefore !== null && attempt.notBefore > readyAt) {
        nextNotBefore = nextNotBefore === null ? attempt.notBefore : Math.min(nextNotBefore, attempt.notBefore);
        return [];
      }
      return [{
        taskId: row.task_id,
        taskRunId: row.run_id,
        attempt,
        kind: row.kind,
        priority: Number(row.priority),
        sequence: Number(row.sequence),
        enqueuedAt: Number(row.enqueued_at),
      }];
    });
    const last = page.at(-1);
    return {
      items,
      hasMore: rows.length > limit,
      nextCursor: last ? { sequence: Number(last.sequence), id: last.queue_id } : null,
      nextNotBefore,
    };
  }

  async function readAdmission(input = {}) {
    const taskRunId = requireSafeId(input.taskRunId ?? input.runId, "taskRunId");
    const attemptId = requireSafeId(input.attemptId, "attemptId");
    await initialize();
    const row = requireDb().prepare(
      `SELECT kind, priority, sequence, enqueued_at, status
       FROM admission_queue WHERE run_id = ? AND attempt_id = ?`,
    ).get(taskRunId, attemptId);
    if (!row) return null;
    return {
      taskRunId,
      attemptId,
      kind: row.kind,
      priority: Number(row.priority),
      sequence: Number(row.sequence),
      enqueuedAt: Number(row.enqueued_at),
      status: row.status,
    };
  }

  async function markAdmission(input = {}) {
    const taskRunId = requireSafeId(input.taskRunId ?? input.runId, "taskRunId");
    const attemptId = requireSafeId(input.attemptId, "attemptId");
    const status = String(input.status ?? "queued");
    if (!["queued", "admitted", "cancelled", "released"].includes(status)) throw new Error("admission status is invalid");
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const changed = connection.prepare(
        `UPDATE admission_queue SET status = ?, owner_epoch = ?, updated_at = ?
         WHERE run_id = ? AND attempt_id = ?`,
      ).run(status, supervisorEpoch, now(), taskRunId, attemptId);
      return Number(changed.changes) === 1;
    }));
  }

  function normalizeProcessRecord(input = {}) {
    const id = requireSafeId(input.id ?? input.processId, "process id");
    const status = String(input.status ?? "running");
    if (!status) throw new Error("process status is required");
    const updatedAt = Number(input.updatedAt ?? now());
    if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) throw new Error("process updatedAt is invalid");
    return {
      id,
      runId: input.runId == null ? null : requireSafeId(input.runId, "process runId"),
      attemptId: input.attemptId == null ? null : requireSafeId(input.attemptId, "process attemptId"),
      pid: input.pid == null ? null : Number(input.pid),
      status,
      updatedAt,
      ownerEpoch: String(input.ownerEpoch ?? supervisorEpoch),
      processStartToken: input.processStartToken == null ? null : String(input.processStartToken),
      payload: { ...input, id, status, updatedAt },
    };
  }

  async function upsertProcess(input = {}) {
    const record = normalizeProcessRecord(input);
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const existing = connection.prepare("SELECT status, owner_epoch FROM processes WHERE id = ?").get(record.id);
      if (existing && TERMINAL_PROCESS_STATUSES.has(String(existing.status)) && !TERMINAL_PROCESS_STATUSES.has(record.status)) {
        throw Object.assign(new Error(`Process tombstone is immutable: ${record.id}`), { code: "TASK_PROCESS_TOMBSTONE" });
      }
      connection.prepare(
        `INSERT INTO processes(id, run_id, attempt_id, pid, status, updated_at, payload_json, owner_epoch, process_start_token, tombstoned_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, attempt_id=excluded.attempt_id,
           pid=excluded.pid, status=excluded.status, updated_at=excluded.updated_at,
           payload_json=excluded.payload_json, owner_epoch=excluded.owner_epoch,
           process_start_token=excluded.process_start_token, tombstoned_at=excluded.tombstoned_at`,
      ).run(
        record.id, record.runId, record.attemptId, Number.isFinite(record.pid) ? record.pid : null,
        record.status, record.updatedAt, json(record.payload), record.ownerEpoch, record.processStartToken,
        TERMINAL_PROCESS_STATUSES.has(record.status) ? record.updatedAt : null,
      );
      return record.payload;
    }));
  }

  async function readProcess(processId) {
    const id = requireSafeId(processId, "process id");
    await initialize();
    const row = requireDb().prepare("SELECT * FROM processes WHERE id = ?").get(id);
    return row ? { ...parseJson(row.payload_json, "process payload"), id: row.id, runId: row.run_id, attemptId: row.attempt_id, pid: row.pid, status: row.status, updatedAt: Number(row.updated_at), ownerEpoch: row.owner_epoch ?? null, processStartToken: row.process_start_token ?? null, tombstonedAt: row.tombstoned_at == null ? null : Number(row.tombstoned_at) } : null;
  }

  async function listProcesses(input = {}) {
    await initialize();
    const runId = input.runId == null ? null : requireSafeId(input.runId, "runId");
    const includeTerminal = input.includeTerminal !== false;
    const predicates = [];
    const params = [];
    if (runId) {
      predicates.push("run_id = ?");
      params.push(runId);
    }
    if (!includeTerminal) predicates.push("status NOT IN ('exited','failed','cancelled','stopped','terminated','tombstoned','stale')");
    const rows = requireDb().prepare(
      `SELECT * FROM processes ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC`,
    ).all(...params);
    return rows.map((row) => ({ ...parseJson(row.payload_json, "process payload"), id: row.id, runId: row.run_id, attemptId: row.attempt_id, pid: row.pid, status: row.status, updatedAt: Number(row.updated_at), ownerEpoch: row.owner_epoch ?? null, processStartToken: row.process_start_token ?? null, tombstonedAt: row.tombstoned_at == null ? null : Number(row.tombstoned_at) }));
  }

  /**
   * Bounded process/storage aggregate for high-frequency diagnostics.  This
   * intentionally never selects process payloads; callers only receive
   * grouped state counts and a bounded PID projection.
   */
  async function diagnosticsAggregate(input = {}) {
    await initialize();
    const runId = input.runId == null ? null : requireSafeId(input.runId, "runId");
    const aggregate = await serialized(() => taskCenterDiagnosticsAggregate(requireDb(), {
      runId,
      pidLimit: input.pidLimit,
      stateLimit: input.stateLimit,
      dbPath,
      fileSize: statSync,
    }));
    return {
      ...aggregate,
      processes: taskOrchestratorDiagnosticsProcessAggregateSchema.parse(aggregate.processes),
    };
  }

  /**
   * Cached, integrity-check-free store health for active diagnostics polling.
   * The full `health()` method remains the explicit quick_check boundary.
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
    const maintenanceRow = requireDb().prepare("SELECT value FROM metadata WHERE key = 'last_maintenance'").get();
    const lastMaintenance = maintenanceRow ? parseJson(maintenanceRow.value, "last maintenance metrics") : null;
    const value = taskOrchestratorDiagnosticsHealthResultSchema.parse({
      observed: true,
      observedAt,
      stale: false,
      // This is an availability check, not an integrity claim.  A full
      // PRAGMA quick_check is still reserved for `health()`/maintenance.
      healthy: storageFailure === null,
      rows: aggregate.rows,
      storage: aggregate.storage,
      processes: aggregate.processes,
      lastMaintenance,
    });
    diagnosticsHealthCache = value;
    return value;
  }

  async function tombstoneProcess(input = {}) {
    const id = requireSafeId(input.id ?? input.processId, "process id");
    const status = String(input.status ?? "exited");
    if (!TERMINAL_PROCESS_STATUSES.has(status)) throw new Error("process tombstone status is invalid");
    const current = await readProcess(id);
    if (!current) return false;
    return upsertProcess({ ...current, ...input, id, status, pid: input.keepPid === false ? null : current.pid, tombstonedAt: now() }).then(() => true);
  }

  async function sweepStaleProcesses(input = {}) {
    const ownerEpoch = String(input.ownerEpoch ?? supervisorEpoch);
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const rows = connection.prepare("SELECT id, payload_json FROM processes WHERE status IN ('starting','running','stopping') AND (owner_epoch IS NULL OR owner_epoch <> ?)").all(ownerEpoch);
      for (const row of rows) {
        const payload = parseJson(row.payload_json, "process payload");
        connection.prepare("UPDATE processes SET status = 'stale', owner_epoch = ?, updated_at = ?, tombstoned_at = ?, payload_json = ? WHERE id = ?").run(ownerEpoch, now(), now(), json({ ...payload, status: "stale", staleReason: "supervisor_epoch_changed" }), row.id);
      }
      return rows.length;
    }));
  }

  async function isLeaseCurrent(input = {}) {
    const runId = requireSafeId(input.taskRunId ?? input.runId, "taskRunId");
    const attemptId = requireSafeId(input.attemptId, "attemptId");
    const leaseId = requireSafeId(input.leaseId, "leaseId");
    const epoch = String(input.supervisorEpoch ?? input.ownerEpoch ?? supervisorEpoch);
    await initialize();
    const row = requireDb().prepare(
      `SELECT 1 FROM leases WHERE id = ? AND run_id = ? AND attempt_id = ? AND status = 'active' AND epoch = ? LIMIT 1`,
    ).get(leaseId, runId, attemptId, epoch);
    return Boolean(row);
  }

  async function revokeLease(input = {}) {
    const leaseId = requireSafeId(input.leaseId, "leaseId");
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const changed = connection.prepare(
        "UPDATE leases SET status = 'revoked' WHERE id = ? AND status = 'active'",
      ).run(leaseId);
      return Number(changed.changes) === 1;
    }));
  }

  async function health() {
    await initialize();
    const connection = requireDb();
    const pragmas = configureTaskCenterDatabase(connection);
    const quickCheck = taskCenterQuickCheck(connection);
    const maintenanceRow = connection.prepare("SELECT value FROM metadata WHERE key = 'last_maintenance'").get();
    return taskOrchestratorStoreHealthResultSchema.parse({
      dbPath,
      corruptionMarkerPath: sqliteCorruptionMarkerPath(dbPath),
      pragmas,
      quickCheck,
      healthy: quickCheck.length === 1 && quickCheck[0].toLowerCase() === "ok",
      rows: taskCenterRowCounts(connection),
      storage: storageMetrics(connection),
      maintenancePolicy: normalizeTaskCenterMaintenancePolicy(),
      lastMaintenance: maintenanceRow ? parseJson(maintenanceRow.value, "last maintenance metrics") : null,
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
        fileSize: (target) => statSync(target).size,
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
        ).run(json(result), timestamp);
      });
      return taskOrchestratorMaintenanceResultSchema.parse(result);
    });
  }

  async function claimRpcRequest(input = {}) {
    const idempotencyKey = requireRequestKey(input.idempotencyKey);
    const requestDigest = requireDigest(input.requestDigest);
    const ownerEpoch = requireRequestKey(input.ownerEpoch, "ownerEpoch");
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const existing = connection.prepare("SELECT * FROM rpc_requests WHERE idempotency_key = ?").get(idempotencyKey);
      if (!existing) {
        connection.prepare(
          `INSERT INTO rpc_requests(idempotency_key, request_digest, owner_epoch, status, started_at)
           VALUES(?, ?, ?, 'processing', ?)`,
        ).run(idempotencyKey, requestDigest, ownerEpoch, now());
        return { state: "claimed" };
      }
      if (existing.request_digest !== requestDigest) {
        throw Object.assign(new Error("Supervisor idempotency key was reused for a different request"), { code: "SUPERVISOR_IDEMPOTENCY_CONFLICT" });
      }
      if (existing.status === "completed") {
        return { state: "completed", result: parseJson(existing.result_json ?? "null", "Supervisor request result") };
      }
      if (existing.status === "failed") {
        return { state: "failed", error: parseJson(existing.error_json ?? "{}", "Supervisor request error") };
      }
      if (existing.status === "processing" && existing.owner_epoch === ownerEpoch) return { state: "processing" };
      connection.prepare(
        "UPDATE rpc_requests SET status = 'unknown', finished_at = ?, error_json = ? WHERE idempotency_key = ?",
      ).run(
        now(),
        json({ code: "SUPERVISOR_REQUEST_OUTCOME_UNKNOWN", message: "The previous Supervisor stopped before it durably recorded the request outcome" }),
        idempotencyKey,
      );
      return { state: "unknown" };
    }));
  }

  async function completeRpcRequest(input = {}) {
    const idempotencyKey = requireRequestKey(input.idempotencyKey);
    const requestDigest = requireDigest(input.requestDigest);
    const ownerEpoch = requireRequestKey(input.ownerEpoch, "ownerEpoch");
    const resultJson = json(input.result ?? null);
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const changed = connection.prepare(
        `UPDATE rpc_requests SET status = 'completed', finished_at = ?, result_json = ?, error_json = NULL
         WHERE idempotency_key = ? AND request_digest = ? AND owner_epoch = ? AND status = 'processing'`,
      ).run(now(), resultJson, idempotencyKey, requestDigest, ownerEpoch);
      if (Number(changed.changes) !== 1) throw new Error("Supervisor request completion lost its durable claim");
      return { ok: true };
    }));
  }

  async function failRpcRequest(input = {}) {
    const idempotencyKey = requireRequestKey(input.idempotencyKey);
    const requestDigest = requireDigest(input.requestDigest);
    const ownerEpoch = requireRequestKey(input.ownerEpoch, "ownerEpoch");
    const error = {
      code: redactSensitiveText(input.error?.code ?? "SUPERVISOR_REQUEST_FAILED", 160),
      message: redactSensitiveText(input.error?.message ?? input.error ?? "Task Supervisor request failed", 4_000),
    };
    await initialize();
    return serialized(() => withTransaction((connection) => {
      const changed = connection.prepare(
        `UPDATE rpc_requests SET status = 'failed', finished_at = ?, result_json = NULL, error_json = ?
         WHERE idempotency_key = ? AND request_digest = ? AND owner_epoch = ? AND status = 'processing'`,
      ).run(now(), json(error), idempotencyKey, requestDigest, ownerEpoch);
      if (Number(changed.changes) !== 1) throw new Error("Supervisor request failure lost its durable claim");
      return { ok: true };
    }));
  }

  async function close() {
    await replayInFlight?.catch(() => undefined);
    await mutationTail;
    if (db && !closed) db.close();
    closed = true;
    initialized = false;
  }

  const api = {
    rootDirectory,
    dbPath,
    legacyRootDirectory,
    initialize,
    readTask,
    isLegacyTask,
    requireTask,
    writeTask,
    archiveTask,
    restoreTask,
    purgeTask,
    readRun,
    requireRun,
    writeRun,
    commitApprovalFence,
    runsForTask,
    listRuns,
    listTurnHistory,
    reconcileLatestRunPointer,
    reconcileLatestRunPointers,
    readEvents,
    listEvents,
    appendEvent,
    nextEventSequence,
    writeArtifact,
    readArtifacts,
    latestArtifactCreatedAt,
    listArtifacts,
    getArtifact,
    getArtifactContent,
    exportTaskManifest,
    writeGate,
    readGates,
    snapshot,
    listTasks,
    findRun,
    allRuns,
    listReadyAttempts,
    readAdmission,
    listOutbox,
    claimOutbox,
    ackOutbox,
    releaseOutbox,
    replayOutbox,
    drainOutbox: replayOutbox,
    markAdmission,
    isLeaseCurrent,
    revokeLease,
    upsertProcess,
    readProcess,
    listProcesses,
    diagnosticsAggregate,
    diagnosticsHealth,
    tombstoneProcess,
    sweepStaleProcesses,
    withTransaction,
    transaction: withTransaction,
    // Public async writer gate for migrations/secondary durable components;
    // all normal CRUD methods already use this queue internally.
    serializedTransaction: async (operation) => { await initialize(); return serialized(() => withTransaction(operation)); },
    quickCheck: async () => { await initialize(); return ensureQuickCheck(); },
    schemaVersion,
    migrationHistory,
    health,
    runMaintenance,
    claimRpcRequest,
    completeRpcRequest,
    failRpcRequest,
    migrationMarker: async () => { await initialize(); return migrationMarker(); },
    migrationIssues: async () => { await initialize(); return migrationIssues(); },
    close,
    // Importer-only hooks are kept on the store boundary so no other runtime
    // can write the supervisor tables directly.
    _database: () => requireDb(),
    _serializedTransaction: (operation) => serialized(() => withTransaction(operation)),
    _legacyMarkerId: LEGACY_MARKER_ID,
    supervisorEpoch,
    get storageFailure() { return storageFailure; },
  };

  return api;
}

export const createSqliteTaskOrchestratorStore = createTaskOrchestratorSqliteStore;
export const createTaskCenterSqliteStore = createTaskOrchestratorSqliteStore;
