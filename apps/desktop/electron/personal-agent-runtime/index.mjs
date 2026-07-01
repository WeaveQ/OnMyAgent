import { readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createCodexAdapter } from "./adapters/codex.mjs";
import { createClaudeAdapter } from "./adapters/claude.mjs";
import { createHermesAdapter } from "./adapters/hermes.mjs";
import { createOpenClawAdapter } from "./adapters/openclaw.mjs";
import { createOpenCodeAdapter } from "./adapters/opencode.mjs";
import { createGenericAcpAdapter } from "./adapters/acp-generic.mjs";
import { personalAgentAvailableMetadataList, personalAgentMetadataList } from "./agent-metadata.mjs";
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
import { runId } from "./utils.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";
import { ensureManagedAcpTool, resolveManagedAcpTool } from "./managed-acp-tools.mjs";
import { ensureRunLogPath, legacyPersonalAssistantRunLogRoot, legacyRunLogRoot, runLogRoot } from "./workdir.mjs";
import { isStaleNativeSessionError, staleNativeSessionResetMessage } from "./native-sessions.mjs";
import { listAgentProcesses, recoverAgentProcesses, registerAgentProcess, unregisterAgentProcess, updateAgentProcess } from "./process-registry.mjs";

const DEFAULT_RUN_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_RUN_TIMEOUT_MS = 30_000;
const MAX_RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const ARTIFACT_PATTERN = /(?:产物文件\s*[:：]\s*|^|[\s"'`([{])((?:\.{1,2}[/\\]|~[/\\]|[/\\])?[\w.\-]+(?:[/\\][\w.\-]+)*\.(?:md|markdown|mdx|txt|log|json|csv|tsv|xlsx|html|pdf|png|jpg|jpeg|webp|svg))/gim;

function probeArtifactExists(absolutePath) {
  if (!absolutePath) return false;
  try {
    statSync(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function resolveArtifactPath(rawPath, workspaceRoot, workdir) {
  const value = String(rawPath ?? "").trim();
  if (!value) return null;
  if (path.isAbsolute(value)) return value;
  if (value.startsWith("~/") || value === "~") {
    return path.join(process.env.HOME || process.env.USERPROFILE || "", value.replace(/^~\/?/, ""));
  }
  if (workdir) {
    const candidate = path.resolve(workdir, value);
    if (probeArtifactExists(candidate)) return candidate;
  }
  if (workspaceRoot) {
    const candidate = path.resolve(workspaceRoot, value);
    if (probeArtifactExists(candidate)) return candidate;
  }
  if (workspaceRoot) return path.resolve(workspaceRoot, value);
  if (workdir) return path.resolve(workdir, value);
  return value;
}

function recordArtifact(state, payload, source) {
  if (!payload) return;
  const rawPath = typeof payload === "string" ? payload : (payload.path ?? payload.value ?? "");
  const cleaned = String(rawPath ?? "").trim().replace(/[.,;:]+$/, "").replace(/^["'\`]/, "").replace(/["'\`]$/, "");
  if (!cleaned) return;
  if (cleaned.startsWith("..")) return;
  const absolute = resolveArtifactPath(cleaned, state.workspaceRoot, state.workdir);
  const key = absolute || cleaned;
  if (!state.artifacts) state.artifacts = [];
  if (state.artifacts.some((entry) => entry.path === key || entry.relPath === cleaned)) return;
  state.artifacts.push({
    path: key,
    relPath: cleaned,
    name: path.basename(cleaned),
    source: typeof payload === "object" && payload?.source ? String(payload.source) : source,
    exists: probeArtifactExists(absolute),
    addedAt: Date.now(),
  });
}

function harvestArtifactsFromText(state, text, source) {
  if (!text) return;
  const value = String(text);
  for (const match of value.matchAll(ARTIFACT_PATTERN)) {
    const candidate = match[1];
    if (candidate) recordArtifact(state, candidate, source);
  }
}

function normalizeRunTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RUN_TIMEOUT_MS;
  return Math.min(MAX_RUN_TIMEOUT_MS, Math.max(MIN_RUN_TIMEOUT_MS, Math.floor(n)));
}

function normalizeAccessibleWorkspaceRoots(value, workspaceRoot = "") {
  const roots = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  const normalized = [];
  const primary = String(workspaceRoot ?? "").trim();
  for (const item of roots) {
    const root = String(item ?? "").trim();
    if (!root || root === primary || seen.has(root)) continue;
    seen.add(root);
    normalized.push(root);
  }
  return normalized;
}

export function createPersonalAgentRuntime(options) {
  configurePersonalAgentRuntimeState(options ?? {});
  const runs = new Map();
  const legacy = options.legacy;
  const injectedAdapters = options.adapters ?? {};
  void recoverAgentProcesses().catch(() => undefined);
  const adapterFactories = {
    opencode: createOpenCodeAdapter,
    codex: createCodexAdapter,
    hermes: createHermesAdapter,
    claude: createClaudeAdapter,
    openclaw: createOpenClawAdapter,
    ...injectedAdapters,
  };

  function adapterFactoryForProvider(provider) {
    if (Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) return adapterFactories[provider];
    if (provider === "hermes" || provider === "opencode" || provider === "openclaw" || provider === "codex" || provider === "claude") return createGenericAcpAdapter;
    return adapterFactories[provider];
  }

  function defaultConnectionMode(provider) {
    if (provider === "opencode") return "OpenCode ACP session";
    if (provider === "codex") return "Codex ACP session";
    if (provider === "hermes") return "Hermes ACP session";
    if (provider === "claude") return "Claude Code ACP session";
    if (provider === "openclaw") return "OpenClaw ACP session";
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
      artifacts: state.artifacts ?? [],
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
      artifacts: [...(state.artifacts ?? [])],
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
    const assistantText = events
      .filter((event) => event.type === "assistant")
      .map((event) => String(event.text ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    const staleRunning = meta.status === "running";
    const status = staleRunning ? "failed" : meta.status;
    const errorInfo = staleRunning
      ? {
          code: "timeout",
          message: "本地 Agent 运行状态已丢失：页面恢复时主进程已没有该 run 的活跃执行记录。",
          debug: "run existed only in persisted log; active runtime state was missing",
        }
      : (meta.errorInfo ?? null);
    const error = staleRunning ? errorInfo.message : (meta.errorInfo?.message ?? null);
    const restoredEvents = staleRunning
      ? [...events, { type: "error", text: errorInfo.message, at: Date.now() }]
      : events;
    return {
      ok: status === "completed",
      runId: meta.runId ?? id,
      agentId: meta.agentId ?? "unknown",
      agentProvider: meta.agentProvider ?? "custom",
      connectionMode: meta.connectionMode ?? "本地 Agent harness session",
      status,
      startedAt: meta.startedAt ?? null,
      finishedAt: staleRunning ? Date.now() : (meta.finishedAt ?? null),
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
      debugSummary: staleRunning ? errorInfo.debug : (meta.debugSummary ?? null),
      errorInfo,
      approvalMode: meta.approvalMode ?? "ask",
      pendingApprovals: staleRunning ? [] : (Array.isArray(meta.pendingApprovals) ? meta.pendingApprovals : []),
      artifacts: Array.isArray(meta.artifacts) ? meta.artifacts : [],
    };
  }

  function classifyErrorInfo(error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    let code = typeof error?.code === "string" && error.code.trim() ? error.code.trim() : "unknown";
    if (code !== "unknown") {
      return { code, message, debug: message || null };
    }
    if (/unsupported format of modelid|expected: modelid\[effort\]|set_model failed/.test(lower)) code = "codex_acp_model_format";
    else if (/set_mode failed|modeid|codex_acp_mode_failed/.test(lower)) code = "codex_acp_mode_failed";
    else if (/conversation interrupted/.test(lower)) code = "acp_bridge_interrupted";
    else if (/acp_bridge_interrupted_after_retry/.test(lower)) code = "acp_bridge_interrupted_after_retry";
    else if (/tool call failed/.test(lower)) code = "acp_tool_failed";
    else if (/sandbox|network|could not resolve host|permission denied|operation not permitted/.test(lower)) code = "sandbox_or_network_refusal";
    else if (/not found|no such file|enoent|command not found|未配置|命令不可用/.test(lower)) code = "missing_binary";
    else if (/auth|login|unauthorized|forbidden|api key|认证|登录/.test(lower)) code = "auth_required";
    else if (/version|版本|update/.test(lower)) code = "version_unsupported";
    else if (/timeout|timed out|超时/.test(lower)) code = "timeout";
    else if (/parse|json|解析/.test(lower)) code = "parse_failed";
    else if (/empty|no assistant|no parseable|空/.test(lower)) code = "empty_output";
    else if (/cancel|取消/.test(lower)) code = "cancelled";
    else if (message.trim()) code = "provider_failed";
    return { code, message, debug: message || null };
  }

  function sanitizeApprovalParams(params) {
    if (!params || typeof params !== "object") return null;
    try {
      return JSON.parse(JSON.stringify(params));
    } catch {
      return { raw: String(params) };
    }
  }

  function requestRunApproval(state, request = {}) {
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
    state.pendingApprovals = [...(state.pendingApprovals ?? []).filter((item) => item.id !== approval.id), approval];
    appendContractEvent(state.events, {
      type: "approval_request",
      text: approval.summary,
      approval,
    });
    state.updatedAt = Date.now();
    void persistRun(state);

    return new Promise((resolve) => {
      state.approvalResolvers.set(approval.id, resolve);
    });
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
    const adapterFactory = adapterFactoryForProvider(agent.provider);
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
      connectionMode: defaultConnectionMode(provider),
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
    };
    runs.set(id, state);
    appendContractEvent(events, { type: "status", text: `${provider} ACP flow started` });
    state.updatedAt = Date.now();
    void persistRun(state);

    if (detected.status !== "online") {
      state.status = "failed";
      state.errorInfo = classifyErrorInfo(new Error(detected.error || `${detected.name} 不可用`));
      state.error = state.errorInfo.message;
      state.finishedAt = Date.now();
      appendContractEvent(events, { type: "error", text: state.error });
      await persistRun(state);
      return snapshot(state);
    }
    if ((provider === "codex" || provider === "claude") && !Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) {
      try {
        const tool = await ensureManagedAcpTool(provider);
        detected.executablePath = tool.binPath;
        detected.managedAcpTool = tool;
        detected.connectionMode = defaultConnectionMode(provider);
        appendContractEvent(events, { type: "status", text: `${provider} managed ACP tool ready: ${tool.id}@${tool.version}` });
      } catch (error) {
        state.status = "failed";
        state.errorInfo = classifyErrorInfo(error);
        state.error = state.errorInfo.message;
        state.finishedAt = Date.now();
        appendContractEvent(events, { type: "error", text: state.error });
        await persistRun(state);
        return snapshot(state);
      }
    }
    const conversation = await getOrCreateConversation(workspaceRoot, provider, agentId, input.conversationId);
    state.conversationId = conversation.id;
    state.providerSessionId = conversation.providerSessionId;
    state.resumeKey = conversation.resumeKey;
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
            const normalized = appendContractEvent(events, event);
            const pidMatch = normalized?.type === "log" ? String(normalized.text ?? "").match(/^pid\s+(\d+)$/) : null;
            if (pidMatch) {
              state.pid = Number(pidMatch[1]);
              registerAgentProcess({
                runId: state.runId,
                pid: state.pid,
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
          conversationWorkdir: conversation.workdir,
          agent: detected,
          model: detected.model,
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
        state.command = result.command;
        state.providerSessionId = result.providerSessionId;
        state.resumeKey = result.resumeKey;
        state.metadata = result.metadata ?? null;
        state.workdir = result.workdir ?? null;
        await updateConversation(workspaceRoot, detected.provider, detected.id, conversation.id, {
          title: conversation.title,
          providerSessionId: result.providerSessionId ?? result.sessionId ?? state.providerSessionId ?? null,
          resumeKey: result.resumeKey ?? result.providerSessionId ?? result.sessionId ?? state.resumeKey ?? null,
          workdir: result.workdir ?? state.workdir ?? null,
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
            provider: state.agentProvider,
            backend: state.agentProvider,
            conversationId: conversation.id,
            agentType: result.metadata?.agent_type ?? "acp",
            command: result.command,
            startedAt: state.startedAt,
          });
        }
        appendContractEvent(events, { type: "assistant", text: result.output });
        harvestArtifactsFromText(state, result.output, "assistant");
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
    if (!adapterFactoryForProvider(agent.provider)) return legacy.run(input);
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
        state.updatedAt = Date.now();
        void persistRun(state);
      }
      return snapshot(state);
    }
    const restored = snapshotFromLog(workspaceRoot, id);
    if (restored) return restored;
    return legacy.status(id);
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
        const adapterFactory = adapterFactoryForProvider(state.agentProvider);
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
    const persisted = conversation?.id
      ? await readConversationEvents(workspaceRoot, agent.provider, agent.id, conversation.id)
      : { events: [], messages: [] };
    return {
      conversation,
      activeRun: activeRun ? snapshot(activeRun) : null,
      running: Boolean(activeRun),
      status: activeRun?.status ?? conversation?.lastStatus ?? "idle",
      events: activeRun ? activeRun.events : persisted.events,
      conversationMessages: activeRun ? runEventsToConversationMessages(activeRun.events) : persisted.messages,
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

  async function listAgents(input = {}) {
    const result = await legacy.listAgents(input);
    const agents = Array.isArray(result?.agents) ? result.agents : [];
    return {
      ...result,
      agents,
      metadata: personalAgentMetadataList(agents),
    };
  }

  async function listAgentMetadata(input = {}) {
    const result = await listAgents(input);
    return { agents: result.metadata };
  }

  async function listAvailableAgentMetadata(input = {}) {
    const result = await legacy.listAgents(input);
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

  return {
    listAgents,
    listAgentMetadata,
    listAcpAgents,
    refreshAcpAgents,
    acpHealth,
    acpSendMessage,
    acpCancel,
    acpResolveApproval,
    acpConfigOptions,
    listProcesses,
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
    getConversationStatus,
    listConversationConfirmations,
    confirmConversationConfirmation,
    classifyErrorForTest: classifyErrorInfo,
  };
}
