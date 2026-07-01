import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { injectPersonalAgentContext } from "../context-injection.mjs";
import { readSession, writeSession } from "../session-store.mjs";
import { createExecHelpers, stringifyAgentCommand } from "../utils.mjs";
import { ensureProviderWorkdir } from "../workdir.mjs";

const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;
const TOOL_COMPLETION_GRACE_MS = 15_000;

function extractErrorMessage(error) {
  if (!error) return "Unknown Hermes ACP error";
  if (typeof error === "string") return error;
  const data = error.data === undefined ? "" : typeof error.data === "string" ? error.data : JSON.stringify(error.data);
  const message = String(error.message ?? error.data?.message ?? "Unknown Hermes ACP error");
  return data && data !== "{}" ? `${message}: ${data}` : message;
}

function extractSessionId(result) {
  const direct = String(result?.sessionId ?? result?.session_id ?? result?.id ?? "").trim();
  if (direct) return direct;
  if (!result || typeof result !== "object") return "";
  const stack = [result];
  const seen = new Set();
  while (stack.length) {
    const item = stack.shift();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const nested = String(item.sessionId ?? item.session_id ?? item.session?.sessionId ?? item.session?.session_id ?? item.session?.id ?? "").trim();
    if (nested) return nested;
    for (const value of Object.values(item)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return "";
}

function isAcpSessionId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

function normalizeHermesModelId(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.includes(":")) return text;
  const slashIndex = text.indexOf("/");
  if (slashIndex > 0 && slashIndex < text.length - 1) return `${text.slice(0, slashIndex)}:${text.slice(slashIndex + 1)}`;
  return text;
}

function normalizeUpdateType(raw) {
  const key = String(raw ?? "").trim().toLowerCase().replace(/[-_]/g, "");
  if (key === "agentmessagechunk") return "agent_message_chunk";
  if (key === "agentthoughtchunk") return "agent_thought_chunk";
  if (key === "toolcall") return "tool_call";
  if (key === "toolcallupdate") return "tool_call_update";
  if (key === "usageupdate") return "usage_update";
  if (key === "turnend" || key === "endturn") return "turn_end";
  return "";
}

function normalizeUpdate(update) {
  if (!update || typeof update !== "object") return { type: "", data: update };
  const direct = normalizeUpdateType(update.sessionUpdate ?? update.type);
  if (direct) return { type: direct, data: update };
  const keys = Object.keys(update);
  if (keys.length === 1) {
    const wrapped = normalizeUpdateType(keys[0]);
    if (wrapped) return { type: wrapped, data: update[keys[0]] };
  }
  return { type: "", data: update };
}

function textFromContent(data) {
  const content = data?.content;
  if (typeof content?.text === "string") return content.text;
  if (typeof data?.text === "string") return data.text;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : typeof part?.content?.text === "string" ? part.content.text : ""))
      .filter((part) => part.trim())
      .join("\n");
  }
  return "";
}

function textFromUnknown(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromUnknown).filter((part) => part.trim()).join("\n");
  if (!value || typeof value !== "object") return "";
  return textFromContent(value)
    || textFromUnknown(value.content)
    || textFromUnknown(value.output)
    || textFromUnknown(value.result)
    || textFromUnknown(value.data)
    || textFromUnknown(value.text)
    || "";
}

function normalizeApprovalMode(value) {
  const mode = String(value ?? "ask").trim();
  if (mode === "auto" || mode === "ask" || mode === "read-only-auto") return mode;
  return "ask";
}

function hermesPermissionOptions(params = {}) {
  const candidates = [params.options, params.permissionOptions, params.request?.options, params.request?.permissionOptions]
    .filter(Array.isArray)
    .flat();
  return candidates.map((option) => ({
    id: String(option?.optionId ?? option?.id ?? option?.name ?? "").trim(),
    label: String(option?.label ?? option?.title ?? option?.name ?? option?.optionId ?? "").trim(),
  })).filter((option) => option.id);
}

