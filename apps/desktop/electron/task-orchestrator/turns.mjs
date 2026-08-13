import { createHash } from "node:crypto";

import { redactSensitiveText } from "./durable-redaction.mjs";

function cleanText(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function remainingBudget(run) {
  const limits = run.definition.endConditions;
  const budget = run.budget;
  if (!budget) return null;
  const remaining = (limit, used) => Math.max(0, limit - used);
  const elapsedLimit = limits.maxElapsedMs;
  const tokenLimit = limits.maxTokens;
  const costLimit = limits.maxCostMicros;
  return {
    primaryTurns: remaining(limits.maxPrimaryTurns, budget.primaryTurnsUsed),
    workerAttempts: remaining(limits.maxWorkerAttempts, budget.workerAttemptsUsed),
    elapsedMs: elapsedLimit === null ? null : remaining(elapsedLimit, budget.elapsedMs),
    tokens: tokenLimit === null || budget.tokensUsed === null ? null : remaining(tokenLimit, budget.tokensUsed),
    costMicros: costLimit === null || budget.costMicrosUsed === null ? null : remaining(costLimit, budget.costMicrosUsed),
    deadlineAt: limits.deadlineAt,
  };
}

function workerMail(run, turn) {
  const ids = new Set(turn.workerAttemptIds);
  return run.workerAttempts
    .filter((attempt) => ids.has(attempt.id))
    .map((attempt) => ({
      attemptId: attempt.id,
      profileId: attempt.profileId,
      status: attempt.status,
      summary: cleanText(attempt.error || (attempt.outputArtifactIds.length ? "Worker produced durable artifacts." : "Worker returned without a durable artifact."), 2_000),
      artifactIds: attempt.outputArtifactIds.slice(0, 50),
    }))
    .slice(0, 100);
}

function capsuleIdentity(run) {
  return {
    capsuleVersion: 1,
    taskId: run.taskId,
    taskRunId: run.id,
    taskRevision: run.taskRevision,
    contractHash: run.permissionGrant?.contractHash ?? sha256(stableJson(run.definition.contract)),
    workspaceRootHash: sha256(run.definition.workspaceRoot),
  };
}

export function assertContinuationCapsuleIdentity(run, capsule) {
  const expected = capsuleIdentity(run);
  const actual = {
    taskId: capsule?.taskId ?? null,
    taskRunId: capsule?.taskRunId ?? null,
    taskRevision: capsule?.taskRevision ?? null,
    contractHash: capsule?.contractHash ?? null,
    workspaceRootHash: capsule?.workspaceRootHash ?? null,
  };
  const missing = Object.values(actual).some((value) => value === null);
  if (missing && run.definition.executionProtocol !== "structured-decisions-v1") return true;
  if (missing || Object.keys(actual).some((key) => actual[key] !== expected[key])) {
    throw Object.assign(new Error("Continuation capsule does not match the frozen task identity"), {
      code: "TASK_CONTINUATION_IDENTITY_MISMATCH",
    });
  }
  return true;
}

function artifactEvidenceItem(artifact) {
  return {
      artifactId: artifact.id,
      attemptId: artifact.attemptId,
      kind: cleanText(artifact.kind, 80) || "artifact",
      evidenceCount: Array.isArray(artifact.evidence) ? artifact.evidence.length : 0,
      summary: redactSensitiveText(artifact.summary, 240).trim(),
      contentExcerpt: redactSensitiveText(artifact.content, 2_000).trim(),
      evidenceLabels: (Array.isArray(artifact.evidence) ? artifact.evidence : [])
        .slice(-8)
        .map((item) => redactSensitiveText(item?.label, 240).trim())
        .filter(Boolean),
    };
}

function workspaceEvidence(artifacts, turnAttemptIds) {
  return artifacts
    .filter((artifact) => turnAttemptIds.has(artifact.attemptId))
    .slice(-4)
    .map(artifactEvidenceItem)
    .slice(0, 4);
}

export function hydrateContinuationCapsuleEvidence(capsule, artifacts) {
  const artifactById = new Map((Array.isArray(artifacts) ? artifacts : []).map((artifact) => [artifact.id, artifact]));
  const hydrated = [];
  const seen = new Set();
  for (const item of Array.isArray(capsule?.workspaceEvidence) ? capsule.workspaceEvidence : []) {
    const artifact = artifactById.get(item.artifactId);
    hydrated.push(artifact && (!item.summary || !item.contentExcerpt)
      ? { ...item, ...artifactEvidenceItem(artifact) }
      : item);
    seen.add(item.artifactId);
  }
  // Legacy retries may have no checkpoint evidence at all. Include the most
  // recent committed artifacts so a fresh provider session can continue from
  // durable work instead of rescanning the repositories from scratch.
  for (const artifact of (Array.isArray(artifacts) ? artifacts : []).slice(-4)) {
    if (seen.has(artifact.id)) continue;
    hydrated.push(artifactEvidenceItem(artifact));
    seen.add(artifact.id);
  }
  return { ...capsule, workspaceEvidence: hydrated.slice(-4) };
}

function cumulativeWorkspaceEvidence(run, artifacts, turnAttemptIds) {
  const previous = run.continuationCapsules?.at(-1) ?? null;
  const inherited = previous
    ? hydrateContinuationCapsuleEvidence(previous, artifacts).workspaceEvidence
    : [];
  const current = workspaceEvidence(artifacts, turnAttemptIds);
  const merged = new Map();
  for (const item of [...inherited, ...current]) {
    const prior = merged.get(item.artifactId);
    merged.set(item.artifactId, prior
      ? {
          ...prior,
          ...item,
          summary: item.summary || prior.summary,
          contentExcerpt: item.contentExcerpt || prior.contentExcerpt,
          evidenceLabels: item.evidenceLabels?.length ? item.evidenceLabels : prior.evidenceLabels,
        }
      : item);
  }
  return [...merged.values()].slice(-4);
}

function cumulativeArtifactIds(run, currentIds) {
  const previous = run.continuationCapsules?.at(-1)?.artifactIds ?? [];
  return [...new Set([...previous, ...currentIds])].slice(-100);
}

function unresolvedSideEffects(run) {
  return (run.sideEffects ?? [])
    .filter((effect) => effect.receiptStatus === "unknown")
    .map((effect) => ({
      id: effect.id,
      operation: cleanText(effect.operation, 240),
      idempotency: effect.idempotency,
      receiptStatus: effect.receiptStatus,
    }))
    .slice(0, 100);
}

function latestContextMessage(snapshot) {
  const messages = Array.isArray(snapshot?.conversationMessages) ? snapshot.conversationMessages : [];
  return [...messages].reverse().find((message) => message?.contextUsage) ?? null;
}

export function contextUsageFromSnapshot(snapshot, now, modelId = null) {
  const usage = latestContextMessage(snapshot)?.contextUsage;
  if (!usage) return null;
  const used = Number(usage.used);
  const total = Number(usage.total);
  const usedTokens = Number.isFinite(used) && used >= 0 ? Math.round(used) : null;
  const totalTokens = Number.isFinite(total) && total > 0 ? Math.round(total) : null;
  const percent = usedTokens !== null && totalTokens !== null
    ? Math.min(100, Math.max(0, (usedTokens / totalTokens) * 100))
    : null;
  const rawSource = String(usage.totalSource ?? "unknown");
  const source = ["runtime", "catalog", "table", "default"].includes(rawSource) ? rawSource : "unknown";
  return {
    usedTokens,
    totalTokens,
    percent,
    source,
    modelId: cleanText(usage.modelId ?? modelId, 240) || null,
    observedAt: now(),
  };
}

export function createTurn({ id, sequence, primaryAttemptId, reason, now }) {
  const timestamp = now();
  return {
    id,
    sequence,
    status: "pending",
    reason,
    primaryAttemptId,
    workerAttemptIds: [],
    decisionId: null,
    checkpointId: null,
    capsuleId: null,
    context: null,
    startedAt: null,
    updatedAt: timestamp,
    finishedAt: null,
  };
}

export function turnForAttempt(run, attempt) {
  if (!attempt?.turnId) return null;
  return run.turns.find((turn) => turn.id === attempt.turnId) ?? null;
}

export function attachWorkerToTurn(run, workerAttempt) {
  const turn = turnForAttempt(run, workerAttempt);
  if (!turn || turn.workerAttemptIds.includes(workerAttempt.id)) return;
  turn.workerAttemptIds.push(workerAttempt.id);
  turn.updatedAt = workerAttempt.updatedAt;
}

function executedAttempts(run) {
  return [
    ...(Array.isArray(run.primaryAttempts) ? run.primaryAttempts : []),
    ...(Array.isArray(run.workerAttempts) ? run.workerAttempts : []),
    ...(Array.isArray(run.checkerAttempts) ? run.checkerAttempts : []),
  ].filter((attempt) => attempt.startedAt !== null
    || attempt.personalRunId !== null
    || !["pending", "ready"].includes(attempt.status));
}

function totalTokensForAttempt(attempt) {
  const usage = attempt.providerUsage;
  if (!usage) return null;
  if (usage.totalTokens !== null) return usage.totalTokens;
  if (usage.inputTokens !== null && usage.outputTokens !== null) return usage.inputTokens + usage.outputTokens;
  return null;
}

function aggregateKnown(attempts, valueForAttempt) {
  if (attempts.length === 0) return 0;
  let total = 0;
  for (const attempt of attempts) {
    const value = valueForAttempt(attempt);
    if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) return null;
    total += value;
  }
  return total;
}

