import { createHash } from "node:crypto";

import {
  taskOrchestratorCheckerAttemptSchema,
  taskOrchestratorCheckerProfileSchema,
  taskOrchestratorCheckerVerdictSchema,
  taskOrchestratorIndependentCheckerPolicySchema,
} from "@onmyagent/types/task-orchestrator";

const TERMINAL_ATTEMPT_STATUSES = new Set(["succeeded", "failed", "blocked", "cancelled"]);

function text(value, limit = 8_000) {
  return String(value ?? "").trim().slice(0, limit);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function checkerContractHash(contract) {
  return createHash("sha256").update(stableJson(contract)).digest("hex");
}

export function normalizeIndependentCheckerPolicy(policy) {
  const parsed = taskOrchestratorIndependentCheckerPolicySchema.parse(policy ?? {});
  if (parsed.mode === "primary-only") return parsed;
  return taskOrchestratorIndependentCheckerPolicySchema.parse({
    ...parsed,
    profile: taskOrchestratorCheckerProfileSchema.parse(parsed.profile),
  });
}

export function validateFrozenCheckerProfile(profile, catalogEntry = null) {
  const parsed = taskOrchestratorCheckerProfileSchema.parse(profile);
  if (catalogEntry) {
    const id = text(catalogEntry.id);
    if (id && id !== parsed.agentId) throw new Error("Frozen checker profile does not match the live catalog agent");
    const provider = text(catalogEntry.provider ?? catalogEntry.backend);
    if (provider && provider !== parsed.provider) throw new Error("Frozen checker profile provider does not match the live catalog");
  }
  return parsed;
}

function currentPrimary(run) {
  return (run?.primaryAttempts ?? []).find((attempt) => attempt.id === run.primaryAttemptId) ?? null;
}

function primaryDecision(run) {
  const primary = currentPrimary(run);
  if (!primary) return null;
  return [...(run.primaryDecisions ?? [])].reverse().find((decision) => decision.attemptId === primary.id) ?? null;
}

function workersTerminal(run) {
  return (run?.workerAttempts ?? []).every((attempt) => TERMINAL_ATTEMPT_STATUSES.has(attempt.status));
}

function exactCompleteDecision(run, decision, artifacts) {
  if (!decision || decision.kind !== "complete") return { ok: false, reason: "Primary has not recorded complete_task" };
  const criteria = run.definition.contract.acceptance;
  const results = Array.isArray(decision.acceptanceResults) ? decision.acceptanceResults : [];
  if (results.length !== criteria.length) return { ok: false, reason: "Primary completion criteria are incomplete" };
  const seen = new Set();
  const artifactIds = new Set((artifacts ?? []).map((artifact) => artifact.id));
  for (const result of results) {
    if (!Number.isInteger(result.criterionIndex) || result.criterionIndex < 0 || result.criterionIndex >= criteria.length || seen.has(result.criterionIndex)) {
      return { ok: false, reason: "Primary completion criteria are not an exact one-to-one match" };
    }
    seen.add(result.criterionIndex);
    if (result.status !== "passed") return { ok: false, reason: "Primary completion criteria are not all passed" };
    if (result.evidenceArtifactIds.some((id) => !artifactIds.has(id))) return { ok: false, reason: "Primary completion references missing evidence artifacts" };
  }
  if (seen.size !== criteria.length) return { ok: false, reason: "Primary completion criteria are incomplete" };
  return { ok: true };
}

export function checkerEligibility(run, artifacts = []) {
  const policy = normalizeIndependentCheckerPolicy(run?.definition?.independentChecker);
  if (policy.mode !== "independent") return { eligible: false, reason: "Independent checker is disabled" };
  const primary = currentPrimary(run);
  if (!primary || primary.status !== "succeeded") return { eligible: false, reason: "Primary attempt is not terminal-success" };
  if (!workersTerminal(run)) return { eligible: false, reason: "Selected workers are not terminal" };
  const decision = primaryDecision(run);
  const exact = exactCompleteDecision(run, decision, artifacts);
  if (!exact.ok) return { eligible: false, reason: exact.reason };
  const round = Number(run.checkerVerdicts?.length ?? 0) + 1;
  if (round > policy.maxRounds) return { eligible: false, reason: "Independent checker maximum rounds reached", terminal: true };
  const existing = (run.checkerAttempts ?? []).find((attempt) => (
    attempt.primaryDecisionId === decision.id && attempt.round === round
  ));
  if (existing) return { eligible: false, reason: "Checker round already durable", existing, terminal: TERMINAL_ATTEMPT_STATUSES.has(existing.status) };
  return { eligible: true, policy, primary, decision, round, contractHash: checkerContractHash(run.definition.contract) };
}

export function buildCheckerInput(run, primaryDecision, artifacts, checkerAttempt) {
  const contractHash = checkerContractHash(run.definition.contract);
  return {
    runId: run.id,
    taskId: run.taskId,
    round: checkerAttempt.round,
    primaryDecisionId: primaryDecision.id,
    contractHash,
    contract: structuredClone(run.definition.contract),
    primaryDecision: structuredClone(primaryDecision),
    workspaceRoot: run.definition.workspaceRoot,
    allowedWorkerProfiles: (run.definition.allowedWorkers ?? []).map((profile) => ({
      id: profile.id,
      label: profile.label,
      agentId: profile.agentId,
      provider: profile.provider,
      model: profile.model,
    })),
    workerAttempts: (run.workerAttempts ?? []).map((attempt) => ({
      id: attempt.id,
      profileId: attempt.profileId,
      parentAttemptId: attempt.parentAttemptId,
      turnId: attempt.turnId,
      status: attempt.status,
      outputArtifactIds: [...(attempt.outputArtifactIds ?? [])],
    })),
    artifacts: (artifacts ?? []).map((artifact) => ({
      id: artifact.id,
      attemptId: artifact.attemptId,
      kind: artifact.kind,
      summary: artifact.summary,
      evidence: (artifact.evidence ?? []).map((evidence) => ({
        kind: evidence.kind,
        provenance: evidence.provenance,
        label: evidence.label,
        value: evidence.value,
        status: evidence.status,
        exitCode: evidence.exitCode,
        path: evidence.path,
      })),
    })),
  };
}

export function checkerPrompt(input) {
  return [
    "You are the independent acceptance checker for a Task Center run.",
    "Read-only verification only: No delegation tools and no task completion tools are available. Do not delegate, modify files, or send messages.",
    "Verify the frozen contract against the durable workspace artifacts/evidence. Primary prose is context only, never proof.",
    `Frozen checker context (JSON): ${JSON.stringify(input)}`,
    "Return exactly one JSON object inside <task-checker-verdict>...</task-checker-verdict>.",
    "The object must contain runId, primaryDecisionId, round, contractHash, verdict (approve|revise|block), summary, criterionResults (exactly one result for every criterion with evidenceArtifactIds), evidenceArtifactIds, and feedback (nullable).",
    "Any missing, contradictory, or unverifiable evidence must use revise or block; never approve on provider completion alone.",
  ].join("\n\n").slice(0, 24_000);
}

function parseJsonEnvelope(output) {
  const source = String(output ?? "");
  const match = source.match(/<task-checker-verdict>\s*([\s\S]*?)\s*<\/task-checker-verdict>/i);
  const raw = match ? match[1] : source.trim();
  try { return JSON.parse(raw); } catch { return null; }
}

export function parseCheckerVerdict(output, input, artifactIds = []) {
  const raw = parseJsonEnvelope(output);
  if (!raw || typeof raw !== "object") throw new Error("Independent checker did not return a parseable verdict");
  const criteria = input.contract.acceptance;
  const criterionResults = Array.isArray(raw.criterionResults) ? raw.criterionResults : [];
  const seen = new Set();
  const available = new Set(artifactIds);
  if (String(raw.runId ?? "") !== input.runId) throw new Error("Independent checker verdict run identity is stale");
  if (String(raw.primaryDecisionId ?? "") !== input.primaryDecisionId) throw new Error("Independent checker verdict decision identity is stale");
  if (Number(raw.round) !== input.round) throw new Error("Independent checker verdict round is stale");
  if (String(raw.contractHash ?? "") !== input.contractHash) throw new Error("Independent checker verdict contract hash is stale");
  if (!['approve', 'revise', 'block'].includes(raw.verdict)) throw new Error("Independent checker verdict is invalid");
  if (criterionResults.length !== criteria.length) throw new Error("Independent checker must report every frozen acceptance criterion exactly once");
  for (const result of criterionResults) {
    const index = Number(result?.criterionIndex);
    if (!Number.isInteger(index) || index < 0 || index >= criteria.length || seen.has(index)) throw new Error("Independent checker criteria are not an exact one-to-one match");
    seen.add(index);
    if (!['passed', 'failed'].includes(result.status)) throw new Error("Independent checker criterion status is invalid");
    if ((result.evidenceArtifactIds ?? []).some((id) => !available.has(id))) throw new Error("Independent checker referenced an unknown evidence artifact");
  }
  if (seen.size !== criteria.length) throw new Error("Independent checker criteria are incomplete");
  if (raw.verdict === "approve" && criterionResults.some((result) => result.status !== "passed")) throw new Error("Independent checker cannot approve failed criteria");
  return taskOrchestratorCheckerVerdictSchema.parse({
    id: text(raw.id, 120) || `checker-verdict-${input.round}`,
    runId: input.runId,
    primaryDecisionId: input.primaryDecisionId,
    checkerAttemptId: input.checkerAttemptId,
    round: input.round,
    contractHash: input.contractHash,
    verdict: raw.verdict,
    summary: text(raw.summary, 4_000) || "Independent checker returned a verdict.",
    criterionResults,
    evidenceArtifactIds: [...new Set([...(raw.evidenceArtifactIds ?? []), ...criterionResults.flatMap((result) => result.evidenceArtifactIds ?? [])])].slice(0, 100),
    feedback: raw.feedback == null ? null : text(raw.feedback, 8_000),
    createdAt: Number(input.createdAt ?? Date.now()),
  });
}

export function createCheckerAttempt({ id, now, run, primaryDecision, profile, round, prompt }) {
  const attempt = {
    id,
    profileId: profile.id,
    turnId: run.currentTurnId,
    primaryDecisionId: primaryDecision.id,
    round,
    status: "ready",
    leaseId: null,
    personalRunId: null,
    conversationId: null,
    providerDiagnostics: null,
    providerUsage: null,
    prompt: text(prompt, 24_000),
    outputArtifactIds: [],
    timeoutMs: profile.timeoutMs,
    startedAt: null,
    progressAt: null,
    notBefore: null,
    updatedAt: now(),
    finishedAt: null,
    error: null,
  };
  return taskOrchestratorCheckerAttemptSchema.parse(attempt);
}

export function checkerVerdictForRound(run, round) {
  return (run.checkerVerdicts ?? []).find((verdict) => verdict.round === round) ?? null;
}

export function checkerAttemptForRound(run, round) {
  return (run.checkerAttempts ?? []).find((attempt) => attempt.round === round) ?? null;
}

export function checkerCanApprove(verdict) {
  return verdict?.verdict === "approve" && verdict.criterionResults.every((result) => result.status === "passed");
}

export function checkerFeedbackCapsule(verdict) {
  return [
    "Independent checker requested a fresh Primary turn.",
    `Checker verdict: ${verdict.summary}`,
    verdict.feedback ? `Feedback: ${verdict.feedback}` : "Feedback: review every failed criterion against durable artifacts.",
    `Criterion results: ${JSON.stringify(verdict.criterionResults)}`,
    `Evidence artifact ids: ${verdict.evidenceArtifactIds.join(", ") || "none"}`,
  ].join("\n\n").slice(0, 24_000);
}
