import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { taskOrchestratorContinuationCapsuleSchema } from "@onmyagent/types/task-orchestrator";

import { createTaskOrchestrator } from "./index.mjs";
import {
  cleanupDirectories,
  contract,
  createRuntime,
  selection,
  taskInput,
  temporaryDirectory,
  waitForSnapshot,
} from "./v2-test-helpers.mjs";
import { assertContinuationCapsuleIdentity, buildContinuationRecords, contextUsageFromSnapshot, continuationPrompt, hydrateContinuationCapsuleEvidence, refreshRunBudget } from "./turns.mjs";
import { isTransientProviderFailure } from "./retry-policy.mjs";

describe("Task Center durable turns", () => {
  const temporaryDirectories = [];
  afterEach(async () => cleanupDirectories(temporaryDirectories.splice(0)));

  it("aggregates numeric provider usage across primary, worker, and checker attempts", () => {
    const usage = (totalTokens, costMicros) => ({ inputTokens: null, outputTokens: null, totalTokens, costMicros, observedAt: 10 });
    const attempt = (providerUsage) => ({ status: "succeeded", startedAt: 1, personalRunId: "run", providerUsage });
    const run = {
      createdAt: 1,
      startedAt: 1,
      definition: { endConditions: {} },
      turns: [{ reason: "initial" }],
      primaryAttempts: [attempt(usage(100, 10))],
      workerAttempts: [attempt(usage(50, 20))],
      checkerAttempts: [attempt(usage(20, 30))],
      budget: null,
    };
    const budget = refreshRunBudget(run, () => 100);
    assert.equal(budget.tokensUsed, 170);
    assert.equal(budget.costMicrosUsed, 60);

    run.workerAttempts.push(attempt(null));
    const unknown = refreshRunBudget(run, () => 110);
    assert.equal(unknown.tokensUsed, null);
    assert.equal(unknown.costMicrosUsed, null);
  });

  it("classifies a terminal Codex stream disconnect as a transient provider failure", () => {
    assert.equal(isTransientProviderFailure("codex ACP stream disconnected before completion. error sending request for url"), true);
  });

  it("carries bounded durable evidence into a fresh context before pending work", () => {
    let id = 0;
    const run = {
      taskId: "task-1",
      id: "run-1",
      taskRevision: 1,
      definition: {
        workspaceRoot: "/workspace",
        contract: { acceptance: ["Produce the architecture report"] },
        endConditions: { maxPrimaryTurns: 24, maxWorkerAttempts: 10, maxElapsedMs: 86_400_000, maxTokens: null, maxCostMicros: null, deadlineAt: null },
      },
      permissionGrant: null,
      budget: { primaryTurnsUsed: 1, workerAttemptsUsed: 0, elapsedMs: 100, tokensUsed: null, costMicrosUsed: null },
      workerAttempts: [],
      sideEffects: [],
      continuationCapsules: [],
    };
    const turn = { id: "turn-1", primaryAttemptId: "primary-1", workerAttemptIds: [] };
    const decision = { id: "decision-1", summary: "Automatic rollover", nextAction: "Synthesize now", acceptanceResults: [] };
    const artifacts = [{
      id: "artifact-1",
      attemptId: "primary-1",
      kind: "primary",
      summary: "Prior inspection",
      content: "Kiro uses a durable scheduler; OnMyAgent currently has split scheduling authorities.",
      evidence: [{ label: "/workspace/docs/Architecture.md:120" }],
    }];
    const { capsule } = buildContinuationRecords({ run, turn, decision, artifacts, context: null, createId: (prefix) => `${prefix}-${++id}`, now: () => 200, trigger: "context-threshold" });
    assert.equal(capsule.workspaceEvidence[0].contentExcerpt.includes("split scheduling authorities"), true);
    assert.deepEqual(capsule.workspaceEvidence[0].evidenceLabels, ["/workspace/docs/Architecture.md:120"]);
    const prompt = continuationPrompt(capsule);
    assert.equal(prompt.indexOf("Durable evidence excerpts") < prompt.indexOf("Next work:"), true);
    assert.match(prompt, /do not repeat covered scans/i);

    run.continuationCapsules.push(capsule);
    const nextTurn = { id: "turn-2", primaryAttemptId: "primary-2", workerAttemptIds: [] };
    const nextDecision = { id: "decision-2", summary: "Second rollover", nextAction: "Write the final synthesis", acceptanceResults: [] };
    const nextArtifacts = [...artifacts, {
      id: "artifact-2",
      attemptId: "primary-2",
      kind: "primary",
      summary: "Second turn",
      content: "",
      evidence: [{ label: "tool (completed)" }],
    }];
    const { capsule: cumulative } = buildContinuationRecords({ run, turn: nextTurn, decision: nextDecision, artifacts: nextArtifacts, context: null, createId: (prefix) => `${prefix}-${++id}`, now: () => 300, trigger: "context-threshold" });
    assert.equal(cumulative.workspaceEvidence.some((item) => item.artifactId === "artifact-1" && item.contentExcerpt.includes("split scheduling authorities")), true);
    assert.deepEqual(cumulative.artifactIds, ["artifact-1", "artifact-2"]);
  });

  it("keeps legacy workspace evidence capsules readable after excerpt fields were added", () => {
    const parsed = taskOrchestratorContinuationCapsuleSchema.parse({
      capsuleVersion: 1,
      id: "capsule-legacy",
      fromTurnId: "turn-legacy",
      summary: "legacy checkpoint",
      completed: [],
      pending: [],
      risks: [],
      artifactIds: ["artifact-legacy"],
      workspaceEvidence: [{
        artifactId: "artifact-legacy",
        attemptId: "primary-legacy",
        kind: "primary",
        evidenceCount: 1,
      }],
      workerMail: [],
      remainingBudget: { primaryTurns: 1, workerAttempts: 1, elapsedMs: 1, tokens: null, costMicros: null, deadlineAt: null },
      unresolvedSideEffects: [],
      nextAction: "continue",
      lastDecisionId: null,
      context: null,
      createdAt: 1,
    });
    assert.equal(parsed.workspaceEvidence[0].summary, "");
    assert.equal(parsed.workspaceEvidence[0].contentExcerpt, "");
    const hydrated = hydrateContinuationCapsuleEvidence(parsed, [{
      id: "artifact-legacy",
      attemptId: "primary-legacy",
      kind: "primary",
      summary: "Prior architecture comparison",
      content: "The durable scheduler evidence is already collected.",
      evidence: [{ label: "/workspace/Architecture.md:42" }],
    }]);
    assert.equal(hydrated.workspaceEvidence[0].summary, "Prior architecture comparison");
    assert.match(hydrated.workspaceEvidence[0].contentExcerpt, /already collected/);
  });

  it("checkpoints one primary turn and continues in a fresh provider session", async () => {
    const userDataDir = await temporaryDirectory("task-turns-user-");
    const workspaceRoot = await temporaryDirectory("task-turns-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let primaryTurn = 0;
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        } else if (input.taskControlPlane?.continue_task) {
          primaryTurn += 1;
          const state = await input.taskControlPlane.get_task_state();
          if (primaryTurn === 1) {
            await input.taskControlPlane.continue_task({
              summary: "The first bounded turn completed its inspection.",
              nextAction: "Finish the acceptance verification in a fresh session.",
              acceptanceResults: [],
            });
          } else {
            await input.taskControlPlane.complete_task({
              summary: "The second bounded turn completed the task.",
              acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
                criterionIndex,
                status: "passed",
                summary: `Verified: ${criterion}`,
                evidenceArtifactIds: [],
              })),
            });
          }
        }
        return { output: `turn ${primaryTurn} completed` };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
      }));
      const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.turns.length, 2);
      assert.equal(finished.run.checkpoints.length, 1);
      assert.equal(finished.run.continuationCapsules.length, 1);
      assert.equal(finished.run.primaryAttempts.length, 2);
      assert.equal(finished.run.turns[0].status, "succeeded");
      assert.equal(finished.run.turns[1].status, "succeeded");
      assert.notEqual(finished.run.primaryAttempts[0].conversationId, finished.run.primaryAttempts[1].conversationId);
      assert.match(finished.run.primaryAttempts[1].prompt, /durable continuation capsule/i);
      const [capsule] = finished.run.continuationCapsules;
      assert.equal(capsule.capsuleVersion, 1);
      assert.equal(capsule.taskId, finished.task.id);
      assert.equal(capsule.taskRunId, finished.run.id);
      assert.equal(capsule.taskRevision, finished.run.taskRevision);
      assert.match(capsule.contractHash, /^[a-f0-9]{64}$/);
      assert.match(capsule.workspaceRootHash, /^[a-f0-9]{64}$/);
      assert.equal(capsule.nextAction, "Finish the acceptance verification in a fresh session.");
      assert.equal(capsule.remainingBudget.primaryTurns, 23);
      assert.deepEqual(capsule.acceptanceResults, []);
      assert.deepEqual(capsule.workerMail, []);
      assert.deepEqual(capsule.unresolvedSideEffects, []);
      assert.equal(assertContinuationCapsuleIdentity(finished.run, capsule), true);
      assert.throws(
        () => assertContinuationCapsuleIdentity(finished.run, { ...capsule, contractHash: "0".repeat(64) }),
        /does not match the frozen task identity/,
      );
      assert.match(finished.run.primaryAttempts[1].prompt, /Frozen identity:/);
      assert.doesNotMatch(finished.run.primaryAttempts[1].prompt, new RegExp(workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
      await orchestrator.close();
    }
  });

  it("blocks a continuation before exceeding the frozen primary-turn budget", async () => {
    const userDataDir = await temporaryDirectory("task-turn-limit-user-");
    const workspaceRoot = await temporaryDirectory("task-turn-limit-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) await input.taskControlPlane.propose_contract({ contract: contract() });
        else if (input.taskControlPlane?.continue_task) {
          await input.taskControlPlane.continue_task({
            summary: "More work remains.",
            nextAction: "Continue beyond the configured limit.",
            acceptanceResults: [],
          });
        }
        return { output: "bounded turn" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
        endConditions: { maxPrimaryTurns: 1 },
      }));
      const blocked = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "blocked");
      assert.match(blocked.run.error, /Maximum primary turn count reached/);
      assert.equal(blocked.run.primaryAttempts.length, 1);
      assert.equal(blocked.run.turns.length, 1);
    } finally {
      await orchestrator.close();
    }
  });

  it("normalizes the latest provider context snapshot for durable checkpointing", () => {
    const observed = contextUsageFromSnapshot({
      conversationMessages: [
        { type: "context_usage", contextUsage: { used: 80, total: 100, totalSource: "runtime", modelId: "model-1" } },
      ],
    }, () => 42, "fallback-model");
    assert.deepEqual(observed, {
      usedTokens: 80,
      totalTokens: 100,
      percent: 80,
      source: "runtime",
      modelId: "model-1",
      observedAt: 42,
    });
  });

  it("rolls over before context exhaustion and fences the old provider run", async () => {
    const userDataDir = await temporaryDirectory("task-context-rollover-user-");
    const workspaceRoot = await temporaryDirectory("task-context-rollover-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let primaryTurn = 0;
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        primaryTurn += 1;
        if (primaryTurn === 1) {
          return {
            status: "running",
            output: "Partial work captured before rollover.",
            conversationMessages: [{
              type: "context_usage",
              contextUsage: { used: 85, total: 100, totalSource: "runtime", modelId: "primary-model" },
            }],
          };
        }
        const state = await input.taskControlPlane.get_task_state();
        await input.taskControlPlane.complete_task({
          summary: "Completed after automatic context rollover.",
          acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
            criterionIndex,
            status: "passed",
            summary: `Verified after rollover: ${criterion}`,
            evidenceArtifactIds: [],
          })),
        });
        return { output: "fresh session completed" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
      }));
      const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.turns.length, 2);
      assert.equal(finished.run.turns[0].context.percent, 85);
      assert.equal(finished.run.primaryDecisions[0].kind, "checkpoint");
      assert.equal(finished.run.checkpoints[0].trigger, "context-threshold");
      assert.equal(finished.run.turns[1].reason, "context-rollover");
      assert.equal(runtime.cancelCalls.some((call) => call.options?.reason === "task-context-rollover"), true);
    } finally {
      await orchestrator.close();
    }
  });

  it("does not start a fresh context turn unless cancellation of the old provider is confirmed", async () => {
    const userDataDir = await temporaryDirectory("task-context-fence-failure-user-");
    const workspaceRoot = await temporaryDirectory("task-context-fence-failure-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let executionTurns = 0;
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        executionTurns += 1;
        return {
          status: "running",
          output: "unsafe to overlap",
          conversationMessages: [{
            type: "context_usage",
            contextUsage: { used: 90, total: 100, totalSource: "runtime", modelId: "primary-model" },
          }],
        };
      },
      cancel: async () => ({ ok: false, error: "provider process group is still alive" }),
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
      }));
      const failed = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "failed");
      assert.match(failed.run.error, /could not fence the old provider run/i);
      assert.equal(executionTurns, 1);
      assert.equal(failed.run.turns.length, 1);
      assert.equal(failed.run.primaryAttempts.length, 1);
      assert.equal(failed.run.primaryAttempts[0].status, "failed");
      assert.equal(failed.run.primaryDecisions[0].kind, "checkpoint");
    } finally {
      await orchestrator.close();
    }
  });

  it("uses a bounded time-based rollover when provider context telemetry is unavailable", async () => {
    const userDataDir = await temporaryDirectory("task-context-fallback-user-");
    const workspaceRoot = await temporaryDirectory("task-context-fallback-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let clock = 1;
    let executionTurns = 0;
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        executionTurns += 1;
        if (executionTurns === 1) return { status: "running", output: "progress without usage telemetry" };
        const state = await input.taskControlPlane.get_task_state();
        await input.taskControlPlane.complete_task({
          summary: "Completed after time-based context recycling.",
          acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
            criterionIndex,
            status: "passed",
            summary: `Verified after fallback rollover: ${criterion}`,
            evidenceArtifactIds: [],
          })),
        });
        return { output: "fresh fallback session completed" };
      },
    });
    let orchestrator;
    orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      now: () => clock,
      sleep: async () => { clock += 30_000; },
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
        primary: { ...selection(), timeoutMs: 120_000 },
        endConditions: { maxTurnRuntimeMs: 120_000, stallTimeoutMs: 120_000 },
      }));
      const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(executionTurns, 2);
      assert.equal(finished.run.turns.length, 2);
      assert.equal(finished.run.primaryDecisions[0].kind, "checkpoint");
      assert.equal(finished.run.checkpoints[0].trigger, "context-threshold");
      assert.equal(finished.run.turns[1].reason, "context-rollover");
      assert.match(finished.run.primaryDecisions[0].summary, /did not report usable context telemetry/i);
      assert.equal(runtime.cancelCalls.some((call) => call.options?.reason === "task-context-rollover"), true);
    } finally {
      await orchestrator.close();
    }
  });

  it("blocks a continuation when a configured token budget cannot be measured", async () => {
    const userDataDir = await temporaryDirectory("task-token-budget-unknown-user-");
    const workspaceRoot = await temporaryDirectory("task-token-budget-unknown-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) await input.taskControlPlane.propose_contract({ contract: contract() });
        else await input.taskControlPlane.continue_task({
          summary: "A second turn would be needed.",
          nextAction: "Continue without token telemetry.",
          acceptanceResults: [],
        });
        return { output: "provider omitted usage" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
        endConditions: { maxTokens: 50_000 },
      }));
      const blocked = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "blocked");
      assert.match(blocked.run.error, /token budget cannot be verified/i);
      assert.equal(blocked.run.primaryAttempts.length, 1);
      assert.equal(blocked.run.budget.tokensUsed, null);
    } finally {
      await orchestrator.close();
    }
  });

  it("persists numeric-only provider usage and blocks completion after exceeding the cost budget", async () => {
    const userDataDir = await temporaryDirectory("task-cost-budget-user-");
    const workspaceRoot = await temporaryDirectory("task-cost-budget-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const secret = "sk-provider-usage-must-not-persist";
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        const state = await input.taskControlPlane.get_task_state();
        await input.taskControlPlane.complete_task({
          summary: "The provider completed the frozen acceptance checks.",
          acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
            criterionIndex,
            status: "passed",
            summary: `Verified: ${criterion}`,
            evidenceArtifactIds: [],
          })),
        });
        return {
          output: "completed with measured usage",
          usage: { inputTokens: 60, outputTokens: 40, totalTokens: 100, costMicros: 150 },
          metadata: { apiKey: secret, billing: { account: secret } },
        };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
        endConditions: { maxTokens: 1_000, maxCostMicros: 100 },
      }));
      const blocked = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "blocked");
      assert.match(blocked.run.error, /cost budget reached/i);
      assert.equal(blocked.run.primaryAttempts[0].providerUsage.totalTokens, 100);
      assert.equal(blocked.run.primaryAttempts[0].providerUsage.costMicros, 150);
      assert.equal(blocked.run.budget.tokensUsed, 100);
      assert.equal(blocked.run.budget.costMicrosUsed, 150);
      assert.doesNotMatch(JSON.stringify(blocked), new RegExp(secret));
    } finally {
      await orchestrator.close();
    }
  });

  it("fails closed before final success when configured usage cannot be measured", async () => {
    const userDataDir = await temporaryDirectory("task-final-usage-user-");
    const workspaceRoot = await temporaryDirectory("task-final-usage-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      autoCompletePrimary: true,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) await input.taskControlPlane.propose_contract({ contract: contract() });
        return { output: "provider omitted all billable usage" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
        endConditions: { maxCostMicros: 1_000_000 },
      }));
      const blocked = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "blocked");
      assert.match(blocked.run.error, /cost budget cannot be verified/i);
      assert.equal(blocked.run.budget.costMicrosUsed, null);
    } finally {
      await orchestrator.close();
    }
  });

  it("fails a provider turn when liveness proves an unowned stdin wait", async () => {
    const userDataDir = await temporaryDirectory("task-stall-user-");
    const workspaceRoot = await temporaryDirectory("task-stall-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let clock = 1;
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        return { status: "running", output: "", events: [], pid: 424242, waitingForInput: true };
      },
    });
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      now: () => clock,
      sleep: async () => { clock += 30_000; },
      pollMs: 1, awaitAlignment: true,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
        primary: { ...selection(), timeoutMs: 120_000 },
        endConditions: { stallTimeoutMs: 60_000, maxTurnRuntimeMs: 120_000 },
      }));
      const failed = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "failed");
      assert.match(failed.run.error, /liveness was STUCK_INPUT: stdin-wait/i);
      assert.equal(runtime.cancelCalls.some((call) => call.options?.reason === "task-liveness-stuck_input"), true);
    } finally {
      await orchestrator.close();
    }
  });

  it("retries a transient WebSocket-to-HTTPS timeout in a fresh bounded turn", async () => {
    const userDataDir = await temporaryDirectory("task-transport-retry-user-");
    const workspaceRoot = await temporaryDirectory("task-transport-retry-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let primaryTurn = 0;
    const delays = [];
    const runtime = createRuntime({
      autoCompletePrimary: false,
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        primaryTurn += 1;
        if (primaryTurn === 1) {
          return {
            status: "failed",
            error: "Warning: Falling back from WebSockets to HTTPS transport. request timed out",
          };
        }
        const state = await input.taskControlPlane.get_task_state();
        await input.taskControlPlane.complete_task({
          summary: "Recovered after a transient transport timeout.",
          acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
            criterionIndex,
            status: "passed",
            summary: `Verified after retry: ${criterion}`,
            evidenceArtifactIds: [],
          })),
        });
        return { output: "retry completed" };
      },
    });
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      pollMs: 1, awaitAlignment: true,
      sleep: async (ms) => { delays.push(ms); },
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
      }));
      const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.turns.length, 2);
      assert.equal(finished.run.turns[0].status, "failed");
      assert.equal(finished.run.turns[1].reason, "transport-retry");
      assert.equal(finished.run.budget.transportRetries, 1);
      assert.deepEqual(delays, [], "transport backoff is owned by the durable notBefore wake, not an in-memory sleep");
      assert.equal(finished.run.primaryAttempts[1].notBefore, null, "beginAttempt clears the durable backoff fence");
      assert.notEqual(finished.run.primaryAttempts[0].conversationId, finished.run.primaryAttempts[1].conversationId);
    } finally {
      await orchestrator.close();
    }
  });

  it("does not misclassify a long-running tool as a silent provider stall", async () => {
    const userDataDir = await temporaryDirectory("task-working-tool-user-");
    const workspaceRoot = await temporaryDirectory("task-working-tool-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let clock = 1;
    let polls = 0;
    const workingEvent = {
      type: "tool",
      at: 1,
      toolCall: { id: "tool-long", kind: "read", status: "in_progress", name: "inspect long local verification" },
    };
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        return { status: "running", output: "", events: [workingEvent] };
      },
      getRun: async ({ current }) => {
        polls += 1;
        if (polls < 4) return current;
        return { ...current, status: "completed", output: "long verification completed" };
      },
    });
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      now: () => clock,
      sleep: async () => { clock += 30_000; },
      pollMs: 1, awaitAlignment: true,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
        primary: { ...selection(), timeoutMs: 180_000 },
        endConditions: { stallTimeoutMs: 60_000, maxTurnRuntimeMs: 180_000 },
      }));
      const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.status, "succeeded");
      assert.equal(runtime.cancelCalls.some((call) => call.options?.reason === "task-turn-stalled"), false);
    } finally {
      await orchestrator.close();
    }
  });

  it("subtracts a multi-hour suspend gap from active turn budgets and reaches terminal success", async () => {
    const userDataDir = await temporaryDirectory("task-suspend-gap-user-");
    const workspaceRoot = await temporaryDirectory("task-suspend-gap-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let clock = 1;
    let polls = 0;
    const suspensionMs = 3 * 60 * 60 * 1_000;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        return { status: "running", output: "waiting through suspend" };
      },
      getRun: async ({ current }) => {
        polls += 1;
        if (polls < 3) return current;
        return { ...current, status: "completed", output: "completed after wake" };
      },
    });
    let orchestrator;
    orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      now: () => clock,
      sleep: async () => {
        orchestrator.recordPowerEvent({ type: "suspend", at: clock });
        clock += suspensionMs;
        orchestrator.recordPowerEvent({ type: "resume", at: clock });
      },
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
        primary: { ...selection(), timeoutMs: 120_000 },
        endConditions: { stallTimeoutMs: 60_000, maxTurnRuntimeMs: 120_000 },
      }));
      const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.status, "succeeded");
      assert.equal(finished.run.turns.length, 1);
      assert.equal(polls, 3);
      assert.equal(runtime.cancelCalls.some((call) => ["task-turn-stalled", "task-turn-timeout"].includes(call.options?.reason)), false);
    } finally {
      await orchestrator.close();
    }
  });

  it("counts a multi-hour clock gap as a timeout when no OS suspend event was recorded", async () => {
    const userDataDir = await temporaryDirectory("task-stall-gap-user-");
    const workspaceRoot = await temporaryDirectory("task-stall-gap-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let clock = 1;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        return { status: "running", output: "stalled provider" };
      },
      getRun: async ({ current }) => current,
    });
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      now: () => clock,
      sleep: async () => { clock += 3 * 60 * 60 * 1_000; },
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
        primary: { ...selection(), timeoutMs: 120_000 },
        endConditions: { stallTimeoutMs: 60_000, maxTurnRuntimeMs: 120_000 },
      }));
      const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => ["blocked", "failed"].includes(snapshot.run?.status));
      assert.equal(["blocked", "failed"].includes(finished.run.status), true);
      assert.equal(runtime.cancelCalls.some((call) => ["task-deadline", "task-turn-timeout"].includes(call.options?.reason)), true);
    } finally {
      await orchestrator.close();
    }
  });
});
