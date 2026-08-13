import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function contract(overrides = {}) {
  return {
    outcome: "Deliver the requested local task outcome.",
    deliverables: ["A durable task result"],
    acceptance: ["The frozen acceptance checks pass"],
    scope: { included: ["The configured workspace"], excluded: ["Remote systems"] },
    verification: ["Run the focused local verification"],
    ...overrides,
  };
}

export function selection(agentId = "primary-agent", provider = "codex", model = "primary-model", label = "Primary") {
  return {
    agentId,
    provider,
    label,
    model,
    catalogSource: "personal-registry",
    timeoutMs: 10_000,
  };
}

export function taskInput(workspaceRoot, overrides = {}) {
  return {
    idea: "Explore and complete a local task.",
    workspaceRoot,
    primary: selection(),
    allowedWorkers: [selection("worker-agent", "claude", "worker-model", "Worker")],
    permissionMode: "restricted",
    contractFinalization: "manual-confirm",
    ...overrides,
  };
}

export function createRuntime(behavior = {}) {
  const runs = new Map();
  const runInputs = new Map();
  const conversations = [];
  const startCalls = [];
  const cancelCalls = [];
  const taskOperations = new Map();
  let conversationSequence = 0;
  let runSequence = 0;
  const catalog = [
    { id: "primary-agent", name: "Primary", provider: "codex", modelOptions: [{ id: "primary-model", label: "Primary model" }] },
    { id: "worker-agent", name: "Worker", provider: "claude", modelOptions: [{ id: "worker-model", label: "Worker model" }] },
  ];
  async function maybeCompletePrimary(input, status) {
    if (
      status !== "completed"
      || behavior.autoCompletePrimary === false
      || input?.taskDepth !== 0
      || !input.taskControlPlane?.complete_task
    ) return;
    let state = await input.taskControlPlane.get_task_state();
    if (state.decisions.some((decision) => decision.attemptId === state.primary.id)) return;
    for (const worker of state.workers.filter((attempt) => ["pending", "ready", "running", "waiting-approval"].includes(attempt.status))) {
      await input.taskControlPlane.wait_agent({ attemptId: worker.id });
    }
    state = await input.taskControlPlane.get_task_state();
    await input.taskControlPlane.complete_task({
      summary: "The fake primary completed the frozen contract.",
      acceptanceResults: state.contract.acceptance.map((criterion, criterionIndex) => ({
        criterionIndex,
        status: "passed",
        summary: `Verified in fake runtime: ${criterion}`,
        evidenceArtifactIds: [],
      })),
    });
  }
  return {
    runs,
    taskOperations,
    conversations,
    startCalls,
    cancelCalls,
    async listAvailableAgentMetadata() {
      return { agents: catalog };
    },
    async createConversation(input) {
      if (input.operationId) taskOperations.set(input.operationId, { operationId: input.operationId, status: "running", pending: true, runId: null });
      const conversation = { id: `conversation-${++conversationSequence}`, ...input };
      conversations.push(conversation);
      if (input.operationId) taskOperations.set(input.operationId, { operationId: input.operationId, status: "completed", pending: false, runId: null });
      return { conversation };
    },
    async startMessage(input) {
      const runId = `personal-${++runSequence}`;
      if (input.operationId) taskOperations.set(input.operationId, { operationId: input.operationId, status: "running", pending: true, runId });
      runInputs.set(runId, input);
      const requested = await behavior.start?.({ input, runId, runs, startCalls }) ?? {};
      const requestedStatus = requested.status ?? "completed";
      await maybeCompletePrimary(input, requestedStatus);
      const snapshot = {
        runId,
        status: requestedStatus,
        output: requested.output ?? "Local agent completed.",
        usage: requested.usage ?? null,
        metadata: requested.metadata ?? null,
        error: requested.error ?? null,
        pendingApprovals: requested.pendingApprovals ?? [],
        events: requested.events ?? [],
        conversationMessages: requested.conversationMessages ?? [],
        fileChanges: requested.fileChanges ?? [],
        artifacts: requested.artifacts ?? [],
        pid: requested.pid ?? null,
        process: requested.process ?? null,
        waitingForInput: requested.waitingForInput === true,
        stdinWaiting: requested.stdinWaiting === true,
        socketEstablished: requested.socketEstablished,
        socketMoving: requested.socketMoving,
      };
      runs.set(runId, snapshot);
      if (input.operationId && requestedStatus !== "running") {
        taskOperations.set(input.operationId, { operationId: input.operationId, status: requestedStatus, pending: false, runId });
      }
      startCalls.push({ input, runId });
      return structuredClone(snapshot);
    },
    async getRun({ runId }) {
      const current = runs.get(runId);
      const next = await behavior.getRun?.({ runId, current, runs });
      const snapshot = next ?? current ?? null;
      await maybeCompletePrimary(runInputs.get(runId), snapshot?.status);
      return structuredClone(snapshot);
    },
    async cancelRun(runId, options) {
      cancelCalls.push({ runId, options });
      const current = runs.get(runId);
      if (current) runs.set(runId, { ...current, status: "cancelled", error: "Cancelled" });
      return behavior.cancel?.({ runId, options, runs }) ?? { ok: true };
    },
    async cancelTaskOperation(input) {
      const operationId = String(input?.operationId ?? "").trim();
      const current = taskOperations.get(operationId) ?? null;
      const runId = current?.runId ?? null;
      const options = { reason: input?.reason ?? "runtime-deadline", taskOperation: true };
      cancelCalls.push({ runId, options, operationId });
      const requested = await behavior.cancelTaskOperation?.({ input, runs, taskOperations })
        ?? await behavior.cancel?.({ runId, options, runs });
      if (requested?.ok === false) return requested;
      if (runId && runs.has(runId)) runs.set(runId, { ...runs.get(runId), status: "cancelled", error: "Cancelled" });
      const result = { operationId, status: "cancelled", pending: false, runId };
      taskOperations.set(operationId, result);
      return { ok: true, ...result };
    },
    getTaskOperation(input) {
      return structuredClone(taskOperations.get(String(input?.operationId ?? "").trim()) ?? null);
    },
    async getTaskCapability() {
      return { supportsTaskIntentHook: true, supportsScopedFullAllow: true, intentHook: "fake-request-permission" };
    },
    async resolveApproval(input) {
      return behavior.resolveApproval?.({ input, runs }) ?? { ok: true };
    },
  };
}

export async function temporaryDirectory(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function cleanupDirectories(directories) {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
}

export async function waitForSnapshot(orchestrator, taskId, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await orchestrator.getTask({ taskId });
  while (!predicate(snapshot)) {
    if (Date.now() >= deadline) {
      const status = snapshot.run?.status ?? snapshot.task.definitionStatus;
      const detail = snapshot.run?.error ?? snapshot.task.alignment?.error ?? "no durable error";
      throw new Error(`Timed out waiting for task snapshot (${status}: ${detail})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    snapshot = await orchestrator.getTask({ taskId });
  }
  return snapshot;
}
