import { spawn } from "node:child_process";
import net from "node:net";

import { injectPersonalAgentContext } from "../context-injection.mjs";
import { extractAcpSessionId, normalizeAcpSessionList, normalizeAcpUpdate, spawnAcpClient, textFromAcpContent } from "../acp-client.mjs";
import { readSession, writeSession } from "../session-store.mjs";
import { createExecHelpers, stringifyAgentCommand } from "../utils.mjs";
import { ensureProviderWorkdir } from "../workdir.mjs";

const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_CODEX_REASONING_EFFORT = "medium";
const OPENCLAW_DEFAULT_GATEWAY_PORT = 18789;
const COMPLETE_STOP_REASONS = new Set(["", "end_turn", "stop", "complete", "completed", "done", "success", "succeeded"]);
const TRUNCATED_STOP_REASONS = new Set(["max_tokens", "length", "token_limit", "context_length", "cancelled", "canceled", "interrupted", "error", "failed"]);

// Extract reasoning/thought text from an agent_message_chunk payload.
// Codex/Gemini variants may embed reasoning inline via content items with
// type "thought"/"reasoning" or role "reasoning" instead of using the dedicated
// agent_thought_chunk update. We split those off so they render as a thinking
// card rather than being concatenated into the assistant response.
function extractReasoningFromMessageChunk(data) {
  if (!data || typeof data !== "object") return { thought: "", messageData: data };
  const roleReasoning = typeof data.role === "string" && /^(reasoning|thought)$/i.test(data.role);
  const content = data.content;
  if (Array.isArray(content)) {
    const thoughtParts = [];
    const messageParts = [];
    for (const item of content) {
      if (item && typeof item === "object") {
        const kind = String(item.type ?? item.kind ?? "").toLowerCase();
        if (kind === "thought" || kind === "reasoning" || kind === "reasoning_delta") {
          const text = typeof item.text === "string" ? item.text : "";
          if (text) thoughtParts.push(text);
          continue;
        }
      }
      messageParts.push(item);
    }
    if (thoughtParts.length) {
      return {
        thought: thoughtParts.join(""),
        messageData: { ...data, content: messageParts },
      };
    }
    if (roleReasoning) {
      return { thought: "", messageData: { ...data, content: messageParts } };
    }
    return { thought: "", messageData: data };
  }
  if (roleReasoning) {
    // Entire chunk is a reasoning payload.
    return { thought: "", messageData: null, reasoningRole: true };
  }
  return { thought: "", messageData: data };
}

// Track streaming thinking chunks per msgId so we can (a) tag adapter events
// with cumulative durationMs and (b) emit a status:"done" boundary when the
// turn switches to real assistant output. Renderer merges by msgId, so the
// adapter does not need to concatenate text itself.
function createThinkingTracker(appendEvent) {
  const active = new Map();
  return {
    push({ text, data, msgId, status }) {
      if (!text) return;
      const key = msgId ?? "__default__";
      const now = Date.now();
      const entry = active.get(key) ?? { startedAt: now };
      active.set(key, entry);
      appendEvent({
        type: "thinking",
        text,
        data,
        status: status || "thinking",
        msgId: msgId ?? null,
        startedAt: entry.startedAt,
        durationMs: now - entry.startedAt,
      });
    },
    finishAll(reason) {
      const now = Date.now();
      for (const [key, entry] of active) {
        appendEvent({
          type: "thinking",
          text: "",
          data: { status: "done", reason: reason || "turn_boundary" },
          status: "done",
          msgId: key === "__default__" ? null : key,
          startedAt: entry.startedAt,
          durationMs: now - entry.startedAt,
        });
      }
      active.clear();
    },
    finishOnAssistant() {
      // Called on first real assistant_chunk of the turn to close any pending
      // thinking streams. Marks the boundary between reasoning stream
      // and final assistant text.
      if (active.size) this.finishAll("assistant_chunk");
    },
    finishOnBoundary(reason) {
      // Whitelist of side-channel events that end the reasoning stream:
      // any non-thinking / non-status side-channel event (tool_call, plan,
      // error, finish) ends the active reasoning stream and freezes durationMs
      // on the corresponding card.
      if (active.size) this.finishAll(reason || "non_thinking_event");
    },
    hasActive() {
      return active.size > 0;
    },
  };
}

// Split a raw thought text into subject/description parts used by the
// transient hover indicator ({subject,
// description}). Subject is the first non-empty line (bounded to 80 chars);
// description is any remainder text.
function deriveThoughtHint(text) {
  const raw = typeof text === "string" ? text : "";
  const trimmed = raw.replace(/\s+$/g, "");
  if (!trimmed) return null;
  const newlineIdx = trimmed.indexOf("\n");
  let subject;
  let description = "";
  if (newlineIdx >= 0) {
    subject = trimmed.slice(0, newlineIdx).trim();
    description = trimmed.slice(newlineIdx + 1).trim();
  } else {
    subject = trimmed.trim();
  }
  if (subject.length > 80) {
    if (!description) description = subject.slice(80).trim();
    subject = subject.slice(0, 80).trim();
  }
  if (!subject) return null;
  return { subject, description };
}

