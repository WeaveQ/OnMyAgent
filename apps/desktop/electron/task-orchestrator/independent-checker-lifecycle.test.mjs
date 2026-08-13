import assert from "node:assert/strict";
import test from "node:test";

import { createTaskOrchestrator } from "./index.mjs";
import { createTaskOrchestratorStore } from "./store-factory.mjs";
import {
  cleanupDirectories,
  contract,
  createRuntime,
  taskInput,
  temporaryDirectory,
  waitForSnapshot,
} from "./v2-test-helpers.mjs";

const directories = [];

function checkerPolicy(maxRounds = 2) {
  return {
    mode: "independent",
    maxRounds,
    profile: {
      id: "checker-independent",
      label: "Independent checker",
      runtime: "personal-local-agent",
      agentId: "primary-agent",
      provider: "codex",
      model: "primary-model",
      modelLabel: "Primary model",
      catalogSource: "personal-registry",
      catalogRevision: null,
      capabilitySnapshot: null,
      instructions: "Read-only acceptance verification.",
      approvalMode: "read-only-auto",
      sessionStrategy: "fresh",
      timeoutMs: 10_000,
    },
  };
}

function checkerOutput(input, verdict = "approve") {
  const marker = "Frozen checker context (JSON): ";
  const line = input.prompt.split("\n").find((value) => value.startsWith(marker));
  const context = JSON.parse(line.slice(marker.length));
  return `<task-checker-verdict>${JSON.stringify({
    runId: context.runId,
    primaryDecisionId: context.primaryDecisionId,
    round: context.round,
    contractHash: context.contractHash,
    verdict,
    summary: `Checker ${verdict}`,
    criterionResults: context.contract.acceptance.map((criterion, criterionIndex) => ({
      criterionIndex,
      status: verdict === "approve" ? "passed" : "failed",
      summary: `${criterion} checked`,
      evidenceArtifactIds: context.primaryDecision.acceptanceResults[criterionIndex]?.evidenceArtifactIds ?? [],
    })),
    evidenceArtifactIds: context.artifacts.map((artifact) => artifact.id),
    feedback: verdict === "revise" ? "Address the failed criteria and re-run verification." : null,
  })}</task-checker-verdict>`;
}

async function runTask({ checkerVerdicts = ["approve"], checkerRunning = false, revokeCheckerLeaseOnStart = false, retryPrimaryRunning = false, maxRounds = 2, endConditions = {} } = {}) {
  const userDataDir = await temporaryDirectory("oma-checker-user-");
  const workspaceRoot = await temporaryDirectory("oma-checker-workspace-");
  directories.push(userDataDir, workspaceRoot);
  let checkerStarts = 0;
  let primaryStarts = 0;
  let store;
  const runtime = createRuntime({
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract({ acceptance: ["Criterion A", "Criterion B"] }) });
        return { output: "aligned" };
      }
      if (input.taskProfileId === "checker-independent") {
        if (revokeCheckerLeaseOnStart) {
          const run = structuredClone(await store.requireRun(input.taskId, input.taskRunId));
          const checker = run.checkerAttempts.find((attempt) => attempt.id === input.metadata?.attemptId)
            ?? run.checkerAttempts.at(-1);
          checker.status = "cancelled";
          checker.leaseId = null;
          checker.error = "Synthetic stale checker lease.";
          checker.updatedAt = Date.now();
          checker.finishedAt = checker.updatedAt;
          run.status = "cancelled";
          run.error = checker.error;
          run.updatedAt = checker.updatedAt;
          run.finishedAt = checker.updatedAt;
          await store.writeRun(run);
          return { status: "running", output: "Checker result arrived after its lease was revoked." };
        }
        if (checkerRunning) return { status: "running", output: "Checker is still verifying." };
        const verdict = checkerVerdicts[Math.min(checkerStarts++, checkerVerdicts.length - 1)];
        return { output: checkerOutput(input, verdict) };
      }
      primaryStarts += 1;
      if (retryPrimaryRunning && primaryStarts > 1) return { status: "running", output: "Retried primary is still running." };
      return { output: "Primary completed." };
    },
  });
  store = createTaskOrchestratorStore({ userDataDir });
  const orchestrator = createTaskOrchestrator({ store, userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
  const created = await orchestrator.createTask(taskInput(workspaceRoot, {
    allowedWorkers: [],
    contractFinalization: "model-recommended-auto",
    independentChecker: checkerPolicy(maxRounds),
    endConditions,
  }));
  return { orchestrator, created, runtime, workspaceRoot, store, userDataDir };
}

test.afterEach(async () => {
  await cleanupDirectories(directories.splice(0));
});

test("primary completion starts a fresh checker conversation and approve waits for user confirmation", async () => {
  const { orchestrator, created, runtime } = await runTask({ endConditions: { completionAuthority: "user-confirm" } });
  try {
    const waiting = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "waiting-approval");
    assert.equal(waiting.run.checkerAttempts.length, 1);
    assert.equal(waiting.run.checkerAttempts[0].status, "succeeded");
    assert.equal(waiting.run.checkerVerdicts[0].verdict, "approve");
    const checkerTurn = waiting.run.turns.find((turn) => turn.id === waiting.run.checkerAttempts[0].turnId);
    assert.equal(checkerTurn?.decisionId, waiting.run.checkerAttempts[0].primaryDecisionId);
    assert.equal(runtime.conversations.some((conversation) => conversation.source === "task-orchestrator-v2-checker"), true);
    const checkerStart = runtime.startCalls.find((call) => call.input.taskProfileId === "checker-independent");
    assert.deepEqual(checkerStart.input.taskTools, []);
    assert.equal(checkerStart.input.taskControlPlane, null);
    assert.match(checkerStart.input.prompt, /No delegation tools/);
    const approved = await orchestrator.resolveGate({ taskRunId: waiting.run.id, gateId: waiting.gates[0].id, decision: "approve" });
    assert.equal(approved.run.status, "succeeded");
  } finally {
    await orchestrator.close();
  }
});