export function refreshRunBudget(run, now) {
  const startedAt = run.startedAt ?? run.createdAt;
  const attempts = executedAttempts(run);
  const observedAt = now();
  let consecutiveFailures = 0;
  for (const attempt of [...run.primaryAttempts].reverse()) {
    if (!["failed", "blocked", "cancelled"].includes(attempt.status)) break;
    consecutiveFailures += 1;
  }
  run.budget = {
    primaryTurnsUsed: run.turns.length,
    workerAttemptsUsed: run.workerAttempts.length,
    consecutiveFailures,
    transportRetries: run.turns.filter((turn) => turn.reason === "transport-retry").length,
    tokensUsed: aggregateKnown(attempts, totalTokensForAttempt),
    costMicrosUsed: aggregateKnown(attempts, (attempt) => attempt.providerUsage?.costMicros ?? null),
    elapsedMs: Math.max(0, observedAt - startedAt),
    updatedAt: observedAt,
  };
  return run.budget;
}

export function endConditionViolation(run, now, { nextTurn = false, nextWorker = false, requireKnownUsage = false } = {}) {
  const limits = run.definition.endConditions;
  const budget = refreshRunBudget(run, now);
  const timestamp = now();
  if (limits.deadlineAt !== null && timestamp >= limits.deadlineAt) return "Task deadline reached";
  if (limits.maxElapsedMs !== null && budget.elapsedMs >= limits.maxElapsedMs) return "Maximum task runtime reached";
  if (nextTurn && Math.max(run.turns.length, run.primaryAttempts.length) >= limits.maxPrimaryTurns) return "Maximum primary turn count reached";
  if (nextWorker && run.workerAttempts.length >= limits.maxWorkerAttempts) return "Maximum worker attempt count reached";
  if (budget.consecutiveFailures >= limits.maxConsecutiveFailures) return "Maximum consecutive failure count reached";
  if (limits.maxTokens !== null && budget.tokensUsed !== null && budget.tokensUsed >= limits.maxTokens) return "Task token budget reached";
  if ((nextTurn || requireKnownUsage) && limits.maxTokens !== null && budget.tokensUsed === null) return "Task token budget cannot be verified because the provider did not report token usage";
  if (limits.maxCostMicros !== null && budget.costMicrosUsed !== null && budget.costMicrosUsed >= limits.maxCostMicros) return "Task cost budget reached";
  if ((nextTurn || requireKnownUsage) && limits.maxCostMicros !== null && budget.costMicrosUsed === null) return "Task cost budget cannot be verified because the provider did not report cost usage";
  return null;
}

