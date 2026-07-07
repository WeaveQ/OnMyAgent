import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createCodexAdapter } from "./adapters/codex.mjs";
import { createClaudeAdapter } from "./adapters/claude.mjs";
import { createHermesAdapter } from "./adapters/hermes.mjs";
import { createOpenClawAdapter } from "./adapters/openclaw.mjs";
import { createOpenCodeAdapter } from "./adapters/opencode.mjs";
import { createGenericAcpAdapter } from "./adapters/acp-generic.mjs";
import { createRemoteAcpAdapter } from "./adapters/remote-acp.mjs";
import { personalAgentAvailableMetadataList, personalAgentMetadataList, personalAgentMetadataFromAgent } from "./agent-metadata.mjs";
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
import { clearSession, readSession, writeSession } from "./session-store.mjs";
import { runId } from "./utils.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";
import { ensureManagedAcpTool, resolveManagedAcpTool } from "./managed-acp-tools.mjs";
import { probeAcpCommand } from "./acp-probe.mjs";
import { ensureRunLogPath, legacyPersonalAssistantRunLogRoot, legacyRunLogRoot, runLogRoot } from "./workdir.mjs";
import { isStaleNativeSessionError, staleNativeSessionResetMessage } from "./native-sessions.mjs";
import { listAgentProcesses, recoverAgentProcesses, registerAgentProcess, unregisterAgentProcess, updateAgentProcess } from "./process-registry.mjs";
import { createCustomAgent, deleteCustomAgent, getAgentOverrides, listCustomAgents, setAgentOverrides, updateCustomAgent } from "./custom-agent-store.mjs";
import { buildErrorTip, classifyErrorInfo } from "./error-diagnostics.mjs";
import { getStoredApprovalDecision, listRememberedApprovalDecisions, rememberApprovalDecision } from "./approval-store.mjs";
import { buildMcpStatus, buildPermissionStatus, buildSkillStatus } from "./host-status.mjs";
import { readNativeMcpConfig, resolveNativeSkillRoots } from "./host-status-sources.mjs";

const DEFAULT_RUN_TIMEOUT_MS = 15 * 60 * 1000;
const MIN_RUN_TIMEOUT_MS = 30_000;
const MAX_RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000;


const ACP_TOOL_EVENT_PREVIEW_CHARS = 4000;
function previewClamp(value, limit = ACP_TOOL_EVENT_PREVIEW_CHARS) {
  const text = typeof value === "string" ? value : (value == null ? "" : String(value));
  if (!text || text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit) + "\n...", truncated: true };
}
function sanitizeAcpToolCallEvent(event) {
  if (!event || event.type !== "acp_tool_call") return event;
  const next = { ...event };
  let truncated = false;
  const textPreview = previewClamp(event.text);
  if (textPreview.truncated) {
    next.text = textPreview.text;
    truncated = true;
  }
  const update = event.update && typeof event.update === "object" ? { ...event.update } : null;
  if (update) {
    const meta = update._meta && typeof update._meta === "object" ? { ...update._meta } : null;
    if (meta) {
      const delta = meta.terminal_output_delta;
      if (delta && typeof delta === "object") {
        const deltaPreview = previewClamp(delta.data);
        if (deltaPreview.truncated) {
          meta.terminal_output_delta = { ...delta, data: deltaPreview.text, truncated: true };
          truncated = true;
        }
      }
      update._meta = meta;
    }
    next.update = update;
  }
  if (truncated) next.truncated = true;
  // 'data' field on the raw event is not persisted; drop if present.
  if ("data" in next) delete next.data;
  return next;
}

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

function visibleArtifacts(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => entry && entry.exists !== false);
}


const FILE_CHANGE_TOOL_NAMES = new Set([
  "apply_patch",
  "edit",
  "edit_file",
  "write",
  "write_file",
  "create_file",
  "str_replace",
  "str_replace_editor",
  "str_replace_based_edit_tool",
  "multi_edit",
  "patch",
]);

