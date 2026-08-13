import { isContractProposalApproval } from "./alignment-approvals.mjs";
import {
  alignmentApprovalMode,
  clone,
  messageOf,
  PERSONAL_TERMINAL_STATUSES,
} from "./definitions.mjs";
import { createTaskControlMcpBridge } from "./runner.mjs";
import { withRuntimeDeadline } from "./runtime-deadline.mjs";
import { createTaskRuntimeOperationController } from "./runtime-operation.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function outputOf(snapshot) {
  return text(snapshot?.output ?? snapshot?.text ?? snapshot?.result ?? "");
}

/** @typedef {Error & { runtimeCleanupAttempted?: boolean, runtimeCleanupOk?: boolean }} RuntimeCleanupError */

/** Durable, cancellable owner for idea-to-contract provider turns. */
export function createTaskAlignmentRuntime(options) {
  const {
    personalAgentRuntime,
    store,
    now,
    createId,
    sleep,
    pollMs,
    serialized,
    emitTask,
    proposeContract,
    isClosed,
    runtimeCallTimeoutMs,
  } = options;
  const active = new Map();
  const cancelled = new Set();

  const deadlineMs = runtimeCallTimeoutMs;
  const runtimeOperations = createTaskRuntimeOperationController({
    personalAgentRuntime,
    createId,
    timeoutMs: deadlineMs,
  });

  async function runtimeCall(label, operation) {
    return withRuntimeDeadline(label, deadlineMs, operation);
  }

  async function cancelRuntimeRun(runId, reason) {
    if (!text(runId)) return { ok: true, skipped: true };
    let result;
    try {
      result = await runtimeCall(`Personal cancelRun (${reason})`, () => personalAgentRuntime.cancelRun(runId, { reason }));
    } catch (error) {
      // A provider/runtime cancel can itself wedge. Give the runtime one
      // bounded escalation attempt before fencing the durable alignment state;
      // never leave the alignment promise waiting on the provider forever.
      if (error?.code !== "TASK_RUNTIME_CALL_TIMEOUT") {
        return { ok: false, error: messageOf(error), cause: error };
      }
      try {
        result = await runtimeCall(`Personal cancelRun escalation (${reason})`, () => personalAgentRuntime.cancelRun(runId, {
          reason: `${reason}-escalation`,
          escalation: true,
          force: true,
        }));
      } catch (escalationError) {
        return { ok: false, error: messageOf(escalationError), cause: escalationError, escalated: true };
      }
    }
    return result?.ok === false
      ? { ok: false, error: messageOf(result.error) || "Personal runtime rejected alignment cancellation", result }
      : { ok: true, result };
  }

  function cleanupError(error, cancellation) {
    const next = /** @type {RuntimeCleanupError} */ (error instanceof Error ? error : new Error(messageOf(error)));
    next.runtimeCleanupAttempted = true;
    next.runtimeCleanupOk = cancellation?.ok === true;
    if (cancellation?.ok !== true) {
      next.message = `${next.message}; provider cancellation was not confirmed: ${cancellation?.error || "unknown cancellation failure"}`;
    }
    return next;
  }

  function controlPlane(taskId) {
    return Object.freeze({
      /** @param {{ contract?: unknown }} input */
      propose_contract: async (input = {}) => {
        const { contract } = input;
        const result = await proposeContract(taskId, contract, "primary");
        if (!result) throw new Error("Contract proposal failed schema validation");
        return {
          proposalId: result.proposal.id,
          proposalRevision: result.proposal.revision,
          contract: result.proposal.contract,
        };
      },
      describe: () => ({ depth: 0, tools: ["propose_contract"] }),
    });
  }

  async function waitForTerminal(task, started, operationId) {
    const runId = text(started?.runId);
    if (!runId && !PERSONAL_TERMINAL_STATUSES.has(started?.status)) {
      throw new Error("Personal runtime did not return an alignment run id");
    }
    const resolvedProposalApprovals = new Set();
    async function rejectUnsafeApproval(snapshot) {
      const pending = Array.isArray(snapshot?.pendingApprovals) ? snapshot.pendingApprovals : [];
      if (pending.length === 1 && isContractProposalApproval(task, snapshot, pending[0])) {
        const approvalId = text(pending[0].id);
        if (!resolvedProposalApprovals.has(approvalId)) {
          let result;
          try {
            result = await runtimeCall(`Personal resolveApproval (${approvalId})`, () => personalAgentRuntime.resolveApproval({ runId, approvalId, decision: "accept" }));
          } catch (error) {
            throw cleanupError(error, await cancelRuntimeRun(runId, "task-alignment-approval-timeout"));
          }
          if (result?.ok !== true) {
            throw cleanupError(
              new Error(`Task contract proposal approval failed: ${text(result?.error) || "unknown error"}`),
              await cancelRuntimeRun(runId, "task-alignment-approval-rejected"),
            );
          }
          resolvedProposalApprovals.add(approvalId);
        }
        return;
      }
      if (runId) await cancelRuntimeRun(runId, "task-alignment-read-only-approval");
      throw new Error("Read-only task alignment requires no approval; the Personal runtime requested an approval");
    }
    let snapshot = started;
    while (!PERSONAL_TERMINAL_STATUSES.has(snapshot?.status)) {
      if (snapshot?.status === "waiting-approval" || snapshot?.pendingApprovals?.length) await rejectUnsafeApproval(snapshot);
      await sleep(pollMs);
      try {
        snapshot = await runtimeCall(`Personal getRun alignment (${runId})`, () => personalAgentRuntime.getRun({ runId, workspaceRoot: task.workspaceRoot }));
      } catch (error) {
        const operationCancellation = operationId
          ? await runtimeOperations.cancel(operationId, "task-alignment-runtime-timeout")
          : { ok: false, error: "Alignment operation id is unavailable" };
        throw cleanupError(error, operationCancellation.ok
          ? operationCancellation
          : await cancelRuntimeRun(runId, "task-alignment-runtime-timeout"));
      }
      if (!snapshot) return { runId, status: "missing", output: "", error: "Alignment runtime run is missing" };
    }
    if (snapshot?.status === "waiting-approval" || snapshot?.pendingApprovals?.length) await rejectUnsafeApproval(snapshot);
    return snapshot;
  }

  async function persistStarted(taskId, conversationId, started) {
    return serialized(async () => {
      const task = clone(await store.requireTask(taskId));
      task.alignment.conversationId = conversationId;
      task.alignment.personalRunId = text(started?.runId) || null;
      task.alignment.status = "running";
      task.alignment.startedAt ??= now();
      task.alignment.finishedAt = null;
      task.alignment.error = null;
      task.updatedAt = now();
      await store.writeTask(task);
      return task;
    });
  }

  async function finish(taskId, terminal) {
    return serialized(async () => {
      const task = clone(await store.requireTask(taskId));
      if (["completed", "failed", "cancelled"].includes(task.alignment.status) && !cancelled.has(taskId)) return task;
      const effectiveTerminal = cancelled.has(taskId)
        ? { ...terminal, status: "cancelled", error: "Alignment cancelled by user." }
        : terminal;
      if (task.alignment.status === "cancelled" && effectiveTerminal?.status !== "cancelled") return task;
      const succeeded = effectiveTerminal?.status === "completed";
      const output = outputOf(effectiveTerminal);
      task.alignment.personalRunId = text(effectiveTerminal?.runId) || task.alignment.personalRunId;
      task.alignment.status = succeeded ? "completed" : effectiveTerminal?.status === "cancelled" ? "cancelled" : "failed";
      task.alignment.finishedAt = now();
      task.alignment.error = succeeded ? null : text(effectiveTerminal?.error) || `Alignment ended with ${effectiveTerminal?.status ?? "unknown"}`;
      if (output) task.alignment.messages.push({ id: createId("message"), role: "primary", text: output, at: now() });
      task.updatedAt = now();
      await store.writeTask(task);
      await emitTask(task.id, succeeded ? "alignment-completed" : task.alignment.status === "cancelled" ? "alignment-cancelled" : "alignment-failed", succeeded ? "Task alignment turn completed." : task.alignment.error);
      return task;
    });
  }

  async function execute(taskId, prompt, existingConversationId = null) {
    const task = await store.requireTask(taskId);
    if (isClosed() || cancelled.has(taskId)) {
      return finish(taskId, { status: "cancelled", error: "Alignment cancelled before provider start.", output: "" });
    }
    const plane = controlPlane(task.id);
    const bridge = await createTaskControlMcpBridge({
      queueRoot: `${store.rootDirectory}/mcp/alignment/${task.id}`,
      token: createId("mcp"),
      alignment: true,
      requestTimeoutMs: task.primary.timeoutMs,
      invoke: (tool, args) => plane[tool]?.(args) ?? Promise.reject(new Error(`Unknown alignment tool: ${tool}`)),
    });
    try {
      let conversationId = text(existingConversationId || task.alignment.conversationId);
      if (!conversationId) {
        const ownedCreate = await runtimeOperations.call("Personal createConversation alignment", "alignment-create", ({ operationId, signal }) => personalAgentRuntime.createConversation({
          workspaceRoot: task.workspaceRoot,
          workdir: task.workspaceRoot,
          agent: { id: task.primary.agentId, provider: task.primary.provider },
          model: task.primary.model,
          title: `Task alignment · ${task.id}`,
          source: "task-center-v2-alignment",
          metadata: { taskId: task.id, phase: "alignment", depth: 0 },
          operationId,
          signal,
        }));
        const created = ownedCreate.value;
        conversationId = text(created?.conversation?.id ?? created?.id);
        if (!conversationId) throw new Error("Personal runtime did not return an alignment conversation id");
      }
      const ownedStart = await runtimeOperations.call("Personal startMessage alignment", "alignment-message", ({ operationId, signal }) => personalAgentRuntime.startMessage({
        workspaceRoot: task.workspaceRoot,
        workdir: task.workspaceRoot,
        prompt,
        approvalMode: alignmentApprovalMode(task.permissionMode),
        timeoutMs: task.primary.timeoutMs,
        conversationId,
        sessionStrategy: "new",
        useRememberedApprovals: false,
        model: task.primary.model,
        agent: { id: task.primary.agentId, provider: task.primary.provider },
        taskControlPlane: plane,
        taskTools: bridge.taskTools,
        mcpServers: bridge.mcpServers,
        taskDepth: 0,
        taskPermissionMode: "restricted",
        operationId,
        signal,
      }));
      const started = ownedStart.value;
      await persistStarted(task.id, conversationId, started);
      if (cancelled.has(task.id)) {
        const runId = text(started?.runId);
        if (runId) await cancelRuntimeRun(runId, "task-alignment-user");
        return finish(task.id, { runId, status: "cancelled", error: "Alignment cancelled by user.", output: "" });
      }
      return finish(task.id, await waitForTerminal(task, started, ownedStart.operationId));
    } catch (error) {
      await finish(task.id, cancelled.has(task.id)
        ? { status: "cancelled", error: "Alignment cancelled by user.", output: "" }
        : { status: "failed", error: messageOf(error), output: "" });
      throw error;
    } finally {
      await bridge.close();
    }
  }

  function launch(taskId, prompt, existingConversationId = null) {
    if (active.has(taskId)) throw new Error("Task alignment already has an active provider turn");
    const execution = execute(taskId, prompt, existingConversationId)
      .catch(() => null)
      .finally(() => {
        if (active.get(taskId) === execution) {
          active.delete(taskId);
          cancelled.delete(taskId);
        }
      });
    active.set(taskId, execution);
    return execution;
  }

  async function cancel(taskId, reason = "user") {
    cancelled.add(taskId);
    const task = await store.requireTask(taskId);
    if (task.alignment.status !== "running" && !active.has(taskId)) {
      cancelled.delete(taskId);
      return store.snapshot(taskId);
    }
    try {
      if (task.alignment.personalRunId) {
        const result = await cancelRuntimeRun(task.alignment.personalRunId, `task-alignment-${reason}`);
        if (result?.ok !== true) throw new Error(result.error || "Alignment cancellation was rejected");
      }
    } catch (error) {
      if (cancelled.has(taskId)) {
        cancelled.delete(taskId);
        await finish(taskId, { status: "failed", error: `Alignment cancellation could not be confirmed: ${messageOf(error)}`, output: "" });
      }
      throw error;
    }
    const execution = active.get(taskId);
    if (execution) await execution.catch(() => undefined);
    else {
      await finish(taskId, { runId: task.alignment.personalRunId, status: "cancelled", error: "Alignment cancelled by user.", output: "" });
      cancelled.delete(taskId);
    }
    return store.snapshot(taskId);
  }

  async function cancelAll(reason) {
    const taskIds = [...active.keys()];
    await Promise.all(taskIds.map((taskId) => cancel(taskId, reason)));
    await Promise.allSettled([...active.values()]);
  }

  return { launch, cancel, cancelAll, awaitAll: () => Promise.allSettled([...active.values()]), isActive: (taskId) => active.has(taskId) };
}