function acpArgsForProvider(provider, ctx, workdir) {
  if (ctx.agent.managedAcpTool) return [...(ctx.agent.customArgs ?? [])];
  if (provider === "opencode") return ["acp", "--cwd", workdir, ...(ctx.agent.customArgs ?? [])];
  return ["acp", ...(ctx.agent.customArgs ?? [])];
}

function normalizeModelId(provider, value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (provider === "codex") {
    if (/^[^\[]+\[[^\]]+]$/.test(text)) return text;
    return `${text}[${DEFAULT_CODEX_REASONING_EFFORT}]`;
  }
  if (provider === "hermes" && !text.includes(":")) {
    const slash = text.indexOf("/");
    if (slash > 0 && slash < text.length - 1) return `${text.slice(0, slash)}:${text.slice(slash + 1)}`;
  }
  return text;
}

function acpFailureCode(provider, message) {
  const text = String(message ?? "");
  if (provider === "codex" && /Unsupported format of modelId|Expected: modelId\[effort\]|set_model/i.test(text)) return "codex_acp_model_format";
  if (provider === "codex" && /set_mode|modeId|mode/i.test(text)) return "codex_acp_mode_failed";
  if (/did not finish cleanly|incomplete output/i.test(text)) return "acp_incomplete_output";
  if (/conversation interrupted/i.test(text)) return "acp_bridge_interrupted";
  if (/tool call failed/i.test(text)) return "acp_tool_failed";
  return null;
}

function acpFailureError(provider, code, message) {
  /** @type {Error & { code?: string, provider?: string }} */
  const error = new Error(message);
  error.code = code;
  error.provider = provider;
  return error;
}

function acpPromptStopReason(result) {
  const direct = textValue(result?.stopReason ?? result?.stop_reason ?? result?.reason ?? result?.finishReason ?? result?.finish_reason).toLowerCase();
  if (direct) return direct;
  if (!result || typeof result !== "object") return "";
  return textValue(result?.result?.stopReason ?? result?.result?.stop_reason ?? result?.turn?.stopReason ?? result?.turn?.stop_reason).toLowerCase();
}

function extractAcpSessionMetadata(source) {
  if (!source || typeof source !== "object") return null;
  const modelsBlock = source.models && typeof source.models === "object" ? source.models : source;
  const availableModelsRaw = Array.isArray(source.availableModels)
    ? source.availableModels
    : Array.isArray(modelsBlock?.availableModels)
      ? modelsBlock.availableModels
      : Array.isArray(source.available_models)
        ? source.available_models
        : [];
  const availableModels = availableModelsRaw
    .map((item) => {
      if (!item || typeof item !== "object") {
        const id = textValue(item);
        return id ? { id, name: id } : null;
      }
      const id = textValue(item.id ?? item.modelId ?? item.model_id ?? item.name);
      if (!id) return null;
      return { id, name: textValue(item.name ?? item.label ?? item.displayName) || id };
    })
    .filter(Boolean);
  const currentModelId = textValue(
    source.currentModelId ?? source.current_model_id ?? modelsBlock?.currentModelId ?? modelsBlock?.current_model_id,
  ) || null;
  const configOptions = Array.isArray(source.configOptions)
    ? source.configOptions
    : Array.isArray(source.config_options)
      ? source.config_options
      : [];
  const modes = Array.isArray(source.modes)
    ? source.modes
    : Array.isArray(source.availableModes)
      ? source.availableModes
      : Array.isArray(source.available_modes)
        ? source.available_modes
        : source.modes && typeof source.modes === "object"
          ? source.modes
          : null;
  const availableCommands = Array.isArray(source.availableCommands)
    ? source.availableCommands
    : Array.isArray(source.available_commands)
      ? source.available_commands
      : [];
  if (!availableModels.length && !configOptions.length && !availableCommands.length && !currentModelId && !modes) {
    return null;
  }
  return { availableModels, currentModelId, configOptions, modes, availableCommands };
}