test("revise persists checker feedback and creates exactly one fresh primary before the next checker round", async () => {
  const { orchestrator, created } = await runTask({ checkerVerdicts: ["revise", "approve"], maxRounds: 2 });
  try {
    const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
    assert.equal(finished.run.checkerVerdicts.map((verdict) => verdict.verdict).join(","), "revise,approve");
    assert.equal(finished.run.primaryAttempts.length, 2);
    assert.equal(finished.run.checkerAttempts.length, 2);
    for (const checkerAttempt of finished.run.checkerAttempts) {
      const checkerTurn = finished.run.turns.find((turn) => turn.id === checkerAttempt.turnId);
      assert.equal(checkerTurn?.decisionId, checkerAttempt.primaryDecisionId);
    }
    assert.equal(finished.run.continuationCapsules.length, 1);
    assert.match(finished.run.continuationCapsules[0].summary, /fresh Primary/);
  } finally {
    await orchestrator.close();
  }
});

test("block and parse/provider failure fail closed and never succeed", async () => {
  const blocked = await runTask({ checkerVerdicts: ["block"], maxRounds: 1 });
  try {
    const snapshot = await waitForSnapshot(blocked.orchestrator, blocked.created.task.id, (value) => value.run?.status === "blocked");
    assert.equal(snapshot.run.checkerVerdicts[0].verdict, "block");
  } finally {
    await blocked.orchestrator.close();
  }

  const failed = await runTask({ checkerVerdicts: ["parse-failure"], maxRounds: 1 });
  try {
    const checkerStart = failed.runtime.startCalls;
    // Replace the checker output only through the runtime behavior contract by
    // forcing an invalid provider payload after the primary is already queued.
    assert.equal(Array.isArray(checkerStart), true);
    const snapshot = await waitForSnapshot(failed.orchestrator, failed.created.task.id, (value) => value.run?.status === "blocked");
    assert.equal(snapshot.run.checkerAttempts[0].status, "blocked");
    assert.equal(snapshot.run.checkerVerdicts.length, 0);
  } finally {
    await failed.orchestrator.close();
  }
});

test("stop fences and cancels an active independent checker", async () => {
  const context = await runTask({ checkerRunning: true, maxRounds: 1 });
  try {
    const running = await waitForSnapshot(context.orchestrator, context.created.task.id, (value) => (
      value.run?.checkerAttempts[0]?.status === "running" && value.run.checkerAttempts[0].personalRunId
    ));
    const checkerRunId = running.run.checkerAttempts[0].personalRunId;
    const stopped = await context.orchestrator.stopTask({ taskRunId: running.run.id });
    assert.equal(stopped.run.status, "cancelled");
    assert.equal(stopped.run.checkerAttempts[0].status, "cancelled");
    assert.equal(stopped.run.checkerAttempts[0].leaseId, null);
    assert.equal(context.runtime.cancelCalls.some((call) => call.runId === checkerRunId), true);
  } finally {
    await context.orchestrator.close();
  }
});

