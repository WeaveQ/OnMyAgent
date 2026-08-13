import { createHash } from "node:crypto";

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function inboundKey(envelope) {
  return `channel:${hash([envelope.platform, envelope.accountId, envelope.chatId, envelope.messageId].join("\u0000"))}`;
}

function taskFromSnapshot(snapshot) {
  return snapshot?.task ?? null;
}

function runFromSnapshot(snapshot) {
  return snapshot?.run ?? null;
}

function taskLine(snapshot) {
  const task = taskFromSnapshot(snapshot);
  const run = runFromSnapshot(snapshot);
  if (!task) return "没有找到对应的 durable Task。";
  const status = run?.status ?? task.definitionStatus ?? "unknown";
  return `Task ${task.id}${run?.id ? ` / Run ${run.id}` : ""}\n状态：${status}`;
}

function helpText() {
  return [
    "Durable Task 命令：",
    "#task <目标> — 创建长期后台任务",
    "#task status — 当前会话任务状态",
    "#task pause | resume | cancel | retry",
    "#task approve [gateId] | reject [gateId]",
    "#task list — 当前会话绑定",
  ].join("\n");
}

/**
 * Durable bridge from explicit messaging commands to the Task Supervisor.
 * The channel database owns only receipts, route bindings and delivery state;
 * task/run truth remains exclusively in the Supervisor SQLite process.
 */
