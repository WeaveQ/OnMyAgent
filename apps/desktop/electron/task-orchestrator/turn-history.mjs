import {
  TASK_ORCHESTRATOR_TURN_HISTORY_BYTE_BUDGET,
  TASK_ORCHESTRATOR_TURN_HISTORY_VERSION,
  taskOrchestratorCheckerAttemptSchema,
  taskOrchestratorCheckpointSchema,
  taskOrchestratorContinuationCapsuleSchema,
  taskOrchestratorPrimaryDecisionSchema,
  taskOrchestratorTurnHistoryAttemptSchema,
  taskOrchestratorTurnHistoryCapsuleSchema,
  taskOrchestratorTurnHistoryCheckerAttemptSchema,
  taskOrchestratorTurnHistoryItemSchema,
  taskOrchestratorTurnHistoryListResultSchema,
  taskOrchestratorTurnSchema,
  taskOrchestratorAttemptSchema,
} from "@onmyagent/types/task-orchestrator";

import { redactSensitiveText } from "./durable-redaction.mjs";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const CURSOR_VERSION = 1;
const CAPSULE_LIST_LIMIT = 20;
const CAPSULE_WORKER_LIMIT = 50;
const HISTORY_TEXT_BYTES = 1_000;

function requireSafeId(value, label) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 120 || !SAFE_ID.test(id)) throw new Error(`${label} is invalid`);
  return id;
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

function safeRequiredText(value, maxBytes, fallback) {
  const redacted = truncateUtf8(redactSensitiveText(value, Math.max(maxBytes * 4, maxBytes)), maxBytes).trim();
  return redacted || fallback;
}

function safeNullableText(value, maxBytes) {
  if (value === null || value === undefined) return null;
  const redacted = truncateUtf8(redactSensitiveText(value, Math.max(maxBytes * 4, maxBytes)), maxBytes).trim();
  return redacted || null;
}

export function encodeTurnHistoryCursor(sequence, id) {
  const normalizedSequence = Number(sequence);
  if (!Number.isInteger(normalizedSequence) || normalizedSequence < 1) throw new Error("turn history cursor sequence is invalid");
  const normalizedId = requireSafeId(id, "turn history cursor id");
  return Buffer.from(JSON.stringify([CURSOR_VERSION, normalizedSequence, normalizedId]), "utf8").toString("base64url");
}

export function decodeTurnHistoryCursor(value) {
  if (value === null || value === undefined || value === "") return null;
  const cursor = String(value).trim();
  if (!cursor || cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("turn history cursor is invalid");
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("turn history cursor is invalid");
  }
  if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== CURSOR_VERSION) throw new Error("turn history cursor is invalid");
  const sequence = Number(parsed[1]);
  const id = requireSafeId(parsed[2], "turn history cursor id");
  if (!Number.isInteger(sequence) || sequence < 1 || encodeTurnHistoryCursor(sequence, id) !== cursor) {
    throw new Error("turn history cursor is invalid");
  }
  return { sequence, id };
}

function safeDiagnostics(value) {
  if (!value) return null;
  return {
    providerSessionId: safeNullableText(value.providerSessionId, 240),
    effectiveModel: safeNullableText(value.effectiveModel, 240),
    transport: safeNullableText(value.transport, 120),
    connectionMode: safeNullableText(value.connectionMode, 240),
  };
}

function safeAttempt(value, checker = false) {
  const parsed = checker
    ? taskOrchestratorCheckerAttemptSchema.parse(value)
    : taskOrchestratorAttemptSchema.parse(value);
  // `notBefore` is an internal durable admission fence. Like the prompt, it
  // is not part of the public immutable history projection.
  const { prompt: _prompt, notBefore: _notBefore, ...attempt } = parsed;
  const safe = {
    ...attempt,
    providerDiagnostics: safeDiagnostics(attempt.providerDiagnostics),
    error: safeNullableText(attempt.error, HISTORY_TEXT_BYTES),
  };
  return checker
    ? taskOrchestratorTurnHistoryCheckerAttemptSchema.parse(safe)
    : taskOrchestratorTurnHistoryAttemptSchema.parse(safe);
}

function safeDecision(value) {
  if (!value) return null;
  const decision = taskOrchestratorPrimaryDecisionSchema.parse(value);
  return taskOrchestratorPrimaryDecisionSchema.parse({
    ...decision,
    summary: safeRequiredText(decision.summary, HISTORY_TEXT_BYTES, "Primary task decision"),
    nextAction: safeNullableText(decision.nextAction, HISTORY_TEXT_BYTES),
    acceptanceResults: decision.acceptanceResults.map((result) => ({
      ...result,
      summary: safeRequiredText(result.summary, HISTORY_TEXT_BYTES, "Acceptance result"),
    })),
  });
}

