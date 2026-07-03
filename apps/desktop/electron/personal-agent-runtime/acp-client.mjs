import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

function textValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

export function extractAcpSessionId(result) {
  const direct = textValue(result?.sessionId ?? result?.session_id ?? result?.id);
  if (direct) return direct;
  if (!result || typeof result !== "object") return "";
  const queue = [result];
  const seen = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const nested = textValue(item.sessionId ?? item.session_id ?? item.session?.sessionId ?? item.session?.session_id ?? item.session?.id);
    if (nested) return nested;
    for (const value of Object.values(item)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return "";
}

export function normalizeAcpUpdate(update) {
  if (!update || typeof update !== "object") return { type: "", data: update };
  const key = textValue(update.sessionUpdate ?? update.type ?? update.kind).toLowerCase().replace(/[-_]/g, "");
  const mapped = {
    agentmessagechunk: "agent_message_chunk",
    agentthoughtchunk: "agent_thought_chunk",
    thought: "agent_thought_chunk",
    thoughtchunk: "agent_thought_chunk",
    reasoning: "agent_thought_chunk",
    reasoningchunk: "agent_thought_chunk",
    reasoningdelta: "agent_thought_chunk",
    toolcall: "tool_call",
    toolcallupdate: "tool_call_update",
    toolcallcomplete: "tool_call_update",
    plan: "plan",
    planupdate: "plan",
    thinking: "thinking",
    thinkingupdate: "thinking",
    usageupdate: "usage_update",
    turnend: "turn_end",
    endturn: "turn_end",
    availablecommands: "available_commands",
    contextusage: "context_usage",
    command: "command",
    permission: "permission",
    permissionrequest: "permission_request",
    requestpermission: "permission_request",
    sessionrequestpermission: "permission_request",
    error: "error",
  }[key];
  if (mapped) return { type: mapped, data: update };
  const keys = Object.keys(update);
  if (keys.length === 1) {
    const wrapped = update[keys[0]];
    return normalizeAcpUpdate({ sessionUpdate: keys[0], ...(wrapped && typeof wrapped === "object" ? wrapped : { value: wrapped }) });
  }
  return { type: "", data: update };
}

export function textFromAcpContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromAcpContent).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.content?.text === "string") return value.content.text;
  if (Array.isArray(value.content)) return textFromAcpContent(value.content);
  return textFromAcpContent(value.content ?? value.output ?? value.result ?? value.data);
}

export function normalizeAcpSessionInfo(value) {
  if (!value || typeof value !== "object") {
    const id = textValue(value);
    return id ? { id, sessionId: id, title: id } : null;
  }
  const sessionId = textValue(value.sessionId ?? value.session_id ?? value.id);
  if (!sessionId) return null;
  const createdAt = Number(value.createdAt ?? value.created_at) || null;
  const updatedAt = Number(value.updatedAt ?? value.updated_at ?? value.lastUpdatedAt ?? value.last_updated_at) || null;
  return {
    id: sessionId,
    sessionId,
    title: textValue(value.title ?? value.name ?? value.label) || sessionId,
    cwd: textValue(value.cwd ?? value.workdir ?? value.workspaceRoot) || null,
    createdAt,
    updatedAt,
    metadata: value.metadata && typeof value.metadata === "object" ? value.metadata : null,
  };
}

export function normalizeAcpSessionList(result) {
  const raw = Array.isArray(result)
    ? result
    : Array.isArray(result?.sessions)
      ? result.sessions
      : Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result?.result?.sessions)
          ? result.result.sessions
          : [];
  return raw.map(normalizeAcpSessionInfo).filter(Boolean);
}

function formatAcpError(error) {
  if (!error) return "Unknown ACP error";
  const message = textValue(error.message ?? error.data?.message ?? error.data) || "Unknown ACP error";
  const data = error.data === undefined || typeof error.data === "string" ? "" : JSON.stringify(error.data);
  return data && data !== "{}" ? `${message}: ${data}` : message;
}