function hermesPermissionOptionForDecision(params = {}, decision = "decline") {
  const options = hermesPermissionOptions(params);
  const byId = (matcher) => options.find((option) => matcher(option.id.toLowerCase()) || matcher(option.label.toLowerCase()))?.id;
  if (decision === "decline" || decision === "cancel") {
    return byId((value) => /reject|deny|decline|cancel|拒绝/.test(value)) || "reject";
  }
  if (decision === "acceptForSession") {
    return byId((value) => /session|always|approve_for_session|本次/.test(value)) || "approve_for_session";
  }
  return byId((value) => /once|approve|allow|accept|允许/.test(value) && !/session|always/.test(value)) || "approve";
}

function hermesPermissionTitle(params = {}) {
  return String(params.title ?? params.request?.title ?? params.toolCall?.title ?? params.toolCall?.name ?? params.toolName ?? "Hermes 请求权限").trim();
}

function hermesPermissionCommand(params = {}) {
  const direct = params.command ?? params.cmd ?? params.input?.command ?? params.request?.command ?? params.request?.input?.command;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const toolInput = params.toolCall?.input ?? params.toolInput ?? params.input ?? params.request?.input;
  if (toolInput && typeof toolInput === "object") {
    const command = toolInput.command ?? toolInput.cmd ?? toolInput.path ?? toolInput.file_path ?? toolInput.pattern;
    if (typeof command === "string" && command.trim()) return command.trim();
  }
  return "";
}

function hermesPermissionKind(params = {}) {
  const name = String(params.toolName ?? params.toolCall?.name ?? params.name ?? params.request?.toolName ?? "").toLowerCase();
  if (/write|edit|patch|delete|move|rename/.test(name)) return "file_change";
  if (/bash|shell|exec|command|terminal/.test(name)) return "command";
  return "permissions";
}

function isReadOnlyHermesPermission(params = {}) {
  const name = String(params.toolName ?? params.toolCall?.name ?? params.name ?? params.request?.toolName ?? "").toLowerCase();
  if (!name) return false;
  if (/write|edit|patch|delete|move|rename|bash|shell|exec|command|terminal/.test(name)) return false;
  return /read|grep|glob|search|list|ls|view/.test(name);
}

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);
    timer.unref?.();
    child.once("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
  });
}