export function createDurableMessagingTaskRouter(options = {}) {
  const store = options.store;
  const taskClient = options.taskClient;
  const resolveCreateInput = options.resolveCreateInput;
  if (!store) throw new Error("Messaging Task store is required");
  if (!taskClient || typeof taskClient.request !== "function") throw new Error("Task Supervisor client is required");
  if (typeof resolveCreateInput !== "function") throw new Error("resolveCreateInput is required");

  function deliveryResult(delivery, claimed) {
    if (!delivery || !claimed) return { replyText: "" };
    return {
      replyText: String(claimed.payload?.text ?? ""),
      deliveryReceipt: {
        id: claimed.id,
        acknowledge: async () => store.ackDelivery(claimed.id, claimed.claimToken),
        release: async () => store.releaseDelivery(claimed.id, claimed.claimToken, { code: "CHANNEL_SEND_FAILED" }),
      },
    };
  }

  function enqueueReply(envelope, text, suffix, taskId = null, taskRunId = null) {
    const stable = envelope.messageId
      ? inboundKey(envelope)
      : `ephemeral:${hash([envelope.platform, envelope.accountId, envelope.chatId, Date.now(), suffix].join("\u0000"))}`;
    const delivery = store.enqueueDelivery({
      ...envelope,
      dedupeKey: `${stable}:${suffix}`,
      taskId,
      taskRunId,
      kind: "command-reply",
      text,
    });
    const claimed = store.claimDeliveries({ deliveryId: delivery.id, limit: 1 })[0] ?? null;
    return { delivery, ...deliveryResult(delivery, claimed) };
  }

  async function snapshotForBinding(envelope) {
    const binding = store.getBinding(envelope);
    if (!binding) return { binding: null, snapshot: null };
    const snapshot = await taskClient.getTask({ taskId: binding.taskId, ...(binding.taskRunId ? { taskRunId: binding.taskRunId } : {}) });
    const task = taskFromSnapshot(snapshot);
    const run = runFromSnapshot(snapshot);
    store.upsertBinding({
      ...envelope,
      taskId: task?.id ?? binding.taskId,
      taskRunId: run?.id ?? task?.latestRunId ?? binding.taskRunId,
      revision: task?.revision ?? binding.revision,
      status: run?.status ?? task?.definitionStatus ?? binding.status,
    });
    return { binding, snapshot };
  }

  async function executeMutation(envelope, operation) {
    const claim = store.claimInbound(envelope, envelope.command);
    if (claim.state === "processing") return { ok: true, replyText: "这条 Task 命令正在处理中。" };
    if (claim.state === "failed") return { ok: false, replyText: "这条 Task 命令先前已失败；请发送一条新消息重试。" };
    if (claim.state === "completed") {
      const prior = claim.result ?? {};
      if (!prior.deliveryId) return { ok: prior.ok !== false, replyText: "" };
      const delivery = store.claimDeliveries({ deliveryId: prior.deliveryId, limit: 1 })[0] ?? null;
      return { ok: prior.ok !== false, ...deliveryResult({ id: prior.deliveryId }, delivery) };
    }
    try {
      const result = await operation(inboundKey(envelope));
      const delivery = store.enqueueDelivery({
        ...envelope,
        dedupeKey: `${inboundKey(envelope)}:reply`,
        taskId: result.taskId ?? null,
        taskRunId: result.taskRunId ?? null,
        kind: "command-reply",
        text: result.replyText,
      });
      store.finishInbound(claim, {
        ok: result.ok !== false,
        taskId: result.taskId ?? null,
        taskRunId: result.taskRunId ?? null,
        deliveryId: delivery.id,
      });
      const claimed = store.claimDeliveries({ deliveryId: delivery.id, limit: 1 })[0] ?? null;
      return { ok: result.ok !== false, ...deliveryResult(delivery, claimed) };
    } catch (error) {
      store.failInbound(claim, error, { retryable: true });
      throw error;
    }
  }

  async function mutateBound(envelope, idempotencyKey) {
    const { binding, snapshot } = await snapshotForBinding(envelope);
    if (!binding || !snapshot) return { ok: false, replyText: "当前会话还没有绑定 durable Task。" };
    const run = runFromSnapshot(snapshot);
    const action = envelope.command.action;
    if (!run?.id) return { ok: false, taskId: binding.taskId, replyText: `${taskLine(snapshot)}\n任务仍在 contract alignment 阶段。` };
    let next;
    if (action === "pause") next = await taskClient.request("taskOrchestratorTaskPause", { taskRunId: run.id }, { idempotencyKey });
    else if (action === "resume") next = await taskClient.request("taskOrchestratorTaskResume", { taskRunId: run.id }, { idempotencyKey });
    else if (action === "cancel") next = await taskClient.request("taskOrchestratorTaskStop", { taskRunId: run.id }, { idempotencyKey });
    else if (action === "retry") next = await taskClient.request("taskOrchestratorPrimaryRetry", { taskRunId: run.id }, { idempotencyKey });
    else if (action === "approve" || action === "reject") {
      const pending = (snapshot.gates ?? []).filter((gate) => gate.status === "pending");
      const requestedGateId = String(envelope.command.args ?? "").trim();
      const gate = requestedGateId ? pending.find((candidate) => candidate.id === requestedGateId) : pending.length === 1 ? pending[0] : null;
      if (!gate) return { ok: false, taskId: binding.taskId, taskRunId: run.id, replyText: pending.length > 1
        ? `有 ${pending.length} 个待审批 gate，请附带 gateId。`
        : "没有可处理的待审批 gate。" };
      next = await taskClient.request("taskOrchestratorGateResolve", {
        taskRunId: run.id,
        gateId: gate.id,
        decision: action,
      }, { idempotencyKey });
    } else throw Object.assign(new Error(`Unsupported Task action: ${action}`), { code: "UNSUPPORTED_TASK_ACTION" });
    const task = taskFromSnapshot(next) ?? taskFromSnapshot(snapshot);
    const nextRun = runFromSnapshot(next) ?? run;
    store.upsertBinding({ ...envelope, taskId: task?.id ?? binding.taskId, taskRunId: nextRun?.id ?? run.id, revision: task?.revision, status: nextRun?.status });
    return { ok: true, taskId: task?.id ?? binding.taskId, taskRunId: nextRun?.id ?? run.id, replyText: taskLine(next ?? snapshot) };
  }

  return async function route(envelope) {
    const action = envelope.command.action;
    if (action === "help") return { ok: true, ...enqueueReply(envelope, helpText(), "help") };
    if (action === "status") {
      const { snapshot } = await snapshotForBinding(envelope);
      return { ok: true, ...enqueueReply(envelope, snapshot ? taskLine(snapshot) : "当前会话还没有绑定 durable Task。", "status") };
    }
    if (action === "list") {
      const bindings = store.listBindings(envelope, 20);
      const text = bindings.length
        ? bindings.map((item) => `${item.taskId}${item.taskRunId ? ` / ${item.taskRunId}` : ""} — ${item.status ?? "unknown"}`).join("\n")
        : "当前会话还没有绑定 durable Task。";
      return { ok: true, ...enqueueReply(envelope, text, "list") };
    }
    if (action === "create") return executeMutation(envelope, async (idempotencyKey) => {
      const createInput = await resolveCreateInput(envelope);
      const snapshot = await taskClient.request("taskOrchestratorTaskCreate", createInput, { idempotencyKey });
      const task = taskFromSnapshot(snapshot);
      const run = runFromSnapshot(snapshot);
      if (!task) throw Object.assign(new Error("Task Supervisor returned no task"), { code: "TASK_CREATE_EMPTY" });
      store.upsertBinding({ ...envelope, taskId: task.id, taskRunId: run?.id ?? task.latestRunId, revision: task.revision, status: run?.status ?? task.definitionStatus });
      return {
        ok: true,
        taskId: task.id,
        taskRunId: run?.id ?? null,
        replyText: `${taskLine(snapshot)}\n已进入 durable contract alignment；后续状态会写入 Task Center。`,
      };
    });
    return executeMutation(envelope, (idempotencyKey) => mutateBound(envelope, idempotencyKey));
  };
}

