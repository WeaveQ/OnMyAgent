import { redactSensitiveText } from "./durable-redaction.mjs";

function requiredRedacted(value, limit, fallback) {
  const redacted = redactSensitiveText(value, limit);
  return redacted.trim() ? redacted : fallback;
}

function nullableRedacted(value, limit) {
  if (value === null || value === undefined) return null;
  const redacted = redactSensitiveText(value, limit);
  return redacted.trim() ? redacted : null;
}

function sanitizeEvidence(evidence) {
  return {
    ...evidence,
    label: requiredRedacted(evidence?.label, 240, "Runtime evidence"),
    value: redactSensitiveText(evidence?.value, 24_000),
    path: nullableRedacted(evidence?.path, 4_096),
  };
}

function sanitizeProviderUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const numeric = (candidate) => typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0
    ? candidate
    : null;
  const observedAt = numeric(value.observedAt);
  const usage = {
    inputTokens: numeric(value.inputTokens),
    outputTokens: numeric(value.outputTokens),
    totalTokens: numeric(value.totalTokens),
    costMicros: numeric(value.costMicros),
    observedAt,
  };
  if (observedAt === null) return null;
  if ([usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.costMicros].every((item) => item === null)) return null;
  return usage;
}

export function sanitizeArtifact(artifact) {
  return {
    ...artifact,
    summary: requiredRedacted(artifact?.summary, 4_000, "Agent stage output"),
    content: redactSensitiveText(artifact?.content, 500_000),
    evidence: (Array.isArray(artifact?.evidence) ? artifact.evidence : [])
      .slice(0, 100)
      .map(sanitizeEvidence),
  };
}

export function sanitizeEvent(event) {
  return {
    ...event,
    message: redactSensitiveText(event?.message, 4_000),
  };
}

export function sanitizeRun(run) {
  const sanitizeAttempt = (attempt) => attempt ? {
    ...attempt,
    providerUsage: sanitizeProviderUsage(attempt?.providerUsage),
    prompt: redactSensitiveText(attempt?.prompt, 24_000),
    error: nullableRedacted(attempt?.error, 8_000),
  } : attempt;
  return {
    ...run,
    primaryAttempts: Array.isArray(run?.primaryAttempts) ? run.primaryAttempts.map(sanitizeAttempt) : run?.primaryAttempts,
    workerAttempts: Array.isArray(run?.workerAttempts) ? run.workerAttempts.map(sanitizeAttempt) : run?.workerAttempts,
    checkerAttempts: Array.isArray(run?.checkerAttempts) ? run.checkerAttempts.map(sanitizeAttempt) : run?.checkerAttempts,
    checkerVerdicts: Array.isArray(run?.checkerVerdicts) ? run.checkerVerdicts.map((verdict) => ({
      ...verdict,
      summary: requiredRedacted(verdict?.summary, 4_000, "Independent checker verdict"),
      feedback: nullableRedacted(verdict?.feedback, 8_000),
      criterionResults: (Array.isArray(verdict?.criterionResults) ? verdict.criterionResults : []).map((result) => ({
        ...result,
        summary: requiredRedacted(result?.summary, 4_000, "Checker criterion result"),
      })),
    })) : run?.checkerVerdicts,
    primaryDecisions: Array.isArray(run?.primaryDecisions) ? run.primaryDecisions.map((decision) => ({
      ...decision,
      summary: requiredRedacted(decision?.summary, 4_000, "Primary task decision"),
      nextAction: nullableRedacted(decision?.nextAction, 4_000),
      acceptanceResults: (Array.isArray(decision?.acceptanceResults) ? decision.acceptanceResults : []).map((result) => ({
        ...result,
        summary: requiredRedacted(result?.summary, 4_000, "Acceptance result"),
      })),
    })) : run?.primaryDecisions,
    sideEffects: Array.isArray(run?.sideEffects) ? run.sideEffects.map((sideEffect) => ({
      ...sideEffect,
      operation: requiredRedacted(sideEffect?.operation, 240, "Provider tool operation"),
    })) : run?.sideEffects,
    continuationCapsules: Array.isArray(run?.continuationCapsules) ? run.continuationCapsules.map((capsule) => ({
      ...capsule,
      summary: requiredRedacted(capsule?.summary, 12_000, "Continue from the durable checkpoint."),
      completed: (Array.isArray(capsule?.completed) ? capsule.completed : []).map((item) => redactSensitiveText(item, 2_000)),
      pending: (Array.isArray(capsule?.pending) ? capsule.pending : []).map((item) => redactSensitiveText(item, 2_000)),
      risks: (Array.isArray(capsule?.risks) ? capsule.risks : []).map((item) => redactSensitiveText(item, 2_000)),
    })) : run?.continuationCapsules,
    error: nullableRedacted(run?.error, 8_000),
  };
}