export function buildContinuationRecords({ run, turn, decision, artifacts, context, createId, now, trigger }) {
  const capsuleId = createId("capsule");
  const checkpointId = createId("checkpoint");
  const acceptance = run.definition.contract.acceptance;
  const results = new Map(decision.acceptanceResults.map((result) => [result.criterionIndex, result]));
  const completed = [];
  const pending = [];
  const risks = [];
  for (let index = 0; index < acceptance.length; index += 1) {
    const result = results.get(index);
    if (result?.status === "passed") completed.push(`${acceptance[index]} — ${result.summary}`.slice(0, 2_000));
    else pending.push(`${acceptance[index]}${result ? ` — ${result.summary}` : ""}`.slice(0, 2_000));
    if (result?.status === "failed") risks.push(result.summary.slice(0, 2_000));
  }
  if (decision.nextAction) pending.unshift(decision.nextAction.slice(0, 2_000));
  const turnAttemptIds = new Set([turn.primaryAttemptId, ...turn.workerAttemptIds]);
  const currentArtifactIds = artifacts
    .filter((artifact) => turnAttemptIds.has(artifact.attemptId))
    .map((artifact) => artifact.id)
    .slice(0, 100);
  const artifactIds = cumulativeArtifactIds(run, currentArtifactIds);
  const capsule = {
    ...capsuleIdentity(run),
    id: capsuleId,
    fromTurnId: turn.id,
    summary: cleanText(decision.summary, 12_000) || "Continue the frozen task from the durable checkpoint.",
    completed,
    pending,
    risks,
    artifactIds,
    workspaceEvidence: cumulativeWorkspaceEvidence(run, artifacts, turnAttemptIds),
    acceptanceResults: decision.acceptanceResults,
    workerMail: workerMail(run, turn),
    remainingBudget: remainingBudget(run),
    unresolvedSideEffects: unresolvedSideEffects(run),
    nextAction: decision.nextAction,
    lastDecisionId: decision.id,
    context,
    createdAt: now(),
  };
  const checkpoint = {
    id: checkpointId,
    turnId: turn.id,
    capsuleId,
    trigger,
    createdAt: now(),
  };
  return { capsule, checkpoint };
}

