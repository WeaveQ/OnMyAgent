import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCodexAdapter } from "./adapters/codex.mjs";
import { createClaudeAdapter } from "./adapters/claude.mjs";
import { createHermesAdapter } from "./adapters/hermes.mjs";
import { createOpenClawAdapter } from "./adapters/openclaw.mjs";
import { createOpenCodeAdapter } from "./adapters/opencode.mjs";
import { createGenericAcpAdapter } from "./adapters/acp-generic.mjs";
import { createRemoteAcpAdapter } from "./adapters/remote-acp.mjs";
import {
  detectAvailableLocalAgents,
} from "./detect-local-agents.mjs";
import { appendContractEvent, normalizeAdapterResult, runEventsToConversationMessages } from "./contract.mjs";
import {
  createConversation,
  getConversation,
  getOrCreateConversation,
  listConversations,
  readConversationEvents,
  resetConversationPointer,
  updateConversation,
  writeConversationEvents,
} from "./conversation-store.mjs";
import { clearSession } from "./session-store.mjs";
import { createConversationRuntimeApi } from "./conversation-runtime-api.mjs";
import { runId, isProcessTreeAlive, terminateProcessTreeByPid } from "./utils.mjs";
import { configurePersonalAgentRuntimeState, personalAgentRuntimeStateRoot } from "./runtime-state.mjs";
import { reconcileChannelActiveRuns } from "./reconcile-channel-active-runs.mjs";
import { ensureManagedAcpTool } from "./managed-acp-tools.mjs";
import { ensureRunLogPath, legacyPersonalAssistantRunLogRoot, legacyRunLogRoot, runLogRoot } from "./workdir.mjs";
import { isStaleNativeSessionError, staleNativeSessionResetMessage } from "./native-sessions.mjs";
import { cleanupRegisteredAgentProcesses, getAgentProcess, recoverAgentProcesses, registerAgentProcess, unregisterAgentProcess } from "./process-registry.mjs";
import { createCustomAgent, deleteCustomAgent, getAgentOverrides, setAgentOverrides, updateCustomAgent } from "./custom-agent-store.mjs";
import { setExtensionEnabled } from "./extension-registry.mjs";
import { buildErrorTip, buildProviderContextResetEvents, classifyErrorInfo } from "./error-diagnostics.mjs";
import { getStoredApprovalDecision, rememberApprovalDecision } from "./approval-store.mjs";
import { createRunPersistence } from "./run-persistence.mjs";
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
  buildApprovalRecord,
  buildFinalizedOrphanMeta,
  buildRestoredRunSnapshot,
  buildRunMeta,
  buildRunSnapshot,
  buildStartupStalledDebugSummary,
  buildStartupStalledErrorInfo,
  classifyRestoredRunMeta,
  defaultConnectionMode,
  isStartupStalled,
  normalizeApprovalMode,
  parseRunLogContent,
  parseStatusInput,
  resolveAdapterFactoryForProvider,
  rewriteOrphanRunLogContent,
} from "./run-helpers.mjs";
import { createAgentCatalog } from "./agent-catalog.mjs";
import { createConnectionProbes } from "./connection-probes.mjs";
import { createHostStatusService } from "./host-status-service.mjs";
import { createSessionOperations } from "./session-operations.mjs";
const runSnapshotDeps = {
  visibleArtifacts,
  runEventsToConversationMessages,
};

