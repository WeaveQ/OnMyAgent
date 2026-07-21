import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createCodexAdapter } from "./adapters/codex.mjs";
import { createClaudeAdapter } from "./adapters/claude.mjs";
import { createHermesAdapter } from "./adapters/hermes.mjs";
import { createOpenClawAdapter } from "./adapters/openclaw.mjs";
import { createOpenCodeAdapter } from "./adapters/opencode.mjs";
import { createGenericAcpAdapter } from "./adapters/acp-generic.mjs";
import { createRemoteAcpAdapter } from "./adapters/remote-acp.mjs";
import { personalAgentAvailableMetadataList, personalAgentMetadataList, personalAgentMetadataFromAgent } from "./agent-metadata.mjs";
import {
  detectAvailableLocalAgents,
  discoverableAgentDrafts,
  mergeCatalogNativeSkillDirs,
} from "./detect-local-agents.mjs";
import { appendContractEvent, normalizeAdapterResult, runEventsToConversationMessages } from "./contract.mjs";
import {
  createConversation,
  getConversation,
  getConversationById,
  getOrCreateConversation,
  importConversationFromArchive,
  listChannelConversations,
  listConversations,
  listConversationsByProvider,
  readConversationEvents,
  resetConversationPointer,
  updateConversation,
  writeConversationEvents,
} from "./conversation-store.mjs";
import { clearSession, readSession, writeSession } from "./session-store.mjs";
import { runId, isProcessTreeAlive, terminateProcessTreeByPid } from "./utils.mjs";
import { configurePersonalAgentRuntimeState, personalAgentRuntimeStateRoot } from "./runtime-state.mjs";
import { readAgentHandshakeCache, writeAgentHandshakeCache } from "./agent-handshake-cache.mjs";
import { reconcileChannelActiveRuns } from "./reconcile-channel-active-runs.mjs";
import { ensureManagedAcpTool, resolveManagedAcpTool } from "./managed-acp-tools.mjs";
import { probeAcpCommand } from "./acp-probe.mjs";
import { ensureRunLogPath, legacyPersonalAssistantRunLogRoot, legacyRunLogRoot, runLogRoot } from "./workdir.mjs";
import { isStaleNativeSessionError, staleNativeSessionResetMessage } from "./native-sessions.mjs";
import { cleanupRegisteredAgentProcesses, getAgentProcess, listAgentProcesses, recoverAgentProcesses, registerAgentProcess, unregisterAgentProcess, updateAgentProcess } from "./process-registry.mjs";
import { createCustomAgent, deleteCustomAgent, getAgentOverrides, listCustomAgents, setAgentOverrides, updateCustomAgent } from "./custom-agent-store.mjs";
import { personalAgentCapability, personalLocalAgentConnectionMode } from "./provider-registry.mjs";
import { adapterToCustomAgent, loadExtensions, setExtensionEnabled } from "./extension-registry.mjs";
import { buildErrorTip, classifyErrorInfo } from "./error-diagnostics.mjs";
import { getStoredApprovalDecision, listRememberedApprovalDecisions, rememberApprovalDecision } from "./approval-store.mjs";
import { buildMcpStatus, buildPermissionStatus, buildSkillStatus } from "./host-status.mjs";
import { readNativeMcpConfig, resolveNativeSkillRoots } from "./host-status-sources.mjs";

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