function assertAcpPromptCompleted(provider, promptResult) {
  const stopReason = acpPromptStopReason(promptResult);
  // Faithfully read stopReason from the ACP session/prompt response instead of
  // guessing from content shape. We never inspect the assistant text with
  // regex heuristics, and we never auto-continue: a truncated turn is reported
  // as `acp_incomplete_output` and shown to the user as-is.
  if (TRUNCATED_STOP_REASONS.has(stopReason) || (stopReason && !COMPLETE_STOP_REASONS.has(stopReason))) {
    return { ok: false, code: "acp_incomplete_output", stopReason, message: `${provider} ACP reply did not finish cleanly: stopReason=${stopReason}` };
  }
  return { ok: true, stopReason };
}

function textValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function acpToolDescription(data) {
  const rawInput = data?.rawInput ?? data?.raw_input ?? data?.input ?? {};
  if (!rawInput || typeof rawInput !== "object") return textValue(data?.kind ?? data?.title ?? data?.name);
  return textValue(rawInput.command ?? rawInput.file_path ?? rawInput.path ?? rawInput.pattern ?? rawInput.query ?? data?.kind);
}

function acpToolOutput(data) {
  if (Array.isArray(data?.content)) return textFromAcpContent(data.content);
  return textFromAcpContent(data?.output ?? data?.result ?? data?.rawOutput ?? data?.content);
}

const TOOL_EVENT_TEXT_PREVIEW_CHARS = 4000;
const TOOL_EVENT_DELTA_PREVIEW_CHARS = 4000;

