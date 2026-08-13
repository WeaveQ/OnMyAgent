import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";

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

const temporaryDirectories = [];

afterEach(async () => {
  await cleanupDirectories(temporaryDirectories.splice(0));
});

function createManualRuntime() {
  return createRuntime({
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract && /freeze|contract/i.test(input.prompt) && !/Start an interactive alignment/i.test(input.prompt)) {
        await input.taskControlPlane.propose_contract({ contract: contract({ outcome: "The aligned outcome is frozen." }) });
      }
      return { output: "A prose response that is deliberately not JSON." };
    },
  });
}

describe("Task Center v2 lifecycle", () => {
  it("canonicalizes display labels from the live catalog while preserving stable ids", async () => {
    const userDataDir = await temporaryDirectory("task-v2-label-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-label-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: createRuntime(), pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        primary: { ...selection(), label: "Old primary label", modelLabel: "old-primary-model-label" },
        allowedWorkers: [{
          ...selection("worker-agent", "claude", "worker-model", "Old worker label"),
          modelLabel: "old-worker-model-label",
        }],
      }));
      assert.equal(created.task.primary.agentId, "primary-agent");
      assert.equal(created.task.primary.label, "Primary");
      assert.equal(created.task.primary.model, "primary-model");
      assert.equal(created.task.primary.modelLabel, "Primary model");
      assert.equal(created.task.allowedWorkers[0].label, "Worker");
      assert.equal(created.task.allowedWorkers[0].modelLabel, "Worker model");
    } finally {
      await orchestrator.close();
    }
  });

  it("keeps alignment proposals structured, verifies revision, then starts one primary owner", async () => {
    const userDataDir = await temporaryDirectory("task-v2-manual-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-manual-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createManualRuntime();
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot));
      assert.equal(created.task.definitionStatus, "alignment");
      assert.equal(created.task.contract, null);
      assert.equal(runtime.startCalls[0].input.approvalMode, "read-only-auto");
      const listed = await orchestrator.listTasks({ workspaceRoot });
      assert.deepEqual(listed.tasks.map((task) => task.id), [created.task.id]);

      const aligned = await orchestrator.sendAlignmentMessage({ taskId: created.task.id, text: "Please freeze the contract." });
      assert.equal(aligned.task.definitionStatus, "awaiting-confirmation");
      assert.equal(aligned.task.alignment.proposals.length, 1);
      assert.equal(aligned.task.alignment.messages.at(-1).text, "A prose response that is deliberately not JSON.");
      assert.equal(aligned.task.contract, null);
      const proposal = aligned.task.alignment.proposals[0];
      assert.equal(aligned.events.find((event) => event.type === "contract-proposed").proposalId, proposal.id);
      assert.equal(aligned.events.find((event) => event.type === "contract-proposed").proposalRevision, proposal.revision);

      const frozen = await orchestrator.finalizeContract({
        taskId: created.task.id,
        expectedRevision: aligned.task.revision,
        proposalId: proposal.id,
        proposalRevision: proposal.revision,
      });
      assert.equal(frozen.task.definitionStatus, "ready");
      assert.equal(frozen.task.contract.outcome, "The aligned outcome is frozen.");
      await assert.rejects(
        orchestrator.finalizeContract({
          taskId: created.task.id,
          expectedRevision: frozen.task.revision,
          proposalId: proposal.id,
          proposalRevision: proposal.revision + 1,
        }),
        /stale or missing/,
      );

      const queued = await orchestrator.startTask({ taskId: created.task.id });
      const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(queued.run.primaryAttempts.length, 1);
      assert.equal(finished.run.primaryAttempts.length, 1);
      assert.equal(finished.run.workerAttempts.length, 0);
      assert.equal(finished.run.primaryAttempts[0].depth, 0);
      assert.equal(runtime.startCalls.filter(({ input }) => input.taskDepth === 0).length >= 2, true);
      const primaryPrompt = runtime.startCalls.find(({ input }) => input.taskTools?.includes("spawn_agent")).input.prompt;
      assert.match(primaryPrompt, /^CURRENT PHASE: TASK EXECUTION\./);
      assert.match(primaryPrompt, /Do not submit another contract proposal/);
      assert.match(primaryPrompt, /Original task idea \(background only; the frozen contract is authoritative\)/);
      assert.match(primaryPrompt, /mcp\.onmyagent-task-control\.spawn_agent/);
      assert.match(primaryPrompt, /Never use provider-native collaboration or subagent tools/);
    } finally {
      await orchestrator.close();
    }
  });

  it("fails fast and cancels when restricted read-only alignment still requests approval", async () => {
    const userDataDir = await temporaryDirectory("task-v2-alignment-approval-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-alignment-approval-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => input.taskTools?.includes("propose_contract")
        ? { status: "waiting-approval", pendingApprovals: [{ id: "alignment-approval", kind: "command", command: "cat" }], output: "approval required" }
        : { output: "alignment" },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot));
      const failed = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.task.alignment.status === "failed");
      assert.match(failed.task.alignment.error, /Read-only task alignment requires no approval/);
      assert.equal(runtime.startCalls[0].input.approvalMode, "read-only-auto");
      assert.equal(runtime.cancelCalls.length >= 1, true);
    } finally {
      await orchestrator.close();
    }
  });

  it("auto-approves only the task-scoped structured contract proposal during alignment", async () => {
    const userDataDir = await temporaryDirectory("task-v2-alignment-contract-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-alignment-contract-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const toolCallId = "contract-tool-call-1";
    let alignmentInput;
    const approvalCalls = [];
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (!input.taskTools?.includes("propose_contract")) return { output: "execution" };
        alignmentInput = input;
        return {
          status: "waiting-approval",
          output: "contract proposal approval required",
          pendingApprovals: [{
            id: "contract-approval-1",
            provider: "codex",
            method: "session/request_permission",
            kind: "command",
            command: null,
            cwd: workspaceRoot,
            params: { toolCall: { toolCallId }, _meta: { is_mcp_tool_approval: true } },
          }],
          events: [{
            type: "acp_tool_call",
            text: JSON.stringify({
              sessionUpdate: "tool_call",
              toolCallId,
              rawInput: { server: "onmyagent-task-control", tool: "propose_contract", arguments: { contract: contract() } },
              _meta: { is_mcp_tool_call: true },
            }),
          }],
        };
      },
      resolveApproval: async ({ input, runs }) => {
        approvalCalls.push(input);
        await alignmentInput.taskControlPlane.propose_contract({ contract: contract({ outcome: "Approved structured contract." }) });
        const current = runs.get(input.runId);
        runs.set(input.runId, { ...current, status: "completed", pendingApprovals: [], output: "proposal submitted" });
        return { ok: true };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const aligned = await orchestrator.createTask(taskInput(workspaceRoot));
      assert.equal(aligned.task.definitionStatus, "awaiting-confirmation");
      assert.equal(aligned.task.alignment.proposals[0].contract.outcome, "Approved structured contract.");
      assert.deepEqual(approvalCalls, [{ runId: runtime.startCalls[0].runId, approvalId: "contract-approval-1", decision: "accept" }]);
      assert.equal(runtime.cancelCalls.length, 0);
    } finally {
      await orchestrator.close();
    }
  });

  it("freezes a model proposal atomically and allows a primary that delegates to no worker to succeed", async () => {
    const userDataDir = await temporaryDirectory("task-v2-auto-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-auto-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract({ outcome: "Auto-frozen outcome." }) });
        }
        return { output: "The model recommendation is prose, not a contract payload." };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto", allowedWorkers: [] }));
      assert.ok(started.run);
      assert.equal(started.task.latestRunId, started.run.id);
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.task.definitionStatus, "ready");
      assert.equal(finished.task.contract.outcome, "Auto-frozen outcome.");
      assert.equal(finished.run.primaryAttempts.length, 1);
      assert.equal(finished.run.workerAttempts.length, 0);
      assert.equal(runtime.startCalls.some(({ input }) => input.taskDepth === 0 && input.taskControlPlane && input.taskTools.includes("spawn_agent")), true);
      assert.equal(runtime.startCalls.find(({ input }) => input.taskDepth === 0 && input.taskTools.includes("spawn_agent")).input.approvalMode, "ask");
    } finally {
      await orchestrator.close();
    }
  });

  it("spawns only configured workers at depth one and omits delegation controls from worker runtime", async () => {
    const userDataDir = await temporaryDirectory("task-v2-worker-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-worker-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let workerInput = null;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        }
        if (input.taskControlPlane?.spawn_agent) {
          const listed = await input.taskControlPlane.list_agents();
          assert.equal(listed[0].description, "Worker worker for the frozen task.");
          assert.equal(listed[0].instructions, listed[0].description);
          await input.taskControlPlane.spawn_agent({ workerProfileId: "worker-1", prompt: "Inspect the configured workspace." });
        }
        if (input.taskDepth === 1) workerInput = input;
        return { output: "completed" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto" }));
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.workerAttempts.length, 1);
      assert.equal(finished.run.workerAttempts[0].depth, 1);
      assert.equal(finished.run.workerAttempts[0].parentAttemptId, finished.run.primaryAttempts[0].id);
      assert.equal(workerInput?.taskDepth, 1);
      assert.equal(workerInput?.taskControlPlane ?? null, null);
      assert.equal(workerInput?.taskTools ?? null, null);
      assert.deepEqual(workerInput?.mcpServers, []);
      assert.equal(runtime.startCalls.filter(({ input }) => input.taskDepth === 1).every(({ input }) => input.approvalMode === "ask"), true);
      await assert.rejects(
        orchestrator.retryPrimary({ taskRunId: finished.run.id, attemptId: finished.run.primaryAttemptId }),
        /Only failed, blocked, or cancelled/,
      );
    } finally {
      await orchestrator.close();
    }
  });

  it("runs a spawned worker before primary wait_agent returns while the primary run remains active", async () => {
    const userDataDir = await temporaryDirectory("task-v2-concurrent-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-concurrent-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let primaryFinished = false;
    let workerStarts = 0;
    let workerCompletedBeforePrimary = false;
    let waitedStatus = null;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskTools?.includes("propose_contract")) {
          await input.taskControlPlane.propose_contract({ contract: contract({ outcome: "Concurrent outcome." }) });
          return { output: "alignment complete" };
        }
        if (input.taskDepth === 1) {
          workerStarts += 1;
          return { output: "worker completed" };
        }
        if (input.taskTools?.includes("spawn_agent")) {
          const spawned = await input.taskControlPlane.spawn_agent({ workerProfileId: "worker-1", prompt: "Inspect concurrently." });
          const waited = await input.taskControlPlane.wait_agent({ attemptId: spawned.attemptId });
          waitedStatus = waited.status;
          workerCompletedBeforePrimary = waited.status === "succeeded" && !primaryFinished;
          primaryFinished = true;
          return { output: "primary completed after worker" };
        }
        return { output: "alignment complete" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto" }));
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(waitedStatus, "succeeded");
      assert.equal(workerCompletedBeforePrimary, true);
      assert.equal(workerStarts, 1);
      assert.equal(finished.run.workerAttempts.length, 1);
      assert.equal(finished.run.workerAttempts[0].status, "succeeded");
      assert.equal(finished.run.primaryAttempts[0].status, "succeeded");
    } finally {
      await orchestrator.close();
    }
  });

  it("keeps a send_message follow-up inside the worker lifecycle", async () => {
    const userDataDir = await temporaryDirectory("task-v2-send-message-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-send-message-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let followUpRunId = null;
    let followUpAttemptId = null;
    let followUpStatus = null;
    const runtime = createRuntime({
      start: async ({ input, runId }) => {
        if (input.taskTools?.includes("propose_contract")) {
          await input.taskControlPlane.propose_contract({ contract: contract({ outcome: "Follow-up outcome." }) });
          return { output: "alignment complete" };
        }
        if (input.taskDepth === 1 && /Follow-up worker assignment/.test(input.prompt)) {
          followUpRunId = runId;
          return { output: "follow-up completed" };
        }
        if (input.taskDepth === 1) {
          return { output: "worker completed before follow-up" };
        }
        if (input.taskTools?.includes("spawn_agent")) {
          const spawned = await input.taskControlPlane.spawn_agent({ workerProfileId: "worker-1", prompt: "Wait for a follow-up." });
          const waited = await input.taskControlPlane.wait_agent({ attemptId: spawned.attemptId });
          assert.equal(waited.status, "succeeded");
          const sent = await input.taskControlPlane.send_message({ attemptId: spawned.attemptId, text: "follow-up" });
          followUpAttemptId = sent.attemptId;
          followUpStatus = sent.status;
          return { output: `primary observed ${sent.status}` };
        }
        return { output: "alignment complete" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto" }));
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(followUpStatus, "succeeded");
      assert.ok(followUpRunId);
      assert.ok(followUpAttemptId);
      assert.equal(finished.run.workerAttempts.length, 2);
      assert.equal(finished.run.workerAttempts[0].status, "succeeded");
      assert.equal(finished.run.workerAttempts[1].id, followUpAttemptId);
      assert.equal(finished.run.workerAttempts[1].status, "succeeded");
      assert.equal(finished.run.primaryAttempts[0].status, "succeeded");
    } finally {
      await orchestrator.close();
    }
  });

  it("keeps the primary active so it can recover a failed worker with one follow-up", async () => {
    const userDataDir = await temporaryDirectory("task-v2-worker-recovery-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-worker-recovery-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let workerStarts = 0;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        if (input.taskControlPlane?.spawn_agent) {
          const spawned = await input.taskControlPlane.spawn_agent({ workerProfileId: "worker-1", prompt: "Attempt the bounded assignment." });
          const failed = await input.taskControlPlane.wait_agent({ attemptId: spawned.attemptId });
          assert.equal(failed.status, "failed");
          const recovered = await input.taskControlPlane.send_message({ attemptId: failed.id, text: "Retry the same bounded assignment." });
          assert.equal(recovered.status, "succeeded");
          return { output: "Primary accepted the recovered worker result." };
        }
        workerStarts += 1;
        return workerStarts === 1
          ? { status: "failed", error: "worker provider quota" }
          : { output: "follow-up recovered" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto" }));
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.deepEqual(finished.run.workerAttempts.map((attempt) => attempt.status), ["failed", "succeeded"]);
      assert.equal(finished.run.primaryAttempts[0].status, "succeeded");
      assert.equal(finished.events.filter((event) => event.type === "worker-failed").length, 1);
    } finally {
      await orchestrator.close();
    }
  });

  it("rejects send_message for an active worker until the primary waits or closes it", async () => {
    const userDataDir = await temporaryDirectory("task-v2-send-active-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-send-active-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let releaseWorker;
    const workerHold = new Promise((resolve) => { releaseWorker = resolve; });
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskTools?.includes("propose_contract")) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        if (input.taskDepth === 1) {
          await workerHold;
          return { output: "worker completed" };
        }
        if (input.taskTools?.includes("spawn_agent")) {
          const spawned = await input.taskControlPlane.spawn_agent({ workerProfileId: "worker-1", prompt: "Keep active." });
          await assert.rejects(
            input.taskControlPlane.send_message({ attemptId: spawned.attemptId, text: "too early" }),
            /Worker attempt is active/,
          );
          releaseWorker();
          const waited = await input.taskControlPlane.wait_agent({ attemptId: spawned.attemptId });
          return { output: `primary observed ${waited.status}` };
        }
        return { output: "aligned" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto" }));
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.workerAttempts.length, 1);
      assert.equal(finished.run.workerAttempts[0].status, "succeeded");
    } finally {
      releaseWorker();
      await orchestrator.close();
    }
  });

  it("propagates full-allow to primary and worker without creating approval gates", async () => {
    const userDataDir = await temporaryDirectory("task-v2-full-allow-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-full-allow-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) await input.taskControlPlane.propose_contract({ contract: contract() });
        if (input.taskControlPlane?.spawn_agent) await input.taskControlPlane.spawn_agent({ workerProfileId: "worker-1", prompt: "Run the local check." });
        return { output: "done" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto", permissionMode: "full-allow" }));
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.task.permissionMode, "full-allow");
      const alignmentCall = runtime.startCalls.find(({ input }) => input.taskTools?.includes("propose_contract"));
      const executionCalls = runtime.startCalls.filter(({ input }) => !input.taskTools?.includes("propose_contract"));
      assert.equal(alignmentCall.input.approvalMode, "read-only-auto");
      assert.equal(alignmentCall.input.taskPermissionMode, "restricted");
      assert.equal(executionCalls.every(({ input }) => input.approvalMode === "auto"), true);
      assert.equal(executionCalls.every(({ input }) => input.taskPermissionGrant?.taskRunId === finished.run.id), true);
      const canonicalWorkspaceRoot = await realpath(workspaceRoot);
      assert.equal(executionCalls.every(({ input }) => input.taskPermissionGrant?.realWorkspaceRoot === canonicalWorkspaceRoot), true);
      assert.deepEqual(finished.run.permissionGrant.allowedProfileIds, ["primary", "worker-1"]);
      assert.equal(finished.gates.length, 0);
    } finally {
      await orchestrator.close();
    }
  });

  it("auto-approves exact task-control MCP calls while keeping user action gates restricted", async () => {
    const userDataDir = await temporaryDirectory("task-v2-task-tool-approval-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-task-tool-approval-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const toolCallId = "list-agents-call-1";
    const approvalCalls = [];
    let primaryInput;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "aligned" };
        }
        if (input.taskTools?.includes("spawn_agent")) {
          primaryInput = input;
          return {
            status: "waiting-approval",
            pendingApprovals: [{
              id: "task-tool-approval-1",
              provider: "codex",
              method: "session/request_permission",
              kind: "command",
              command: null,
              cwd: workspaceRoot,
              params: { toolCall: { toolCallId }, _meta: { is_mcp_tool_approval: true } },
            }],
            events: [{
              type: "acp_tool_call",
              update: {
                sessionUpdate: "tool_call",
                toolCallId,
                rawInput: { server: "onmyagent-task-control", tool: "list_agents", arguments: {} },
                _meta: { is_mcp_tool_call: true },
              },
            }],
          };
        }
        return { output: "worker" };
      },
      resolveApproval: async ({ input, runs }) => {
        approvalCalls.push(input);
        assert.equal((await primaryInput.taskControlPlane.list_agents()).length, 1);
        const current = runs.get(input.runId);
        runs.set(input.runId, { ...current, status: "completed", pendingApprovals: [], output: "task tool completed" });
        return { ok: true };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto" }));
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.gates.length, 0);
      assert.equal(approvalCalls.length, 1);
      assert.equal(approvalCalls[0].decision, "accept");
    } finally {
      await orchestrator.close();
    }
  });

  it("maps restricted mode to a durable approval gate and resumes after the Personal decision", async () => {
    const userDataDir = await temporaryDirectory("task-v2-restricted-gate-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-restricted-gate-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) await input.taskControlPlane.propose_contract({ contract: contract() });
        if (input.taskControlPlane?.spawn_agent) {
          return { status: "running", pendingApprovals: [{ id: "approval-1", kind: "command", command: "pnpm test" }], output: "waiting" };
        }
        return { output: "aligned" };
      },
      resolveApproval: async ({ input, runs }) => {
        const current = runs.get(input.runId);
        if (current) runs.set(input.runId, { ...current, status: "completed", pendingApprovals: [], output: "approved" });
        return { ok: true };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto", allowedWorkers: [] }));
      const waiting = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "waiting-approval");
      assert.equal(waiting.gates.length, 1);
      assert.equal(waiting.gates[0].status, "pending");
      assert.equal(runtime.startCalls.find(({ input }) => input.taskDepth === 0 && input.taskTools.includes("spawn_agent")).input.approvalMode, "ask");
      await orchestrator.resolveGate({ taskRunId: waiting.run.id, gateId: waiting.gates[0].id, decision: "approve" });
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => (
        snapshot.run && ["succeeded", "failed", "blocked"].includes(snapshot.run.status)
      ));
      assert.equal(finished.run.status, "succeeded", finished.run.error ?? "restricted run did not succeed");
      assert.equal(finished.gates[0].status, "approved");
    } finally {
      await orchestrator.close();
    }
  });

  it("fences a rejected Personal approval without reopening a stale gate", async () => {
    const userDataDir = await temporaryDirectory("task-v2-restricted-gate-retry-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-restricted-gate-retry-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) await input.taskControlPlane.propose_contract({ contract: contract() });
        if (input.taskControlPlane?.spawn_agent) {
          return { status: "running", pendingApprovals: [{ id: "approval-intent-failed", kind: "command", command: "touch proof.txt" }], output: "waiting" };
        }
        return { output: "aligned" };
      },
      resolveApproval: async () => ({ ok: false, error: "Task side-effect intent was not durably recorded" }),
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto", allowedWorkers: [] }));
      const waiting = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "waiting-approval");
      await assert.rejects(
        orchestrator.resolveGate({ taskRunId: waiting.run.id, gateId: waiting.gates[0].id, decision: "approve" }),
        /side-effect intent was not durably recorded/i,
      );
      const fenced = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "blocked");
      assert.equal(fenced.gates[0].status, "cancelled");
      assert.equal(fenced.run.primaryAttempts[0].status, "blocked");
      assert.equal(fenced.run.primaryAttempts[0].leaseId, null);
      assert.equal(runtime.cancelCalls.filter((call) => call.runId?.startsWith("personal-")).length, 1);
      await assert.rejects(
        orchestrator.resolveGate({ taskRunId: fenced.run.id, gateId: fenced.gates[0].id, decision: "approve" }),
        /already resolved|expired|stale/i,
      );
    } finally {
      await orchestrator.close();
    }
  });

  it("retries only the primary attempt with a fresh Personal conversation", async () => {
    const userDataDir = await temporaryDirectory("task-v2-retry-user-");
    const workspaceRoot = await temporaryDirectory("task-v2-retry-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let primaryStarts = 0;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) await input.taskControlPlane.propose_contract({ contract: contract() });
        if (input.taskControlPlane?.spawn_agent) {
          primaryStarts += 1;
          return primaryStarts === 1 ? { status: "failed", error: "first primary failed" } : { output: "retry succeeded" };
        }
        return { output: "aligned" };
      },
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const started = await orchestrator.createTask(taskInput(workspaceRoot, { contractFinalization: "model-recommended-auto", allowedWorkers: [] }));
      const failed = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "failed");
      const retried = await orchestrator.retryPrimary({ taskRunId: failed.run.id, attemptId: failed.run.primaryAttemptId });
      const finished = await waitForSnapshot(orchestrator, started.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(finished.run.primaryAttempts.length, 2);
      assert.equal(new Set(runtime.startCalls.filter(({ input }) => input.taskControlPlane?.spawn_agent).map(({ runId }) => runId)).size, 2);
      assert.equal(retried.run.primaryAttempts.length, 2);
    } finally {
      await orchestrator.close();
    }
  });
});