function sanitizeContract(contract) {
  if (!contract || typeof contract !== "object") return contract;
  return {
    ...contract,
    outcome: redactSensitiveText(contract.outcome, 24_000),
    deliverables: (Array.isArray(contract.deliverables) ? contract.deliverables : []).map((item) => redactSensitiveText(item, 4_000)),
    acceptance: (Array.isArray(contract.acceptance) ? contract.acceptance : []).map((item) => redactSensitiveText(item, 4_000)),
    scope: contract.scope ? {
      ...contract.scope,
      included: (Array.isArray(contract.scope.included) ? contract.scope.included : []).map((item) => redactSensitiveText(item, 4_000)),
      excluded: (Array.isArray(contract.scope.excluded) ? contract.scope.excluded : []).map((item) => redactSensitiveText(item, 4_000)),
    } : contract.scope,
    verification: (Array.isArray(contract.verification) ? contract.verification : []).map((item) => redactSensitiveText(item, 4_000)),
  };
}

function sanitizeProfile(profile) {
  if (!profile || typeof profile !== "object") return profile;
  return { ...profile, label: redactSensitiveText(profile.label, 120), instructions: redactSensitiveText(profile.instructions, 12_000) };
}

/** Sanitize alignment transcripts/proposals before they become durable task state. */
export function sanitizeTask(task) {
  if (!task || typeof task !== "object") return task;
  const alignment = task.alignment && typeof task.alignment === "object" ? task.alignment : task.alignment;
  const independentChecker = task.independentChecker && typeof task.independentChecker === "object"
    ? {
        ...task.independentChecker,
        profile: task.independentChecker.profile ? sanitizeProfile(task.independentChecker.profile) : task.independentChecker.profile,
      }
    : task.independentChecker;
  return {
    ...task,
    idea: redactSensitiveText(task.idea, 24_000),
    primary: sanitizeProfile(task.primary),
    allowedWorkers: Array.isArray(task.allowedWorkers) ? task.allowedWorkers.map(sanitizeProfile) : task.allowedWorkers,
    independentChecker,
    contract: sanitizeContract(task.contract),
    alignment: alignment ? {
      ...alignment,
      messages: (Array.isArray(alignment.messages) ? alignment.messages : []).map((message) => ({ ...message, text: redactSensitiveText(message?.text, 24_000) })),
      proposals: (Array.isArray(alignment.proposals) ? alignment.proposals : []).map((proposal) => ({ ...proposal, contract: sanitizeContract(proposal?.contract) })),
    } : alignment,
  };
}

export function sanitizeGate(gate) {
  const operation = gate?.operation;
  const timestamp = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const leaseId = typeof gate?.leaseId === "string" && gate.leaseId.trim() ? gate.leaseId.trim() : null;
  const personalRunId = typeof gate?.personalRunId === "string" && gate.personalRunId.trim() ? gate.personalRunId.trim() : null;
  return {
    ...gate,
    leaseId,
    personalRunId,
    expiresAt: timestamp(gate?.expiresAt),
    title: requiredRedacted(gate?.title, 240, "Agent approval required"),
    summary: requiredRedacted(gate?.summary, 4_000, "The local agent requested approval."),
    operation: operation ? {
      ...operation,
      method: nullableRedacted(operation.method, 120),
      kind: nullableRedacted(operation.kind, 120),
      command: nullableRedacted(operation.command, 8_000),
      cwd: nullableRedacted(operation.cwd, 4_096),
      params: (Array.isArray(operation.params) ? operation.params : [])
        .slice(0, 50)
        .map((entry) => ({
          name: requiredRedacted(entry?.name, 160, "value"),
          value: redactSensitiveText(entry?.value, 4_000),
        })),
      diff: nullableRedacted(operation.diff, 24_000),
    } : operation,
  };
}