export class AcpJsonRpcClient {
  constructor({ child, appendEvent, onNotification, onRequest }) {
    this.child = child;
    this.appendEvent = appendEvent ?? (() => undefined);
    this.onNotification = onNotification ?? (() => undefined);
    this.onRequest = onRequest ?? null;
    this.nextId = 1;
    this.pending = new Map();
    this.disposed = false;
    this.stdout = createInterface({ input: child.stdout });
    this.stdout.on("line", (line) => this.handleLine(line));
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.appendEvent({ type: "log", text: `stderr> ${text}` });
    });
    child.once("error", (error) => this.rejectAll(error));
    child.once("close", (code, signal) => {
      if (this.disposed) return;
      this.rejectAll(new Error(`ACP process exited: ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`));
    });
  }

  dispose() {
    this.disposed = true;
    this.stdout?.close();
    this.child.stdout?.destroy();
    this.child.stderr?.destroy();
    this.child.stdin?.destroy();
  }

  request(method, params, timeoutMs = 60_000) {
    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdin.write(payload, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  initialize(clientInfo = { name: "onmyagent-personal-agent", version: "0.1.0" }, clientCapabilities = {}) {
    return this.request("initialize", { protocolVersion: 1, clientInfo, clientCapabilities });
  }

  createSession(params = {}) {
    return this.request("session/new", params);
  }

  resumeSession(sessionId, params = {}) {
    return this.request("session/resume", { ...params, sessionId });
  }

  loadSession(sessionId, params = {}) {
    return this.request("session/load", { ...params, sessionId });
  }

  listSessions(params = {}) {
    return this.request("session/list", params);
  }

  closeSession(sessionId, params = {}) {
    return this.request("session/close", { ...params, sessionId });
  }

  forkSession(sessionId, params = {}) {
    return this.request("session/fork", { ...params, sessionId });
  }

  setConfigOption(sessionId, optionId, value, params = {}) {
    return this.request("config/set", { ...params, sessionId, optionId, value });
  }

  respond(id, result) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`, "utf8");
  }

  rejectRequest(id, code, message) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`, "utf8");
  }

  rejectAll(error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  handleLine(line) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      this.appendEvent({ type: "log", text: `stdout> ${trimmed}` });
      return;
    }

    if (message.id !== undefined && message.method && message.result === undefined && message.error === undefined) {
      if (this.onRequest) {
        void this.onRequest(message, this).catch((error) => this.rejectRequest(message.id, -32000, error.message));
      } else {
        this.rejectRequest(message.id, -32601, `method not found: ${message.method}`);
      }
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(Number(message.id));
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(Number(message.id));
      if (message.error) entry.reject(new Error(`${entry.method}: ${formatAcpError(message.error)}`));
      else entry.resolve(message.result ?? null);
      return;
    }
    if (message.method === "session/update" || message.method === "session/notification") {
      this.onNotification(message.params ?? {}, message);
      return;
    }
    if (message.method === "session/request_permission" || message.method === "permission/request") {
      if (this.onRequest) {
        void this.onRequest(message, this).catch((error) => this.rejectRequest(message.id, -32000, error.message));
      } else if (message.id !== undefined) {
        this.rejectRequest(message.id, -32601, `method not found: ${message.method}`);
      } else {
        this.onNotification({ update: { sessionUpdate: "permission_request", ...(message.params ?? {}) } }, message);
      }
      return;
    }
    this.appendEvent({ type: "log", text: message.method ? `acp> ${message.method}` : `stdout> ${trimmed}` });
  }
}

export function spawnAcpClient({ command, args = [], cwd = process.cwd(), env = process.env, appendEvent, onNotification = () => undefined, onRequest = null, detached = false }) {
  // Spawn detached on non-Windows so the child becomes a process-group leader.
  // That lets the caller kill the whole tree (child + any grandchildren
  // it spawns, e.g. codex-acp → codex) via `process.kill(-pid, signal)`.
  const useDetached = detached && process.platform !== "win32";
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], detached: useDetached });
  child.unref?.();
  appendEvent?.({ type: "log", text: `${command} ${args.join(" ")}`.trim() });
  appendEvent?.({ type: "log", text: `pid ${child.pid ?? "unknown"}` });
  return { child, client: new AcpJsonRpcClient({ child, appendEvent, onNotification, onRequest }) };
}
