import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  detectAvailableLocalAgents,
} from "./detect-local-agents.mjs";
import { appendContractEvent, normalizeAdapterResult, runEventsToConversationMessages } from "./contract.mjs";
import {
  createConversation,
  getOrCreateConversation,
  listConversations,
  resetConversationPointer,
  updateConversation,
  writeConversationEvents,
} from "./conversation-store.mjs";
import { clearSession } from "./session-store.mjs";
import { createConversationRuntimeApi } from "./conversation-runtime-api.mjs";
import { runId, isProcessTreeAlive, terminateProcessTreeByPid } from "./utils.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";
import { ensureManagedAcpTool } from "./managed-acp-tools.mjs";
import { ensureRunLogPath, legacyPersonalAssistantRunLogRoot, legacyRunLogRoot, runLogRoot } from "./workdir.mjs";
import { isStaleNativeSessionError, staleNativeSessionResetMessage } from "./native-sessions.mjs";
import { configureProcessRegistry, getAgentProcess, registerAgentProcess, unregisterAgentProcess } from "./process-registry.mjs";
import { schedulePersonalAgentStartupReconcile } from "./startup-reconcile.mjs";
import { getAgentOverrides, setAgentOverrides } from "./custom-agent-store.mjs";
import { buildErrorTip, buildProviderContextResetEvents, classifyErrorInfo } from "./error-diagnostics.mjs";
import { forgetRememberedApprovalDecision, rememberApprovalDecision } from "./approval-store.mjs";
import { createRunPersistence } from "./run-persistence.mjs";
import { createAdapterRegistry } from "./adapter-registry.mjs";
import { createApprovalRuntime } from "./approval-runtime.mjs";
import { createOrphanReconcile } from "./orphan-reconcile.mjs";
import {
  sanitizeAcpToolCallEvent,
  visibleArtifacts,
  recordFileChangeFromToolCall,
  recordFileChangeFromAcpUpdate,
  extractAssistantArtifactPaths,
  recordArtifact,
  normalizeRunTimeoutMs,
  normalizeAccessibleWorkspaceRoots,
} from "./artifact-tracking.mjs";
import {
  buildRestoredRunSnapshot,
  buildRunMeta,
  buildRunSnapshot,
  buildStartupStalledDebugSummary,
  buildStartupStalledErrorInfo,
  classifyRestoredRunMeta,
  defaultConnectionMode,
  isStartupStalled,
  normalizeApprovalMode,
  normalizeWorkerRunPolicy,
  parseRunLogContent,
  parseStatusInput,
  providerDiagnosticsFromResult,
} from "./run-helpers.mjs";
import { createAgentCatalog } from "./agent-catalog.mjs";
import { personalAgentMetadataFromAgent } from "./agent-metadata.mjs";
import { createConnectionProbes } from "./connection-probes.mjs";
import { createHostStatusService } from "./host-status-service.mjs";
import { sanitizeTaskPermissionGrant } from "./task-permission-policy.mjs";
import { createSessionOperations } from "./session-operations.mjs";
import { createPersonalAgentStartGate } from "./start-gate.mjs";
import {
  createTaskOperationRegistry,
  normalizeTaskOperationId,
  taskOperationCancellationResult as operationCancellationResult,
  taskOperationInputValue as operationInputValue,
} from "./task-operation-registry.mjs";
const runSnapshotDeps = {
  visibleArtifacts,
  runEventsToConversationMessages,
};

const DEFAULT_CANCEL_HANDLER_TIMEOUT_MS = 2_000;
const DEFAULT_CANCEL_ESCALATION_GRACE_MS = 1_000;
const MAX_CANCEL_TIMEOUT_MS = 30_000;

function boundedCancelDuration(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(MAX_CANCEL_TIMEOUT_MS, Math.round(numeric)));
}

function boundedOperation(value, timeoutMs) {
  const timeout = boundedCancelDuration(timeoutMs, DEFAULT_CANCEL_HANDLER_TIMEOUT_MS);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "timeout" });
    }, timeout);
    Promise.resolve()
      .then(value)
      .then(
        (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ kind: "success", result });
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ kind: "error", error });
        },
      );
  });
}

function validCancellationPid(value) {
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return null;
  return pid;
}

function isRetryableCodexSessionAuthFailure(provider, error) {
  if (provider !== "codex") return false;
  const message = String(error?.message ?? error);
  return /session\/new\b[\s\S]*\b(?:authentication required|auth|required login|unauthorized)\b/i.test(message);
}

