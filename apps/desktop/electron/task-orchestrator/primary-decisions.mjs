import { taskOrchestratorPrimaryDecisionInputSchema } from "@onmyagent/types/task-orchestrator";

import { ACTIVE_ATTEMPT_STATUSES, findAttempt } from "./definitions.mjs";

const TOOL_DECISIONS = new Map([
  ["checkpoint_task", "checkpoint"],
  ["continue_task", "continue"],
  ["complete_task", "complete"],
  ["block_task", "block"],
  ["realign_task", "realign"],
]);

function sameDecision(left, right) {
  return left.kind === right.kind
    && left.summary === right.summary
    && left.nextAction === right.nextAction
    && JSON.stringify(left.acceptanceResults) === JSON.stringify(right.acceptanceResults);
}

function validateCriterionResults(run, kind, results) {
  const criteria = run.definition.contract.acceptance;
  const indexes = new Set();
  for (const result of results) {
    if (result.criterionIndex >= criteria.length) {
      throw new Error(`Acceptance criterion ${result.criterionIndex} does not exist in the frozen contract`);
    }
    if (indexes.has(result.criterionIndex)) {
      throw new Error(`Acceptance criterion ${result.criterionIndex} was reported more than once`);
    }
    indexes.add(result.criterionIndex);
  }
  if (kind !== "complete") return;
  if (results.length !== criteria.length || criteria.some((_, index) => !indexes.has(index))) {
    throw new Error("complete_task requires exactly one result for every frozen acceptance criterion");
  }
  if (results.some((result) => result.status !== "passed")) {
    throw new Error("complete_task requires every frozen acceptance criterion to pass");
  }
}

function attemptSummary(attempt) {
  return {
    id: attempt.id,
    kind: attempt.kind,
    profileId: attempt.profileId,
    parentAttemptId: attempt.parentAttemptId,
    depth: attempt.depth,
    status: attempt.status,
    outputArtifactIds: attempt.outputArtifactIds,
    error: attempt.error,
    startedAt: attempt.startedAt,
    updatedAt: attempt.updatedAt,
    finishedAt: attempt.finishedAt,
  };
}

export function decisionKindForTool(tool) {
  return TOOL_DECISIONS.get(String(tool ?? "")) ?? null;
}

export function decisionForAttempt(run, attemptId) {
  return run.primaryDecisions.find((decision) => decision.attemptId === attemptId) ?? null;
}

export function createPrimaryDecisionController({ store, serialized, now, createId, emit }) {
  async function getTaskState(taskId, taskRunId, attemptId) {
    const run = await store.requireRun(taskId, taskRunId);
    const primary = findAttempt(run, attemptId);
    if (!primary || primary.kind !== "primary") throw new Error("Task state is primary-only");
    const artifacts = await store.readArtifacts(taskId, taskRunId);
    return {
      taskId,
      taskRunId,
      taskRevision: run.taskRevision,
      status: run.status,
      executionProtocol: run.definition.executionProtocol,
      contract: run.definition.contract,
      endConditions: run.definition.endConditions,
      currentTurnId: run.currentTurnId,
      turns: run.turns,
      budget: run.budget,
      permissionMode: run.definition.permissionMode,
      primary: attemptSummary(primary),
      workers: run.workerAttempts.map(attemptSummary),
      decisions: run.primaryDecisions,
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        attemptId: artifact.attemptId,
        kind: artifact.kind,
        summary: artifact.summary,
        evidence: artifact.evidence.map((item) => ({ kind: item.kind, status: item.status, label: item.label })),
      })),
    };
  }

  async function record(taskId, taskRunId, attemptId, kind, input) {
    const parsed = taskOrchestratorPrimaryDecisionInputSchema.parse(input);
    return serialized(async () => {
      const run = await store.requireRun(taskId, taskRunId);
      const primary = findAttempt(run, attemptId);
      if (!primary || primary.kind !== "primary" || primary.id !== run.primaryAttemptId) {
        throw new Error("Primary decision target is stale");
      }
      if (!primary.leaseId) {
        throw new Error("Primary decision requires the current active lease");
      }
      if (primary.status === "waiting-approval") {
        const unresolved = (await store.readGates(taskId, taskRunId)).some((gate) => (
          gate.attemptId === attemptId && (gate.status === "pending" || gate.status === "resolving")
        ));
        if (unresolved) throw new Error("Primary decision cannot bypass an unresolved approval gate");
        primary.status = "running";
        run.status = "running";
      } else if (primary.status !== "running") {
        throw new Error("Primary decision requires the current active lease");
      }
      if (run.definition.executionProtocol !== "structured-decisions-v1") {
        throw new Error("This imported run does not use structured primary decisions");
      }
      if (["checkpoint", "continue", "realign"].includes(kind) && !parsed.nextAction) {
        throw new Error(`${kind}_task requires a nextAction`);
      }
      validateCriterionResults(run, kind, parsed.acceptanceResults);
      const activeWorkers = run.workerAttempts.filter((attempt) => ACTIVE_ATTEMPT_STATUSES.has(attempt.status) || attempt.leaseId);
      if (["complete", "checkpoint", "continue"].includes(kind) && activeWorkers.length) {
        // A task-control precondition is not a provider failure. Returning a
        // successful, structured deferral keeps the primary session alive so
        // it can wait for (or close) the active workers and retry the same
        // decision. Throwing here terminates some ACP turns and needlessly
        // fails the whole durable run while healthy workers are still active.
        return {
          recorded: false,
          retryable: true,
          code: "active_workers",
          message: `${kind}_task was not recorded because spawned workers are still active.`,
          requiredAction: "Call wait_agent or close_agent for every active worker, then retry the task decision.",
          activeWorkers: activeWorkers.map((attempt) => ({
            attemptId: attempt.id,
            profileId: attempt.profileId,
            status: attempt.status,
          })),
        };
      }
      const artifactIds = new Set((await store.readArtifacts(taskId, taskRunId)).map((artifact) => artifact.id));
      for (const result of parsed.acceptanceResults) {
        for (const artifactId of result.evidenceArtifactIds) {
          if (!artifactIds.has(artifactId)) throw new Error(`Acceptance evidence artifact does not exist: ${artifactId}`);
        }
      }
      const candidate = {
        id: createId("decision"),
        attemptId,
        turnId: primary.turnId ?? null,
        kind,
        summary: parsed.summary,
        nextAction: parsed.nextAction ?? null,
        acceptanceResults: parsed.acceptanceResults,
        createdAt: now(),
      };
      const existing = decisionForAttempt(run, attemptId);
      if (existing) {
        if (sameDecision(existing, candidate)) return existing;
        throw new Error("A different primary decision is already durable for this attempt");
      }
      run.primaryDecisions.push(candidate);
      run.latestDecisionId = candidate.id;
      const progressAt = now();
      primary.progressAt = progressAt;
      run.updatedAt = progressAt;
      await store.writeRun(run);
      await emit(run, "primary-decision-recorded", `Primary recorded ${kind}: ${candidate.summary}`, attemptId);
      return candidate;
    });
  }

  return { getTaskState, record };
}