function previewString(value, limit = TOOL_EVENT_TEXT_PREVIEW_CHARS) {
  const text = textValue(value);
  if (!text || text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}\n...`, truncated: true };
}

function sanitizeToolCallUpdateForStorage(data) {
  if (!data || typeof data !== "object") return data;
  const next = { ...data };
  const meta = data._meta && typeof data._meta === "object" ? { ...data._meta } : null;
  const terminalDelta = meta?.terminal_output_delta;
  if (terminalDelta && typeof terminalDelta === "object") {
    const preview = previewString(terminalDelta.data, TOOL_EVENT_DELTA_PREVIEW_CHARS);
    meta.terminal_output_delta = {
      ...terminalDelta,
      data: preview.text,
      truncated: Boolean(terminalDelta.truncated) || preview.truncated,
    };
    next._meta = meta;
  }
  return next;
}

function acpToolCallFromUpdate(type, data) {
  const id = textValue(data?.tool_call_id ?? data?.toolCallId ?? data?.id);
  if (!id) return null;
  const rawInput = data?.rawInput ?? data?.raw_input ?? data?.input ?? null;
  return {
    id,
    name: textValue(data?.title ?? data?.name) || "tool",
    kind: textValue(data?.kind),
    status: textValue(data?.status ?? data?.state) || (type === "tool_call_update" ? "completed" : "running"),
    description: acpToolDescription(data),
    input: rawInput && typeof rawInput === "object" ? JSON.stringify(rawInput, null, 2) : textValue(rawInput),
    output: type === "tool_call_update" ? acpToolOutput(data) : "",
  };
}

function shouldResumeProviderSession(provider, ctx, stored) {
  if (provider === "hermes") return false;
  if (provider !== "codex") return true;
  if (stored?.health === "unhealthy") return false;
  if (ctx.providerSessionId || ctx.resumeKey) return true;
  return false;
}

function normalizeExplicitSessionId(provider, value) {
  const text = String(value ?? "").trim();
  if (provider === "hermes" && text && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return "";
  return text;
}

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForPort(port, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function ensureOpenClawGateway({ executablePath, workdir, env, appendEvent }) {
  if (await isPortOpen(OPENCLAW_DEFAULT_GATEWAY_PORT)) return null;
  appendEvent({ type: "status", text: `OpenClaw gateway not listening on ${OPENCLAW_DEFAULT_GATEWAY_PORT}; starting local gateway for ACP.` });
  const child = spawn(executablePath, ["gateway", "run", "--force", "--auth", "none", "--bind", "loopback", "--port", String(OPENCLAW_DEFAULT_GATEWAY_PORT), "--allow-unconfigured"], {
    cwd: workdir,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.unref?.();
  appendEvent({ type: "log", text: `openclaw gateway pid ${child.pid ?? "unknown"}` });
  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) appendEvent({ type: "log", text: `openclaw-gateway> ${text.slice(0, 2000)}` });
  });
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) appendEvent({ type: "log", text: `openclaw-gateway stderr> ${text.slice(0, 2000)}` });
  });
  const ready = await waitForPort(OPENCLAW_DEFAULT_GATEWAY_PORT);
  if (!ready) {
    child.kill("SIGTERM");
    await waitForExit(child, 2_000);
    throw new Error(`OpenClaw gateway did not become ready on 127.0.0.1:${OPENCLAW_DEFAULT_GATEWAY_PORT}`);
  }
  appendEvent({ type: "status", text: "OpenClaw gateway started for ACP." });
  return child;
}

function isPlanningMode(collaborationMode) {
  if (!collaborationMode || typeof collaborationMode !== "object") return false;
  if (collaborationMode.kind === "plan") return true;
  return Boolean(collaborationMode.planning);
}

function codexModeForApprovalMode(approvalMode, collaborationMode = null) {
  if (isPlanningMode(collaborationMode)) return "plan";
  if (approvalMode === "auto") return "agent-full-access";
  if (approvalMode === "read-only-auto") return "read-only";
  return "agent";
}

function supportsSessionSetModel(provider) {
  return provider !== "claude" && provider !== "openclaw";
}

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    timer.unref?.();
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Kill the whole process tree, not just the direct child. On non-Windows the
// child was spawned detached (its own process group), so a
// negative pid signals every process in that group — the ACP bridge plus any
// agent CLI it forked. Escalate SIGTERM → SIGKILL. Windows uses taskkill /T /F.
async function terminateProcessTree(child, { graceMs = 1_000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    if (pid) {
      try {
        spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } catch {
        child.kill("SIGKILL");
      }
    }
    await waitForExit(child, graceMs + 2_000);
    return;
  }
  const killGroup = (signal) => {
    if (!pid) return child.kill(signal);
    try {
      process.kill(-pid, signal);
    } catch {
      // Process group already gone, or child was not a group leader; fall back
      // to signalling the direct child.
      try {
        child.kill(signal);
      } catch {
        // Already exited.
      }
    }
  };
  killGroup("SIGTERM");
  await Promise.race([
    waitForExit(child, graceMs),
    new Promise((resolve) => setTimeout(resolve, graceMs).unref?.()),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    killGroup("SIGKILL");
    await waitForExit(child, 2_000);
  }
}

function acpPermissionKind(params = {}) {
  const text = JSON.stringify(params).toLowerCase();
  if (/bash|shell|command|execute|exec/.test(text)) return "command";
  if (/write|edit|patch|delete|remove|rename|move|file/.test(text)) return "file_change";
  if (/mcp/.test(text)) return "mcp";
  if (/permission|approval|approve/.test(text)) return "permissions";
  return "unknown";
}

function isReadOnlyPermission(params = {}) {
  const text = JSON.stringify(params).toLowerCase();
  if (/write|edit|patch|delete|remove|rename|move|mkdir|touch|>|sudo|kill|rm\s/.test(text)) return false;
  return /read|list|ls|cat|grep|rg|find|pwd|view|inspect/.test(text);
}

function permissionDecisionPayload(params, decision) {
  const options = Array.isArray(params?.options) ? params.options : [];
  const normalized = String(decision ?? "decline");
  const patterns = normalized === "acceptForSession"
    ? [/session/i, /always/i, /approve.*session/i]
    : normalized === "accept"
      ? [/approve/i, /allow/i, /accept/i]
      : [/reject/i, /deny/i, /decline/i];
  for (const pattern of patterns) {
    const found = options.find((option) => pattern.test(String(option?.optionId ?? option?.id ?? option?.label ?? "")));
    if (found) return { optionId: found.optionId ?? found.id ?? found.label };
  }
  return { decision: normalized === "acceptForSession" ? "accept" : normalized };
}

async function withAcpSessionClient(ctx, appendEvent, operation) {
  const provider = ctx.agent.provider;
  const executablePath = ctx.agent.managedAcpTool?.binPath || ctx.agent.executablePath || provider;
  const workdir = await ensureProviderWorkdir(ctx.workspaceRoot, provider, ctx.agent.id);
  const args = acpArgsForProvider(provider, ctx, workdir);
  const env = createExecHelpers().processEnv({ PWD: workdir });
  const ownedProcesses = [];
  if (provider === "openclaw") {
    const gateway = await ensureOpenClawGateway({ executablePath, workdir, env, appendEvent });
    if (gateway) ownedProcesses.push(gateway);
  }
  const { child, client } = spawnAcpClient({ command: executablePath, args, cwd: workdir, env, detached: true, appendEvent });
  child.unref?.();
  try {
    const initialized = await client.initialize();
    return await operation({ provider, workdir, client, initialized, child });
  } finally {
    client.dispose();
    await terminateProcessTree(child);
    for (const owned of ownedProcesses) await terminateProcessTree(owned, { graceMs: 2_000 });
  }
}

function acpSessionCapability(initialized, name) {
  const capabilities = initialized?.agentCapabilities ?? initialized?.capabilities ?? {};
  const sessionCapabilities = capabilities.sessionCapabilities ?? capabilities.session_capabilities ?? capabilities.sessions ?? {};
  if (name === "load") return Boolean(capabilities.loadSession ?? capabilities.load_session ?? sessionCapabilities.load);
  return Boolean(sessionCapabilities[name]);
}

function requireAcpSessionCapability(initialized, name, method) {
  if (acpSessionCapability(initialized, name)) return;
  throw new Error(`${method} is not supported by this ACP agent`);
}

function conversationMessagesFromLoadResult(result) {
  const raw = Array.isArray(result?.messages) ? result.messages : Array.isArray(result?.conversation?.messages) ? result.conversation.messages : [];
  return raw.map((message, index) => ({
    id: textValue(message?.id) || `loaded-${index + 1}`,
    type: textValue(message?.type) || "text",
    role: textValue(message?.role) || "assistant",
    text: textFromAcpContent(message?.text ?? message?.content ?? message),
    createdAt: Number(message?.createdAt ?? message?.created_at) || Date.now(),
    metadata: message?.metadata && typeof message.metadata === "object" ? message.metadata : null,
  })).filter((message) => message.text || message.type !== "text");
}

export function createGenericAcpAdapter({ appendEvent, registerCancel }) {
  const execHelpers = createExecHelpers();
  const active = new Map();
  async function createOrResumeSession(ctx, client, workdir, provider) {
    let sessionId = "";
    let sessionMetadata = extractAcpSessionMetadata(await client.initialize()) ?? null;
    const stored = await readSession(ctx.workspaceRoot, provider, ctx.agent.id);
    const explicitSessionId = normalizeExplicitSessionId(provider, ctx.resumeKey ?? ctx.providerSessionId);
    const storedSessionId = shouldResumeProviderSession(provider, ctx, stored) ? String(explicitSessionId || stored.sessionId || "").trim() : "";
    const modelId = normalizeModelId(provider, ctx.model);
    if (storedSessionId) {
      try {
        const resumed = await client.resumeSession(storedSessionId, { cwd: workdir, ...(modelId ? { model: modelId } : {}) });
        sessionId = extractAcpSessionId(resumed) || storedSessionId;
        sessionMetadata = extractAcpSessionMetadata(resumed) ?? sessionMetadata;
        appendEvent({ type: "log", text: `${provider} ACP session resumed ${sessionId}` });
      } catch (error) {
        appendEvent({ type: "log", text: `${provider} ACP resume failed; creating new session: ${error.message}` });
      }
    }
    if (!sessionId) {
      const created = await client.createSession({ cwd: workdir, mcpServers: [], ...(modelId ? { model: modelId } : {}) });
      sessionId = extractAcpSessionId(created);
      if (!sessionId) throw new Error(`${provider} ACP session/new returned no sessionId`);
      sessionMetadata = extractAcpSessionMetadata(created) ?? sessionMetadata;
      appendEvent({ type: "log", text: `${provider} ACP session created ${sessionId}` });
    }
    if (sessionMetadata) appendEvent({ type: "status", text: `acp_session_metadata> ${JSON.stringify(sessionMetadata)}` });
    if (provider === "codex") {
      const modeId = codexModeForApprovalMode(ctx.approvalMode, ctx.collaborationMode);
      await client.request("session/set_mode", { sessionId, modeId }).catch((error) => {
        const message = `${provider} ACP set_mode failed: ${error.message}`;
        appendEvent({ type: "error", text: message });
        throw acpFailureError(provider, acpFailureCode(provider, message) ?? "codex_acp_mode_failed", message);
      });
      appendEvent({ type: "status", text: `${provider} ACP mode ${modeId}` });
    }
    if (modelId && supportsSessionSetModel(provider)) {
      await client.request("session/set_model", { sessionId, modelId }).catch((error) => {
        const message = `${provider} ACP set_model failed: ${error.message}`;
        appendEvent({ type: "error", text: message });
        throw acpFailureError(provider, acpFailureCode(provider, message) ?? "acp_model_set_failed", message);
      });
    } else if (modelId) {
      appendEvent({ type: "status", text: `${provider} ACP set_model skipped: model is passed during session create/resume` });
    }
    await writeSession(ctx.workspaceRoot, provider, ctx.agent.id, { sessionId, workdir, health: "healthy", updatedAt: Date.now() });
    return { sessionId, sessionMetadata, modelId };
  }

  return {
    provider: "acp",
    async warmupConversation(ctx) {
      const provider = ctx.agent.provider;
      const executablePath = ctx.agent.managedAcpTool?.binPath || ctx.agent.executablePath || provider;
      const workdir = await ensureProviderWorkdir(ctx.workspaceRoot, provider, ctx.agent.id);
      await injectPersonalAgentContext({ workdir, provider, workspaceRoot: ctx.workspaceRoot, accessibleWorkspaceRoots: ctx.accessibleWorkspaceRoots });
      const args = acpArgsForProvider(provider, ctx, workdir);
      const env = execHelpers.processEnv({ PWD: workdir });
      const { child, client } = spawnAcpClient({ command: executablePath, args, cwd: workdir, env, detached: true, appendEvent });
      child.unref?.();
      try {
        const { sessionId, sessionMetadata } = await createOrResumeSession(ctx, client, workdir, provider);
        return { ok: true, sessionId, providerSessionId: sessionId, resumeKey: sessionId, workdir, sessionMetadata };
      } finally {
        client.dispose();
        await terminateProcessTree(child);
      }
    },
    async listSessions(ctx) {
      return withAcpSessionClient(ctx, appendEvent, async ({ client, workdir, initialized }) => {
        requireAcpSessionCapability(initialized, "list", "session/list");
        const listed = await client.listSessions({ cwd: workdir });
        return { sessions: normalizeAcpSessionList(listed), raw: listed };
      });
    },
    async loadSession(ctx) {
      const sessionId = textValue(ctx.sessionId ?? ctx.providerSessionId ?? ctx.resumeKey);
      if (!sessionId) throw new Error("sessionId is required");
      return withAcpSessionClient(ctx, appendEvent, async ({ client, workdir, initialized }) => {
        requireAcpSessionCapability(initialized, "load", "session/load");
        const loaded = await client.loadSession(sessionId, { cwd: workdir });
        const loadedSessionId = extractAcpSessionId(loaded) || sessionId;
        return {
          sessionId: loadedSessionId,
          providerSessionId: loadedSessionId,
          conversationMessages: conversationMessagesFromLoadResult(loaded),
          raw: loaded,
        };
      });
    },
    async closeSession(ctx) {
      const sessionId = textValue(ctx.sessionId ?? ctx.providerSessionId ?? ctx.resumeKey);
      if (!sessionId) throw new Error("sessionId is required");
      return withAcpSessionClient(ctx, appendEvent, async ({ client, initialized }) => {
        requireAcpSessionCapability(initialized, "close", "session/close");
        const result = await client.closeSession(sessionId);
        return { ok: true, sessionId, raw: result };
      });
    },
    async forkSession(ctx) {
      const sessionId = textValue(ctx.sessionId ?? ctx.providerSessionId ?? ctx.resumeKey);
      if (!sessionId) throw new Error("sessionId is required");
      return withAcpSessionClient(ctx, appendEvent, async ({ client, initialized }) => {
        requireAcpSessionCapability(initialized, "fork", "session/fork");
        const forked = await client.forkSession(sessionId, { messageId: ctx.messageId ?? ctx.msgId ?? null });
        const forkedSessionId = extractAcpSessionId(forked);
        if (!forkedSessionId) throw new Error("session/fork returned no sessionId");
        return { sessionId: forkedSessionId, providerSessionId: forkedSessionId, raw: forked };
      });
    },
    async setConfigOption(ctx) {
      const optionId = textValue(ctx.optionId ?? ctx.configOptionId ?? ctx.id);
      if (!optionId) throw new Error("optionId is required");
      return withAcpSessionClient(ctx, appendEvent, async ({ client, workdir }) => {
        let sessionId = textValue(ctx.sessionId ?? ctx.providerSessionId ?? ctx.resumeKey);
        if (!sessionId) {
          const created = await client.createSession({ cwd: workdir });
          sessionId = extractAcpSessionId(created);
        }
        if (!sessionId) throw new Error("config/set requires an ACP sessionId");
        const result = await client.setConfigOption(sessionId, optionId, ctx.value, { cwd: workdir });
        const configOptions = Array.isArray(result?.configOptions)
          ? result.configOptions
          : Array.isArray(result?.config_options)
            ? result.config_options
            : [];
        return {
          ok: true,
          sessionId,
          optionId,
          value: ctx.value,
          confirmation: textValue(result?.confirmation ?? result?.message) || null,
          configOptions,
          raw: result,
        };
      });
    },
    async sendMessage(ctx) {
      const provider = ctx.agent.provider;
      const executablePath = ctx.agent.managedAcpTool?.binPath || ctx.agent.executablePath || provider;
      const workdir = await ensureProviderWorkdir(ctx.workspaceRoot, provider, ctx.agent.id);
      await injectPersonalAgentContext({ workdir, provider, workspaceRoot: ctx.workspaceRoot, accessibleWorkspaceRoots: ctx.accessibleWorkspaceRoots });
      const args = acpArgsForProvider(provider, ctx, workdir);
      const command = stringifyAgentCommand(executablePath, args);
      const env = execHelpers.processEnv({ PWD: workdir });
      const outputParts = [];
      const failedToolUpdates = [];
      let sessionId = "";
      const ownedProcesses = [];
      if (provider === "openclaw") {
        const gateway = await ensureOpenClawGateway({ executablePath, workdir, env, appendEvent });
        if (gateway) ownedProcesses.push(gateway);
      }
      const thinking = createThinkingTracker(appendEvent);
      const { child, client } = spawnAcpClient({
        command: executablePath,
        args,
        cwd: workdir,
        env,
        detached: true,
        appendEvent,
        onNotification: (params) => {
          const { type, data } = normalizeAcpUpdate(params.update ?? params);
          if (type === "agent_message_chunk") {
            const reasoning = extractReasoningFromMessageChunk(data);
            if (reasoning.thought) {
              const msgIdReasoning = data?.msg_id ?? data?.msgId ?? null;
              const hint = deriveThoughtHint(reasoning.thought);
              if (hint) appendEvent({ type: "thought", text: hint.subject, subject: hint.subject, description: hint.description, msgId: msgIdReasoning });
              thinking.push({
                text: reasoning.thought,
                data,
                msgId: msgIdReasoning,
                status: textValue(data?.status) || "thinking",
              });
            }
            const messageData = reasoning.reasoningRole ? null : reasoning.messageData ?? data;
            const text = messageData ? textFromAcpContent(messageData) : "";
            if (text) {
              // Real assistant text begins: close any pending thinking streams.
              thinking.finishOnAssistant();
              outputParts.push(text);
              appendEvent({ type: "assistant_chunk", text });
            }
            return;
          }
          if (type === "agent_thought_chunk") {
            const text = textFromAcpContent(data);
            if (text) {
              const msgIdT = data?.msg_id ?? data?.msgId ?? null;
              const hint = deriveThoughtHint(text);
              if (hint) appendEvent({ type: "thought", text: hint.subject, subject: hint.subject, description: hint.description, msgId: msgIdT });
              thinking.push({
                text,
                data,
                msgId: msgIdT,
                status: textValue(data?.status) || "thinking",
              });
            }
            return;
          }
          if (type === "plan") {
            thinking.finishOnBoundary("plan");
            appendEvent({ type: "plan", text: textFromAcpContent(data), data, plan: data });
            return;
          }
          if (type === "thinking") {
            const status = textValue(data?.status) || "thinking";
            const text = textFromAcpContent(data);
            if (status === "done" || status === "completed") {
              // Provider explicitly reports thinking-done — flush via tracker
              // so we emit a consistent boundary event with durationMs.
              thinking.finishAll("provider_done");
            } else if (text) {
              thinking.push({
                text,
                data,
                msgId: data?.msg_id ?? data?.msgId ?? null,
                status,
              });
            }
            return;
          }
          if (type === "tool_call" || type === "tool_call_update") {
            thinking.finishOnBoundary(type);
            const storedUpdate = sanitizeToolCallUpdateForStorage(data);
            const textPreview = previewString(textFromAcpContent(storedUpdate) || JSON.stringify(storedUpdate ?? {}));
            const toolText = textPreview.text;
            const toolCall = acpToolCallFromUpdate(type, data);
            appendEvent({
              type: "acp_tool_call",
              text: toolText,
              truncated: textPreview.truncated,
              update: storedUpdate,
              msgId: data?.msg_id ?? data?.msgId ?? null,
            });
            if (!toolCall?.id) appendEvent({ type: "tool", text: `acp_${type}> ${toolText}`, toolCall });
            if (type === "tool_call_update" && String(data?.status ?? "").toLowerCase() === "failed") {
              failedToolUpdates.push(toolText);
            }
          }
          if (type === "available_commands") appendEvent({ type: "status", text: `acp_available_commands> ${JSON.stringify(data?.commands ?? data?.availableCommands ?? data ?? [])}` });
          if (type === "context_usage" || type === "usage_update") appendEvent({ type: "status", text: `acp_${type}> ${JSON.stringify(data ?? {})}` });
          if (type === "error") { thinking.finishOnBoundary("error"); appendEvent({ type: "error", text: textFromAcpContent(data) || JSON.stringify(data ?? {}) }); }
        },
        onRequest: async (message, client) => {
          const method = String(message.method ?? "");
          if (method !== "session/request_permission" && method !== "permission/request") {
            client.rejectRequest(message.id, -32601, `method not found: ${method}`);
            return;
          }
          const params = message.params ?? {};
          const readonly = isReadOnlyPermission(params);
          let decision = "decline";
          if (ctx.approvalMode === "auto" || (ctx.approvalMode === "read-only-auto" && readonly)) {
            decision = "accept";
          } else if (typeof ctx.requestApproval === "function") {
            const approval = await ctx.requestApproval({
              id: params.id ?? message.id,
              method,
              kind: acpPermissionKind(params),
              title: String(params.title ?? params.toolName ?? params.permission ?? "ACP 权限请求"),
              summary: String(params.summary ?? params.description ?? params.command ?? params.toolName ?? "ACP Agent 请求继续执行受限操作。"),
              command: params.command ?? params.input?.command ?? null,
              cwd: params.cwd ?? params.input?.cwd ?? workdir,
              readonly,
              params,
            });
            decision = approval?.decision ?? "decline";
          }
          client.respond(message.id, permissionDecisionPayload(params, decision));
        },
      });
      child.unref?.();
      if (ctx.runId) active.set(ctx.runId, child);
      registerCancel?.(async () => {
        await terminateProcessTree(child);
        if (ctx.runId) active.delete(ctx.runId);
      });

      try {
        const warm = await createOrResumeSession(ctx, client, workdir, provider);
        sessionId = warm.sessionId;
        const sessionMetadata = warm.sessionMetadata;
        const modelId = warm.modelId;
        // One turn = one ACP session/prompt request/response. We faithfully read
        // `stopReason` and never guess truncation from text or auto-continue.
        const promptResult = await client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: ctx.prompt }] }, DEFAULT_TURN_TIMEOUT_MS);
        thinking.finishAll("turn_end");
        const output = outputParts.join("").trim();
        const completion = assertAcpPromptCompleted(provider, promptResult);
        if (/\*?conversation interrupted\*?/i.test(output)) {
          const detail = failedToolUpdates.at(-1) ?? "ACP session reported conversation interrupted";
          await writeSession(ctx.workspaceRoot, provider, ctx.agent.id, { sessionId, workdir, health: "unhealthy", lastFailureCode: "acp_bridge_interrupted", lastFailure: detail, updatedAt: Date.now() });
          throw acpFailureError(provider, "acp_bridge_interrupted", `${provider} ACP conversation interrupted. ${detail}`);
        }
        if (failedToolUpdates.length) {
          const detail = failedToolUpdates.at(-1);
          const code = /"exit_code"\s*:\s*null|terminal_exit/i.test(detail ?? "") ? "acp_bridge_interrupted" : "acp_tool_failed";
          await writeSession(ctx.workspaceRoot, provider, ctx.agent.id, { sessionId, workdir, health: "unhealthy", lastFailureCode: code, lastFailure: detail, updatedAt: Date.now() });
          if (output) {
            appendEvent({ type: "status", text: `${provider} ACP reported a failed tool after assistant output; preserving the assistant response.` });
          } else {
            throw acpFailureError(provider, code, `${provider} ACP tool call failed. ${detail}`);
          }
        }
        if (!output) throw new Error(`${provider} ACP completed without assistant text`);
        if (!completion.ok) {
          // Truncated output is preserved and shown as-is; the incomplete-output
          // warning lets the frontend render a truncation indicator.
          appendEvent({ type: "status", text: completion.message });
        }
        return {
          output,
          stopReason: completion.stopReason || "",
          truncated: !completion.ok,
          command: [command, `sessionID=${sessionId}`, `cwd=${workdir}`, modelId ? `model=${modelId}` : "model=<default>"].join("\n"),
          connectionMode: `${ctx.agent.name || provider} ACP session`,
          providerSessionId: sessionId,
          resumeKey: sessionId,
          sessionId,
          sessionMetadata,
          workdir,
          pid: child.pid ?? null,
          metadata: {
            agent_type: "acp",
            provider,
            connectionMode: `${ctx.agent.name || provider} ACP session`,
            managedAcpTool: ctx.agent.managedAcpTool ?? null,
            stopReason: completion.stopReason || null,
            truncated: !completion.ok,
            sessionMetadata: sessionMetadata ?? null,
          },
        };
      } finally {
        if (ctx.runId) active.delete(ctx.runId);
        client.dispose();
        // Tear down the entire ACP process tree so no agent CLI is orphaned
        // when the turn ends.
        await terminateProcessTree(child);
        for (const owned of ownedProcesses) {
          await terminateProcessTree(owned, { graceMs: 2_000 });
        }
      }
    },
    async cancel(ctx) {
      const child = active.get(ctx.runId);
      if (!child) throw new Error("ACP run is not active");
      await terminateProcessTree(child);
      active.delete(ctx.runId);
    },
  };
}

export const __test__ = {
  extractReasoningFromMessageChunk,
  createThinkingTracker,
  deriveThoughtHint,
  normalizeModelId,
  shouldResumeProviderSession,
  normalizeExplicitSessionId,
  acpFailureCode,
  codexModeForApprovalMode,
  isPlanningMode,
  supportsSessionSetModel,
  acpPromptStopReason,
  assertAcpPromptCompleted,
  extractAcpSessionMetadata,
  createGenericAcpAdapterForTest: createGenericAcpAdapter,
};