export function createPersonalAgentRuntime(options) {
  configurePersonalAgentRuntimeState(options ?? {});
  const providerEnvironment = Object.freeze({ ...(options?.providerEnvironment ?? process.env) });
  // Capture the reconcile cutoff at runtime start so orphaned "running" logs
  // from the current session are never treated as stale-and-finalized.
  const reconcileCutoffMs = Date.now();
  const runs = new Map();
  const legacy = options.legacy;
  const injectedAdapters = options.adapters ?? {};
  const rememberApprovalDecisionFn = typeof options.rememberApprovalDecision === "function"
    ? options.rememberApprovalDecision
    : rememberApprovalDecision;
  const forgetRememberedApprovalDecisionFn = typeof options.forgetRememberedApprovalDecision === "function"
    ? options.forgetRememberedApprovalDecision
    : forgetRememberedApprovalDecision;
  if (options.processRegistryFile || options.processRegistryNamespace) {
    configureProcessRegistry({
      filePath: options.processRegistryFile,
      namespace: options.processRegistryNamespace,
    });
  }
  const processTermination = {
    isAlive: typeof options.isProcessTreeAlive === "function" ? options.isProcessTreeAlive : isProcessTreeAlive,
    terminate: typeof options.terminateProcessTreeByPid === "function" ? options.terminateProcessTreeByPid : terminateProcessTreeByPid,
  };
  const cancelHandlerTimeoutMs = boundedCancelDuration(
    options.cancelHandlerTimeoutMs ?? options.cancelTimeoutMs,
    DEFAULT_CANCEL_HANDLER_TIMEOUT_MS,
  );
  const cancelEscalationGraceMs = boundedCancelDuration(
    options.cancelEscalationGraceMs,
    DEFAULT_CANCEL_ESCALATION_GRACE_MS,
  );
  const cancelEscalationTimeoutMs = boundedCancelDuration(
    options.cancelEscalationTimeoutMs,
    Math.min(MAX_CANCEL_TIMEOUT_MS, cancelEscalationGraceMs + 2_000),
  );
  const startGate = createPersonalAgentStartGate();
  const taskOperationRegistry = createTaskOperationRegistry({
    createId: runId,
    cancelOperation: (...args) => cancelTaskOperation(...args),
  });
  const {
    begin: beginTaskOperation,
    finish: finishTaskOperation,
    lookup: taskOperationLookup,
    markCancelled: markOperationCancelled,
    maybeFinish: maybeFinishTaskOperation,
    retain: retainOperation,
  } = taskOperationRegistry;
  const bundledExtensionRoots = Array.isArray(options.bundledExtensionRoots) ? options.bundledExtensionRoots.filter(Boolean) : [];
  const conversationApi = createConversationRuntimeApi({
    legacy,
    runs,
    getRunSnapshot: (state, options) => snapshot(state, options),
    resolveApproval: (input) => resolveApproval(input),
  });
  const {
    resetConversation,
    listAgentConversations,
    createAgentConversation: createAgentConversationRaw,
    getAgentConversation,
    getAgentConversationById,
    listAgentChannelConversations,
    listAgentConversationsByProvider,
    importAgentConversationFromArchive,
    getConversationStatus,
    listConversationConfirmations,
    confirmConversationConfirmation,
  } = conversationApi;
  const { adapterFactoryForProvider } = createAdapterRegistry({ injectedAdapters });
  const { finalizeStaleRunLog, reconcileOrphanRuns } = createOrphanReconcile({
    runs,
    reconcileCutoffMs,
    userDataDir: options.userDataDir,
    processTermination,
  });
  const startupReconcile = schedulePersonalAgentStartupReconcile({
    reconcileCutoffMs,
    deferMs: options.deferStartupReconcileMs,
    userDataDir: options.userDataDir,
    getRun: status,
    reconcileOrphanRuns,
  });

  async function persistRun(state) {
    if (typeof options.persistRun === "function") {
      await options.persistRun(state);
      return;
    }
    const meta = buildRunMeta(state, { visibleArtifacts });
    const lines = [meta, ...state.events].map((entry) => JSON.stringify(entry)).join("\n");
    if (!state.logPath) return;
    await mkdir(path.dirname(state.logPath), { recursive: true });
    await writeFile(state.logPath, `${lines}${lines ? "\n" : ""}`, "utf8");
    if (state.workspaceRoot && state.agentProvider && state.agentId && state.conversationId) {
      await writeConversationEvents(
        state.workspaceRoot,
        state.agentProvider,
        state.agentId,
        state.conversationId,
        state.events,
        runEventsToConversationMessages(state.events),
      ).catch(() => undefined);
    }
  }

  const { schedulePersistRun, flushPersistRun, retainCompletedRunBriefly } = createRunPersistence({ persistRun, runs });
  const { requestRunApproval, resolveApproval } = createApprovalRuntime({
    runs,
    flushPersistRun,
    beginTaskOperation,
    finishTaskOperation,
    operationCancellationResult,
    rememberApprovalDecision: rememberApprovalDecisionFn,
    forgetRememberedApprovalDecision: forgetRememberedApprovalDecisionFn,
  });

  function snapshot(state, options = {}) {
    return buildRunSnapshot(state, runSnapshotDeps, options);
  }

  function isProcessAlive(pid) {
    const n = Number(pid);
    if (!n) return false;
    try {
      process.kill(n, 0);
      return true;
    } catch {
      return false;
    }
  }

  function snapshotFromLog(workspaceRoot, id) {
    if (!workspaceRoot || !id) return null;
    let raw = "";
    let logPath = "";
    for (const root of [runLogRoot(workspaceRoot), legacyPersonalAssistantRunLogRoot(workspaceRoot), legacyRunLogRoot(workspaceRoot)]) {
      const candidate = path.join(root, `${id}.jsonl`);
      try {
        raw = readFileSync(candidate, "utf8");
        logPath = candidate;
        break;
      } catch {
        // Try the next compatible runtime-state location.
      }
    }
    if (!raw) {
      return null;
    }
    const { meta, events } = parseRunLogContent(raw);
    if (!meta) return null;
    // Finalized orphaned runs (previous process crashed mid-run) must be
    // invisible to the UI: they carry a misleading "failed / orphaned" status
    // that reappears every time the renderer polls a stale runId cached in
    // localStorage. Returning null lets status() fall through to legacy /
    // not-found, and pollRun then clears the stale activeRunId.
    const classification = classifyRestoredRunMeta(meta);
    if (classification === "orphaned") return null;
    if (classification === "stale_running") {
      if (logPath) void finalizeStaleRunLog(logPath, meta);
      return null;
    }
    return buildRestoredRunSnapshot(meta, events, id, logPath, runSnapshotDeps);
  }

  async function runtimeContext() {
    const onmyagentServer = typeof options.onmyagentServerInfo === "function" ? await options.onmyagentServerInfo() : null;
    const engine = typeof options.engineInfo === "function" ? await options.engineInfo() : null;
    let opencodeAuthorization = null;
    if (engine?.baseUrl && engine?.opencodeUsername && engine?.opencodePassword) {
      opencodeAuthorization = `Basic ${Buffer.from(`${engine.opencodeUsername}:${engine.opencodePassword}`, "utf8").toString("base64")}`;
    } else if (onmyagentServer?.clientToken || onmyagentServer?.ownerToken) {
      opencodeAuthorization = `Bearer ${onmyagentServer.clientToken ?? onmyagentServer.ownerToken}`;
    }
    return {
      onmyagentServerBaseUrl: onmyagentServer?.baseUrl ?? null,
      opencodeBaseUrl: engine?.baseUrl ?? onmyagentServer?.baseUrl ?? null,
      onmyagentServerToken: onmyagentServer?.clientToken ?? onmyagentServer?.ownerToken ?? null,
      opencodeAuthorization,
      workspacePath: engine?.projectDir ?? null,
    };
  }

  async function createAgentConversation(input = {}) {
    const operation = beginTaskOperation("createConversation", input);
    if (operation?.status === "cancelling" || operation?.signal.aborted) {
      finishTaskOperation(operation, operationCancellationResult(operation));
      return operationCancellationResult(operation);
    }
    let result = null;
    let error = null;
    try {
      // The conversation store accepts only the documented input fields. The
      // operation id/signal stay runtime-local and are intentionally not
      // persisted into conversation metadata.
      result = await createAgentConversationRaw(input);
      operation && (operation.conversationId = result?.conversation?.id ?? result?.id ?? null);
      if (operation?.status === "cancelling" || operation?.signal.aborted) {
        return operationCancellationResult(operation, { conversationId: operation.conversationId });
      }
      return result;
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      finishTaskOperation(operation, result, error);
    }
  }

  async function cancelTaskOperation(input = {}, options = {}) {
    const operationId = normalizeTaskOperationId(operationInputValue(input));
    if (!operationId) return { ok: false, error: "operationId is required" };
    const operation = taskOperationRegistry.get(operationId);
    if (!operation) return { ok: false, error: "task operation not found", operationId };
    if (operation.cancelPromise) return operation.cancelPromise;
    // Cancellation is caller-owned and idempotent. A late timeout/caller
    // race must not turn a completed cancellation into a spurious "run not
    // running" error (nor invoke the provider cancel hook twice).
    if (operation.status === "cancelled" && !operation.state?.cancelHandler && operation.state?.status !== "running") {
      return {
        ok: true,
        operationId,
        runId: operation.runId ?? operation.state?.runId ?? null,
        status: "cancelled",
        idempotent: true,
      };
    }
    const inputRecord = input && typeof input === "object"
      ? /** @type {Record<string, unknown>} */ (input)
      : null;
    const reason = String(options.reason ?? inputRecord?.reason ?? "caller-cancelled").trim() || "caller-cancelled";
    markOperationCancelled(operation, reason);
    operation.cancelSettled = false;
    const cancellation = (async () => {
      const state = operation.state;
      if (state?.runId) {
        const result = await cancel(state.runId, {
          reason: reason === "aborted" ? "operation-aborted" : reason,
          cancelHandlerTimeoutMs: options.cancelHandlerTimeoutMs,
          cancelEscalationTimeoutMs: options.cancelEscalationTimeoutMs,
        });
        if (result?.ok !== true && state.status === "running") {
          operation.status = "failed";
          operation.updatedAt = Date.now();
          retainOperation(operation);
          return { ok: false, operationId, error: result?.error ?? "task operation cancellation failed" };
        }
        operation.status = "cancelled";
        operation.updatedAt = Date.now();
        return { ok: true, operationId, runId: state.runId, status: state.status, cancellation: result };
      }
      // No run id exists yet. The start/create operation will observe the
      // aborted record at its next boundary and must not register late work.
      operation.status = "cancelled";
      operation.updatedAt = Date.now();
      return { ok: true, operationId, pending: true, status: "cancelled" };
    })();
    operation.cancelPromise = cancellation;
    try {
      return await cancellation;
    } catch (error) {
      operation.status = "failed";
      operation.updatedAt = Date.now();
      retainOperation(operation);
      return { ok: false, operationId, error: String(error?.message ?? error) };
    } finally {
      if (operation.cancelPromise === cancellation) operation.cancelPromise = null;
      operation.cancelSettled = true;
      maybeFinishTaskOperation(
        operation,
        operation.state ?? operationCancellationResult(operation),
        operation.status === "failed" ? new Error("task operation cancellation failed") : null,
      );
    }
  }

  async function start(input = {}) {
    startGate.assertAllowed();
    const operation = beginTaskOperation("startMessage", input);
    let startFailure = null;
    if (operation?.status === "cancelling" || operation?.signal.aborted) {
      finishTaskOperation(operation, operationCancellationResult(operation));
      return operationCancellationResult(operation);
    }
    try {
      const agent = await legacy.normalizeAgent(input.agent ?? {});
      if (operation?.status === "cancelling" || operation?.signal.aborted) {
        return operationCancellationResult(operation);
      }
      const adapterFactory = adapterFactoryForProvider(agent.provider, agent);
      if (!adapterFactory) {
        const legacyResult = await legacy.start({ ...input, signal: operation?.signal ?? input.signal });
        return operation?.status === "cancelling" || operation?.signal.aborted
          ? operationCancellationResult(operation)
          : legacyResult;
      }
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const prompt = String(input.prompt ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!prompt) throw new Error("prompt is required");
    const accessibleWorkspaceRoots = normalizeAccessibleWorkspaceRoots(input.accessibleWorkspaceRoots, workspaceRoot);
    const detected = await legacy.detectAgent(agent, workspaceRoot);
    if (operation?.status === "cancelling" || operation?.signal.aborted) {
      return operationCancellationResult(operation);
    }
    const id = runId();
    const startedAt = Date.now();
    const events = [];
    const provider = detected.provider ?? agent.provider;
    const agentId = detected.id ?? agent.id ?? provider;
    const taskPermissionGrant = sanitizeTaskPermissionGrant(input.taskPermissionGrant);
    const workerRunPolicy = normalizeWorkerRunPolicy(input, detected.model);
    const state = {
      runId: id,
      agentId,
      agentProvider: provider,
      connectionMode: defaultConnectionMode(provider, detected),
      status: "running",
      workspaceRoot,
      accessibleWorkspaceRoots,
      conversationId: null,
      providerSessionId: null,
      initialProviderSessionId: null,
      effectiveModel: null,
      transport: null,
      resumeKey: null,
      conversationWorkdir: null,
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      pid: null,
      processStartToken: null,
      terminationConfirmed: false,
      exitConfirmed: false,
      childExitConfirmed: false,
      childState: null,
      exitCode: null,
      operationId: operation?.operationId ?? null,
      operationSignal: operation?.signal ?? null,
      agent,
      command: `${agent.provider} harness session`,
      outputParts: [],
      error: null,
      events,
      logPath: await ensureRunLogPath(workspaceRoot, id),
      metadata: null,
      workdir: null,
      debugSummary: null,
      errorInfo: null,
      cancelHandler: null,
      approvalMode: normalizeApprovalMode(input.approvalMode),
      taskControlPlane: input.taskControlPlane ?? null,
      taskTools: Array.isArray(input.taskTools) ? [...input.taskTools] : [],
      mcpServers: Array.isArray(input.mcpServers) ? [...input.mcpServers] : [],
      taskDepth: Number.isInteger(input.taskDepth) ? input.taskDepth : 0, taskPermissionMode: input.taskPermissionMode === "full-allow" ? "full-allow" : "restricted",
      // The Task Center runner passes the signed grant and profile context;
      // derive the stable task identity from the bounded grant when callers do
      // not duplicate it in the start payload.
      taskId: String(input.taskId ?? taskPermissionGrant?.taskId ?? "").trim() || null,
      taskRunId: String(input.taskRunId ?? input.runId ?? taskPermissionGrant?.taskRunId ?? "").trim() || null,
      taskRevision: Number.isSafeInteger(Number(input.taskRevision)) ? Number(input.taskRevision) : taskPermissionGrant?.taskRevision ?? null,
      taskContractHash: String(input.taskContractHash ?? input.contractHash ?? "").trim() || null,
      taskProfileId: String(input.taskProfileId ?? "").trim() || null,
      taskPermissionGrant,
      taskExecutionObserver: input.taskExecutionObserver && typeof input.taskExecutionObserver === "object"
        ? input.taskExecutionObserver
        : null,
      ...workerRunPolicy,
      pendingApprovals: [],
      approvalResolvers: new Map(),
      timeoutMs: normalizeRunTimeoutMs(input.timeoutMs),
      timeoutTimer: null,
      timedOut: false,
      cancelRequested: null,
      cancelEscalationUnresolved: false,
      processTerminationPromise: null,
      lateProcessCleanupPromise: null,
      taskStarted: false,
      taskSettled: false,
      artifacts: [],
      fileChanges: [],
    };
    if (operation) {
      operation.state = state;
      operation.runId = id;
      operation.updatedAt = Date.now();
    }
    if (operation?.status === "cancelling" || operation?.signal.aborted) {
      state.cancelRequested = operation.cancelReason ?? "operation-cancelled";
      await finalizeCancellation(state, state.cancelRequested, { diagnostic: "operation cancelled before provider start" });
      return snapshot(state);
    }
    runs.set(id, state);
    // Record the user's prompt as the first event of the run so the Studio
    // conversation view (and conversation-store hydration) can render the user
    // message for channel-initiated runs, which have no renderer-side optimistic
    // input. Prefer the raw user text (input.userText) when available — for
    // Telegram/Discord the wrapped `prompt` carries transport metadata that is
    // not useful to display.
    appendContractEvent(events, { type: "user", text: String(input.userText ?? prompt ?? "").trim() });
    appendContractEvent(events, { type: "status", text: `${provider} ACP flow started` });
    state.updatedAt = Date.now();
    schedulePersistRun(state);

    if (detected.status !== "online") {
      state.status = "failed";
      state.errorInfo = classifyErrorInfo(new Error(detected.error || `${detected.name} 不可用`));
      state.error = state.errorInfo.message;
      state.finishedAt = Date.now();
      appendContractEvent(events, { type: "error", text: state.error });
      appendContractEvent(events, buildErrorTip(state.errorInfo));
      await flushPersistRun(state, true);
      return snapshot(state);
    }
    if ((provider === "codex" || provider === "claude") && !Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) {
      try {
        const tool = await ensureManagedAcpTool(provider);
        detected.executablePath = tool.binPath;
        detected.managedAcpTool = tool;
        detected.connectionMode = defaultConnectionMode(provider, detected);
        appendContractEvent(events, { type: "status", text: `${provider} managed ACP tool ready: ${tool.id}@${tool.version}` });
      } catch (error) {
        state.status = "failed";
        state.errorInfo = classifyErrorInfo(error);
        state.error = state.errorInfo.message;
        state.finishedAt = Date.now();
        appendContractEvent(events, { type: "error", text: state.error });
        appendContractEvent(events, buildErrorTip(state.errorInfo));
        await flushPersistRun(state, true);
        return snapshot(state);
      }
    }
    if (operation?.status === "cancelling" || operation?.signal.aborted) {
      await cancel(state.runId, { reason: operation.cancelReason ?? "operation-cancelled" });
      return snapshot(state);
    }
    const conversation = await getOrCreateConversation(workspaceRoot, provider, agentId, input.conversationId);
    state.conversationId = conversation.id;
    state.providerSessionId = conversation.providerSessionId;
    state.initialProviderSessionId = conversation.providerSessionId;
    state.resumeKey = conversation.resumeKey;
    if (operation) operation.conversationId = conversation.id;
    if (operation?.status === "cancelling" || operation?.signal.aborted) {
      await cancel(state.runId, { reason: operation.cancelReason ?? "operation-cancelled" });
      return snapshot(state);
    }
    // When the conversation has no committed workdir (a brand-new conversation
    // whose project was picked via the workspace chip after creation), fall
    // back to the workdir passed on the send so the run executes in the mounted
    // project instead of the default workspace root.
    const requestedWorkdir = input.workdir ? String(input.workdir).trim() || null : null;
    state.conversationWorkdir = conversation.workdir || requestedWorkdir || null;
    state.timeoutTimer = setTimeout(() => {
      if (state.status !== "running") return;
      state.timedOut = true;
      cancel(state.runId, { reason: "timeout" }).catch(() => undefined);
    }, state.timeoutMs);

    let bootResolved = false;
    let resolveBoot;
    const bootReady = new Promise((resolve) => {
      resolveBoot = resolve;
    });
    const markBootReady = () => {
      if (bootResolved) return;
      bootResolved = true;
      resolveBoot?.();
    };

    state.taskStarted = true;
    const task = (async () => {
      try {
        const ctx = await runtimeContext();
        const adapter = adapterFactory({
          ...ctx,
          appendEvent: (event) => {
            state.updatedAt = Date.now();
            const sanitized = sanitizeAcpToolCallEvent(event);
            const normalized = appendContractEvent(events, sanitized);
            const pidMatch = normalized?.type === "log" ? String(normalized.text ?? "").match(/^pid\s+(\d+)$/) : null;
            if (pidMatch) {
              registerStateProcess(state, Number(pidMatch[1]), state.command, "acp");
            }
            if (normalized?.type === "artifact") {
              const payload = /** @type {any} */ (normalized).artifact ?? normalized.text ?? normalized;
              recordArtifact(state, payload, "adapter");
            }
            if (normalized?.type === "tool") {
              const toolCall = /** @type {any} */ (normalized).toolCall ?? null;
              recordFileChangeFromToolCall(state, toolCall);
            }
            if (normalized?.type === "acp_tool_call") {
              const update = /** @type {any} */ (normalized).update ?? null;
              recordFileChangeFromAcpUpdate(state, update);
            }
            markBootReady();
            schedulePersistRun(state);
            return normalized;
          },
          registerCancel: (handler) => {
            state.cancelHandler = typeof handler === "function" ? handler : null;
            if (state.cancelRequested) void cleanupLateProcess(state);
          },
          requestApproval: (request) => requestRunApproval(state, request),
          approvalMode: state.approvalMode,
          taskControlPlane: state.taskControlPlane,
          taskTools: state.taskTools,
          mcpServers: state.mcpServers,
          providerEnvironment,
          operationId: operation?.operationId ?? null,
          signal: operation?.signal ?? input.signal ?? null,
        });
        if (state.cancelRequested || operation?.signal.aborted) {
          await cancel(state.runId, { reason: operation?.cancelReason ?? "operation-cancelled" });
          return;
        }
        if (state.taskPermissionMode === "full-allow" && input.requireTaskIntentHook === true) {
          const capability = adapter?.taskCapabilities ?? adapter?.capabilities?.task ?? null;
          if (capability?.supportsTaskIntentHook !== true || capability?.supportsScopedFullAllow === false) {
            state.status = "failed";
            state.errorInfo = {
              code: "task_full_allow_unsupported",
              message: "Task full-allow requires a blocking pre-execute permission hook; this adapter did not prove one.",
              debug: "task-full-allow-unsupported: adapter capability is not intent-before-effect",
            };
            state.error = state.errorInfo.message;
            state.finishedAt = Date.now();
            appendContractEvent(events, { type: "error", text: state.error });
            await flushPersistRun(state, true);
            return;
          }
        }
        let sendContext = {
          runId: id,
          workspaceRoot,
          accessibleWorkspaceRoots,
          conversationId: conversation.id,
          providerSessionId: conversation.providerSessionId,
          resumeKey: conversation.resumeKey,
          conversationWorkdir: state.conversationWorkdir,
          agent: detected,
          // Preserve the caller's model and isolated-worker policy.
          ...workerRunPolicy,
          prompt,
          rawPrompt: prompt,
          approvalMode: state.approvalMode,
          taskControlPlane: state.taskControlPlane,
          taskTools: state.taskTools,
          mcpServers: state.mcpServers,
          providerEnvironment,
          taskDepth: state.taskDepth,
          taskPermissionMode: state.taskPermissionMode,
          taskId: state.taskId,
          taskRunId: state.taskRunId,
          taskRevision: state.taskRevision,
          taskContractHash: state.taskContractHash,
          taskProfileId: state.taskProfileId,
          taskPermissionGrant: state.taskPermissionGrant,
          taskExecutionObserver: state.taskExecutionObserver,
          operationId: operation?.operationId ?? null,
          signal: operation?.signal ?? input.signal ?? null,
          requestApproval: (request) => requestRunApproval(state, request),
        };
        if (state.cancelRequested || operation?.signal.aborted) {
          await cancel(state.runId, { reason: operation?.cancelReason ?? "operation-cancelled" });
          return;
        }
        let sendPromise = adapter.sendMessage(sendContext);
        markBootReady();
        let result;
        try {
          result = normalizeAdapterResult(await sendPromise);
        } catch (error) {
          if (state.command === "local agent harness session" && sendContext.agent?.managedAcpTool?.binPath) {
            const modelId = String(sendContext.model ?? "").trim();
            state.command = [
              sendContext.agent.managedAcpTool.binPath,
              sendContext.providerSessionId || sendContext.resumeKey ? `sessionID=${sendContext.providerSessionId ?? sendContext.resumeKey}` : null,
              sendContext.conversationWorkdir ? `cwd=${sendContext.conversationWorkdir}` : null,
              modelId ? `model=${modelId}` : "model=<default>",
            ].filter(Boolean).join("\n");
          }
          if (isRetryableCodexSessionAuthFailure(detected.provider, error)) {
            // session/new precedes session/prompt, so a clean ACP restart here
            // cannot duplicate the user's message or any provider side effect.
            // Codex auth refresh can briefly race the first app-server start;
            // bound recovery to one retry and preserve a persistent auth error.
            appendContractEvent(events, {
              type: "status",
              text: "Codex ACP authentication was temporarily unavailable; retrying once with a clean process.",
            });
            await resetConversationPointer(workspaceRoot, detected.provider, detected.id, conversation.id);
            await clearSession(workspaceRoot, detected.provider, detected.id).catch(() => undefined);
            sendContext = {
              ...sendContext,
              providerSessionId: null,
              resumeKey: null,
              conversationWorkdir: sendContext.sessionStrategy === "new" ? state.conversationWorkdir : null,
            };
            sendPromise = adapter.sendMessage(sendContext);
            result = normalizeAdapterResult(await sendPromise);
          } else if (error?.code === "acp_bridge_interrupted" && detected.provider === "codex") {
            for (const event of buildProviderContextResetEvents(detected.provider, "Codex ACP bridge interrupted; retrying once with a clean session.")) appendContractEvent(events, event);
            await resetConversationPointer(workspaceRoot, detected.provider, detected.id, conversation.id);
            await clearSession(workspaceRoot, detected.provider, detected.id).catch(() => undefined);
            sendContext = {
              ...sendContext,
              providerSessionId: null,
              resumeKey: null,
              conversationWorkdir: sendContext.sessionStrategy === "new" ? state.conversationWorkdir : null,
            };
            sendPromise = adapter.sendMessage(sendContext);
            try {
              result = normalizeAdapterResult(await sendPromise);
            } catch (retryError) {
              if (retryError?.code === "acp_bridge_interrupted") retryError.code = "acp_bridge_interrupted_after_retry";
              throw retryError;
            }
          } else if (isStaleNativeSessionError(detected.provider, error) && (sendContext.resumeKey || sendContext.providerSessionId)) {
            for (const event of buildProviderContextResetEvents(detected.provider, staleNativeSessionResetMessage(detected.provider))) appendContractEvent(events, event);
            await resetConversationPointer(workspaceRoot, detected.provider, detected.id, conversation.id);
            await clearSession(workspaceRoot, detected.provider, detected.id).catch(() => undefined);
            sendContext = {
              ...sendContext,
              providerSessionId: null,
              resumeKey: null,
              conversationWorkdir: sendContext.sessionStrategy === "new" ? state.conversationWorkdir : null,
            };
            sendPromise = adapter.sendMessage(sendContext);
            result = normalizeAdapterResult(await sendPromise);
          } else {
            throw error;
          }
        }
        if (state.status !== "running" || state.cancelRequested) {
          await fenceLateAdapterResult(state, result);
          return;
        }
        state.outputParts.push(result.output);
        for (const relPath of extractAssistantArtifactPaths(result.output)) {
          recordArtifact(state, { path: relPath }, "assistant");
        }
        state.command = result.command;
        state.providerSessionId = result.providerSessionId;
        const providerDiagnostics = providerDiagnosticsFromResult(result);
        state.effectiveModel = providerDiagnostics?.effectiveModel ?? null;
        state.transport = providerDiagnostics?.transport ?? null;
        state.resumeKey = result.resumeKey;
        state.metadata = result.metadata ?? null;
        state.workdir = result.workdir ?? null;
        state.terminationConfirmed = result.terminationConfirmed === true;
        state.exitConfirmed = result.exitConfirmed === true;
        state.childExitConfirmed = result.childExitConfirmed === true;
        state.childState = result.childState ?? null;
        state.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null;
        await updateConversation(workspaceRoot, detected.provider, detected.id, conversation.id, {
          title: conversation.title,
          providerSessionId: result.providerSessionId ?? result.sessionId ?? state.providerSessionId ?? null,
          resumeKey: result.resumeKey ?? result.providerSessionId ?? result.sessionId ?? state.resumeKey ?? null,
          workdir: result.workdir ?? state.conversationWorkdir ?? null,
          lastRunId: state.runId,
          lastStatus: "completed",
          source: conversation.source ?? "studio-created",
        });
        state.debugSummary = [
          `provider=${state.agentProvider}`,
          `connection=${result.connectionMode ?? state.connectionMode}`,
          `runId=${state.runId}`,
          state.providerSessionId ? `providerSessionId=${state.providerSessionId}` : "providerSessionId=<none>",
          state.resumeKey ? `resumeKey=${state.resumeKey}` : "resumeKey=<none>",
          result.workdir ? `workdir=${result.workdir}` : null,
        ].filter(Boolean).join("\n");
        if (result.connectionMode) state.connectionMode = result.connectionMode;
        if (result.pid) {
          registerStateProcess(state, result.pid, result.command, result.metadata?.agent_type ?? "acp");
        }
        // Stream chunks flow live via appendEvent during the run; completion is
        // marked by a single `finish` event carrying stopReason and truncation.
        appendContractEvent(events, {
          type: "finish",
          text: result.output,
          stopReason: result.metadata?.stopReason ?? null,
          truncated: Boolean(result.metadata?.truncated),
        });
        state.updatedAt = Date.now();
        state.status = "completed";
        state.error = null;
        state.errorInfo = null;
        schedulePersistRun(state);
      } catch (error) {
        if (state.status !== "running" || state.cancelRequested) return;
        state.status = "failed";
        state.errorInfo = classifyErrorInfo(error);
        state.error = state.errorInfo.message;
        state.debugSummary = [
          `provider=${state.agentProvider}`,
          `connection=${state.connectionMode}`,
          `runId=${state.runId}`,
          `errorCode=${state.errorInfo.code}`,
          state.errorInfo.debug ? `debug=${state.errorInfo.debug}` : null,
        ].filter(Boolean).join("\n");
        appendContractEvent(events, { type: "error", text: state.error });
        appendContractEvent(events, buildErrorTip(state.errorInfo));
        await updateConversation(workspaceRoot, detected.provider, detected.id, conversation.id, {
          lastRunId: state.runId,
          lastStatus: "failed",
          metadata: {
            ...(conversation.metadata ?? {}),
            health: state.errorInfo.code === "acp_bridge_interrupted" ? "unhealthy" : "failed",
            lastFailureCode: state.errorInfo.code,
            lastFailure: state.errorInfo.message,
            lastFailureAt: Date.now(),
          },
        });
        state.updatedAt = Date.now();
        schedulePersistRun(state);
      } finally {
        markBootReady();
        // Keep an unresolved cancellation record discoverable until a later
        // cleanup pass confirms the process tree is gone.  Unregistering here
        // would erase the only safe PID/PGID identity while a late provider
        // result or hung process is still alive.
        if (!state.cancelEscalationUnresolved) unregisterAgentProcess(state.runId);
        state.cancelHandler = null;
        state.finishedAt ??= Date.now();
        if (state.timeoutTimer) {
          clearTimeout(state.timeoutTimer);
          state.timeoutTimer = null;
        }
        let settlementFailure = null;
        try {
          await flushPersistRun(state, true);
        } catch (error) {
          settlementFailure = error;
          state.status = "failed";
          state.errorInfo = classifyErrorInfo(error);
          state.error = `Final run persistence failed: ${state.errorInfo.message}`;
          state.finishedAt ??= Date.now();
          state.updatedAt = Date.now();
        } finally {
          retainCompletedRunBriefly(state);
          state.taskSettled = true;
          if (operation?.state === state) maybeFinishTaskOperation(operation, state, settlementFailure);
        }
      }
    })();

    await Promise.race([bootReady, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    void task.catch(() => undefined);

    return snapshot(state);
    } catch (error) {
      startFailure = error;
      throw error;
    } finally {
      maybeFinishTaskOperation(operation, operation?.state ?? null, startFailure);
    }
  }

  async function run(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    if (!adapterFactoryForProvider(agent.provider, agent)) return legacy.run(input);
    const started = await start(input);
    if (!started?.runId || started?.cancelled || started?.status === "cancelled") return started;
    return await new Promise((resolve) => {
      const poll = () => {
        const current = status(started.runId);
        if (current.status !== "running") {
          resolve(current);
          return;
        }
        setTimeout(poll, 250);
      };
      poll();
    });
  }

  function status(input, options = {}) {
    const { runId: id, workspaceRoot } = parseStatusInput(input);
    const state = runs.get(id);
    if (state) {
      if (isStartupStalled(state)) {
        state.status = "failed";
        state.finishedAt = Date.now();
        state.errorInfo = buildStartupStalledErrorInfo();
        state.error = state.errorInfo.message;
        state.debugSummary = buildStartupStalledDebugSummary(state);
        appendContractEvent(state.events, { type: "error", text: state.error });
        appendContractEvent(state.events, buildErrorTip(state.errorInfo));
        state.updatedAt = Date.now();
        schedulePersistRun(state);
      }
      return snapshot(state, options);
    }
    const restored = snapshotFromLog(workspaceRoot, id);
    if (restored) return restored;
    const legacyResult = legacy.status(id);
    if (legacyResult?.status === "missing") return null;
    return legacyResult;
  }

  function cancellationProcessRecord(state) {
    const registered = getAgentProcess(state.runId);
    if (registered && registered.runId === state.runId) {
      const provider = String(registered.provider ?? registered.backend ?? "").trim();
      if (provider && provider !== state.agentProvider) return null;
      const pid = validCancellationPid(registered.pid);
      if (pid) {
        return {
          runId: state.runId,
          pid,
          pgid: validCancellationPid(registered.pgid),
          source: "registry",
          ...(registered.processStartToken ? { processStartToken: registered.processStartToken } : {}),
        };
      }
    }
    const pid = validCancellationPid(state.pid);
    if (!pid) return null;
    return {
      runId: state.runId,
      pid,
      pgid: null,
      source: "state",
      ...(state.processStartToken ? { processStartToken: state.processStartToken } : {}),
    };
  }

  function processAlive(record) {
    try {
      const result = processTermination.isAlive(record);
      if (result === true) return true;
      if (result === false) return false;
      return null;
    } catch {
      return null;
    }
  }

  async function terminateAndConfirm(record) {
    const initial = processAlive(record);
    if (initial === false) return { confirmed: true, attempted: false };
    if (initial === null) return { confirmed: false, attempted: false, error: "process liveness probe failed" };
    const termination = await boundedOperation(
      () => processTermination.terminate({
        pid: record.pid,
        pgid: record.pgid,
        ...(record.processStartToken ? { processStartToken: record.processStartToken } : {}),
        graceMs: cancelEscalationGraceMs,
      }),
      cancelEscalationTimeoutMs,
    );
    if (termination.kind !== "success") {
      return {
        confirmed: false,
        attempted: true,
        error: termination.kind === "timeout" ? "process termination timed out" : String(termination.error?.message ?? termination.error ?? "process termination failed"),
      };
    }
    if (termination.result?.terminated === false) {
      return {
        confirmed: false,
        attempted: true,
        error: String(termination.result.reason ?? "process termination was not confirmed"),
      };
    }
    const deadline = Date.now() + cancelEscalationTimeoutMs;
    while (Date.now() < deadline) {
      const alive = processAlive(record);
      if (alive === false) return { confirmed: true, attempted: true };
      if (alive === null) return { confirmed: false, attempted: true, error: "process liveness probe failed after termination" };
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
    }
    const finalAlive = processAlive(record);
    return finalAlive === false
      ? { confirmed: true, attempted: true }
      : { confirmed: false, attempted: true, error: "process remains alive after termination" };
  }

  function terminateStateProcess(state, record) {
    if (!state || !record) return Promise.resolve({ confirmed: true, attempted: false });
    if (state.processTerminationPromise) return state.processTerminationPromise;
    const termination = terminateAndConfirm(record)
      .then((result) => {
        if (result.confirmed) {
          unregisterAgentProcess(state.runId);
          state.cancelEscalationUnresolved = false;
        } else {
          state.cancelEscalationUnresolved = true;
        }
        return result;
      })
      .catch((error) => {
        state.cancelEscalationUnresolved = true;
        return { confirmed: false, attempted: true, error: String(error?.message ?? error) };
      })
      .finally(() => {
        state.processTerminationPromise = null;
      });
    state.processTerminationPromise = termination;
    return termination;
  }

  async function cleanupLateProcess(state) {
    if (!state || !(state.cancelRequested || state.status !== "running")) return { confirmed: true, attempted: false };
    if (state.lateProcessCleanupPromise) return state.lateProcessCleanupPromise;
    const cleanup = (async () => {
      const record = cancellationProcessRecord(state);
      if (!record) return { confirmed: true, attempted: false };
      return terminateStateProcess(state, record);
    })().finally(() => {
      state.lateProcessCleanupPromise = null;
    });
    state.lateProcessCleanupPromise = cleanup;
    return cleanup;
  }

  function registerStateProcess(state, pid, command = state?.command, agentType = "acp") {
    const numericPid = validCancellationPid(pid);
    if (!state || !numericPid) return null;
    state.pid = numericPid;
    const registered = registerAgentProcess({
      runId: state.runId,
      pid: numericPid,
      pgid: numericPid,
      provider: state.agentProvider,
      backend: state.agentProvider,
      conversationId: state.conversationId,
      agentType,
      command,
      startedAt: state.startedAt,
    });
    state.processStartToken = registered?.processStartToken ?? state.processStartToken ?? null;
    // A provider may report its child PID after the caller-owned operation has
    // already timed out. Reap that late process through the same identity-
    // fenced path as normal cancellation; never leave a registry residue.
    if (state.cancelRequested || state.status !== "running") void cleanupLateProcess(state);
    return registered;
  }

  async function fenceLateAdapterResult(state, result) {
    if (!state || !result || !(state.cancelRequested || state.status !== "running")) return;
    if (result.pid) registerStateProcess(state, result.pid, result.command ?? state.command, result.metadata?.agent_type ?? "acp");
    const lateSessionId = String(result.providerSessionId ?? result.sessionId ?? result.resumeKey ?? "").trim();
    // A newly-created provider session may have been written by the adapter
    // before its late result arrived. Remove only that new pointer; a resumed
    // Personal conversation keeps its pre-existing session intact.
    if (lateSessionId && !state.initialProviderSessionId && state.workspaceRoot && state.agentProvider && state.agentId) {
      await clearSession(state.workspaceRoot, state.agentProvider, state.agentId).catch(() => undefined);
    }
    await cleanupLateProcess(state).catch(() => undefined);
  }

  function clearCancellationApprovals(state) {
    for (const [approvalId, resolver] of state.approvalResolvers ?? []) {
      try {
        resolver({ decision: "cancel", approval: (state.pendingApprovals ?? []).find((item) => item.id === approvalId) ?? null });
      } catch {
        // A resolver belongs to a provider request; a stale resolver must not
        // prevent cancellation cleanup for the rest of the run.
      }
    }
    state.approvalResolvers?.clear?.();
    state.pendingApprovals = [];
  }

  async function finalizeCancellation(state, reason, options = {}) {
    const isTimeout = reason === "timeout" || state.timedOut;
    const escalated = options.escalated === true;
    const diagnostic = String(options.diagnostic ?? "").trim();
    state.status = isTimeout ? "failed" : "cancelled";
    const baseError = isTimeout
      ? `本地 Agent 执行超时（已运行 ${Math.round((Date.now() - state.startedAt) / 1000)}s，超过 ${Math.round(state.timeoutMs / 1000)}s 上限），已自动停止。`
      : "用户取消";
    state.error = diagnostic ? `${baseError} ${diagnostic}` : baseError;
    state.errorInfo = isTimeout
      ? { code: "timeout", message: state.error, debug: diagnostic || `wall-clock timeout after ${state.timeoutMs}ms` }
      : { code: "cancelled", message: state.error, debug: diagnostic || null };
    state.debugSummary = [
      `provider=${state.agentProvider}`,
      `connection=${state.connectionMode}`,
      `runId=${state.runId}`,
      escalated ? "cancelEscalation=true" : null,
      diagnostic ? `cancelDiagnostic=${diagnostic}` : null,
    ].filter(Boolean).join("\n");
    state.finishedAt = Date.now();
    state.updatedAt = Date.now();
    appendContractEvent(state.events, {
      type: isTimeout ? "error" : "status",
      text: isTimeout ? state.error : `${state.agentProvider} run cancelled${diagnostic ? ` (${diagnostic})` : ""}`,
    });
    await flushPersistRun(state, true);
  }

  async function cancel(id, options = {}) {
    const state = runs.get(String(id ?? ""));
    if (!state) return legacy.cancel(id);
    if (state.status !== "running") {
      if (state.cancelRequested) void cleanupLateProcess(state);
      return { ok: false, error: "run not running" };
    }
    if (state.cancelPromise) return state.cancelPromise;
    const reason = String(options.reason ?? "user").trim() || "user";
    state.cancelRequested = reason;
    const operation = state.operationId ? taskOperationRegistry.get(state.operationId) : null;
    if (operation && operation.status === "pending") markOperationCancelled(operation, reason);
    const cancellation = (async () => {
      if (state.timeoutTimer) {
        clearTimeout(state.timeoutTimer);
        state.timeoutTimer = null;
      }
      clearCancellationApprovals(state);
      state.updatedAt = Date.now();

      let adapterResult;
      if (typeof state.cancelHandler === "function") {
        adapterResult = await boundedOperation(() => state.cancelHandler(), options.cancelHandlerTimeoutMs ?? options.cancelTimeoutMs ?? cancelHandlerTimeoutMs);
      } else {
        try {
          const ctx = await runtimeContext();
          const adapterFactory = adapterFactoryForProvider(state.agentProvider, state.agent ?? null);
          if (!adapterFactory) {
            adapterResult = await boundedOperation(
              () => legacy.cancel(id),
              options.cancelHandlerTimeoutMs ?? options.cancelTimeoutMs ?? cancelHandlerTimeoutMs,
            );
          } else {
            const adapter = adapterFactory({ ...ctx, appendEvent: (event) => appendContractEvent(state.events, event) });
            adapterResult = typeof adapter?.cancel === "function"
              ? await boundedOperation(
                () => adapter.cancel({ runId: state.runId, workspaceRoot: state.workspaceRoot, agent: { id: state.agentId, provider: state.agentProvider } }),
                options.cancelHandlerTimeoutMs ?? options.cancelTimeoutMs ?? cancelHandlerTimeoutMs,
              )
              : { kind: "success", result: null };
          }
        } catch (error) {
          adapterResult = { kind: "error", error };
        }
      }
      const registryRecord = getAgentProcess(state.runId);
      const processRecord = cancellationProcessRecord(state);
      const registryIdentityConflict = Boolean(registryRecord && !processRecord);
      const adapterSucceeded = adapterResult?.kind === "success";
      let termination = { confirmed: !processRecord && !registryIdentityConflict && adapterSucceeded, attempted: false };
      let escalated = false;
      if (!processRecord && state.processTerminationPromise) {
        termination = await state.processTerminationPromise;
        escalated = termination.attempted === true;
      } else if (processRecord) {
        const alive = processAlive(processRecord);
        if (alive === false) {
          termination = { confirmed: true, attempted: false };
        } else {
          escalated = true;
          termination = await terminateStateProcess(state, processRecord);
        }
      }
      if (!termination.confirmed) {
        const adapterDiagnostic = adapterResult?.kind === "timeout"
          ? "adapter cancel timed out"
          : adapterResult?.kind === "error"
            ? `adapter cancel failed: ${String(adapterResult.error?.message ?? adapterResult.error ?? "unknown error")}`
            : "process termination could not be confirmed";
        const terminationDiagnostic = termination.error ? `; ${termination.error}` : "";
        state.cancelEscalationUnresolved = Boolean(processRecord || registryIdentityConflict);
        state.status = "failed";
        state.error = `取消未能确认 Agent 已停止（${adapterDiagnostic}${terminationDiagnostic}）。`;
        state.errorInfo = { code: "cancel_escalation_failed", message: state.error, debug: `cancel escalation failed; runId=${state.runId}` };
        state.debugSummary = `provider=${state.agentProvider}\nrunId=${state.runId}\ncancelEscalation=true\ncancelEscalationConfirmed=false`;
        state.finishedAt = Date.now();
        state.updatedAt = Date.now();
        appendContractEvent(state.events, { type: "error", text: state.error });
        await flushPersistRun(state, true);
        return { ok: false, error: state.error };
      }
      if (processRecord) {
        unregisterAgentProcess(state.runId);
        state.cancelEscalationUnresolved = false;
      }
      const diagnostic = escalated
        ? `cancel escalation confirmed (${processRecord?.source ?? "adapter"}, pid ${processRecord?.pid ?? "unknown"})`
        : "";
      await finalizeCancellation(state, reason, { escalated, diagnostic });
      return { ok: true };
    })();
    state.cancelPromise = cancellation;
    try {
      return await cancellation;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (getAgentProcess(state.runId)) state.cancelEscalationUnresolved = true;
      if (state.status === "running") {
        state.status = "failed";
        state.error = `取消流程失败：${message}`;
        state.errorInfo = { code: "cancel_escalation_failed", message: state.error, debug: `cancel escalation exception; runId=${state.runId}` };
        state.finishedAt = Date.now();
        state.updatedAt = Date.now();
        appendContractEvent(state.events, { type: "error", text: state.error });
      }
      await flushPersistRun(state, true).catch(() => undefined);
      return { ok: false, error: message };
    } finally {
      if (state.cancelPromise === cancellation) state.cancelPromise = null;
    }
  }

  const {
    warmupConversation,
    listAgentProviderSessions,
    loadAgentProviderSession,
    closeAgentProviderSession,
    forkAgentProviderSession,
    setAgentConfigOption,
  } = createSessionOperations({
    legacy,
    injectedAdapters,
    adapterFactoryForProvider,
    runs,
    cancel,
    providerEnvironment,
  });

  // Agent catalog (list/CRUD/metadata/ACP config) and ACP connection probes
  // live in their own modules and receive the closure deps they need.
  const catalog = createAgentCatalog({ legacy, bundledExtensionRoots });
  const {
    listAgents,
    createAgent,
    updateAgent,
    deleteAgent,
    listAgentMetadata,
    listAvailableAgentMetadata,
    acpHealth,
    acpConfigOptions,
    listProcesses,
    listExtensions,
    setExtensionEnabled: setExtensionEnabledMethod,
  } = catalog;
  const {
    testConnection,
    testCustomAgent,
    checkProviderHealth,
    checkManagedAgentHealthById,
  } = createConnectionProbes({ legacy, injectedAdapters, listAgents, providerEnvironment });
  const getHostStatus = createHostStatusService({ legacy, getConversationStatus });

  async function listAcpAgents(input = {}) {
    return listAvailableAgentMetadata(input);
  }
  async function refreshAcpAgents(input = {}) {
    return listAvailableAgentMetadata({ ...input, refresh: true });
  }
  async function acpSendMessage(input = {}) {
    return start(input);
  }
  async function acpCancel(input = {}) {
    return cancel(input.runId ?? input.id ?? input);
  }
  async function acpResolveApproval(input = {}) {
    return resolveApproval(input);
  }

  async function getTaskCapability(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const factory = adapterFactoryForProvider(agent.provider, agent);
    if (!factory) {
      return {
        provider: agent.provider ?? null,
        agentId: agent.id ?? null,
        supportsTaskIntentHook: false,
        supportsScopedFullAllow: false,
        diagnostic: "task-full-allow-unsupported: provider adapter is unavailable",
      };
    }
    try {
      const adapter = factory({
        appendEvent: () => undefined,
        registerCancel: () => undefined,
        requestApproval: () => ({ decision: "decline" }),
        agent,
      });
      const capabilities = adapter?.taskCapabilities ?? adapter?.capabilities?.task ?? null;
      const supportsTaskIntentHook = capabilities?.supportsTaskIntentHook === true;
      return {
        provider: agent.provider ?? null,
        agentId: agent.id ?? null,
        supportsTaskIntentHook,
        supportsScopedFullAllow: supportsTaskIntentHook && capabilities?.supportsScopedFullAllow !== false,
        intentHook: supportsTaskIntentHook ? String(capabilities.intentHook ?? "adapter").slice(0, 120) : null,
        diagnostic: supportsTaskIntentHook ? null : "task-full-allow-unsupported: blocking pre-execute intent hook is not proven",
      };
    } catch {
      return {
        provider: agent.provider ?? null,
        agentId: agent.id ?? null,
        supportsTaskIntentHook: false,
        supportsScopedFullAllow: false,
        diagnostic: "task-full-allow-unsupported: adapter capability probe failed",
      };
    }
  }

  async function getTaskAgentMetadata(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const requested = input.agent && typeof input.agent === "object"
      ? input.agent
      : { id: input.agentId, provider: input.provider };
    const agent = await legacy.normalizeAgent(requested ?? {});
    const detected = await legacy.detectAgent(agent, workspaceRoot, { includeModels: input.includeModels !== false });
    return { agent: personalAgentMetadataFromAgent(detected) };
  }
  async function closeRuntime() {
    await startupReconcile.close();
  }
  return {
    listAgents,
    listAgentMetadata,
    listExtensions,
    setExtensionEnabled: setExtensionEnabledMethod,
    listAcpAgents,
    refreshAcpAgents,
    acpHealth,
    acpSendMessage,
    acpCancel,
    acpResolveApproval,
    getTaskAgentMetadata,
    getTaskCapability,
    acpConfigOptions,
    setConfigOption: setAgentConfigOption,
    createCustomAgent: createAgent,
    updateCustomAgent: updateAgent,
    detectAvailableLocalAgents,
    deleteCustomAgent: deleteAgent,
    getAgentOverrides: async (input = {}) => getAgentOverrides(String(input.workspaceRoot ?? "").trim(), String(input.id ?? input.agentId ?? "").trim()),
    setAgentOverrides: async (input = {}) => setAgentOverrides(String(input.workspaceRoot ?? "").trim(), String(input.id ?? input.agentId ?? "").trim(), input.overrides ?? {}),
    listProcesses,
    testConnection,
    testCustomAgent,
    checkProviderHealth,
    checkManagedAgentHealthById,
    validateAgent: legacy.detectAgent,
    startMessage: start,
    blockStarts: startGate.block,
    ready: startupReconcile.ready,
    close: closeRuntime,
    cancelTaskOperation,
    getTaskOperation: taskOperationLookup,
    lookupTaskOperation: taskOperationLookup,
    getRun: status,
    runMessage: run,
    cancelRun: cancel,
    resolveApproval,
    resetConversation,
    listConversations: listAgentConversations,
    createConversation: createAgentConversation,
    getConversation: getAgentConversation,
    getConversationById: getAgentConversationById,
    listChannelConversations: listAgentChannelConversations,
    listConversationsByProvider: listAgentConversationsByProvider,
    importConversationFromArchive: importAgentConversationFromArchive,
    warmupConversation,
    listProviderSessions: listAgentProviderSessions,
    loadProviderSession: loadAgentProviderSession,
    closeProviderSession: closeAgentProviderSession,
    forkProviderSession: forkAgentProviderSession,
    getConversationStatus,
    listConversationConfirmations,
    confirmConversationConfirmation,
    getHostStatus,
    classifyErrorForTest: classifyErrorInfo,
    buildErrorTipForTest: buildErrorTip,
    // Read-only host connection used by the channel AssistantBridge. The
    // bridge consumes only the canonical primary-runtime HTTP surface.
    getPrimaryRuntimeConnection: runtimeContext,
  };
}