test("pause and quit both fence an active independent checker", async () => {
  const pausedContext = await runTask({ checkerRunning: true, maxRounds: 1 });
  try {
    const running = await waitForSnapshot(pausedContext.orchestrator, pausedContext.created.task.id, (value) => (
      value.run?.checkerAttempts[0]?.status === "running" && value.run.checkerAttempts[0].personalRunId
    ));
    const checkerRunId = running.run.checkerAttempts[0].personalRunId;
    const paused = await pausedContext.orchestrator.pauseTask({ taskRunId: running.run.id });
    assert.equal(paused.run.status, "paused");
    assert.equal(paused.run.checkerAttempts[0].status, "cancelled");
    assert.equal(paused.run.checkerAttempts[0].leaseId, null);
    assert.equal(pausedContext.runtime.cancelCalls.some((call) => call.runId === checkerRunId), true);
  } finally {
    await pausedContext.orchestrator.close();
  }

  const quitContext = await runTask({ checkerRunning: true, maxRounds: 1 });
  const running = await waitForSnapshot(quitContext.orchestrator, quitContext.created.task.id, (value) => (
    value.run?.checkerAttempts[0]?.status === "running" && value.run.checkerAttempts[0].personalRunId
  ));
  const checkerRunId = running.run.checkerAttempts[0].personalRunId;
  const drained = await quitContext.orchestrator.pauseAllAndDrain("explicit_quit");
  assert.deepEqual(drained.pausedRunIds, [running.run.id]);
  const durable = await quitContext.store.requireRun(running.run.taskId, running.run.id);
  assert.equal(durable.status, "paused");
  assert.equal(durable.checkerAttempts[0].status, "cancelled");
  assert.equal(durable.checkerAttempts[0].leaseId, null);
  assert.equal(quitContext.runtime.cancelCalls.some((call) => call.runId === checkerRunId), true);
});

test("primary retry supersedes and cancels an active independent checker", async () => {
  const context = await runTask({ checkerRunning: true, retryPrimaryRunning: true, maxRounds: 1 });
  try {
    const running = await waitForSnapshot(context.orchestrator, context.created.task.id, (value) => (
      value.run?.checkerAttempts[0]?.status === "running" && value.run.checkerAttempts[0].personalRunId
    ));
    const checkerRunId = running.run.checkerAttempts[0].personalRunId;
    const failed = structuredClone(await context.store.requireRun(running.run.taskId, running.run.id));
    const primary = failed.primaryAttempts.at(-1);
    primary.status = "failed";
    primary.error = "Synthetic primary failure while checker cleanup is pending.";
    primary.finishedAt = Date.now();
    failed.status = "failed";
    failed.error = primary.error;
    failed.finishedAt = primary.finishedAt;
    failed.updatedAt = primary.finishedAt;
    await context.store.writeRun(failed);

    await context.orchestrator.retryPrimary({ taskRunId: failed.id, attemptId: primary.id });
    const retried = await context.orchestrator.getTask({ taskId: failed.taskId });
    assert.equal(retried.run.checkerAttempts[0].status, "cancelled");
    assert.equal(retried.run.checkerAttempts[0].leaseId, null);
    assert.equal(context.runtime.cancelCalls.some((call) => call.runId === checkerRunId), true);
    assert.equal(retried.run.primaryAttempts.length, 2);
  } finally {
    await context.orchestrator.close();
  }
});

test("a checker start result cannot outlive a stale durable lease", async () => {
  const context = await runTask({ revokeCheckerLeaseOnStart: true, maxRounds: 1 });
  try {
    const cancelled = await waitForSnapshot(context.orchestrator, context.created.task.id, (value) => (
      value.run?.status === "cancelled"
      && context.runtime.cancelCalls.some((call) => call.options?.taskOperation === true && call.runId)
    ));
    assert.equal(cancelled.run.checkerAttempts[0].status, "cancelled");
    assert.equal(cancelled.run.checkerAttempts[0].leaseId, null);
    assert.equal(context.runtime.cancelCalls.some((call) => (
      call.options?.taskOperation === true
      && call.runId === context.runtime.startCalls.find((entry) => entry.input.taskProfileId === "checker-independent")?.runId
    )), true);
  } finally {
    await context.orchestrator.close();
  }
});