export function createMessagingTaskEventEnqueuer({ store, taskClient }) {
  const significant = new Set(["approval-required", "run-blocked", "run-succeeded", "run-failed", "run-cancelled", "run-paused"]);

  function handle(event) {
    const taskId = String(event?.taskId ?? "").trim();
    const eventId = String(event?.id ?? "").trim();
    if (!taskId || !eventId) return 0;
    const bindings = store.listBindingsForTask?.(taskId) ?? [];
    if (significant.has(String(event.type))) {
      store.enqueueLocalNotification(event);
      for (const binding of bindings) {
        store.enqueueDelivery({
          ...binding,
          dedupeKey: `task-event:${eventId}:${binding.platform}:${hash(`${binding.accountId}\u0000${binding.chatId}`).slice(0, 16)}`,
          taskId,
          taskRunId: event.taskRunId,
          eventId,
          kind: "task-event",
          text: `${event.type}: ${String(event.message ?? "").slice(0, 3_500)}\nTask ${taskId}${event.taskRunId ? ` / Run ${event.taskRunId}` : ""}`,
        });
      }
    }
    // Advance only after any required notification/outbox writes. If main
    // dies between those writes and the cursor update, replay is harmlessly
    // deduplicated; the inverse order could permanently skip a notification.
    store.advanceNotificationCursor(event);
    for (const binding of bindings) {
      store.advanceBindingEventCursor(binding, event.sequence, event.taskRunId);
      store.advanceDeliveryCursor(binding, taskId, event.taskRunId, event.sequence);
    }
    return bindings.length;
  }

  async function replayStream(taskId, taskRunId = null) {
    const cursors = [store.notificationCursor(taskId, taskRunId)];
    for (const binding of store.listBindingsForTask?.(taskId) ?? []) {
      cursors.push(store.deliveryCursor(binding, taskId, taskRunId));
    }
    let cursor = Math.min(...cursors);
    let handled = 0;
    for (;;) {
      const page = await taskClient.listEvents({ taskId, taskRunId, cursor, limit: 200 });
      for (const event of page.events ?? []) handled += handle(event);
      if (!page.hasMore || page.nextCursor == null || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
    return handled;
  }

  async function replay() {
    let handled = 0;
    let taskCursor = null;
    do {
      const taskPage = await taskClient.listTasks({ cursor: taskCursor, limit: 200 });
      for (const task of taskPage.tasks ?? []) {
        handled += await replayStream(task.id, null);
        let runCursor = null;
        do {
          const runPage = await taskClient.listRuns({ taskId: task.id, cursor: runCursor, limit: 200 });
          for (const run of runPage.runs ?? []) handled += await replayStream(task.id, run.id);
          runCursor = runPage.hasMore ? runPage.nextCursor ?? null : null;
        } while (runCursor !== null);
      }
      taskCursor = taskPage.hasMore ? taskPage.nextCursor ?? null : null;
    } while (taskCursor !== null);
    return handled;
  }

  return Object.freeze({ handle, replay, replayStream });
}
