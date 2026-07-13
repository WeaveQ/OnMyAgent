import { randomUUID } from "node:crypto";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
const BLOCKED_KEY = /(authorization|broker.*token|cdp|credential|dom|environment|history|memory|model.*token|screenshot|secret|thinking|token)/i;

function safeValue(value, key = "") {
  if (BLOCKED_KEY.test(key)) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 4_000);
  if (Array.isArray(value)) {
    return value.map((item) => safeValue(item)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const safeChild = safeValue(childValue, childKey);
    if (safeChild !== undefined) result[childKey] = safeChild;
  }
  return result;
}

function text(value, maxLength = 4_000) {
  return String(value ?? "").slice(0, maxLength);
}

function publicRun(run) {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    userMessageId: run.userMessageId,
    ownerId: run.ownerId,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    pendingApprovals: [...run.pendingApprovals.values()],
    events: run.events.slice(),
    ...(run.result !== undefined ? { result: run.result } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function writeMessage(child, value) {
  if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(value)}\n`);
}

function normalizeRunnerEvent(event) {
  const type = text(event?.type, 80);
  if (type === "ready") {
    return {
      type,
      agentClass: text(event.agentClass, 200),
      model: text(event.model, 200),
      phase: text(event.phase, 80),
    };
  }
  if (type === "phase") return { type, phase: text(event.phase, 80) };
  if (type === "model_error") {
    return {
      type: "protocol_warning",
      message: `${text(event.errorType, 120) || "ModelError"}: ${text(event.error)}`,
    };
  }
  if (type === "model_update") {
    const raw = event.raw && typeof event.raw === "object" ? event.raw : {};
    return {
      type,
      step: Number(event.step) || 0,
      evaluation: text(event.evaluation),
      nextGoal: text(event.nextGoal),
      actions: safeValue(event.actions) ?? [],
      raw: {
        evaluationPreviousGoal: text(raw.evaluationPreviousGoal),
        nextGoal: text(raw.nextGoal),
        actions: safeValue(raw.actions) ?? [],
      },
    };
  }
  if (type === "narration") {
    return {
      type,
      step: Number(event.step) || 0,
      text: text(event.text),
      nextGoal: text(event.nextGoal),
    };
  }
  if (type === "operation_started") {
    return {
      type,
      operationId: text(event.operationId, 200),
      step: Number(event.step) || 0,
      actions: safeValue(event.actions) ?? [],
      actionCount: Number(event.actionCount) || 0,
      url: text(event.url),
      title: text(event.title),
    };
  }
  if (type === "operation_progress") {
    return {
      type,
      operationId: text(event.operationId, 200),
      step: Number(event.step) || 0,
      action: safeValue(event.action) ?? null,
      observationSource: text(event.observationSource, 80),
    };
  }
  if (type === "operation_completed") {
    return {
      type,
      operationId: text(event.operationId, 200),
      step: Number(event.step) || 0,
      results: safeValue(event.results) ?? [],
      success: event.success === true,
      url: text(event.url),
      title: text(event.title),
      error: text(event.error),
    };
  }
  if (type === "approval") {
    return {
      type,
      approvalId: text(event.approvalId, 200),
      operationId: text(event.operationId, 200),
      action: safeValue(event.action) ?? null,
      summary: text(event.summary),
      elementText: text(event.elementText, 500),
    };
  }
  if (type === "approval_resolved") {
    return {
      type,
      approvalId: text(event.approvalId, 200),
      operationId: text(event.operationId, 200),
      decision: event.decision === "accept" ? "accept" : "reject",
    };
  }
  if (type === "done") return { type, result: safeValue(event.result, "result") ?? null };
  if (type === "error") {
    return {
      type,
      error: text(event.error || "Browser Use Agent failed"),
      errorCode: text(event.errorCode, 100),
      errorType: text(event.errorType, 200),
    };
  }
  if (type === "cancelled") return { type };
  return null;
}

export function createBrowserUseAgentRuntime({
  browserEnvironment,
  modelGateway,
  spawnRunner,
  store = null,
  now = Date.now,
}) {
  if (!browserEnvironment || !modelGateway || typeof spawnRunner !== "function") {
    throw new Error("Browser Use Agent runtime dependencies are required");
  }
  const runs = new Map();

  function persist(run) {
    store?.saveRun(publicRun(run));
  }

  function emit(run, event, sourceEventId = "") {
    const sourceId = text(sourceEventId, 200).trim();
    if (sourceId && run.sourceEventIds.has(sourceId)) return false;
    if (sourceId) run.sourceEventIds.add(sourceId);
    run.nextSequence += 1;
    const timestamp = Number(event.timestamp) || now();
    const safeEvent = {
      ...event,
      id: sourceId ? `${run.runId}:${sourceId}` : `${run.runId}:${run.nextSequence}`,
      runId: run.runId,
      sequence: run.nextSequence,
      timestamp,
    };
    run.events.push(safeEvent);
    run.updatedAt = timestamp;
    persist(run);
    return true;
  }

  function cleanup(run) {
    if (run.cleaned) return;
    run.cleaned = true;
    modelGateway.releaseRun(run.modelEnvironment);
    browserEnvironment.releaseOwner(run.ownerId, { closeTabs: !run.retainTabs });
  }

  function finish(run, status, details = {}, eventType = status) {
    if (TERMINAL_STATUSES.has(run.status)) return;
    run.status = status;
    if (Object.hasOwn(details, "result")) run.result = details.result;
    if (details.error) run.error = details.error;
    run.pendingApprovals.clear();
    cleanup(run);
    emit(run, { type: eventType, ...details });
  }

  function handleEvent(run, rawEvent) {
    if (TERMINAL_STATUSES.has(run.status)) return;
    const event = normalizeRunnerEvent(rawEvent);
    if (!event) return;
    const sourceEventId = text(rawEvent.id, 200);
    if (event.type === "approval") {
      const id = event.approvalId.trim();
      if (!id) return;
      const approval = {
        id,
        operationId: event.operationId || null,
        title: "Browser action requires approval",
        summary: event.summary || "External side effect",
        action: event.action,
      };
      run.pendingApprovals.set(id, approval);
      run.status = "pending_approval";
      emit(run, { type: "approval", approval }, sourceEventId);
      return;
    }
    if (event.type === "approval_resolved") {
      const alreadyResolved = run.events.some(
        (item) => item.type === "approval_resolved" && item.approvalId === event.approvalId,
      );
      if (!alreadyResolved) emit(run, event, sourceEventId);
      return;
    }
    if (event.type === "done") {
      if (event.result == null || (typeof event.result === "string" && !event.result.trim())) {
        finish(run, "failed", {
          error: "Browser Use Agent ended without a final result",
        }, "error");
        return;
      }
      finish(run, "completed", { result: event.result }, "done");
      return;
    }
    if (event.type === "error") {
      finish(run, "failed", {
        error: event.error,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(event.errorType ? { errorType: event.errorType } : {}),
      }, "error");
      return;
    }
    if (event.type === "cancelled") {
      finish(run, "cancelled", {}, "cancelled");
      return;
    }
    emit(run, event, sourceEventId);
  }

  function attachOutput(run) {
    let buffer = "";
    run.child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleEvent(run, JSON.parse(line));
        } catch {
          emit(run, { type: "protocol_warning", message: "Invalid runner event" });
        }
      }
    });
    run.child.stderr.on("data", (chunk) => {
      run.stderr = `${run.stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    run.child.on("error", (error) => finish(run, "failed", { error: error.message }, "error"));
    run.child.on("close", (code, signal) => {
      if (TERMINAL_STATUSES.has(run.status)) return;
      finish(run, "failed", {
        error: `Browser Use Agent exited before completion (${signal ?? code ?? "unknown"})`,
      }, "error");
    });
  }

  async function start(input) {
    const task = String(input?.task ?? "").trim();
    const ownerId = String(input?.ownerId ?? "").trim();
    const sessionId = String(input?.sessionId ?? ownerId).trim();
    const userMessageId = String(input?.userMessageId ?? "").trim() || null;
    if (!task || !ownerId || !sessionId) {
      throw new Error("Browser Use Agent task, ownerId, and sessionId are required");
    }
    const activeRun = [...runs.values()].find(
      (run) => run.sessionId === sessionId && !TERMINAL_STATUSES.has(run.status),
    );
    if (activeRun) throw new Error(`Browser Use Agent is already active for session ${sessionId}`);
    await modelGateway.start();
    const browserEnvironmentValue = await browserEnvironment.environmentForOwner(ownerId);
    const modelEnvironment = modelGateway.environmentForRun({ ownerId, model: input.model ?? null });
    const child = spawnRunner({
      env: { ...browserEnvironmentValue, ...modelEnvironment },
      ownerId,
    });
    const timestamp = now();
    const run = {
      runId: randomUUID(),
      sessionId,
      userMessageId,
      ownerId,
      status: "running",
      retainTabs: input.retainTabs === true,
      pendingApprovals: new Map(),
      events: [],
      sourceEventIds: new Set(),
      nextSequence: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      modelEnvironment,
      child,
      cleaned: false,
      stderr: "",
    };
    runs.set(run.runId, run);
    persist(run);
    attachOutput(run);
    writeMessage(child, {
      task,
      language: String(input.language ?? "en"),
      useVision: input.useVision ?? "auto",
      maxSteps: input.maxSteps,
      maxActionsPerStep: input.maxActionsPerStep,
    });
    return publicRun(run);
  }

  function status(runId) {
    const run = runs.get(runId);
    return run ? publicRun(run) : store?.getRun(runId) ?? null;
  }

  function history(sessionId) {
    if (store) return store.listBySession(sessionId);
    return [...runs.values()]
      .filter((run) => run.sessionId === sessionId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((run) => publicRun(run));
  }

  async function approve({ runId, approvalId, decision }) {
    const run = runs.get(runId);
    const approval = run?.pendingApprovals.get(approvalId);
    if (!run || !approval) return { ok: false, error: "approval_not_found" };
    if (!["accept", "reject"].includes(decision)) return { ok: false, error: "invalid_decision" };
    run.pendingApprovals.delete(approvalId);
    run.status = run.pendingApprovals.size ? "pending_approval" : "running";
    writeMessage(run.child, { type: "approval_response", approvalId, decision });
    emit(run, {
      type: "approval_resolved",
      approvalId,
      operationId: approval.operationId,
      decision,
    });
    return { ok: true, run: publicRun(run) };
  }

  async function cancel(runId) {
    const run = runs.get(runId);
    if (!run) return store?.getRun(runId) ?? null;
    if (!TERMINAL_STATUSES.has(run.status)) {
      run.status = "cancelled";
      run.child.kill("SIGTERM");
      cleanup(run);
      emit(run, { type: "cancelled" });
    }
    return publicRun(run);
  }

  async function dispose() {
    await Promise.all([...runs.values()].map((run) => cancel(run.runId)));
  }

  return { approve, cancel, dispose, history, start, status };
}
