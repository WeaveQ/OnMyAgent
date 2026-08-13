import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCheckerInput,
  checkerCanApprove,
  checkerContractHash,
  checkerEligibility,
  checkerFeedbackCapsule,
  checkerPrompt,
  createCheckerAttempt,
  parseCheckerVerdict,
  validateFrozenCheckerProfile,
} from "./independent-checker.mjs";

const profile = {
  id: "checker-independent",
  label: "Independent checker",
  runtime: "personal-local-agent",
  agentId: "codex",
  provider: "codex",
  model: "gpt-5.6-sol",
  modelLabel: "gpt-5.6-sol",
  catalogSource: "personal-registry",
  catalogRevision: "catalog-1",
  capabilitySnapshot: null,
  instructions: "Read-only acceptance verification.",
  approvalMode: "ask",
  sessionStrategy: "fresh",
  timeoutMs: 60_000,
};

const contract = {
  outcome: "A verified result",
  deliverables: ["A result"],
  acceptance: ["Tests pass", "Evidence is recorded"],
  scope: { included: ["workspace"], excluded: ["network" ] },
  verification: ["Run tests"],
};

function baseRun(overrides = {}) {
  const run = {
    id: "run-1",
    taskId: "task-1",
    currentTurnId: "turn-1",
    primaryAttemptId: "primary-1",
    definition: {
      contract,
      workspaceRoot: "/tmp/workspace",
      allowedWorkers: [{ id: "worker-1", label: "Claude worker", agentId: "claude", provider: "claude", model: "sonnet" }],
      independentChecker: { mode: "independent", profile, maxRounds: 2 },
    },
    primaryAttempts: [{ id: "primary-1", status: "succeeded", turnId: "turn-1" }],
    workerAttempts: [{ id: "worker-attempt-1", profileId: "worker-1", parentAttemptId: "primary-1", turnId: "turn-1", status: "succeeded", outputArtifactIds: ["artifact-1"] }],
    primaryDecisions: [{ id: "decision-1", attemptId: "primary-1", kind: "complete", acceptanceResults: [
      { criterionIndex: 0, status: "passed", summary: "Tests pass", evidenceArtifactIds: ["artifact-1"] },
      { criterionIndex: 1, status: "passed", summary: "Evidence exists", evidenceArtifactIds: ["artifact-1"] },
    ] }],
    checkerAttempts: [],
    checkerVerdicts: [],
    ...overrides,
  };
  return run;
}

const artifacts = [{ id: "artifact-1", attemptId: "primary-1", kind: "primary", summary: "result", evidence: [] }];

test("default/legacy policy stays primary-only and never becomes a checker pipeline", () => {
  const run = baseRun({ definition: { ...baseRun().definition, independentChecker: undefined } });
  assert.equal(checkerEligibility(run, artifacts).eligible, false);
  assert.match(checkerEligibility(run, artifacts).reason, /disabled/);
});

test("frozen checker profile is catalog-backed and rejects drift", () => {
  assert.equal(validateFrozenCheckerProfile(profile, { id: "codex", provider: "codex" }).agentId, "codex");
  assert.throws(() => validateFrozenCheckerProfile(profile, { id: "claude", provider: "codex" }), /does not match/);
});

test("eligibility requires complete primary decision and terminal workers", () => {
  const incomplete = baseRun({ primaryDecisions: [{ ...baseRun().primaryDecisions[0], acceptanceResults: [] }] });
  assert.equal(checkerEligibility(incomplete, artifacts).eligible, false);
  assert.match(checkerEligibility(incomplete, artifacts).reason, /incomplete/);
  const activeWorker = baseRun({ workerAttempts: [{ id: "worker-1", status: "running" }] });
  assert.equal(checkerEligibility(activeWorker, artifacts).eligible, false);
  assert.match(checkerEligibility(activeWorker, artifacts).reason, /terminal/);
});

test("checker input is fresh, frozen, read-only, and exact", () => {
  const run = baseRun();
  const eligibility = checkerEligibility(run, artifacts);
  const attempt = createCheckerAttempt({
    id: "checker-1",
    now: () => 100,
    run,
    primaryDecision: eligibility.decision,
    profile,
    round: eligibility.round,
    prompt: "verify",
  });
    const input = buildCheckerInput(run, eligibility.decision, artifacts, attempt);
  assert.equal(input.contractHash, checkerContractHash(contract));
  assert.equal(input.primaryDecisionId, "decision-1");
    assert.equal(input.workspaceRoot, "/tmp/workspace");
    assert.deepEqual(input.allowedWorkerProfiles, [{ id: "worker-1", label: "Claude worker", agentId: "claude", provider: "claude", model: "sonnet" }]);
    assert.deepEqual(input.workerAttempts[0].outputArtifactIds, ["artifact-1"]);
  assert.match(checkerPrompt(input), /No delegation tools/);
  assert.doesNotMatch(checkerPrompt(input), /complete_task/);
});

test("approve/revise/block verdicts are exact and fail closed on parse/hash/criteria errors", () => {
  const run = baseRun();
  const eligibility = checkerEligibility(run, artifacts);
  const attempt = createCheckerAttempt({ id: "checker-1", now: () => 100, run, primaryDecision: eligibility.decision, profile, round: 1, prompt: "verify" });
  const input = { ...buildCheckerInput(run, eligibility.decision, artifacts, attempt), checkerAttemptId: attempt.id, createdAt: 101 };
  const result = (verdict, extra = {}) => parseCheckerVerdict(`<task-checker-verdict>${JSON.stringify({
    runId: input.runId, primaryDecisionId: input.primaryDecisionId, round: input.round, contractHash: input.contractHash,
    verdict, summary: `${verdict} summary`, criterionResults: input.contract.acceptance.map((_, criterionIndex) => ({ criterionIndex, status: verdict === "approve" ? "passed" : "failed", summary: "checked", evidenceArtifactIds: ["artifact-1"] })), evidenceArtifactIds: ["artifact-1"], feedback: verdict === "revise" ? "fix the criterion" : null, ...extra,
  })}</task-checker-verdict>`, input, ["artifact-1"]);
  assert.equal(result("approve").verdict, "approve");
  assert.equal(checkerCanApprove(result("approve")), true);
  assert.equal(result("revise").verdict, "revise");
  assert.equal(result("block").verdict, "block");
  assert.match(checkerFeedbackCapsule(result("revise")), /fresh Primary/);
  assert.throws(() => result("approve", { contractHash: "bad" }), /hash/);
  assert.throws(() => parseCheckerVerdict("not json", input, ["artifact-1"]), /parseable/);
  assert.throws(() => result("approve", { criterionResults: [{ criterionIndex: 0, status: "passed", summary: "one", evidenceArtifactIds: ["artifact-1"] }] }), /every frozen/);
});

test("same primary decision and round is idempotently ineligible", () => {
  const run = baseRun({ checkerAttempts: [{ id: "checker-1", primaryDecisionId: "decision-1", round: 1, status: "succeeded" }] });
  const result = checkerEligibility(run, artifacts);
  assert.equal(result.eligible, false);
  assert.equal(result.existing.id, "checker-1");
  assert.equal(result.terminal, true);
});

test("round budget blocks after max rounds", () => {
  const run = baseRun({ checkerVerdicts: [{ round: 1 }, { round: 2 }] });
  const result = checkerEligibility(run, artifacts);
  assert.equal(result.eligible, false);
  assert.equal(result.terminal, true);
  assert.match(result.reason, /maximum/);
});