function compactTextList(values, limit, fallback) {
  return values.slice(0, limit).map((value) => safeRequiredText(value, HISTORY_TEXT_BYTES, fallback));
}

function omittedCount(values, limit) {
  return Math.max(0, values.length - Math.min(values.length, limit));
}

function textWasTruncated(original, safe) {
  return String(original ?? "") !== String(safe ?? "");
}

export function compactTurnHistoryCapsule(value) {
  if (!value) return null;
  const capsule = taskOrchestratorContinuationCapsuleSchema.parse(value);
  const summary = safeRequiredText(capsule.summary, 4_000, "Continue from the durable checkpoint.");
  const nextAction = safeNullableText(capsule.nextAction, 2_000);
  const completed = compactTextList(capsule.completed, CAPSULE_LIST_LIMIT, "Completed task work");
  const pending = compactTextList(capsule.pending, CAPSULE_LIST_LIMIT, "Pending task work");
  const risks = compactTextList(capsule.risks, CAPSULE_LIST_LIMIT, "Known task risk");
  const acceptanceResults = capsule.acceptanceResults.slice(0, CAPSULE_LIST_LIMIT).map((result) => ({
    ...result,
    summary: safeRequiredText(result.summary, HISTORY_TEXT_BYTES, "Acceptance result"),
  }));
  const workerMail = capsule.workerMail.slice(0, CAPSULE_WORKER_LIMIT).map((mail) => ({
    ...mail,
    summary: safeRequiredText(mail.summary, HISTORY_TEXT_BYTES, "Worker result"),
  }));
  const omitted = {
    completed: omittedCount(capsule.completed, CAPSULE_LIST_LIMIT),
    pending: omittedCount(capsule.pending, CAPSULE_LIST_LIMIT),
    risks: omittedCount(capsule.risks, CAPSULE_LIST_LIMIT),
    artifactIds: 0,
    workspaceEvidence: 0,
    acceptanceResults: omittedCount(capsule.acceptanceResults, CAPSULE_LIST_LIMIT),
    workerMail: omittedCount(capsule.workerMail, CAPSULE_WORKER_LIMIT),
    unresolvedSideEffects: 0,
  };
  const textFieldsTruncated = [
    [capsule.summary, summary],
    [capsule.nextAction, nextAction],
    ...capsule.completed.slice(0, CAPSULE_LIST_LIMIT).map((item, index) => [item, completed[index]]),
    ...capsule.pending.slice(0, CAPSULE_LIST_LIMIT).map((item, index) => [item, pending[index]]),
    ...capsule.risks.slice(0, CAPSULE_LIST_LIMIT).map((item, index) => [item, risks[index]]),
    ...capsule.acceptanceResults.slice(0, CAPSULE_LIST_LIMIT).map((item, index) => [item.summary, acceptanceResults[index]?.summary]),
    ...capsule.workerMail.slice(0, CAPSULE_WORKER_LIMIT).map((item, index) => [item.summary, workerMail[index]?.summary]),
  ].filter(([original, safe]) => textWasTruncated(original, safe)).length;
  return taskOrchestratorTurnHistoryCapsuleSchema.parse({
    ...capsule,
    summary,
    completed,
    pending,
    risks,
    acceptanceResults,
    workerMail,
    nextAction,
    truncation: {
      truncated: textFieldsTruncated > 0 || Object.values(omitted).some((count) => count > 0),
      textFieldsTruncated,
      omitted,
    },
  });
}

function indexById(values) {
  return new Map(values.map((value) => [value.id, value]));
}