export function createPersonalAgentRuntime(options) {
  configurePersonalAgentRuntimeState(options ?? {});
  // Capture the reconcile cutoff at runtime start so orphaned "running" logs
  // from the current session are never treated as stale-and-finalized.
  const reconcileCutoffMs = Date.now();
  const runs = new Map();
  const legacy = options.legacy;
  const injectedAdapters = options.adapters ?? {};
  const bundledExtensionRoots = Array.isArray(options.bundledExtensionRoots) ? options.bundledExtensionRoots.filter(Boolean) : [];
  void recoverAgentProcesses().catch(() => undefined);
  // Reap any process trees left behind by the previous runtime session before
  // finalizing their orphaned run logs. `recoverAgentProcesses` only marks them
  // stale; this actually SIGTERM -> SIGKILLs the (possibly still-alive, hung)
  // trees so `reconcileOrphanRuns` can reclaim the logs.
  void cleanupRegisteredAgentProcesses().catch(() => undefined);
  void reconcileOrphanRuns().catch(() => undefined);
  // Channel active-run locks (<userDataDir>/<platform>/accounts/*.active-runs.json)
  // are normally reclaimed by each channel's poll loop, but that loop only runs
  // while the channel service is active. If the app restarts mid-run the lock
  // can be left behind forever, locking the conversation ("还在处理上一条消息").
  // Reconcile them here against the same run snapshots reconcileOrphanRuns uses.
  void reconcileChannelActiveRuns({
    userDataDir: String(options.userDataDir ?? "").trim(),
    getRun: status,
    reconcileCutoffMs,
  }).catch(() => undefined);
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
    if (Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) return adapterFactories[provider];
    if (provider === "remote") return createRemoteAcpAdapter;
    if (provider === "hermes" || provider === "opencode" || provider === "openclaw" || provider === "codex" || provider === "claude") return createGenericAcpAdapter;
    if (provider === "custom" && agent && agent.connectionType === "cli" && agent.supportsAcp !== false) return createGenericAcpAdapter;
    return adapterFactories[provider];
  }

  function defaultConnectionMode(provider, agent = null) {
    if (provider === "opencode") return "OpenCode ACP session";
    if (provider === "codex") return "Codex ACP session";
    if (provider === "hermes") return "Hermes ACP session";
    if (provider === "claude") return "Claude Code ACP session";
    if (provider === "openclaw") return "OpenClaw ACP session";
    if (provider === "remote") return "Remote ACP WebSocket session";
    if (provider === "custom" && agent && agent.connectionType === "cli" && agent.supportsAcp !== false) {
      const name = agent && typeof agent.name === "string" && agent.name.trim() ? agent.name.trim() : null;
      return `${name ?? "Custom"} ACP session`;
    }
    return "本地 Agent harness session";
  }

  async function persistRun(state) {
    const meta = {
      type: "run_meta",
      at: Date.now(),
      runId: state.runId,
      agentId: state.agentId,
      agentProvider: state.agentProvider,
      status: state.status,
      connectionMode: state.connectionMode,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      pid: state.pid,
      command: state.command,
      providerSessionId: state.providerSessionId,
      resumeKey: state.resumeKey,
      metadata: state.metadata,
      workdir: state.workdir,
      conversationId: state.conversationId ?? null,
      debugSummary: state.debugSummary,
      errorInfo: state.errorInfo,
      approvalMode: state.approvalMode,
      pendingApprovals: state.pendingApprovals,
      artifacts: visibleArtifacts(state.artifacts),
      fileChanges: [...(state.fileChanges ?? [])],
    };
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

  function snapshot(state) {
    return {
      ok: state.status === "completed",
      runId: state.runId,
      agentId: state.agentId,
      agentProvider: state.agentProvider,
      connectionMode: state.connectionMode,
      status: state.status,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      pid: state.pid,
      command: state.command,
      output: state.outputParts.join("\n").trim(),
      error: state.error,
      events: [...state.events],
      conversationMessages: runEventsToConversationMessages(state.events),
      logPath: state.logPath,
      conversationId: state.conversationId ?? null,
      providerSessionId: state.providerSessionId,
      resumeKey: state.resumeKey,
      metadata: state.metadata,
      workdir: state.workdir,
      debugSummary: state.debugSummary,
      errorInfo: state.errorInfo,
      approvalMode: state.approvalMode,
      pendingApprovals: [...(state.pendingApprovals ?? [])],
      artifacts: visibleArtifacts(state.artifacts),
      fileChanges: [...(state.fileChanges ?? [])],
    };
  }

  function normalizeApprovalMode(value) {
    const mode = String(value ?? "ask").trim();
    if (mode === "auto" || mode === "ask" || mode === "read-only-auto") return mode;
    return "ask";
  }

  function parseStatusInput(input) {
    if (input && typeof input === "object") {
      return {
        runId: String(input.runId ?? input.id ?? "").trim(),
        workspaceRoot: String(input.workspaceRoot ?? "").trim(),
      };
    }
    return { runId: String(input ?? "").trim(), workspaceRoot: "" };
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
      const lines = content.split(/\r?\n/).filter((line) => line.trim());
      const finalizedMeta = {
        ...meta,
        status: "failed",
        finishedAt: Date.now(),
        debugSummary: "orphaned run: persisted log still 'running' but no active runtime record after process restart (patched by reconcile)",
        errorInfo: {
          code: "orphaned",
          message: "该 run 因主进程重启/崩溃而中断：恢复时已无对应的活跃执行记录，属历史残留（孤儿 run），并未真正执行失败。",
          debug: "run existed only in persisted log; active runtime state was missing after process restart",
        },
      };
      let changed = false;
      const outLines = lines.map((line) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed?.type === "run_meta") {
            changed = true;
            return JSON.stringify(finalizedMeta);
          }
        } catch {
          // Keep non-JSON / corrupt lines as-is.
        }
        return line;
      });
      if (!changed) return;
      outLines.push(JSON.stringify({ type: "error", text: finalizedMeta.errorInfo.message, at: Date.now() }));
      await writeFile(logPath, `${outLines.join("\n")}\n`, "utf8");
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
    let meta = null;
    const events = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed?.type === "run_meta") meta = parsed;
        else events.push(parsed);
      } catch {
        // Ignore corrupt log lines; keep the rest of the run inspectable.
      }
    }
    if (!meta) return null;
    // Finalized orphaned runs (previous process crashed mid-run) must be
    // invisible to the UI: they carry a misleading "failed / orphaned" status
    // that reappears every time the renderer polls a stale runId cached in
    // localStorage. Returning null lets status() fall through to legacy /
    // not-found, and pollRun then clears the stale activeRunId.
    if (meta.status === "failed" && meta.errorInfo?.code === "orphaned") return null;
    const assistantText = events
      .filter((event) => event.type === "assistant")
      .map((event) => String(event.text ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    const staleRunning = meta.status === "running";
    if (staleRunning) {
      if (logPath) void finalizeStaleRunLog(logPath, meta);
      return null;
    }
    const status = meta.status;
    const errorInfo = meta.errorInfo ?? null;
    const error = errorInfo?.message ?? null;
    const restoredEvents = events;
    return {
      ok: status === "completed",
      runId: meta.runId ?? id,
      agentId: meta.agentId ?? "unknown",
      agentProvider: meta.agentProvider ?? "custom",
      connectionMode: meta.connectionMode ?? "本地 Agent harness session",
      status,
      startedAt: meta.startedAt ?? null,
      finishedAt: meta.finishedAt ?? null,
      pid: meta.pid ?? null,
      command: meta.command ?? "",
      output: assistantText,
      error,
      events: restoredEvents,
      conversationMessages: runEventsToConversationMessages(restoredEvents),
      logPath,
      providerSessionId: meta.providerSessionId ?? null,
      resumeKey: meta.resumeKey ?? null,
      metadata: meta.metadata ?? null,
      workdir: meta.workdir ?? null,
      conversationId: meta.conversationId ?? null,
      debugSummary: meta.debugSummary ?? null,
      errorInfo,
      approvalMode: meta.approvalMode ?? "ask",
      pendingApprovals: Array.isArray(meta.pendingApprovals) ? meta.pendingApprovals : [],
      artifacts: visibleArtifacts(meta.artifacts),
      fileChanges: Array.isArray(meta.fileChanges) ? [...meta.fileChanges] : [],
    };
  }

  function sanitizeApprovalParams(params) {
    if (!params || typeof params !== "object") return null;
    try {
      return JSON.parse(JSON.stringify(params));
    } catch {
      return { raw: String(params) };
    }
  }

  async function requestRunApproval(state, request = {}) {
    const approvalId = String(request.id ?? `${state.runId}-approval-${Date.now()}-${Math.random().toString(16).slice(2)}`).trim();
    const approval = {
      id: approvalId,
      runId: state.runId,
      provider: state.agentProvider,
      method: String(request.method ?? "unknown"),
      kind: request.kind ?? "unknown",
      title: String(request.title ?? "需要用户审批"),
      summary: String(request.summary ?? "本地 Agent 请求执行受限操作。"),
      command: request.command ? String(request.command) : null,
      cwd: request.cwd ? String(request.cwd) : state.workspaceRoot,
      readonly: Boolean(request.readonly),
      params: sanitizeApprovalParams(request.params),
      createdAt: Date.now(),
    };
    const stored = await getStoredApprovalDecision(state.workspaceRoot, { provider: state.agentProvider, agentId: state.agentId, approval });
    if (stored) {
      appendContractEvent(state.events, {
        type: "approval_decision",
        text: `${approval.kind}: acceptForSession (stored)` ,
        approval,
        storedApprovalKey: stored.key,
      });
      state.updatedAt = Date.now();
      state.lastApprovalPersist = persistRun(state);
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
    state.lastApprovalPersist = persistRun(state);
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
    await persistRun(state);
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
    void persistRun(state);

    if (detected.status !== "online") {
      state.status = "failed";
      state.errorInfo = classifyErrorInfo(new Error(detected.error || `${detected.name} 不可用`));
      state.error = state.errorInfo.message;
      state.finishedAt = Date.now();
      appendContractEvent(events, { type: "error", text: state.error });
      appendContractEvent(events, buildErrorTip(state.errorInfo));
      await persistRun(state);
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
        await persistRun(state);
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
            void persistRun(state);
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
            appendContractEvent(events, {
              type: "status",
              text: "Codex ACP bridge interrupted; retrying once with a clean session.",
            });
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
            appendContractEvent(events, {
              type: "status",
              text: staleNativeSessionResetMessage(detected.provider),
            });
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
      } finally {
        markBootReady();
        unregisterAgentProcess(state.runId);
        state.cancelHandler = null;
        state.finishedAt ??= Date.now();
        if (state.timeoutTimer) {
          clearTimeout(state.timeoutTimer);
          state.timeoutTimer = null;
        }
        await persistRun(state);
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

  function status(input) {
    const { runId: id, workspaceRoot } = parseStatusInput(input);
    const state = runs.get(id);
    if (state) {
      const meaningfulEvents = state.events.filter((event) => {
        const text = String(event.text ?? "");
        return !(event.type === "status" && /(?:harness|ACP) flow started/.test(text));
      });
      const startupStalled = state.status === "running" && meaningfulEvents.length === 0 && Date.now() - state.startedAt > 30_000;
      if (startupStalled) {
        state.status = "failed";
        state.finishedAt = Date.now();
        state.errorInfo = {
          code: "timeout",
          message: "本地 Agent 启动阶段已中断：没有产生进程 PID 或可追踪输出。",
          debug: "runtime startup stalled before adapter reported pid",
        };
        state.error = state.errorInfo.message;
        state.debugSummary = [
          `provider=${state.agentProvider}`,
          `connection=${state.connectionMode}`,
          `runId=${state.runId}`,
          "startupStalled=true",
        ].join("\n");
        appendContractEvent(state.events, { type: "error", text: state.error });
        appendContractEvent(state.events, buildErrorTip(state.errorInfo));
        state.updatedAt = Date.now();
        void persistRun(state);
      }
      return snapshot(state);
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
      await persistRun(state);
      return { ok: true };
    } catch (error) {
      state.cancelRequested = null;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function resetConversation(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    for (const state of runs.values()) {
      if (
        state.status === "running" &&
        state.workspaceRoot === workspaceRoot &&
        state.agentProvider === agent.provider &&
        state.agentId === agent.id
      ) {
        return { ok: false, error: "agent has an active run" };
      }
    }
    const conversation = await resetConversationPointer(workspaceRoot, agent.provider, agent.id, input.conversationId);
    const cleared = await clearSession(workspaceRoot, agent.provider, agent.id);
    return { ...cleared, conversation };
  }

  async function listAgentConversations(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    return listConversations(workspaceRoot, agent.provider, agent.id);
  }

  async function createAgentConversation(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const conversation = await createConversation(workspaceRoot, agent.provider, agent.id, input);
    return { conversation };
  }

  async function getAgentConversation(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const conversation = await getConversation(workspaceRoot, agent.provider, agent.id, input.conversationId);
    return { conversation };
  }

  // Cross-agent lookup by id (ignores the provider/agentId partition). Lets
  // the UI open any conversation — channel-bound ones live under scoped
  // agents not in the ACP list, and restored sessions may come from anywhere.
  async function getAgentConversationById(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const conversationId = String(input.conversationId ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!conversationId) throw new Error("conversationId is required");
    const conversation = await getConversationById(workspaceRoot, conversationId);
    return { conversation };
  }

  // All source:"channel" conversations across the workspace, for the Studio
  // "Channel sessions" group.
  async function listAgentChannelConversations(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    return listChannelConversations(workspaceRoot);
  }

  // Aggregate the agent's normal sessions and its communication-channel
  // sessions (`source:"channel"`) into a single conversation list, so the
  // local-agent dropdown shows every session for the selected agent.
  async function listAgentConversationsByProvider(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    return listConversationsByProvider(workspaceRoot, agent.provider, agent.id);
  }

  // Import an archived session's messages as a local transcript so the local
  // agent view can render its history (used by "resume from archive").
  async function importAgentConversationFromArchive(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    return importConversationFromArchive(workspaceRoot, agent.provider, agent.id, input);
  }

  async function warmupConversation(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const detected = await legacy.detectAgent(agent, workspaceRoot);
    const provider = detected.provider ?? agent.provider;
    const agentId = detected.id ?? agent.id ?? provider;
    const adapterFactory = adapterFactoryForProvider(provider, detected);
    if (!adapterFactory) return { ok: false, unsupportedReason: "adapter_not_supported" };
    if (detected.status !== "online") return { ok: false, error: detected.error || `${detected.name ?? provider} is not online` };
    if ((provider === "codex" || provider === "claude") && !Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) {
      const tool = await ensureManagedAcpTool(provider);
      detected.executablePath = tool.binPath;
      detected.managedAcpTool = tool;
      detected.connectionMode = defaultConnectionMode(provider, detected);
    }
    const conversation = await getOrCreateConversation(workspaceRoot, provider, agentId, input.conversationId);
    const adapter = adapterFactory({ appendEvent: () => undefined, registerCancel: () => undefined });
    if (typeof adapter.warmupConversation !== "function") return { ok: false, conversation, unsupportedReason: "warmup_not_supported" };
    try {
      const warmed = await adapter.warmupConversation({
        runId: `warmup-${Date.now()}`,
        workspaceRoot,
        accessibleWorkspaceRoots: normalizeAccessibleWorkspaceRoots(input.accessibleWorkspaceRoots, workspaceRoot),
        conversationId: conversation.id,
        providerSessionId: conversation.providerSessionId,
        resumeKey: conversation.resumeKey,
        conversationWorkdir: conversation.workdir,
        agent: detected,
        model: input.model ?? detected.model,
        approvalMode: normalizeApprovalMode(input.approvalMode),
      });
      // Persist warmup-derived ACP session metadata (available_commands,
      // available models, config options) so listAgents can hydrate the
      // handshake before the user sends a message. codex-acp publishes
      // available_commands asynchronously after newSession returns; without
      // this the slash-menu is empty on cold agent switches and only
      // populated after the first message triggers a live event stream.
      const warmSessionMetadata = warmed.sessionMetadata && typeof warmed.sessionMetadata === "object"
        ? warmed.sessionMetadata
        : null;
      if (warmSessionMetadata) {
        try {
          const priorSession = await readSession(workspaceRoot, provider, agentId).catch(() => ({}));
          await writeSession(workspaceRoot, provider, agentId, {
            ...(priorSession && typeof priorSession === "object" ? priorSession : {}),
            sessionId: warmed.sessionId ?? warmed.providerSessionId ?? priorSession?.sessionId ?? "",
            workdir: warmed.workdir ?? priorSession?.workdir ?? conversation.workdir ?? null,
            sessionMetadata: warmSessionMetadata,
            handshakeAt: Date.now(),
          });
          // Custom agents are stored with provider="custom" but warmed up
          // via their detected adapter provider (e.g. CodeBuddy detects as
          // "opencode"). listAgents hydrates with agent.provider ("custom"),
          // so mirror the session metadata under the original provider key
          // too, otherwise the handshake stays cold and the model selector
          // never appears for custom ACP agents.
          const originalProvider = String(input.agent?.provider ?? agent.provider ?? "").trim();
          if (originalProvider && originalProvider !== provider) {
            try {
              const priorOriginal = await readSession(workspaceRoot, originalProvider, agentId).catch(() => ({}));
              await writeSession(workspaceRoot, originalProvider, agentId, {
                ...(priorOriginal && typeof priorOriginal === "object" ? priorOriginal : {}),
                sessionMetadata: warmSessionMetadata,
                handshakeAt: Date.now(),
              });
            } catch {
              // best-effort mirror; the primary write above already succeeded.
            }
          }
          // Also cache the handshake at the agent level (independent of
          // workspace) so channels using a different workspaceRoot (e.g.
          // WeChat) can hydrate the model list without re-warming-up. An
          // agent's advertised models are an agent property, not a workspace
          // property, so this global cache is correct and avoids scanning
          // other workspaces' private session data.
          const cacheProvider = originalProvider || provider;
          await writeAgentHandshakeCache(cacheProvider, agentId, {
            sessionMetadata: warmSessionMetadata,
            handshakeAt: Date.now(),
          }).catch(() => undefined);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn(`[personal-agent-runtime] warmup session-store write failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const updated = await updateConversation(workspaceRoot, provider, agentId, conversation.id, {
        providerSessionId: warmed.providerSessionId ?? warmed.sessionId ?? conversation.providerSessionId,
        resumeKey: warmed.resumeKey ?? warmed.providerSessionId ?? warmed.sessionId ?? conversation.resumeKey,
        workdir: warmed.workdir ?? conversation.workdir,
        metadata: { ...(conversation.metadata ?? {}), warmupAt: Date.now(), warmupStatus: "ready", sessionMetadata: warmSessionMetadata },
      });
      return { ok: true, conversation: updated, providerSessionId: updated.providerSessionId, resumeKey: updated.resumeKey };
    } catch (error) {
      return { ok: false, conversation, error: error instanceof Error ? error.message : String(error) };
    }
  }


  async function listAgentProviderSessions(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const adapterFactory = adapterFactoryForProvider(agent.provider, agent);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory({ appendEvent: () => undefined, registerCancel: () => undefined });
    if (typeof adapter.listSessions !== "function") return { sessions: [], unsupportedReason: "session_list_not_supported" };
    return adapter.listSessions({ ...input, workspaceRoot, agent });
  }

  async function loadAgentProviderSession(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const adapterFactory = adapterFactoryForProvider(agent.provider, agent);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory({ appendEvent: () => undefined, registerCancel: () => undefined });
    if (typeof adapter.loadSession !== "function") throw new Error(`${agent.provider} does not support session/load`);
    const loaded = await adapter.loadSession({ ...input, workspaceRoot, agent });
    const sessionId = loaded.sessionId || input.providerSessionId || input.resumeKey;
    // Reuse an existing conversation with the same providerSessionId instead
    // of always creating a duplicate. This preserves previously persisted
    // events (e.g. imported from archive) so the user sees the full history.
    let conversation = null;
    if (sessionId) {
      const listed = await listConversations(workspaceRoot, agent.provider, agent.id);
      conversation = listed.conversations.find(
        (item) => item.providerSessionId === sessionId || item.resumeKey === sessionId,
      ) ?? null;
    }
    if (!conversation) {
      conversation = await createConversation(workspaceRoot, agent.provider, agent.id, {
        title: input.title ?? `Loaded ${loaded.sessionId}`,
        providerSessionId: loaded.sessionId,
        resumeKey: loaded.sessionId,
        source: "provider-session-load",
        metadata: loaded.raw ?? null,
      });
    }
    if (Array.isArray(loaded.conversationMessages) && loaded.conversationMessages.length) {
      await writeConversationEvents(workspaceRoot, agent.provider, agent.id, conversation.id, [], loaded.conversationMessages);
    }
    return { ...loaded, conversation };
  }

  async function closeAgentProviderSession(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const sessionId = String(input.sessionId ?? input.providerSessionId ?? input.resumeKey ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!sessionId) throw new Error("sessionId is required");
    const adapterFactory = adapterFactoryForProvider(agent.provider, agent);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory({ appendEvent: () => undefined, registerCancel: () => undefined });
    if (typeof adapter.closeSession !== "function") throw new Error(`${agent.provider} does not support session/close`);
    const result = await adapter.closeSession({ ...input, sessionId, workspaceRoot, agent });
    const listed = await listConversations(workspaceRoot, agent.provider, agent.id);
    const closedConversations = listed.conversations.filter((conversation) => {
      if (input.conversationId && conversation.id === input.conversationId) return true;
      return conversation.providerSessionId === sessionId || conversation.resumeKey === sessionId;
    });
    for (const conversation of closedConversations) {
      await updateConversation(workspaceRoot, agent.provider, agent.id, conversation.id, {
        providerSessionId: null,
        resumeKey: null,
        lastStatus: "closed",
        metadata: {
          ...(conversation.metadata ?? {}),
          closedProviderSessionId: sessionId,
          closedAt: Date.now(),
        },
      });
      for (const state of runs.values()) {
        if (state.workspaceRoot === workspaceRoot && state.agentProvider === agent.provider && state.agentId === agent.id && state.conversationId === conversation.id && state.status === "running") {
          await cancel(state.runId, { reason: "provider-session-closed" }).catch(() => undefined);
        }
      }
    }
    return { ...result, closedConversationIds: closedConversations.map((conversation) => conversation.id) };
  }

  async function forkAgentProviderSession(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const adapterFactory = adapterFactoryForProvider(agent.provider, agent);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory({ appendEvent: () => undefined, registerCancel: () => undefined });
    if (typeof adapter.forkSession !== "function") throw new Error(`${agent.provider} does not support session/fork`);
    const forked = await adapter.forkSession({ ...input, workspaceRoot, agent });
    const conversation = await createConversation(workspaceRoot, agent.provider, agent.id, {
      title: input.title ?? `Fork ${forked.sessionId}`,
      providerSessionId: forked.sessionId,
      resumeKey: forked.sessionId,
      source: "provider-session-fork",
      metadata: forked.raw ?? null,
    });
    return { ...forked, conversation };
  }

  async function setAgentConfigOption(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const optionId = String(input.optionId ?? input.configOptionId ?? input.id ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!optionId) throw new Error("optionId is required");
    // Custom agents are stored with provider="custom" but their ACP adapter
    // is resolved via detectAgent (e.g. CodeBuddy detects as "opencode").
    // Without detecting, adapterFactoryForProvider("custom", agent) returns
    // null because the normalized agent lacks connectionType/supportsAcp,
    // and setConfigOption fails with "No adapter for custom". Aligns with
    // warmupConversation which uses detected.provider.
    const detected = await legacy.detectAgent(agent, workspaceRoot).catch(() => agent);
    const provider = detected.provider ?? agent.provider;
    const adapterFactory = adapterFactoryForProvider(provider, detected);
    if (!adapterFactory) throw new Error(`No adapter for ${provider}`);
    // codex/claude ship their ACP entrypoint as a managed npm package
    // (`codex-acp`, `claude-acp`); the raw `codex` / `claude` CLIs run a TUI
    // and exit 1 when spawned as an ACP subprocess (no TTY). Mirror the
    // warmup/start paths so `#model` / model dropdown reach the correct
    // binary instead of ACP-crashing with `ACP process exited: 1`.
    if ((provider === "codex" || provider === "claude") && !Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) {
      const tool = await ensureManagedAcpTool(provider);
      detected.executablePath = tool.binPath;
      detected.managedAcpTool = tool;
      detected.connectionMode = defaultConnectionMode(provider, detected);
    }
    const adapter = adapterFactory({ appendEvent: () => undefined, registerCancel: () => undefined });
    if (typeof adapter.setConfigOption !== "function") throw new Error(`${provider} does not support config/set`);
    return adapter.setConfigOption({ ...input, optionId, workspaceRoot, agent: detected });
  }

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

  async function loadExtensionAdapters() {
    try {
      const { enabledAdapters } = await loadExtensions({ bundledRoots: bundledExtensionRoots });
      return enabledAdapters.map((adapter) => adapterToCustomAgent(adapter));
    } catch {
      return [];
    }
  }

  // Two-step ACP probe result → { status, error, step } for a CLI+ACP agent.
  // Used by both the discoverable catalog and CLI+ACP custom agents so
  // entries whose binary exists but who fail `initialize` (unsupported CLI,
  // e.g. GitHub Copilot) or `session/new` (未登陆, e.g. Kimi CLI) do not
  // surface as `online` in the 本地 tab picker. The management tab still
  // sees them (via `listAgents` without the `available` filter) with the
  // right diagnostic.
  async function probeCliAcpAgent(command, acpArgs, workspaceRoot) {
    try {
      const probe = await probeAcpCommand({
        command,
        args: Array.isArray(acpArgs) ? acpArgs : [],
        cwd: workspaceRoot || process.cwd(),
        timeoutMs: 8_000,
      });
      if (probe.ok) return { status: "online", error: null, step: probe.step };
      if (probe.step === "needs_auth") return { status: "needs_auth", error: probe.error ?? "authentication required", step: probe.step };
      if (probe.step === "fail_cli") return { status: "missing", error: probe.error ?? null, step: probe.step };
      return { status: "offline", error: probe.error ?? "ACP handshake failed", step: probe.step };
    } catch (probeError) {
      const message = probeError instanceof Error ? probeError.message : String(probeError);
      return { status: "offline", error: message, step: "fail_acp" };
    }
  }

  // Resolve the discoverable catalog into agent cards for the management page.
  // Each draft is run through the normal detection layer so status (online /
  // offline / missing), version and connectionMode are computed the same way as
  // the 5 built-ins. Not-installed agents resolve to offline/missing but are
  // still returned (that's the whole point) with `discoverable: true` so the UI
  // can render them read-only (no edit/delete) yet still test-connectable.
  async function buildDiscoverableAgents(workspaceRoot, registeredAgents, includeModels) {
    const existingIds = new Set();
    for (const agent of Array.isArray(registeredAgents) ? registeredAgents : []) {
      if (agent?.id) existingIds.add(String(agent.id).toLowerCase());
      if (agent?.provider) existingIds.add(String(agent.provider).toLowerCase());
      const exe = String(agent?.executablePath ?? "").split(/[\\/]/).pop();
      if (exe) existingIds.add(exe.toLowerCase());
    }
    const drafts = discoverableAgentDrafts().filter(
      (draft) => !existingIds.has(String(draft.id).toLowerCase()),
    );
    return Promise.all(
      drafts.map(async (draft) => {
        let detected = null;
        try {
          detected = await legacy.detectAgent(
            {
              id: draft.id,
              name: draft.name,
              provider: "custom",
              executablePath: draft.executablePath,
              connectionType: "cli",
              supportsAcp: true,
              acpArgs: draft.acpArgs,
            },
            workspaceRoot,
            { includeModels },
          );
        } catch {
          detected = null;
        }
        const base = detected && typeof detected === "object" ? detected : {};
        // A discoverable catalog entry is either installed (detectAgent resolves
        // it to "online" with a real version) or not installed. Anything that is
        // not "online" is treated as not-installed: surface it as "missing" with
        // no error so the card shows a clean "未安装" state instead of a red
        // error box / raw "spawn X ENOENT" (the whole point is "listed even when
        // not installed", not "broken").
        const versionOk = base.status === "online";
        // `--version` succeeded only proves the binary exists. To keep entries
        // like Kimi (未登陆) or Copilot (不支持 ACP) out of the 本地 tab,
        // additionally run a 2-step ACP probe: `initialize` + `session/new`.
        // Only draft agents that pass both steps are treated as truly online;
        // anything else (`needs_auth` / `fail_acp` / `fail_cli`) is downgraded
        // so `personalAgentAvailableMetadataList`'s `available` filter drops
        // them from the runtime picker but the management tab still surfaces
        // them read-only with the right diagnostic.
        let effectiveStatus = versionOk ? "online" : "missing";
        let effectiveError = versionOk ? (base.error ?? null) : null;
        let acpProbeStep = null;
        if (versionOk) {
          const probeResult = await probeCliAcpAgent(draft.executablePath, draft.acpArgs, workspaceRoot);
          effectiveStatus = probeResult.status;
          effectiveError = probeResult.error;
          acpProbeStep = probeResult.step;
        }
        // Force identity/kind fields back to the catalog values: detectAgent may
        // normalize a not-installed custom draft in ways that drop our metadata.
        return {
          ...base,
          id: draft.id,
          name: draft.name,
          provider: "custom",
          connectionType: "cli",
          supportsAcp: true,
          acpArgs: draft.acpArgs,
          nativeSkillsDirs: draft.nativeSkillsDirs,
          discoverable: true,
          status: effectiveStatus,
          error: effectiveError,
          acpProbeStep,
        };
      }),
    );
  }

  async function listAgents(input = {}) {
    const result = await legacy.listAgents(input);
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const customAgentsRaw = workspaceRoot ? await listCustomAgents(workspaceRoot) : [];
    // Custom agents come straight from the store without going through the
    // legacy detector, so `capability` / `connectionMode` were never
    // populated. Compute them here (Upstream-aligned: cli + supportsAcp => ACP)
    // so `agent_type` becomes "acp", the ACP warmup path kicks in, and the
    // UI's model selector sees supportsModelOverride based on the handshake
    // instead of the raw stored bool.
    const customAgents = await Promise.all(customAgentsRaw.map(async (agent) => {
      // Probe CLI+ACP custom agents so 未登录 / ACP 失败 get offline|needs_auth
      // (still 已安装). Non-ACP or raw-cmd agents keep their stored status.
      const isCliAcp = agent?.connectionType === "cli" && agent?.supportsAcp !== false;
      let status = agent?.status === "offline" ? "offline" : "online";
      let error = agent?.error ?? null;
      let acpProbeStep = agent?.acpProbeStep ?? null;
      // Detect binary version the same way as built-ins (`--version`). Custom
      // agents used to skip this path, so the sidebar showed "Custom" instead
      // of e.g. "0.2.106" / "0.1.0".
      let version = agent?.version ?? null;
      if (agent?.executablePath) {
        try {
          const detected = await legacy.detectAgent(agent, workspaceRoot, { includeModels: false });
          if (detected && typeof detected === "object") {
            const detectedVersion = String(detected.version ?? "").trim();
            if (detectedVersion) version = detectedVersion.split("\n")[0].trim();
            // Prefer detect status when ACP probe is not applicable.
            if (!isCliAcp && detected.status) {
              status = detected.status;
              error = detected.error ?? null;
            }
          }
        } catch {
          // keep stored status / null version
        }
      }
      if (isCliAcp && agent?.executablePath) {
        const probeResult = await probeCliAcpAgent(agent.executablePath, agent.acpArgs, workspaceRoot);
        status = probeResult.status;
        error = probeResult.error;
        acpProbeStep = probeResult.step;
      }
      const capability = personalAgentCapability(agent.provider, status, { customAgent: agent });
      // Always recompute connection mode so named custom agents never stick on
      // the legacy stored "Custom ACP session" label.
      const connectionMode = personalLocalAgentConnectionMode(agent.provider, agent);
      // Backfill catalog skill roots (WorkBuddy often only stored ~/.codebuddy/skills
      // while the bulk of user skills live under ~/.workbuddy/skills).
      const nativeSkillsDirs = mergeCatalogNativeSkillDirs(agent);
      // Store-backed agents are fleet members (mine), never catalog drafts.
      return {
        ...agent,
        version,
        nativeSkillsDirs,
        capability,
        connectionMode,
        discoverable: false,
        status,
        error,
        acpProbeStep,
        agent_source: agent.agent_source ?? agent.agentSource ?? "custom",
      };
    }));
    const extensionAgents = await loadExtensionAdapters();
    const registeredAgents = [...(Array.isArray(result?.agents) ? result.agents : []), ...customAgents, ...extensionAgents];
    // Management page only: always list the known-but-not-installed agent
    // catalog (Upstream-style "十多个都显示，没装也在") so users can test-connect
    // any of them. Gated behind includeDiscoverable so the runtime/session
    // dropdowns (which call listAgents without the flag) stay unaffected.
    const discoverableAgents = input.includeDiscoverable
      ? await buildDiscoverableAgents(workspaceRoot, registeredAgents, input.includeModels !== false)
      : [];
    const agents = [...registeredAgents, ...discoverableAgents];
    // Merge handshake-advertised models into agent.modelOptions so all
    // channels (WeChat #model, Feishu, local page) share the same dynamic
    // model list. Static modelOptions (from CLI probes for built-in providers)
    // take priority; handshake models fill gaps for custom/CodeBuddy agents.
    function mergeHandshakeModelsIntoOptions(existingOptions, handshake) {
      const base = Array.isArray(existingOptions) ? existingOptions.filter((o) => o && typeof o.id === "string" && o.id.trim()) : [];
      const seen = new Set(base.map((o) => o.id.trim().toLowerCase()));
      const merged = [...base];
      // From config_options (category === "model")
      const configOptions = Array.isArray(handshake?.config_options) ? handshake.config_options : [];
      for (const item of configOptions) {
        if (!item || typeof item !== "object") continue;
        const category = typeof item.category === "string" ? item.category : "";
        const itemId = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
        if (category !== "model" && !/model/i.test(itemId)) continue;
        const opts = Array.isArray(item.options) ? item.options : [];
        for (const opt of opts) {
          if (!opt || typeof opt !== "object") continue;
          const id = String(opt.value ?? opt.id ?? opt.name ?? "").trim();
          if (!id || seen.has(id.toLowerCase())) continue;
          seen.add(id.toLowerCase());
          merged.push({ id, label: String(opt.name ?? opt.label ?? opt.value ?? id).trim() || id });
        }
      }
      // From available_models
      const availableModels = Array.isArray(handshake?.available_models) ? handshake.available_models : [];
      for (const item of availableModels) {
        if (item && typeof item === "object") {
          const id = String(item.id ?? item.modelId ?? item.model_id ?? item.name ?? "").trim();
          if (!id || seen.has(id.toLowerCase())) continue;
          seen.add(id.toLowerCase());
          merged.push({ id, label: String(item.label ?? item.name ?? item.displayName ?? id).trim() || id });
        } else if (typeof item === "string" && item.trim()) {
          const id = item.trim();
          if (seen.has(id.toLowerCase())) continue;
          seen.add(id.toLowerCase());
          merged.push({ id, label: id });
        }
      }
      return merged;
    }

    // Hydrate ACP session metadata cached from the last warmup so the
    // handshake exposes available_commands / config options / models before
    // the user sends a message. Falls back to the raw agent when the
    // session-store has nothing for that provider/agent yet.
    const accessibleRoots = Array.isArray(input.accessibleWorkspaceRoots)
      ? input.accessibleWorkspaceRoots.map((r) => String(r ?? "").trim()).filter(Boolean)
      : [];
    const hydratedAgents = workspaceRoot
      ? await Promise.all(agents.map(async (agent) => {
          const provider = String(agent?.provider ?? "").trim();
          const agentId = String(agent?.id ?? provider).trim();
          if (!provider || !agentId) return agent;
          try {
            // Custom ACP agents are stored with provider="custom" but warmed
            // up via their detected adapter provider (e.g. CodeBuddy is
            // detected as the "opencode" provider). The warmup path mirrors
            // the session metadata under the original provider key, but as a
            // safety net also try the backend / "opencode" keys.
            const candidateProviders = [provider];
            const backend = String(agent?.backend ?? "").trim();
            if (backend && !candidateProviders.includes(backend)) candidateProviders.push(backend);
            if (!candidateProviders.includes("opencode")) candidateProviders.push("opencode");
            // Search the primary workspace first, then fall back to any
            // accessible workspace roots. This lets channels (e.g. WeChat)
            // that use a different workspaceRoot still pick up handshake
            // metadata captured in another workspace where the agent was
            // actually warmed up.
            const candidateRoots = [workspaceRoot, ...accessibleRoots.filter((r) => r !== workspaceRoot)];
            let stored = null;
            for (const root of candidateRoots) {
              for (const candidate of candidateProviders) {
                stored = await readSession(root, candidate, agentId);
                if (stored?.sessionMetadata && typeof stored.sessionMetadata === "object") break;
              }
              if (stored?.sessionMetadata && typeof stored.sessionMetadata === "object") break;
            }
            // Final fallback: read the agent-level global handshake cache.
            // This is populated by warmupConversation whenever any workspace
            // warms up the agent, so channels using a different workspaceRoot
            // (e.g. WeChat) can still hydrate the model list. Unlike scanning
            // other workspaces' session files, this cache only contains
            // handshake metadata (models/commands/config options) that the
            // agent itself advertised, so no cross-workspace data leaks.
            if (!stored?.sessionMetadata || typeof stored.sessionMetadata !== "object") {
              for (const candidate of candidateProviders) {
                const cached = await readAgentHandshakeCache(candidate, agentId);
                if (cached?.sessionMetadata && typeof cached.sessionMetadata === "object") {
                  stored = cached;
                  break;
                }
              }
            }
            const meta = stored?.sessionMetadata;
            if (!meta || typeof meta !== "object") return agent;
            const nextAvailableCommands = Array.isArray(meta.availableCommands) && meta.availableCommands.length
              ? meta.availableCommands
              : (Array.isArray(agent?.availableCommands) ? agent.availableCommands : []);
            // Merge warmup-captured config options / models into the agent
            // handshake so acpConfigOptions() and the renderer's
            // useAcpModelInfo can see them without waiting for the first
            // message. Aligns with Upstream's preload_advertised_catalogs
            // which seeds advertised models/modes from the agent handshake.
            const handshake = { ...(agent.handshake ?? {}) };
            if (Array.isArray(meta.configOptions) && meta.configOptions.length && !Array.isArray(handshake.config_options)) {
              handshake.config_options = meta.configOptions;
            }
            if (Array.isArray(meta.availableModels) && meta.availableModels.length && !(Array.isArray(handshake.available_models) && handshake.available_models.length)) {
              handshake.available_models = meta.availableModels;
            }
            if (meta.currentModelId && !handshake.current_model_id) {
              handshake.current_model_id = meta.currentModelId;
            }
            // Plan 3: merge handshake-advertised models into agent.modelOptions
            // so all channels (WeChat #model, Feishu, local page) share the
            // same dynamic model list without each channel re-implementing
            // handshake parsing. Static modelOptions (from CLI probes) take
            // priority; handshake models fill in the gaps for custom/CodeBuddy
            // agents that only advertise models via ACP handshake.
            const hydratedModelOptions = mergeHandshakeModelsIntoOptions(agent.modelOptions, handshake);
            return { ...agent, handshake, sessionMetadata: meta, availableCommands: nextAvailableCommands, modelOptions: hydratedModelOptions };
          } catch {
            return agent;
          }
        }))
      : agents;
    return {
      ...result,
      agents: hydratedAgents,
      metadata: personalAgentMetadataList(hydratedAgents),
    };
  }

  async function createAgent(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    return createCustomAgent(workspaceRoot, input.agent ?? input);
  }

  async function updateAgent(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const id = String(input.id ?? input.agent?.id ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!id) throw new Error("agent id is required");
    return updateCustomAgent(workspaceRoot, id, input.agent ?? input);
  }

  async function deleteAgent(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const id = String(input.id ?? input.agentId ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    if (!id) throw new Error("agent id is required");
    return deleteCustomAgent(workspaceRoot, id);
  }

  async function listAgentMetadata(input = {}) {
    const result = await listAgents(input);
    return { agents: result.metadata };
  }

  async function listAvailableAgentMetadata(input = {}) {
    // Reuse the hydrated listAgents pipeline so ACP handshake commands /
    // models / config options captured during warmup are exposed to the
    // renderer via handshake.available_commands. Directly calling
    // `legacy.listAgents` would return raw agent objects and drop the
    // session-store hydration.
    //
    // Force `includeDiscoverable: true` here so any binary from the built-in
    // discoverable catalog (grok / kimi / goose / trae / mimo / codebuddy...)
    // that is already installed on PATH auto-surfaces in the 本地 tab as an
    // online agent. `personalAgentAvailableMetadataList` filters by
    // `enabled && available`, so not-installed drafts (status: "missing")
    // are dropped and only actually-usable ones make it into the picker.
    const result = await listAgents({ ...input, includeDiscoverable: true });
    const agents = Array.isArray(result?.agents) ? result.agents : [];
    return { agents: personalAgentAvailableMetadataList(agents) };
  }

  async function listAcpAgents(input = {}) {
    return listAvailableAgentMetadata(input);
  }

  async function refreshAcpAgents(input = {}) {
    return listAvailableAgentMetadata({ ...input, refresh: true });
  }

  async function acpHealth(input = {}) {
    const result = await listAgents(input);
    const agents = Array.isArray(result.metadata) ? result.metadata : [];
    return {
      ok: true,
      agents: agents.map((agent) => ({
        id: agent.id,
        backend: agent.backend,
        agent_type: agent.agent_type,
        available: agent.available,
        connectionMode: agent.connectionMode,
        error: agent.error ?? null,
      })),
    };
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

  async function acpConfigOptions(input = {}) {
    const result = await listAgentMetadata(input);
    const agentId = String(input.agent?.id ?? input.agentId ?? "").trim();
    const provider = String(input.agent?.provider ?? input.provider ?? "").trim();
    const agent = result.agents.find((item) => item.id === agentId || item.backend === provider) ?? result.agents[0] ?? null;
    const availableModels = Array.isArray(agent?.handshake?.available_models) ? agent.handshake.available_models : [];
    const configOptions = Array.isArray(agent?.handshake?.config_options) ? agent.handshake.config_options : [];
    const availableCommands = Array.isArray(agent?.handshake?.available_commands) ? agent.handshake.available_commands : [];
    const supportsModelOverride = Boolean(agent?.handshake?.agent_capabilities?._meta?.supportsModelOverride);
    const supportsModeOverride = configOptions.some((option) => /mode/i.test(String(option?.id ?? option?.name ?? "")));
    return {
      configOptions,
      availableModels: supportsModelOverride ? availableModels : [],
      availableCommands,
      capabilities: {
        supportsConfigOptions: configOptions.length > 0,
        supportsModelOverride: supportsModelOverride && availableModels.length > 0,
        supportsModeOverride,
      },
      unsupportedReason: !agent
        ? "agent_not_found"
        : !configOptions.length && !(supportsModelOverride && availableModels.length)
          ? "provider_does_not_expose_config_options"
          : null,
    };
  }

  function listProcesses(input = {}) {
    return { processes: listAgentProcesses(input) };
  }

  // Run a two-step ACP probe (CLI spawn -> initialize -> session/new) against
  // an agent and return a structured connection result the
  // UI can render (status color, capabilities, models, config options).
  async function testConnection(input = {}) {
    const checkedAt = Date.now();
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const detected = await legacy.detectAgent(agent, workspaceRoot).catch((error) => ({
      ...agent,
      status: "offline",
      error: error instanceof Error ? error.message : String(error),
    }));
    if (detected.status && detected.status !== "online") {
      // Collapse legacy "error" status into "offline" so the 5-state model
      // (online / needs_auth / offline / missing / unknown) is always returned.
      const rawStatus = detected.status === "error" ? "offline" : detected.status;
      const errorText = String(detected.error ?? "");
      const errorCode = detected.errorInfo?.code ?? detected.errorCode ?? "";
      // A missing binary (not installed) is reported as "missing" with a clean
      // human message — never the raw "spawn X ENOENT" / "未配置可执行命令".
      const isMissing =
        rawStatus === "missing" ||
        String(errorCode).toLowerCase() === "missing_binary" ||
        /enoent|not found|command not found|no such file|未配置|未安装/i.test(errorText);
      let status = rawStatus;
      if (isMissing) {
        status = "missing";
      } else if (rawStatus === "offline" && /auth|login|unauthorized|forbidden|api key|credential|认证|登录|未授权|凭证/i.test(errorText)) {
        status = "needs_auth";
      }
      return {
        ok: false,
        status,
        step: status === "missing" ? "fail_cli" : status === "needs_auth" ? "needs_auth" : "fail_cli",
        error: isMissing ? `${detected.name ?? agent.name ?? agent.provider} 未安装` : (detected.error ?? `${detected.name ?? agent.name ?? agent.provider} unavailable`),
        capabilities: null,
        models: [],
        configOptions: [],
        checkedAt,
      };
    }
    const provider = detected.provider ?? agent.provider;
    let executablePath = detected.executablePath || provider;
    // Built-in providers expose ACP via the `acp` subcommand, but custom / cli
    // agents (incl. the discoverable catalog like CodeBuddy/Gemini) switch into
    // ACP mode via their own flag (e.g. `--acp`) carried on `acpArgs`. Using the
    // hard-coded `acp` subcommand for those would spawn the wrong process.
    const detectedAcpArgs = Array.isArray(detected.acpArgs) ? detected.acpArgs.filter(Boolean) : [];
    const detectedCustomArgs = Array.isArray(detected.customArgs) ? detected.customArgs : [];
    let args =
      (provider === "custom" || detected.connectionType === "cli") && detectedAcpArgs.length
        ? [...detectedAcpArgs, ...detectedCustomArgs]
        : ["acp", ...detectedCustomArgs];
    try {
      if (provider === "codex" || provider === "claude") {
        const tool = await resolveManagedAcpTool(provider);
        if (tool?.installed && tool.binPath) {
          executablePath = tool.binPath;
          args = [...(Array.isArray(detected.customArgs) ? detected.customArgs : [])];
        }
      }
      const probe = await probeAcpCommand({ command: executablePath, args, cwd: workspaceRoot || process.cwd(), timeoutMs: Number(input.timeoutMs) || 12_000 });
      const meta = probe.sessionResult ? extractProbeMetadata(probe.sessionResult, probe.initialized) : extractProbeMetadata(probe.initialized);
      // If the probe determined the binary is simply not installed, replace the
      // raw "spawn X ENOENT" with a clean "未安装" message.
      const probeMissing = probe.status === "missing";
      return {
        ok: probe.ok,
        status: probe.status,
        step: probe.step,
        error: probeMissing ? `${detected.name ?? agent.name ?? agent.provider} 未安装` : (probe.error ?? null),
        capabilities: probe.initialized?.capabilities ?? null,
        models: meta.models,
        configOptions: meta.configOptions,
        checkedAt,
      };
    } catch (error) {
      return {
        ok: false,
        status: "offline",
        step: "fail_cli",
        error: error instanceof Error ? error.message : String(error),
        capabilities: null,
        models: [],
        configOptions: [],
        checkedAt,
      };
    }
  }

  // Test a custom agent configuration before saving.
  // Runs a two-step ACP probe (CLI spawn -> initialize -> session/new) with
  // the provided command/args/env and returns a three-state result:
  // success / fail_cli / fail_acp.
  async function testCustomAgent(input = {}) {
    const command = String(input.command ?? "").trim();
    if (!command) {
      return { step: "fail_cli", error: "command is required", durationMs: 0 };
    }
    const args = Array.isArray(input.args) ? input.args.filter(Boolean) : [];
    const acpArgs = Array.isArray(input.acpArgs) ? input.acpArgs.filter(Boolean) : [];
    const env = input.env && typeof input.env === "object" && !Array.isArray(input.env) ? input.env : {};
    const timeoutMs = Math.max(1000, Math.min(30000, Number(input.timeoutMs) || 8000));
    const cwd = String(input.cwd ?? process.cwd()).trim();
    const startedAt = Date.now();
    try {
      const probe = await probeAcpCommand({ command, args: acpArgs.length > 0 ? acpArgs : args, cwd, timeoutMs, env });
      const durationMs = Date.now() - startedAt;
      // Map probeAcpCommand's 4-state result to the 3-state contract:
      // - "online" -> "success"
      // - "fail_cli" -> "fail_cli"
      // - "fail_acp" -> "fail_acp"
      // - "needs_auth" -> "fail_acp" (auth error is still an ACP-layer issue)
      const step = probe.step === "online" ? "success" : probe.step === "needs_auth" ? "fail_acp" : probe.step;
      return { step, error: probe.error ?? null, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      // Spawn errors are CLI-layer; JSON-RPC errors are ACP-layer.
      const step = /ENOENT|spawn|command not found|not found/i.test(message) ? "fail_cli" : "fail_acp";
      return { step, error: message, durationMs };
    }
  }

  async function checkProviderHealth(input = {}) {
    const checkedAt = Date.now();
    try {
      const agent = await legacy.normalizeAgent(input.agent ?? {});
      if (Object.prototype.hasOwnProperty.call(injectedAdapters, agent.provider)) {
        // Injected adapters are not health-checked by sending a real user prompt,
        // because that would pollute the conversation context. We rely on the
        // detection layer (executable / managed tool / availability) instead.
        const workspaceRoot = String(input.workspaceRoot ?? "").trim();
        const detected = await legacy.detectAgent(agent, workspaceRoot).catch((error) => ({
          ...agent,
          status: "offline",
          error: error instanceof Error ? error.message : String(error),
        }));
        const healthy = detected.status === "online";
        return {
          ok: true,
          healthy,
          status: healthy ? "online" : "offline",
          reason: detected.error ?? null,
          step: healthy ? "online" : "fail_detect",
          checkedAt,
          capabilities: null,
          models: [],
          configOptions: [],
        };
      }
      const result = await testConnection(input);
      return {
        ok: true,
        healthy: Boolean(result.ok),
        status: result.status ?? (result.ok ? "online" : "offline"),
        reason: result.error ?? null,
        step: result.step ?? null,
        checkedAt,
        capabilities: result.capabilities ?? null,
        models: result.models ?? [],
        configOptions: result.configOptions ?? [],
      };
    } catch (error) {
      return {
        ok: false,
        healthy: false,
        status: "offline",
        reason: error instanceof Error ? error.message : String(error),
        step: "failed",
        checkedAt,
        capabilities: null,
        models: [],
        configOptions: [],
      };
    }
  }

  async function checkManagedAgentHealthById(input = {}) {
    const id = String(input.id ?? input.agentId ?? input.provider ?? "").trim();
    if (!id) return { ok: false, healthy: false, status: "unknown", reason: "agent id is required", checkedAt: Date.now() };
    const agents = await listAgents({ workspaceRoot: input.workspaceRoot });
    const agent = (agents.agents ?? []).find((item) => item.id === id || item.provider === id);
    if (!agent) return { ok: false, healthy: false, status: "missing", reason: `agent ${id} was not found`, checkedAt: Date.now() };
    return checkProviderHealth({ ...input, agent });
  }

  function extractProbeMetadata(...sources) {
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      const modelsBlock = source.models && typeof source.models === "object" ? source.models : source;
      const rawModels = Array.isArray(modelsBlock?.availableModels)
        ? modelsBlock.availableModels
        : Array.isArray(source.availableModels)
          ? source.availableModels
          : Array.isArray(source.available_models)
            ? source.available_models
            : [];
      const models = rawModels
        .map((item) => (item && typeof item === "object"
          ? { id: String(item.id ?? item.modelId ?? item.name ?? "").trim(), label: String(item.name ?? item.label ?? item.id ?? "").trim() }
          : { id: String(item ?? "").trim(), label: String(item ?? "").trim() }))
        .filter((m) => m.id);
      const configOptions = Array.isArray(source.configOptions)
        ? source.configOptions
        : Array.isArray(source.config_options)
          ? source.config_options
          : [];
      if (models.length || configOptions.length) return { models, configOptions };
    }
    return { models: [], configOptions: [] };
  }

  async function getHostStatus(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const agent = input.agent ? await legacy.normalizeAgent(input.agent).catch(() => null) : null;
    // Skill roots come from three sources (HR2-B):
    // 1. per-provider defaults resolved against workspace + $HOME
    //    (~/.codex/skills, ~/.claude/skills, ~/.opencode/skills, ~/.gemini)
    // 2. explicit overrides on the agent metadata (native_skills_dirs)
    // 3. additionalSkillRoots the caller wants scanned
    const overrides = [];
    if (agent) {
      const metadata = personalAgentMetadataFromAgent(agent);
      if (Array.isArray(metadata.native_skills_dirs)) overrides.push(...metadata.native_skills_dirs);
    }
    if (Array.isArray(input.additionalSkillRoots)) {
      for (const root of input.additionalSkillRoots) {
        if (typeof root === "string" && root.trim().length) overrides.push(root);
      }
    }
    const nativeSkillsDirs = agent
      ? await resolveNativeSkillRoots(agent, workspaceRoot, overrides)
      : [];
    // Live event stream + handshake commands feed the MCP view-model.
    const status = agent && input.conversationId
      ? await getConversationStatus({ workspaceRoot, agent, conversationId: input.conversationId }).catch(() => null)
      : null;
    const conversationMessages = status?.conversationMessages ?? [];
    const availableCommands = (() => {
      if (!agent) return [];
      const metadata = personalAgentMetadataFromAgent(agent);
      return Array.isArray(metadata.handshake?.available_commands) ? metadata.handshake.available_commands : [];
    })();
    const remembered = workspaceRoot ? await listRememberedApprovalDecisions(workspaceRoot) : [];
    const nativeMcp = agent
      ? await readNativeMcpConfig(agent, workspaceRoot).catch((error) => ({ servers: [], errors: [{ file: "<readNativeMcpConfig>", message: String(error?.message || error) }] }))
      : { servers: [], errors: [] };
    const [skill, liveMcp, permission] = await Promise.all([
      buildSkillStatus({ nativeSkillsDirs }),
      Promise.resolve(buildMcpStatus({ conversationMessages, availableCommands })),
      Promise.resolve(buildPermissionStatus({
        pendingApprovals: status?.activeRun?.pendingApprovals ?? [],
        conversationMessages,
        rememberedDecisions: remembered,
      })),
    ]);
    // Merge config-file MCP servers with live tool-call observations.
    // Config wins on transport; live wins on toolCount + connected.
    const mergedByName = new Map();
    for (const s of nativeMcp.servers) {
      const key = String(s.name || "").toLowerCase();
      if (!key) continue;
      mergedByName.set(key, {
        name: s.name,
        transport: s.transport || s.type || null,
        connected: false,
        toolCount: 0,
        source: s.source,
        sourceFile: s.sourceFile,
      });
    }
    for (const s of liveMcp.servers) {
      const key = String(s.name || "").toLowerCase();
      if (!key) continue;
      const prev = mergedByName.get(key) || { name: s.name, transport: null, connected: true, toolCount: 0 };
      mergedByName.set(key, {
        ...prev,
        transport: prev.transport || s.transport || null,
        connected: true,
        toolCount: (prev.toolCount || 0) + (s.toolCount || 0),
      });
    }
    const mcp = {
      servers: [...mergedByName.values()],
      error: liveMcp.error || null,
      sourceErrors: nativeMcp.errors,
    };
    return {
      workspaceRoot,
      agentId: agent?.id ?? null,
      conversationId: status?.conversation?.id ?? input.conversationId ?? null,
      skill,
      mcp,
      permission,
    };
  }

  return {
    listAgents,
    listAgentMetadata,
    listExtensions: async () => loadExtensions({ bundledRoots: bundledExtensionRoots }),
    setExtensionEnabled: async (input = {}) => setExtensionEnabled(String(input.name ?? input.extensionName ?? "").trim(), input.enabled !== false),
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
  };
}