export function createPersonalAgentRuntime(options) {
  configurePersonalAgentRuntimeState(options ?? {});
  // Capture the reconcile cutoff at runtime start so orphaned "running" logs
  // from the current session are never treated as stale-and-finalized.
  const reconcileCutoffMs = Date.now();
  const runs = new Map();
  const legacy = options.legacy;
  const injectedAdapters = options.adapters ?? {};
  const bundledExtensionRoots = Array.isArray(options.bundledExtensionRoots) ? options.bundledExtensionRoots.filter(Boolean) : [];
  const conversationApi = createConversationRuntimeApi({ legacy, runs });
  const {
    resetConversation,
    listAgentConversations,
    createAgentConversation,
    getAgentConversation,
    getAgentConversationById,
    listAgentChannelConversations,
    listAgentConversationsByProvider,
    importAgentConversationFromArchive,
  } = conversationApi;
  // Startup reconcile can defer off cold path (deferStartupReconcileMs).
  // recover marks stale; cleanup SIGTERM/KILL hung trees; orphan logs finalize;
  // channel active-run locks reclaim mid-run restarts ("还在处理上一条消息").
  const runStartupReconcile = () => {
    void recoverAgentProcesses().catch(() => undefined);
    void cleanupRegisteredAgentProcesses().catch(() => undefined);
    void reconcileOrphanRuns().catch(() => undefined);
    void reconcileChannelActiveRuns({
      userDataDir: String(options.userDataDir ?? "").trim(),
      getRun: status,
      reconcileCutoffMs,
    }).catch(() => undefined);
  };
  const deferMs = Math.max(0, Number(options.deferStartupReconcileMs ?? 0) || 0);
  if (deferMs > 0) setTimeout(runStartupReconcile, deferMs);
  else runStartupReconcile();
  const adapterFactories = {
    opencode: createOpenCodeAdapter,
    codex: createCodexAdapter,
    hermes: createHermesAdapter,
    claude: createClaudeAdapter,
    openclaw: createOpenClawAdapter,
    remote: createRemoteAcpAdapter,
    ...injectedAdapters,
  };
  function adapterFactoryForProvider(provider, agent = null) {
    return resolveAdapterFactoryForProvider(
      provider,
      agent,
      injectedAdapters,
      adapterFactories,
      createGenericAcpAdapter,
      createRemoteAcpAdapter,
    );
  }

  async function persistRun(state) {
    const meta = buildRunMeta(state, { visibleArtifacts });
    const lines = [meta, ...state.events].map((entry) => JSON.stringify(entry)).join("\n");
    if (!state.logPath) return;
    await mkdir(path.dirname(state.logPath), { recursive: true });
    await writeFile(state.logPath, `${lines}${lines ? "\n" : ""}`, "utf8").catch(() => undefined);
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

  // A log whose run_meta is still "running" but has no active runtime record
  // (in-memory runs Map) is an orphan produced by a previous process session
  // that died/restarted mid-run. Persist it as "failed" so the UI stops
  // reporting the misleading "本地 Agent 运行状态已丢失 / timeout" error and
  // future restores read a clean, finalized log.
  async function finalizeStaleRunLog(logPath, meta) {
    try {
      const content = await readFile(logPath, "utf8");
      const finalizedMeta = buildFinalizedOrphanMeta(meta);
      const rewritten = rewriteOrphanRunLogContent(content, finalizedMeta);
      if (!rewritten) return;
      await writeFile(logPath, rewritten.content, "utf8");
    } catch {
      // Best effort: never block run restore on a log write failure.
    }
  }

  // On startup, reconcile every persisted run log across all workspaces and
  // finalize any orphaned "running" runs (process is already gone) the previous
  // process session left behind.
  async function reconcileOrphanRuns() {
    const reconcileCutoff = reconcileCutoffMs;
    const root = personalAgentRuntimeStateRoot();
    const workspacesRoot = path.join(root, "personal-assistant", "workspaces");
    const workspaces = await readdir(workspacesRoot).catch(() => []);
    for (const workspace of workspaces) {
      const runsDir = path.join(workspacesRoot, workspace, "runs");
      const files = await readdir(runsDir).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(runsDir, file);
        let meta = null;
        try {
          const firstLine = (await readFile(filePath, "utf8")).split(/\r?\n/).find((line) => line.trim());
          if (firstLine) meta = JSON.parse(firstLine);
        } catch {
          continue;
        }
        if (!meta || meta.type !== "run_meta" || meta.status !== "running") continue;
        // Skip live runs owned by the in-memory Map (may still have pid=null while adapter spawns).
        const startedAt = Number(meta.startedAt ?? meta.at ?? 0);
        if (startedAt && startedAt >= reconcileCutoff) continue;
        if (runs.has(meta.runId)) continue;
        // Do NOT skip a running run merely because its pid is still alive — a
        // process can be hung (e.g. blocked on the network) yet never finish,
        // which is the phantom-lock bug. If we can identify the tree via the
        // registry, reap it (SIGTERM -> SIGKILL); otherwise best-effort reap by
        // pid. Either way finalize the log so the channel lock is released.
        const registered = getAgentProcess(meta.runId);
        if (registered && isProcessTreeAlive(registered)) {
          await terminateProcessTreeByPid({ pid: registered.pid, pgid: registered.pgid });
          unregisterAgentProcess(meta.runId);
        } else if (isProcessAlive(meta.pid)) {
          await terminateProcessTreeByPid({ pid: meta.pid });
        }
        await finalizeStaleRunLog(filePath, meta);
      }
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

  async function requestRunApproval(state, request = {}) {
    const approval = buildApprovalRecord(state, request);
    const stored = await getStoredApprovalDecision(state.workspaceRoot, { provider: state.agentProvider, agentId: state.agentId, approval });
    if (stored) {
      appendContractEvent(state.events, {
        type: "approval_decision",
        text: `${approval.kind}: acceptForSession (stored)` ,
        approval,
        storedApprovalKey: stored.key,
      });
      state.updatedAt = Date.now();
      state.lastApprovalPersist = flushPersistRun(state, true);
      void state.lastApprovalPersist;
      return { decision: "acceptForSession", approval, stored: true };
    }
    state.pendingApprovals = [...(state.pendingApprovals ?? []).filter((item) => item.id !== approval.id), approval];
    appendContractEvent(state.events, {
      type: "approval_request",
      text: approval.summary,
      approval,
    });
    state.updatedAt = Date.now();
    // Register the resolver synchronously so a decision arriving during the
    // durable write is never dropped. The persist is fire-and-forget for the
    // in-memory pending state (already observable), but the recoverable
    // confirmation write (ASP-3) is awaited via `state.persistedApproval` so
    // callers that need the durable record can synchronize on it.
    const decision = new Promise((resolve) => {
      state.approvalResolvers.set(approval.id, resolve);
    });
    state.lastApprovalPersist = flushPersistRun(state, true);
    void state.lastApprovalPersist;
    return decision;
  }

  async function resolveApproval(input = {}) {
    const runIdValue = String(input.runId ?? "").trim();
    const approvalId = String(input.approvalId ?? input.id ?? "").trim();
    const decision = String(input.decision ?? "").trim();
    const allowed = new Set(["accept", "acceptForSession", "decline", "cancel"]);
    if (!runIdValue || !approvalId) return { ok: false, error: "runId and approvalId are required" };
    if (!allowed.has(decision)) return { ok: false, error: "invalid approval decision" };
    const state = runs.get(runIdValue);
    if (!state || state.status !== "running") return { ok: false, error: "run is not active" };
    const approval = (state.pendingApprovals ?? []).find((item) => item.id === approvalId);
    if (!approval) return { ok: false, error: "approval request not found" };
    state.pendingApprovals = (state.pendingApprovals ?? []).filter((item) => item.id !== approvalId);
    if (input.alwaysAllow === true) {
      await rememberApprovalDecision(state.workspaceRoot, { provider: state.agentProvider, agentId: state.agentId, approval, decision: "acceptForSession" });
    }
    appendContractEvent(state.events, {
      type: "approval_decision",
      text: `${approval.kind}: ${decision}`,
      approval,
    });
    state.updatedAt = Date.now();
    await flushPersistRun(state, true);
    const resolver = state.approvalResolvers?.get(approvalId);
    state.approvalResolvers?.delete(approvalId);
    resolver?.({ decision, approval });
    return { ok: true };
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
      opencodeBaseUrl: engine?.baseUrl ?? onmyagentServer?.baseUrl ?? null,
      onmyagentServerToken: onmyagentServer?.clientToken ?? onmyagentServer?.ownerToken ?? null,
      opencodeAuthorization,
      workspacePath: engine?.projectDir ?? null,
    };
  }

  async function start(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const adapterFactory = adapterFactoryForProvider(agent.provider, agent);
    if (!adapterFactory) {
      return legacy.start(input);
    }
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const prompt = String(input.prompt ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!prompt) throw new Error("prompt is required");
    const accessibleWorkspaceRoots = normalizeAccessibleWorkspaceRoots(input.accessibleWorkspaceRoots, workspaceRoot);
    const detected = await legacy.detectAgent(agent, workspaceRoot);
    const id = runId();
    const startedAt = Date.now();
    const events = [];
    const provider = detected.provider ?? agent.provider;
    const agentId = detected.id ?? agent.id ?? provider;
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
      resumeKey: null,
      conversationWorkdir: null,
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      pid: null,
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
      pendingApprovals: [],
      approvalResolvers: new Map(),
      timeoutMs: normalizeRunTimeoutMs(input.timeoutMs),
      timeoutTimer: null,
      timedOut: false,
      cancelRequested: null,
      artifacts: [],
      fileChanges: [],
    };
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
    const conversation = await getOrCreateConversation(workspaceRoot, provider, agentId, input.conversationId);
    state.conversationId = conversation.id;
    state.providerSessionId = conversation.providerSessionId;
    state.resumeKey = conversation.resumeKey;
    // When the conversation has no committed workdir (a brand-new conversation
    // whose project was picked via the workspace chip after creation), fall
    // back to the workdir passed on the send so the run executes in the mounted
    // project instead of the default workspace root.
    const requestedWorkdir = input.workdir ? String(input.workdir).trim() || null : null;
    state.conversationWorkdir = conversation.workdir || requestedWorkdir || null;
    state.conversationWorkdir = conversation.workdir;
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
              state.pid = Number(pidMatch[1]);
              registerAgentProcess({
                runId: state.runId,
                pid: state.pid,
                pgid: state.pid,
                provider: state.agentProvider,
                backend: state.agentProvider,
                conversationId: state.conversationId,
                agentType: "acp",
                command: state.command,
                startedAt: state.startedAt,
              });
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
          },
          requestApproval: (request) => requestRunApproval(state, request),
          approvalMode: state.approvalMode,
        });
        let sendContext = {
          runId: id,
          workspaceRoot,
          accessibleWorkspaceRoots,
          conversationId: conversation.id,
          providerSessionId: conversation.providerSessionId,
          resumeKey: conversation.resumeKey,
          conversationWorkdir: state.conversationWorkdir,
          agent: detected,
          // Prefer the caller-supplied model (IM per-chat #model, or the Studio
          // model dropdown) so channel turns actually use the requested model
          // rather than falling back to the agent default.
          model: (typeof input.model === "string" && input.model.trim()) ? input.model.trim() : detected.model,
          prompt,
          rawPrompt: prompt,
          approvalMode: state.approvalMode,
          requestApproval: (request) => requestRunApproval(state, request),
        };
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
          if (error?.code === "acp_bridge_interrupted" && detected.provider === "codex") {
            for (const event of buildProviderContextResetEvents(detected.provider, "Codex ACP bridge interrupted; retrying once with a clean session.")) appendContractEvent(events, event);
            await resetConversationPointer(workspaceRoot, detected.provider, detected.id, conversation.id);
            await clearSession(workspaceRoot, detected.provider, detected.id).catch(() => undefined);
            sendContext = {
              ...sendContext,
              providerSessionId: null,
              resumeKey: null,
              conversationWorkdir: null,
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
              conversationWorkdir: null,
            };
            sendPromise = adapter.sendMessage(sendContext);
            result = normalizeAdapterResult(await sendPromise);
          } else {
            throw error;
          }
        }
        if (state.status !== "running" || state.cancelRequested) return;
        state.outputParts.push(result.output);
        for (const relPath of extractAssistantArtifactPaths(result.output)) {
          recordArtifact(state, { path: relPath }, "assistant");
        }
        state.command = result.command;
        state.providerSessionId = result.providerSessionId;
        state.resumeKey = result.resumeKey;
        state.metadata = result.metadata ?? null;
        state.workdir = result.workdir ?? null;
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
          state.pid = result.pid;
          registerAgentProcess({
            runId: state.runId,
            pid: result.pid,
            pgid: result.pid,
            provider: state.agentProvider,
            backend: state.agentProvider,
            conversationId: conversation.id,
            agentType: result.metadata?.agent_type ?? "acp",
            command: result.command,
            startedAt: state.startedAt,
          });
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
        unregisterAgentProcess(state.runId);
        state.cancelHandler = null;
        state.finishedAt ??= Date.now();
        if (state.timeoutTimer) {
          clearTimeout(state.timeoutTimer);
          state.timeoutTimer = null;
        }
        await flushPersistRun(state, true);
        retainCompletedRunBriefly(state);
      }
    })();

    await Promise.race([bootReady, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    void task.catch(() => undefined);

    return snapshot(state);
  }

  async function run(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    if (!adapterFactoryForProvider(agent.provider, agent)) return legacy.run(input);
    const started = await start(input);
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

  async function cancel(id, options = {}) {
    const state = runs.get(String(id ?? ""));
    if (!state) return legacy.cancel(id);
    if (state.status !== "running") return { ok: false, error: "run not running" };
    const reason = String(options.reason ?? "user").trim() || "user";
    state.cancelRequested = reason;
    try {
      if (state.timeoutTimer) {
        clearTimeout(state.timeoutTimer);
        state.timeoutTimer = null;
      }
      if (typeof state.cancelHandler === "function") {
        await state.cancelHandler();
      } else {
        const ctx = await runtimeContext();
        const adapterFactory = adapterFactoryForProvider(state.agentProvider, state.agent ?? null);
        if (!adapterFactory) return legacy.cancel(id);
        const adapter = adapterFactory({ ...ctx, appendEvent: (event) => appendContractEvent(state.events, event) });
        await adapter.cancel({ runId: state.runId, workspaceRoot: state.workspaceRoot, agent: { id: state.agentId, provider: state.agentProvider } });
      }
      const isTimeout = reason === "timeout" || state.timedOut;
      state.status = isTimeout ? "failed" : "cancelled";
      state.error = isTimeout
        ? `本地 Agent 执行超时（已运行 ${Math.round((Date.now() - state.startedAt) / 1000)}s，超过 ${Math.round(state.timeoutMs / 1000)}s 上限），已自动停止。`
        : "用户取消";
      state.errorInfo = isTimeout
        ? { code: "timeout", message: state.error, debug: `wall-clock timeout after ${state.timeoutMs}ms` }
        : { code: "cancelled", message: "用户取消", debug: null };
      for (const [approvalId, resolver] of state.approvalResolvers ?? []) {
        resolver({ decision: "cancel", approval: (state.pendingApprovals ?? []).find((item) => item.id === approvalId) ?? null });
      }
      state.approvalResolvers?.clear?.();
      state.pendingApprovals = [];
      state.finishedAt = Date.now();
      state.updatedAt = Date.now();
      appendContractEvent(state.events, { type: isTimeout ? "error" : "status", text: isTimeout ? state.error : `${state.agentProvider} run cancelled` });
      await flushPersistRun(state, true);
      return { ok: true };
    } catch (error) {
      state.cancelRequested = null;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
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
  });

  async function getConversationStatus(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const conversation = await getConversation(workspaceRoot, agent.provider, agent.id, input.conversationId);
    const activeRun = [...runs.values()].find((state) => (
      state.workspaceRoot === workspaceRoot
      && state.agentProvider === agent.provider
      && state.agentId === agent.id
      && (!conversation?.id || state.conversationId === conversation.id)
      && state.status === "running"
    ));
    // Ensure any in-flight approval persist has flushed before reading the
    // durable conversation events, so recovered confirmations (ASP-3) are
    // consistent with the in-memory pending approvals.
    if (activeRun?.lastApprovalPersist) {
      await activeRun.lastApprovalPersist.catch(() => undefined);
    }
    const persisted = conversation?.id
      ? await readConversationEvents(workspaceRoot, agent.provider, agent.id, conversation.id)
      : { events: [], messages: [] };
    return {
      conversation,
      activeRun: activeRun ? snapshot(activeRun) : null,
      running: Boolean(activeRun),
      status: activeRun?.status ?? conversation?.lastStatus ?? "idle",
      events: activeRun ? activeRun.events : persisted.events,
      // Always re-derive from events so contract.mjs updates (e.g. approval_decision merging) apply to historical conversations without a rewrite.
      conversationMessages: activeRun
        ? runEventsToConversationMessages(activeRun.events)
        : (Array.isArray(persisted.events) && persisted.events.length ? runEventsToConversationMessages(persisted.events) : persisted.messages),
    };
  }

  async function listConversationConfirmations(input = {}) {
    const statusResult = await getConversationStatus(input);
    const confirmations = statusResult.activeRun?.pendingApprovals ?? statusResult.conversationMessages
      .filter((message) => message.type === "permission" && message.approval)
      .map((message) => message.approval);
    return {
      conversation: statusResult.conversation,
      confirmations,
    };
  }

  async function confirmConversationConfirmation(input = {}) {
    const runIdValue = String(input.runId ?? "").trim();
    if (runIdValue) return resolveApproval(input);
    const statusResult = await getConversationStatus(input);
    const approvalId = String(input.approvalId ?? input.id ?? "").trim();
    const approval = (statusResult.activeRun?.pendingApprovals ?? []).find((item) => item.id === approvalId);
    if (!statusResult.activeRun?.runId || !approval) return { ok: false, error: "approval request not found" };
    return resolveApproval({ ...input, runId: statusResult.activeRun.runId, approvalId });
  }

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
  } = createConnectionProbes({ legacy, injectedAdapters, listAgents });
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
    // Read-only accessor used by the channel AssistantBridge (P2): returns the
    // same OpenCode connection the runtime uses internally, so the bridge can
    // create/prompt the OpenCode session the desktop "助理" tab reads. No core
    // runtime behavior changes for any other agent.
    getOpencodeConnection: runtimeContext,
  };
}