export function createTurnHistoryItem({
  taskId,
  taskRunId,
  turn,
  attempts = [],
  checkerAttempts = [],
  decisions = [],
  checkpoints = [],
  capsules = [],
}) {
  const normalizedTaskId = requireSafeId(taskId, "taskId");
  const normalizedRunId = requireSafeId(taskRunId, "taskRunId");
  const parsedTurn = taskOrchestratorTurnSchema.parse(turn);
  const attemptMap = indexById(attempts);
  const primary = attemptMap.get(parsedTurn.primaryAttemptId);
  if (!primary) throw new Error(`Turn history is corrupt: primary attempt ${parsedTurn.primaryAttemptId} is missing`);
  const workers = parsedTurn.workerAttemptIds.map((id) => {
    const worker = attemptMap.get(id);
    if (!worker) throw new Error(`Turn history is corrupt: worker attempt ${id} is missing`);
    return safeAttempt(worker);
  });
  const matchingCheckerAttempts = checkerAttempts
    .filter((attempt) => attempt?.turnId === parsedTurn.id)
    .sort((left, right) => Number(left.round) - Number(right.round) || String(left.id).localeCompare(String(right.id)))
    .map((attempt) => safeAttempt(attempt, true));
  const decision = parsedTurn.decisionId === null ? null : indexById(decisions).get(parsedTurn.decisionId) ?? null;
  const checkpoint = parsedTurn.checkpointId === null ? null : indexById(checkpoints).get(parsedTurn.checkpointId) ?? null;
  const capsule = parsedTurn.capsuleId === null ? null : indexById(capsules).get(parsedTurn.capsuleId) ?? null;
  if (parsedTurn.decisionId && !decision) throw new Error(`Turn history is corrupt: decision ${parsedTurn.decisionId} is missing`);
  if (parsedTurn.checkpointId && !checkpoint) throw new Error(`Turn history is corrupt: checkpoint ${parsedTurn.checkpointId} is missing`);
  if (parsedTurn.capsuleId && !capsule) throw new Error(`Turn history is corrupt: capsule ${parsedTurn.capsuleId} is missing`);
  return taskOrchestratorTurnHistoryItemSchema.parse({
    historyVersion: TASK_ORCHESTRATOR_TURN_HISTORY_VERSION,
    taskId: normalizedTaskId,
    taskRunId: normalizedRunId,
    turn: parsedTurn,
    primaryAttempt: safeAttempt(primary),
    workerAttempts: workers,
    checkerAttempts: matchingCheckerAttempts,
    decision: safeDecision(decision),
    checkpoint: checkpoint ? taskOrchestratorCheckpointSchema.parse(checkpoint) : null,
    capsule: compactTurnHistoryCapsule(capsule),
  });
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function withStableSerializedBytes(result) {
  let value = { ...result, serializedBytes: 0 };
  for (let index = 0; index < 4; index += 1) {
    const bytes = serializedBytes(value);
    if (bytes === value.serializedBytes) return value;
    value = { ...value, serializedBytes: bytes };
  }
  return value;
}

/**
 * Fit complete turn items into one Supervisor-safe page. An item is never
 * split across cursors: callers either receive its complete safe projection or
 * a deterministic error if the projection itself exceeds the byte budget.
 */
export function createTurnHistoryPage({
  taskId,
  taskRunId,
  entries,
  requestedLimit,
  priorCursor = null,
  sourceHasMore = false,
}) {
  const normalizedTaskId = requireSafeId(taskId, "taskId");
  const normalizedRunId = requireSafeId(taskRunId, "taskRunId");
  const limit = Number(requestedLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be an integer between 1 and 200");
  const selected = [];
  let hasMore = sourceHasMore || entries.length > limit;
  for (const entry of entries.slice(0, limit)) {
    const candidate = [...selected, entry];
    const provisional = withStableSerializedBytes({
      historyVersion: TASK_ORCHESTRATOR_TURN_HISTORY_VERSION,
      taskId: normalizedTaskId,
      taskRunId: normalizedRunId,
      items: candidate.map((item) => item.item),
      nextCursor: encodeTurnHistoryCursor(entry.sequence, entry.id),
      // Measure conservatively: the final page may need a continuation even
      // when the source query itself fit the requested item count.
      hasMore: true,
      byteBudget: TASK_ORCHESTRATOR_TURN_HISTORY_BYTE_BUDGET,
    });
    if (provisional.serializedBytes <= TASK_ORCHESTRATOR_TURN_HISTORY_BYTE_BUDGET) {
      selected.push(entry);
      continue;
    }
    hasMore = true;
    if (selected.length === 0) {
      throw Object.assign(
        new Error(`Turn history item ${entry.id} exceeds the bounded Supervisor response`),
        { code: "TASK_TURN_HISTORY_ITEM_TOO_LARGE" },
      );
    }
    break;
  }
  if (selected.length < Math.min(entries.length, limit)) hasMore = true;
  const result = withStableSerializedBytes({
    historyVersion: TASK_ORCHESTRATOR_TURN_HISTORY_VERSION,
    taskId: normalizedTaskId,
    taskRunId: normalizedRunId,
    items: selected.map((entry) => entry.item),
    nextCursor: selected.length
      ? encodeTurnHistoryCursor(selected.at(-1).sequence, selected.at(-1).id)
      : priorCursor,
    hasMore,
    byteBudget: TASK_ORCHESTRATOR_TURN_HISTORY_BYTE_BUDGET,
  });
  if (result.serializedBytes > TASK_ORCHESTRATOR_TURN_HISTORY_BYTE_BUDGET) {
    throw new Error("Turn history page exceeded the bounded Supervisor response budget");
  }
  return taskOrchestratorTurnHistoryListResultSchema.parse(result);
}