export function buildPauseContinuationRecords({ run, turn, artifacts, createId, now, trigger, reason }) {
  const capsuleId = createId("capsule");
  const checkpointId = createId("checkpoint");
  const turnAttemptIds = new Set([turn.primaryAttemptId, ...turn.workerAttemptIds]);
  const unknownEffects = (run.sideEffects ?? []).filter((effect) => (
    turnAttemptIds.has(effect.attemptId)
    && ["non-idempotent", "unknown"].includes(effect.idempotency)
    && effect.receiptStatus === "unknown"
  ));
  const capsule = {
    ...capsuleIdentity(run),
    id: capsuleId,
    fromTurnId: turn.id,
    summary: `Task paused safely: ${cleanText(reason, 4_000) || "execution owner requested a checkpoint"}`.slice(0, 12_000),
    completed: [],
    pending: run.definition.contract.acceptance.map((criterion) => `Re-evaluate: ${criterion}`.slice(0, 2_000)),
    risks: unknownEffects.map((effect) => `Reconcile uncertain side effect before retrying: ${effect.operation}`.slice(0, 2_000)),
    artifactIds: cumulativeArtifactIds(run, artifacts
      .filter((artifact) => turnAttemptIds.has(artifact.attemptId))
      .map((artifact) => artifact.id)
      .slice(0, 100)),
    workspaceEvidence: cumulativeWorkspaceEvidence(run, artifacts, turnAttemptIds),
    acceptanceResults: [],
    workerMail: workerMail(run, turn),
    remainingBudget: remainingBudget(run),
    unresolvedSideEffects: unresolvedSideEffects(run),
    nextAction: "Resume from the durable checkpoint after reconciling any uncertain side effect.",
    lastDecisionId: run.latestDecisionId,
    context: turn.context,
    createdAt: now(),
  };
  return {
    capsule,
    checkpoint: {
      id: checkpointId,
      turnId: turn.id,
      capsuleId,
      trigger,
      createdAt: now(),
    },
  };
}

export function continuationPrompt(capsule) {
  return [
    "Continue the same frozen task in a fresh provider session from this durable continuation capsule.",
    `Checkpoint summary: ${capsule.summary}`,
    capsule.completed.length ? `Completed:\n- ${capsule.completed.join("\n- ")}` : "Completed: none recorded.",
    capsule.workspaceEvidence.length
      ? `Durable evidence excerpts from prior turns (reuse these; do not repeat covered scans):\n${JSON.stringify(capsule.workspaceEvidence)}`
      : "Durable evidence excerpts: none.",
    capsule.pending.length ? `Next work:\n- ${capsule.pending.join("\n- ")}` : "Next work: re-evaluate the frozen acceptance criteria.",
    capsule.risks.length ? `Known risks:\n- ${capsule.risks.join("\n- ")}` : "Known risks: none recorded.",
    capsule.artifactIds.length ? `Durable artifact ids: ${capsule.artifactIds.join(", ")}` : "Durable artifact ids: none.",
    `Frozen identity: task=${capsule.taskId ?? "legacy"}, run=${capsule.taskRunId ?? "legacy"}, revision=${capsule.taskRevision ?? "legacy"}, contract=${capsule.contractHash ?? "legacy"}, workspace=${capsule.workspaceRootHash ?? "legacy"}.`,
    capsule.workerMail.length ? `Worker mail: ${JSON.stringify(capsule.workerMail)}` : "Worker mail: none.",
    capsule.remainingBudget ? `Remaining budget: ${JSON.stringify(capsule.remainingBudget)}` : "Remaining budget: unavailable.",
    capsule.unresolvedSideEffects.length ? `Unresolved side effects: ${JSON.stringify(capsule.unresolvedSideEffects)}` : "Unresolved side effects: none.",
    capsule.nextAction ? `Next action: ${capsule.nextAction}` : "Next action: inspect durable state and choose the safest continuation.",
    "Inspect durable task state before acting. Do not assume an uncertain side effect succeeded; reconcile it first.",
  ].join("\n\n").slice(0, 24_000);
}
