import { randomUUID } from "node:crypto";

function publicRun(run) {
  return {
    runId: run.runId,
    ownerId: run.ownerId,
    status: run.status,
    pendingApprovals: [...run.pendingApprovals.values()],
    events: run.events.slice(),
    ...(run.result !== undefined ? { result: run.result } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

function writeMessage(child, value) {
  if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(value)}\n`);
}

export function createBrowserUseAgentRuntime({
  browserEnvironment,
  modelGateway,
  spawnRunner,
}) {
  if (!browserEnvironment || !modelGateway || typeof spawnRunner !== "function") {
    throw new Error("Browser Use Agent runtime dependencies are required");
  }
  const runs = new Map();

  function emit(run, event) {
    const safeEvent = { ...event, runId: run.runId };
    run.events.push(safeEvent);
  }

  function cleanup(run) {
    if (run.cleaned) return;
    run.cleaned = true;
    modelGateway.releaseRun(run.modelEnvironment);
    browserEnvironment.releaseOwner(run.ownerId, { closeTabs: !run.retainTabs });
  }

  function finish(run, status, details = {}) {
    if (["completed", "failed", "cancelled"].includes(run.status)) return;
    run.status = status;
    if (Object.hasOwn(details, "result")) run.result = details.result;
    if (details.error) run.error = details.error;
    run.pendingApprovals.clear();
    cleanup(run);
    emit(run, { type: status, ...details });
  }

  function handleEvent(run, event) {
    if (!event || typeof event !== "object" || typeof event.type !== "string") return;
    if (event.type === "approval") {
      const id = String(event.approvalId ?? "").trim();
      if (!id) return;
      const approval = {
        id,
        title: "Browser action requires approval",
        summary: String(event.summary ?? "External side effect"),
        action: event.action ?? null,
      };
      run.pendingApprovals.set(id, approval);
      run.status = "pending_approval";
      emit(run, { type: "approval", approval });
      return;
    }
    if (event.type === "done") {
      finish(run, "completed", { result: event.result ?? null });
      return;
    }
    if (event.type === "error") {
      finish(run, "failed", { error: String(event.error ?? "Browser Use Agent failed") });
      return;
    }
    emit(run, event);
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
    run.child.on("error", (error) => finish(run, "failed", { error: error.message }));
    run.child.on("close", (code, signal) => {
      if (run.status === "cancelled" || run.status === "completed" || run.status === "failed") return;
      finish(run, "failed", {
        error: `Browser Use Agent exited before completion (${signal ?? code ?? "unknown"})`,
      });
    });
  }

  async function start(input) {
    const task = String(input?.task ?? "").trim();
    const ownerId = String(input?.ownerId ?? "").trim();
    if (!task || !ownerId) throw new Error("Browser Use Agent task and ownerId are required");
    await modelGateway.start();
    const browserEnvironmentValue = await browserEnvironment.environmentForOwner(ownerId);
    const modelEnvironment = modelGateway.environmentForRun({ ownerId, model: input.model ?? null });
    const child = spawnRunner({
      env: { ...browserEnvironmentValue, ...modelEnvironment },
      ownerId,
    });
    const run = {
      runId: randomUUID(),
      ownerId,
      status: "running",
      retainTabs: input.retainTabs === true,
      pendingApprovals: new Map(),
      events: [],
      modelEnvironment,
      child,
      cleaned: false,
    };
    runs.set(run.runId, run);
    attachOutput(run);
    writeMessage(child, {
      task,
      useVision: input.useVision ?? "auto",
      maxSteps: input.maxSteps,
      maxActionsPerStep: input.maxActionsPerStep,
    });
    return publicRun(run);
  }

  function status(runId) {
    const run = runs.get(runId);
    return run ? publicRun(run) : null;
  }

  async function approve({ runId, approvalId, decision }) {
    const run = runs.get(runId);
    const approval = run?.pendingApprovals.get(approvalId);
    if (!run || !approval) return { ok: false, error: "approval_not_found" };
    if (!["accept", "reject"].includes(decision)) return { ok: false, error: "invalid_decision" };
    run.pendingApprovals.delete(approvalId);
    run.status = run.pendingApprovals.size ? "pending_approval" : "running";
    writeMessage(run.child, { type: "approval_response", approvalId, decision });
    emit(run, { type: "approval_resolved", approvalId, decision });
    return { ok: true, run: publicRun(run) };
  }

  async function cancel(runId) {
    const run = runs.get(runId);
    if (!run) return null;
    if (!["completed", "failed", "cancelled"].includes(run.status)) {
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

  return { approve, cancel, dispose, start, status };
}
