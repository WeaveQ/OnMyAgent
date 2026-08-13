import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TASK_ORCHESTRATOR_TURN_HISTORY_BYTE_BUDGET,
  taskOrchestratorTurnHistoryListResultSchema,
} from "@onmyagent/types/task-orchestrator";

import {
  createTurnHistoryItem,
  createTurnHistoryPage,
  decodeTurnHistoryCursor,
  encodeTurnHistoryCursor,
} from "./turn-history.mjs";

function attempt(id, kind, turnId, parentAttemptId = null) {
  return {
    id,
    kind,
    profileId: `${kind}-profile`,
    parentAttemptId,
    turnId,
    depth: kind === "primary" ? 0 : 1,
    status: "succeeded",
    leaseId: null,
    personalRunId: `personal-${id}`,
    conversationId: `conversation-${id}`,
    providerDiagnostics: {
      providerSessionId: `provider-${id}`,
      effectiveModel: "safe-model",
      transport: "stdio",
      connectionMode: "ACP",
    },
    providerUsage: null,
    prompt: "authorization: bearer must-not-cross-history",
    outputArtifactIds: [],
    timeoutMs: 60_000,
    startedAt: 10,
    updatedAt: 20,
    finishedAt: 20,
    error: "token=must-not-cross-history",
  };
}

function checkerAttempt(turnId, decisionId) {
  return {
    id: "checker-1",
    profileId: "checker-profile",
    turnId,
    primaryDecisionId: decisionId,
    round: 1,
    status: "succeeded",
    leaseId: null,
    personalRunId: "personal-checker",
    conversationId: "conversation-checker",
    providerDiagnostics: null,
    providerUsage: null,
    prompt: "password=must-not-cross-history",
    outputArtifactIds: [],
    timeoutMs: 60_000,
    startedAt: 20,
    updatedAt: 30,
    finishedAt: 30,
    error: null,
  };
}

function fixture() {
  const turn = {
    id: "turn-2",
    sequence: 2,
    status: "succeeded",
    reason: "primary-checkpoint",
    primaryAttemptId: "primary-2",
    workerAttemptIds: ["worker-2"],
    decisionId: "decision-2",
    checkpointId: "checkpoint-2",
    capsuleId: "capsule-2",
    context: null,
    startedAt: 10,
    updatedAt: 30,
    finishedAt: 30,
  };
  const decision = {
    id: "decision-2",
    attemptId: "primary-2",
    turnId: turn.id,
    kind: "checkpoint",
    summary: "password=must-not-cross-history",
    nextAction: "Continue verification.",
    acceptanceResults: [],
    createdAt: 20,
  };
  const checkpoint = {
    id: "checkpoint-2",
    turnId: turn.id,
    capsuleId: "capsule-2",
    trigger: "primary-decision",
    createdAt: 25,
  };
  const capsule = {
    capsuleVersion: 1,
    id: "capsule-2",
    fromTurnId: turn.id,
    taskId: "task-1",
    taskRunId: "run-1",
    taskRevision: 1,
    contractHash: "a".repeat(64),
    workspaceRootHash: "b".repeat(64),
    summary: "api_key=must-not-cross-history",
    completed: Array.from({ length: 25 }, (_, index) => `completed ${index}`),
    pending: ["pending"],
    risks: ["secret=must-not-cross-history"],
    artifactIds: [],
    workspaceEvidence: [],
    acceptanceResults: [],
    workerMail: [],
    remainingBudget: null,
    unresolvedSideEffects: [],
    nextAction: "Continue verification.",
    lastDecisionId: decision.id,
    context: null,
    createdAt: 25,
  };
  return {
    turn,
    attempts: [attempt("primary-2", "primary", turn.id), attempt("worker-2", "worker", turn.id, "primary-2")],
    checkerAttempts: [checkerAttempt(turn.id, decision.id)],
    decisions: [decision],
    checkpoints: [checkpoint],
    capsules: [capsule],
  };
}

describe("Task Center immutable turn history projection", () => {
  it("returns linked safe records without prompts, raw logs, or secrets", () => {
    const item = createTurnHistoryItem({ taskId: "task-1", taskRunId: "run-1", ...fixture() });
    assert.equal(item.primaryAttempt.id, "primary-2");
    assert.deepEqual(item.workerAttempts.map((entry) => entry.id), ["worker-2"]);
    assert.deepEqual(item.checkerAttempts.map((entry) => entry.id), ["checker-1"]);
    assert.equal(item.decision.id, "decision-2");
    assert.equal(item.checkpoint.id, "checkpoint-2");
    assert.equal(item.capsule.id, "capsule-2");
    assert.equal(item.capsule.completed.length, 20);
    assert.equal(item.capsule.truncation.omitted.completed, 5);
    assert.equal(item.capsule.truncation.truncated, true);
    const serialized = JSON.stringify(item);
    assert.doesNotMatch(serialized, /prompt/i);
    assert.doesNotMatch(serialized, /must-not-cross-history/);
    assert.match(serialized, /\[REDACTED\]/);
  });

  it("uses a canonical opaque sequence/id keyset cursor", () => {
    const cursor = encodeTurnHistoryCursor(12, "turn-12");
    assert.deepEqual(decodeTurnHistoryCursor(cursor), { sequence: 12, id: "turn-12" });
    assert.throws(() => decodeTurnHistoryCursor(`${cursor}x`), /cursor is invalid/);
    assert.throws(() => decodeTurnHistoryCursor("not/base64"), /cursor is invalid/);
  });

  it("keeps complete items inside the Supervisor byte budget", () => {
    const item = createTurnHistoryItem({ taskId: "task-1", taskRunId: "run-1", ...fixture() });
    const page = createTurnHistoryPage({
      taskId: "task-1",
      taskRunId: "run-1",
      entries: [{ id: item.turn.id, sequence: item.turn.sequence, item }],
      requestedLimit: 1,
    });
    assert.deepEqual(taskOrchestratorTurnHistoryListResultSchema.parse(page), page);
    assert.equal(page.items.length, 1);
    assert.equal(page.hasMore, false);
    assert.ok(page.serializedBytes <= TASK_ORCHESTRATOR_TURN_HISTORY_BYTE_BUDGET);
    assert.equal(Buffer.byteLength(JSON.stringify(page), "utf8"), page.serializedBytes);
  });

  it("fails closed when a referenced immutable record is missing", () => {
    const value = fixture();
    assert.throws(
      () => createTurnHistoryItem({ taskId: "task-1", taskRunId: "run-1", ...value, decisions: [] }),
      /decision decision-2 is missing/,
    );
  });
});