class HermesAcpClient {
  constructor({ child, appendEvent, onText, onToolResult, onToolCompleted, onDone, requestApproval, approvalMode, runId, cwd }) {
    this.child = child;
    this.appendEvent = appendEvent;
    this.onText = onText;
    this.onToolResult = onToolResult;
    this.onToolCompleted = onToolCompleted;
    this.onDone = onDone;
    this.nextId = 1;
    this.pending = new Map();
    this.acceptUpdates = false;
    this.done = false;
    this.requestApproval = requestApproval;
    this.approvalMode = normalizeApprovalMode(approvalMode);
    this.runId = runId || "";
    this.cwd = cwd || "";

    this.stdout = createInterface({ input: child.stdout });
    this.stdout.on("line", (line) => this.handleLine(line));
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.appendEvent({ type: "log", text: `stderr> ${text}` });
    });
    child.once("error", (error) => this.rejectAll(error));
    child.once("close", (code, signal) => {
      this.rejectAll(new Error(`hermes acp exited: ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`));
    });
  }

  dispose() {
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

  rejectAll(error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
    if (this.acceptUpdates && !this.done) {
      this.done = true;
      this.onDone({ status: "failed", error: error.message });
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
      void this.handleAgentRequest(message).catch((error) => {
        this.appendEvent({ type: "error", text: `Hermes permission handling failed: ${error.message}` });
        this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "selected", optionId: "reject" } } })}\n`, "utf8");
      });
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(Number(message.id));
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(Number(message.id));
      if (message.error) {
        entry.reject(new Error(`${entry.method}: ${extractErrorMessage(message.error)}`));
      } else {
        entry.resolve(message.result ?? null);
        if (entry.method === "session/prompt") this.complete("completed", "");
      }
      return;
    }
    if (message.method === "session/update" || message.method === "session/notification") {
      this.handleNotification(message.params ?? {});
      return;
    }
    this.appendEvent({ type: "log", text: message.method ? `acp> ${message.method}` : `stdout> ${trimmed}` });
  }

  async handleAgentRequest(message) {
    const method = String(message.method ?? "");
    if (method !== "session/request_permission") {
      const response = { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `method not found: ${method}` } };
      this.child.stdin.write(`${JSON.stringify(response)}\n`, "utf8");
      this.appendEvent({ type: "log", text: `Hermes unhandled request ${method}` });
      return;
    }
    const params = message.params ?? {};
    const readonly = isReadOnlyHermesPermission(params);
    let decision = "decline";
    if (this.approvalMode === "auto" || (this.approvalMode === "read-only-auto" && readonly)) {
      decision = "acceptForSession";
      this.appendEvent({ type: "approval_decision", text: `Hermes approval_auto_accept> ${hermesPermissionTitle(params)}` });
    } else {
      const kind = hermesPermissionKind(params);
      const command = hermesPermissionCommand(params);
      this.appendEvent({ type: "status", text: `waiting_approval> ${kind}: ${hermesPermissionTitle(params)}` });
      const result = await this.requestApproval?.({
        id: `${this.runId || "hermes"}-${message.id}`,
        method,
        kind,
        title: hermesPermissionTitle(params),
        summary: command ? `Hermes 请求执行：${command}` : "Hermes 请求执行受限操作。",
        command: kind === "command" ? command : null,
        cwd: this.cwd,
        readonly,
        params,
      });
      decision = result?.decision ?? "decline";
    }
    const response = {
      jsonrpc: "2.0",
      id: message.id,
      result: { outcome: { outcome: "selected", optionId: hermesPermissionOptionForDecision(params, decision) } },
    };
    this.child.stdin.write(`${JSON.stringify(response)}\n`, "utf8");
    this.appendEvent({ type: "log", text: `Hermes permission ${decision}` });
  }

  handleNotification(params) {
    if (!this.acceptUpdates) return;
    const { type, data } = normalizeUpdate(params.update ?? params);
    if (type === "agent_message_chunk") {
      const text = textFromContent(data).trim();
      if (text) this.onText(text);
      return;
    }
    if (type === "agent_thought_chunk") {
      const text = textFromContent(data).trim();
      if (text) this.appendEvent({ type: "log", text: `thought> ${text.slice(0, 1200)}` });
      return;
    }
    if (type === "tool_call") {
      const tool = String(data?.title ?? data?.name ?? data?.kind ?? "tool").trim();
      this.appendEvent({ type: "tool", text: `tool_start> ${tool}` });
      return;
    }
    if (type === "tool_call_update") {
      const status = String(data?.status ?? data?.state ?? "update").trim();
      this.appendEvent({ type: "tool", text: `tool_update> ${status}` });
      const text = textFromUnknown(data).trim();
      if (text) this.onToolResult?.(text);
      if (/complete|completed|success|succeeded|done/i.test(status)) this.onToolCompleted?.();
      return;
    }
    if (type === "turn_end") this.complete("completed", "");
  }

  complete(status, error) {
    if (this.done) return;
    this.done = true;
    this.onDone({ status, error });
  }
}

export function createHermesAdapter({ appendEvent, registerCancel, requestApproval, approvalMode = "ask" }) {
  const execHelpers = createExecHelpers();
  const active = new Map();
  const mode = normalizeApprovalMode(approvalMode);

  return {
    provider: "hermes",
    async sendMessage(ctx) {
      const executablePath = ctx.agent.executablePath || "hermes";
      const workdir = await ensureProviderWorkdir(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
      await injectPersonalAgentContext({ workdir, provider: ctx.agent.provider, workspaceRoot: ctx.workspaceRoot, accessibleWorkspaceRoots: ctx.accessibleWorkspaceRoots });

      const args = ["acp", ...(ctx.agent.customArgs ?? [])];
      const command = stringifyAgentCommand(executablePath, args);
      appendEvent({ type: "log", text: command });
      const child = spawn(executablePath, args, {
        cwd: workdir,
        env: execHelpers.processEnv({ PWD: workdir, ...(mode === "auto" ? { HERMES_YOLO_MODE: "1" } : {}) }),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.unref?.();
      if (ctx.runId) active.set(ctx.runId, child);
      registerCancel?.(async () => {
        child.kill("SIGTERM");
        if (ctx.runId) active.delete(ctx.runId);
      });
      appendEvent({ type: "log", text: `pid ${child.pid ?? "unknown"}` });

      const outputParts = [];
      let streamedText = "";
      let sessionId = "";
      let doneResolve;
      let toolGraceTimer = null;
      const done = new Promise((resolve) => {
        doneResolve = resolve;
      });
      const completeAfterToolGrace = () => {
        if (toolGraceTimer) clearTimeout(toolGraceTimer);
        toolGraceTimer = setTimeout(() => {
          appendEvent({ type: "status", text: "Hermes tool completed; finishing after waiting for final assistant text." });
          doneResolve({ status: "completed", error: "" });
        }, TOOL_COMPLETION_GRACE_MS);
        toolGraceTimer.unref?.();
      };
      const rpc = new HermesAcpClient({
        child,
        appendEvent,
        onText: (text) => {
          streamedText += text;
          appendEvent({ type: "assistant_chunk", text });
        },
        onToolResult: (text) => {
          outputParts.push(text);
        },
        onToolCompleted: completeAfterToolGrace,
        onDone: (result) => doneResolve(result),
        requestApproval,
        approvalMode: mode,
        runId: ctx.runId,
        cwd: workdir,
      });

      try {
        await rpc.request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "onmyagent-personal-agent", version: "0.1.0" },
          clientCapabilities: {},
        });

        const stored = await readSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
        const storedSessionId = String(ctx.resumeKey ?? ctx.providerSessionId ?? stored.sessionId ?? "").trim();
        const modelId = normalizeHermesModelId(ctx.model);
        if (storedSessionId) {
          try {
            const resumed = await rpc.request("session/resume", {
              cwd: workdir,
              sessionId: storedSessionId,
              mcpServers: [],
              ...(modelId ? { model: modelId } : {}),
            });
            sessionId = extractSessionId(resumed) || storedSessionId;
            appendEvent({ type: "log", text: `Hermes ACP session resumed ${sessionId}` });
          } catch (error) {
            appendEvent({ type: "log", text: `Hermes ACP session resume failed; starting new session: ${error.message}` });
          }
        }
        if (!sessionId) {
          const created = await rpc.request("session/new", { cwd: workdir, mcpServers: [], ...(modelId ? { model: modelId } : {}) });
          sessionId = extractSessionId(created);
          if (!sessionId) throw new Error("Hermes ACP session/new returned no sessionId");
          appendEvent({ type: "log", text: `Hermes ACP session created ${sessionId}` });
        }
        if (modelId) {
          await rpc.request("session/set_model", { sessionId, modelId });
          appendEvent({ type: "log", text: `Hermes ACP model set ${modelId}` });
        }
        await writeSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id, {
          sessionId,
          workdir,
          updatedAt: Date.now(),
        });

        rpc.acceptUpdates = true;
        const promptPromise = rpc.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: ctx.prompt }],
        }, DEFAULT_TURN_TIMEOUT_MS);

        const promptCompletion = promptPromise.then(
          () => ({ status: "completed", error: "" }),
          (error) => ({ status: "failed", error: error.message }),
        );
        const terminal = await Promise.race([
          done,
          promptCompletion,
          new Promise((resolve) => setTimeout(() => resolve({ status: "failed", error: "Hermes ACP prompt timed out" }), DEFAULT_TURN_TIMEOUT_MS)),
        ]);
        if (toolGraceTimer) clearTimeout(toolGraceTimer);
        if (terminal.status === "failed") throw new Error(terminal.error || "Hermes ACP prompt failed");
        const output = (outputParts.join("\n") || streamedText).trim();
        if (!output) throw new Error("Hermes ACP completed without assistant text");
        return {
          output,
          command: [command, `sessionID=${sessionId}`, `cwd=${workdir}`, modelId ? `model=${modelId}` : "model=<default>"].join("\n"),
          connectionMode: "Hermes ACP JSON-RPC session",
          sessionId,
          providerSessionId: sessionId,
          resumeKey: sessionId,
          workdir,
          pid: child.pid ?? null,
        };
      } finally {
        if (ctx.runId) active.delete(ctx.runId);
        rpc.dispose();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        await waitForExit(child);
      }
    },
    async cancel(ctx) {
      const child = active.get(ctx.runId);
      if (!child) throw new Error("Hermes run is not active");
      child.kill("SIGTERM");
      active.delete(ctx.runId);
    },
  };
}

export const __test__ = {
  extractSessionId,
  isAcpSessionId,
  normalizeHermesModelId,
  textFromUnknown,
  hermesPermissionOptionForDecision,
  isReadOnlyHermesPermission,
  hermesPermissionKind,
};