function extractFilePathFromToolCall(toolCall) {
  if (!toolCall) return null;
  const input = String(toolCall.input ?? "").trim();
  if (input) {
    // Try JSON input first (Codex/Hermes structured inputs).
    if (input.startsWith("{")) {
      try {
        const parsed = JSON.parse(input);
        const candidate = parsed?.file_path ?? parsed?.path ?? parsed?.filename ?? parsed?.file ?? parsed?.target_file;
        if (candidate && typeof candidate === "string") return candidate.trim();
      } catch {
        // fall through to regex
      }
    }
    const m = input.match(/(?:file_path|path|filename|file|target_file)\s*[:=]\s*["']?([^"'\n,}]+)/i);
    if (m) return m[1].trim();
  }
  const desc = String(toolCall.description ?? "").trim();
  if (desc) {
    const m = desc.match(/["'`]([^"'`\n]+\.[A-Za-z0-9]+)["'`]/);
    if (m) return m[1].trim();
  }
  return null;
}

function recordFileChangeFromToolCall(state, toolCall) {
  if (!toolCall || typeof toolCall !== "object") return;
  const name = String(toolCall.name ?? "").toLowerCase();
  if (!FILE_CHANGE_TOOL_NAMES.has(name)) return;
  const status = String(toolCall.status ?? "").toLowerCase();
  // Only record on completed changes; running is still in-flight.
  if (status && status !== "completed" && status !== "success" && status !== "done") return;
  const rawPath = extractFilePathFromToolCall(toolCall);
  if (!rawPath) return;
  const absolute = resolveArtifactPath(rawPath, state.workspaceRoot, state.workdir);
  if (!absolute) return;
  if (!probeArtifactExists(absolute)) return;
  if (!state.fileChanges) state.fileChanges = [];
  const id = createHash("sha1").update(`file-change|${toolCall.id ?? name}|${absolute}`).digest("hex").slice(0, 12);
  if (state.fileChanges.some((entry) => entry.id === id)) return;
  state.fileChanges.push({
    id,
    filePath: absolute,
    fileName: path.basename(absolute),
    tool: name,
    toolCallId: String(toolCall.id ?? ""),
    diff: String(toolCall.output ?? "").slice(0, 8000) || null,
    at: Date.now(),
  });
}

function collectAcpUpdatePaths(update) {
  const paths = new Set();
  const rawInput = update.rawInput ?? update.raw_input ?? update.input ?? null;
  if (rawInput && typeof rawInput === "object") {
    for (const key of ["file_path", "path", "filename", "file", "target_file"]) {
      const v = rawInput[key];
      if (typeof v === "string" && v.trim()) paths.add(v.trim());
    }
  }
  const locations = Array.isArray(update.locations) ? update.locations : [];
  for (const loc of locations) {
    const p = typeof loc?.path === "string" ? loc.path.trim() : "";
    if (p) paths.add(p);
  }
  const content = Array.isArray(update.content) ? update.content : [];
  for (const item of content) {
    const p = typeof item?.path === "string" ? item.path.trim() : "";
    if (p) paths.add(p);
    const diffPath = typeof item?.diff?.path === "string" ? item.diff.path.trim() : "";
    if (diffPath) paths.add(diffPath);
  }
  // Claude Code embeds the resolved response under `_meta.claudeCode.toolResponse`.
  const toolResponse = update._meta?.claudeCode?.toolResponse ?? update._meta?.toolResponse;
  if (toolResponse && typeof toolResponse === "object") {
    for (const key of ["filePath", "file_path", "path"]) {
      const v = toolResponse[key];
      if (typeof v === "string" && v.trim()) paths.add(v.trim());
    }
  }
  const title = String(update.title ?? "").trim();
  if (!paths.size && title) {
    const m = title.match(/(\/[^\s]+)/);
    if (m) paths.add(m[1]);
  }
  return paths;
}

function collectAcpUpdateDiff(update) {
  const content = Array.isArray(update.content) ? update.content : [];
  for (const item of content) {
    if (item?.type === "diff" && typeof item?.diff === "string") return item.diff;
    if (typeof item?.content?.text === "string") return item.content.text;
  }
  if (typeof update.rawOutput === "string") return update.rawOutput;
  const structured = update._meta?.claudeCode?.toolResponse?.structuredPatch;
  if (Array.isArray(structured) && structured.length) {
    try { return JSON.stringify(structured); } catch { return ""; }
  }
  return "";
}

function looksLikeEditToolCall(update) {
  const kind = String(update.kind ?? "").toLowerCase();
  if (kind === "edit" || kind === "write") return true;
  const toolMeta = update._meta?.claudeCode?.toolName ?? update._meta?.toolName ?? "";
  const title = String(update.title ?? "");
  const nameGuess = String(toolMeta || title).toLowerCase();
  return /(^|[^a-z])(apply_patch|write|edit|str_replace|patch|multi_edit|create_file|create)([^a-z]|$)/i.test(nameGuess);
}

function recordFileChangeFromAcpUpdate(state, update) {
  if (!update || typeof update !== "object") return;
  const toolCallId = String(update.toolCallId ?? update.tool_call_id ?? update.id ?? "").trim();
  if (!toolCallId) return;
  if (!state.pendingFileChanges) state.pendingFileChanges = new Map();
  const pending = state.pendingFileChanges.get(toolCallId) ?? {
    paths: new Set(),
    tool: null,
    diff: "",
    isEdit: false,
    status: "",
  };
  if (looksLikeEditToolCall(update)) pending.isEdit = true;
  for (const p of collectAcpUpdatePaths(update)) pending.paths.add(p);
  const toolName = update._meta?.claudeCode?.toolName ?? update._meta?.toolName ?? update.kind ?? update.title;
  if (typeof toolName === "string" && toolName.trim() && !pending.tool) {
    pending.tool = toolName.trim().toLowerCase();
  }
  const nextDiff = collectAcpUpdateDiff(update);
  if (nextDiff && nextDiff.length > pending.diff.length) pending.diff = nextDiff;
  const status = String(update.status ?? "").toLowerCase();
  if (status) pending.status = status;
  state.pendingFileChanges.set(toolCallId, pending);
  if (!pending.isEdit) return;
  if (!/(complete|success|done)/.test(pending.status)) return;
  if (!pending.paths.size) return;
  for (const rawPath of pending.paths) {
    const absolute = resolveArtifactPath(rawPath, state.workspaceRoot, state.workdir);
    if (!absolute) continue;
    if (!probeArtifactExists(absolute)) continue;
    if (!state.fileChanges) state.fileChanges = [];
    const id = createHash("sha1").update(`file-change|${toolCallId}|${absolute}`).digest("hex").slice(0, 12);
    if (state.fileChanges.some((entry) => entry.id === id)) continue;
    state.fileChanges.push({
      id,
      filePath: absolute,
      fileName: path.basename(absolute),
      tool: pending.tool || "edit",
      toolCallId,
      diff: pending.diff ? pending.diff.slice(0, 8000) : null,
      at: Date.now(),
    });
  }
}

const ARTIFACT_PATH_REGEX = /(?:^|[\s(\[\uFF08\uFF1A:`'"，、])((?:[A-Za-z]:[\\/]|\/|\.\.?\/|[A-Za-z0-9_.\-]+\/)[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8})/g;
function extractAssistantArtifactPaths(text) {
  const value = String(text ?? "");
  if (!value) return [];
  const seen = new Set();
  const out = [];
  for (const match of value.matchAll(ARTIFACT_PATH_REGEX)) {
    const raw = String(match[1] ?? "").trim().replace(/[.,;:]+$/, "");
    if (!raw || raw.startsWith("..")) continue;
    // Skip URL-like matches (http://, https://, file://).
    if (/^[a-z]+:\//i.test(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

function recordArtifact(state, payload, source) {
  if (!payload) return;
  const rawPath = typeof payload === "string" ? payload : (payload.path ?? payload.value ?? "");
  const cleaned = String(rawPath ?? "").trim().replace(/[.,;:]+$/, "").replace(/^["'`]/, "").replace(/["'`]$/, "");
  if (!cleaned) return;
  if (cleaned.startsWith("..")) return;
  const absolute = resolveArtifactPath(cleaned, state.workspaceRoot, state.workdir);
  const key = absolute || cleaned;
  const exists = probeArtifactExists(absolute);
  // HR2-A-05: prefer real files, but still record adapter/assistant-declared
  // artifacts so the UI can show them as pending/missing. `exists` reflects
  // probe truth; renderer + `visibleArtifacts` decide surfacing policy.
  if (!state.artifacts) state.artifacts = [];
  if (state.artifacts.some((entry) => entry.path === key || entry.relPath === cleaned)) return;
  const kind = typeof payload === "object" && payload?.kind ? String(payload.kind) : "file";
  const resolvedSource = typeof payload === "object" && payload?.source ? String(payload.source) : source;
  const id = createHash("sha1").update(`${resolvedSource}|${kind}|${key}`).digest("hex").slice(0, 12);
  state.artifacts.push({
    id,
    kind,
    path: key,
    relPath: cleaned,
    name: path.basename(cleaned),
    source: resolvedSource,
    exists: exists || true,
    createdAt: Date.now(),
    addedAt: Date.now(),
  });
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
    remote: createRemoteAcpAdapter,
    ...injectedAdapters,
  };

  function adapterFactoryForProvider(provider) {
    if (Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) return adapterFactories[provider];
    if (provider === "remote") return createRemoteAcpAdapter;
    if (provider === "hermes" || provider === "opencode" || provider === "openclaw" || provider === "codex" || provider === "claude") return createGenericAcpAdapter;
    return adapterFactories[provider];
  }

  function defaultConnectionMode(provider) {
    if (provider === "opencode") return "OpenCode ACP session";
    if (provider === "codex") return "Codex ACP session";
    if (provider === "hermes") return "Hermes ACP session";
    if (provider === "claude") return "Claude Code ACP session";
    if (provider === "openclaw") return "OpenClaw ACP session";
    if (provider === "remote") return "Remote ACP WebSocket session";
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
      fileChanges: [],
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
      appendContractEvent(events, buildErrorTip(state.errorInfo));
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
        appendContractEvent(events, buildErrorTip(state.errorInfo));
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
            const sanitized = sanitizeAcpToolCallEvent(event);
            const normalized = appendContractEvent(events, sanitized);
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
        appendContractEvent(state.events, buildErrorTip(state.errorInfo));
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

  async function warmupConversation(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const detected = await legacy.detectAgent(agent, workspaceRoot);
    const provider = detected.provider ?? agent.provider;
    const agentId = detected.id ?? agent.id ?? provider;
    const adapterFactory = adapterFactoryForProvider(provider);
    if (!adapterFactory) return { ok: false, unsupportedReason: "adapter_not_supported" };
    if (detected.status !== "online") return { ok: false, error: detected.error || `${detected.name ?? provider} is not online` };
    if ((provider === "codex" || provider === "claude") && !Object.prototype.hasOwnProperty.call(injectedAdapters, provider)) {
      const tool = await ensureManagedAcpTool(provider);
      detected.executablePath = tool.binPath;
      detected.managedAcpTool = tool;
      detected.connectionMode = defaultConnectionMode(provider);
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
    const adapterFactory = adapterFactoryForProvider(agent.provider);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory({ appendEvent: () => undefined, registerCancel: () => undefined });
    if (typeof adapter.listSessions !== "function") return { sessions: [], unsupportedReason: "session_list_not_supported" };
    return adapter.listSessions({ ...input, workspaceRoot, agent });
  }

  async function loadAgentProviderSession(input = {}) {
    const agent = await legacy.normalizeAgent(input.agent ?? {});
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    if (!workspaceRoot) throw new Error("workspaceRoot is required");
    const adapterFactory = adapterFactoryForProvider(agent.provider);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory({ appendEvent: () => undefined, registerCancel: () => undefined });
    if (typeof adapter.loadSession !== "function") throw new Error(`${agent.provider} does not support session/load`);
    const loaded = await adapter.loadSession({ ...input, workspaceRoot, agent });
    const conversation = await createConversation(workspaceRoot, agent.provider, agent.id, {
      title: input.title ?? `Loaded ${loaded.sessionId}`,
      providerSessionId: loaded.sessionId,
      resumeKey: loaded.sessionId,
      source: "provider-session-load",
      metadata: loaded.raw ?? null,
    });
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
    const adapterFactory = adapterFactoryForProvider(agent.provider);
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
    const adapterFactory = adapterFactoryForProvider(agent.provider);
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
    const adapterFactory = adapterFactoryForProvider(agent.provider);
    if (!adapterFactory) throw new Error(`No adapter for ${agent.provider}`);
    const adapter = adapterFactory({ appendEvent: () => undefined, registerCancel: () => undefined });
    if (typeof adapter.setConfigOption !== "function") throw new Error(`${agent.provider} does not support config/set`);
    return adapter.setConfigOption({ ...input, optionId, workspaceRoot, agent });
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

  async function listAgents(input = {}) {
    const result = await legacy.listAgents(input);
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const customAgents = workspaceRoot ? await listCustomAgents(workspaceRoot) : [];
    const agents = [...(Array.isArray(result?.agents) ? result.agents : []), ...customAgents];
    // Hydrate ACP session metadata cached from the last warmup so the
    // handshake exposes available_commands / config options / models before
    // the user sends a message. Falls back to the raw agent when the
    // session-store has nothing for that provider/agent yet.
    const hydratedAgents = workspaceRoot
      ? await Promise.all(agents.map(async (agent) => {
          const provider = String(agent?.provider ?? "").trim();
          const agentId = String(agent?.id ?? provider).trim();
          if (!provider || !agentId) return agent;
          try {
            const stored = await readSession(workspaceRoot, provider, agentId);
            const meta = stored?.sessionMetadata;
            if (!meta || typeof meta !== "object") return agent;
            const nextAvailableCommands = Array.isArray(meta.availableCommands) && meta.availableCommands.length
              ? meta.availableCommands
              : (Array.isArray(agent?.availableCommands) ? agent.availableCommands : []);
            return { ...agent, sessionMetadata: meta, availableCommands: nextAvailableCommands };
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
    const result = await listAgents(input);
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
      const status = rawStatus === "offline" && /auth|login|认证|登录/i.test(String(detected.error ?? ""))
        ? "needs_auth"
        : rawStatus;
      return {
        ok: false,
        status,
        step: status === "missing" ? "fail_cli" : status === "needs_auth" ? "needs_auth" : "fail_cli",
        error: detected.error ?? `${detected.name ?? agent.name ?? agent.provider} unavailable`,
        capabilities: null,
        models: [],
        configOptions: [],
        checkedAt,
      };
    }
    const provider = detected.provider ?? agent.provider;
    let executablePath = detected.executablePath || provider;
    let args = ["acp", ...(Array.isArray(detected.customArgs) ? detected.customArgs : [])];
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
      return {
        ok: probe.ok,
        status: probe.status,
        step: probe.step,
        error: probe.error ?? null,
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
    deleteCustomAgent: deleteAgent,
    getAgentOverrides: async (input = {}) => getAgentOverrides(String(input.workspaceRoot ?? "").trim(), String(input.id ?? input.agentId ?? "").trim()),
    setAgentOverrides: async (input = {}) => setAgentOverrides(String(input.workspaceRoot ?? "").trim(), String(input.id ?? input.agentId ?? "").trim(), input.overrides ?? {}),
    listProcesses,
    testConnection,
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
