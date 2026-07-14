import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { injectPersonalAgentContext } from "../context-injection.mjs";
import { readSession, writeSession } from "../session-store.mjs";
import { createExecHelpers, stringifyAgentCommand } from "../utils.mjs";
import { ensureProviderWorkdir } from "../workdir.mjs";

const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;

function nilIfEmpty(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeAccessibleWorkspaceRoots(value, workspaceRoot = "") {
  const primary = String(workspaceRoot ?? "").trim();
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  const roots = [];
  for (const item of source) {
    const root = String(item ?? "").trim();
    if (!root || root === primary || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return roots;
}

function buildDeveloperInstructions(workspaceRoot, accessibleWorkspaceRoots = []) {
  const extraRoots = normalizeAccessibleWorkspaceRoots(accessibleWorkspaceRoots, workspaceRoot);
  return [
    "你正在作为 OnMyAgent 的个人助理通过本机 Codex app-server 执行用户请求。",
    "必须输出一段可以直接展示给用户的最终回复。",
    "如果创建、修改或读取了文件，请在回复里列出相对当前工作区的文件路径。",
    `当前工作区根目录：${workspaceRoot}`,
    extraRoots.length ? `额外可访问目录：\n${extraRoots.map((root) => `- ${root}`).join("\n")}` : "额外可访问目录：无",
  ].join("\n");
}

function codexRunPolicyForApprovalMode(approvalMode) {
  // Aligned with Upstream acp_launch_policy: non-auto sessions run under
  // Codex `workspace-write` sandbox with outbound network access enabled;
  // only the explicit `auto` (yolo/full-access) mode escalates to
  // `danger-full-access`. Approvals still gate sensitive actions in
  // non-auto modes via `on-request`.
  if (approvalMode === "auto") {
    return {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      threadSandbox: "danger-full-access",
      turnSandboxPolicy: { type: "dangerFullAccess" },
    };
  }
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    threadSandbox: "workspace-write",
    turnSandboxPolicy: { type: "workspaceWrite", networkAccess: true },
  };
}

function extractNested(value, ...keys) {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function extractThreadID(result) {
  return String(
    result?.thread?.id ??
      result?.threadId ??
      result?.threadID ??
      result?.id ??
      "",
  ).trim();
}

function extractErrorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return String(error.message ?? error.data?.message ?? JSON.stringify(error));
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

function codexApprovalResponseForRequest(method, params = {}) {
  if (method === "item/commandExecution/requestApproval") return { decision: "acceptForSession" };
  if (method === "item/fileChange/requestApproval") return { decision: "acceptForSession" };
  if (method === "item/permissions/requestApproval") return { scope: "session", permissions: params?.permissions ?? {} };
  return null;
}

function codexApprovalResponseForDecision(method, decision, params = {}) {
  if (method === "item/permissions/requestApproval") {
    if (decision === "decline" || decision === "cancel") return { scope: "none", permissions: {} };
    return { scope: decision === "acceptForSession" ? "session" : "once", permissions: params?.permissions ?? {} };
  }
  const normalized = decision === "accept" || decision === "acceptForSession" || decision === "cancel" ? decision : "decline";
  return { decision: normalized };
}

function commandFromApprovalParams(params = {}) {
  const direct = params?.command ?? params?.cmd ?? params?.reason;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const actionCommand = params?.action?.command ?? params?.commandAction?.command;
  if (typeof actionCommand === "string" && actionCommand.trim()) return actionCommand.trim();
  return "command execution";
}

function commandActionType(params = {}) {
  return String(params?.action?.type ?? params?.commandAction?.type ?? "").trim();
}

function isReadonlyCommandApproval(params = {}) {
  const type = commandActionType(params);
  if (type === "read" || type === "listFiles" || type === "search") return true;
  return false;
}

function approvalKind(method) {
  if (method === "item/commandExecution/requestApproval") return "command";
  if (method === "item/fileChange/requestApproval") return "file_change";
  if (method === "item/permissions/requestApproval") return "permissions";
  return "unknown";
}

function cleanupChildAsync(child, rpc) {
  rpc.dispose();
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
}

class CodexRpcClient {
  constructor({ child, appendEvent, onAssistantText, onDone, onSession, onError, requestApproval, approvalMode, runId, cwd }) {
    this.child = child;
    this.appendEvent = appendEvent;
    this.onAssistantText = onAssistantText;
    this.onDone = onDone;
    this.onSession = onSession;
    this.onError = onError;
    this.requestApproval = requestApproval;
    this.approvalMode = approvalMode || "ask";
    this.runId = runId || "";
    this.cwd = cwd || "";
    this.nextId = 1;
    this.pending = new Map();
    this.threadId = "";
    this.turnStarted = false;
    this.done = false;

    this.stdout = createInterface({ input: child.stdout });
    this.stdout.on("line", (line) => this.handleLine(line));
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.appendEvent({ type: "log", text: `stderr> ${text}` });
    });
    child.once("error", (error) => this.rejectAll(error));
    child.once("close", (code, signal) => {
      this.rejectAll(new Error(`codex app-server exited: ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`));
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
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
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

  notify(method, params = undefined) {
    const payload = params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8");
  }

  rejectAll(error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
    if (!this.done && this.turnStarted) {
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

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(Number(message.id));
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(Number(message.id));
      if (message.error) entry.reject(new Error(extractErrorMessage(message.error)));
      else entry.resolve(message.result ?? null);
      return;
    }

    const method = String(message.method ?? "").trim();
    if (!method) {
      this.appendEvent({ type: "log", text: `stdout> ${trimmed}` });
      return;
    }
    if (message.id !== undefined) {
      void this.handleServerRequest(Number(message.id), method, message.params ?? {}).catch((error) => {
        this.appendEvent({ type: "error", text: `Codex approval handling failed: ${error.message}` });
        this.respond(Number(message.id), codexApprovalResponseForDecision(method, "decline", message.params ?? {}));
      });
      return;
    }
    this.handleNotification(method, message.params ?? {});
  }

  respond(id, result) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`, "utf8");
  }

  async handleServerRequest(id, method, params) {
    const approvalResponse = codexApprovalResponseForRequest(method, params);
    if (!approvalResponse) {
      this.appendEvent({ type: "error", text: `Unhandled Codex server request: ${method}` });
      this.respond(id, { error: `Unhandled request: ${method}` });
      return;
    }
    const readonly = method === "item/commandExecution/requestApproval" && isReadonlyCommandApproval(params);
    if (this.approvalMode === "auto" || (this.approvalMode === "read-only-auto" && readonly)) {
      const command = commandFromApprovalParams(params);
      this.appendEvent({ type: "approval_decision", text: `approval_auto_accept> ${method} ${command.slice(0, 1000)}` });
      this.respond(id, approvalResponse);
      return;
    }
    const approvalId = `${this.runId || "codex"}-${id}`;
    const command = commandFromApprovalParams(params);
    const kind = approvalKind(method);
    this.appendEvent({ type: "status", text: `waiting_approval> ${kind}: ${command.slice(0, 1000)}` });
    const approvalResult = await this.requestApproval?.({
      id: approvalId,
      method,
      kind,
      title: kind === "command" ? "Codex 请求执行命令" : kind === "file_change" ? "Codex 请求修改文件" : "Codex 请求权限",
      summary: kind === "command" ? `Codex 请求执行命令：${command}` : kind === "file_change" ? "Codex 请求应用文件变更。" : "Codex 请求提升权限。",
      command: kind === "command" ? command : null,
      cwd: this.cwd,
      readonly,
      params,
    });
    const decision = approvalResult?.decision ?? "decline";
    this.respond(id, codexApprovalResponseForDecision(method, decision, params));
    return;
  }

  handleNotification(method, params) {
    if (method === "thread/started") {
      const threadId = String(params?.thread?.id ?? params?.threadId ?? "").trim();
      if (threadId) {
        this.threadId = threadId;
        this.onSession(threadId);
      }
      return;
    }
    if (method === "turn/started") {
      this.turnStarted = true;
      this.appendEvent({ type: "log", text: "Codex turn started" });
      return;
    }
    if (method === "item/started") {
      const item = params?.item ?? {};
      const type = String(item.type ?? "item");
      const command = String(item.command ?? "").trim();
      if (type === "commandExecution" && command) {
        const id = String(item.id ?? item.callId ?? command).trim();
        this.appendEvent({
          type: "tool",
          text: `tool_start> ${type}: ${command}`,
          toolCall: { id, name: type, status: "running", description: command, input: command },
        });
      } else {
        this.appendEvent({ type: "log", text: `item_start> ${type}` });
      }
      return;
    }
    if (method === "item/completed") {
      const item = params?.item ?? {};
      const type = String(item.type ?? "");
      if (type === "agentMessage") {
        const text = String(item.text ?? "").trim();
        if (text) this.onAssistantText(text);
        if (String(item.phase ?? "") === "final_answer") this.complete("completed", "");
        return;
      }
      const output = String(item.aggregatedOutput ?? "").trim();
      if (type === "commandExecution") {
        const command = String(item.command ?? "").trim();
        const id = String(item.id ?? item.callId ?? (command || output || type)).trim();
        const status = /failed|error|exit_code"?\s*:\s*(?!0)\d+/i.test(output) ? "failed" : "completed";
        this.appendEvent({
          type: "tool",
          text: output ? `tool_end> ${type}: ${output.slice(0, 1200)}` : `item_done> ${type}`,
          toolCall: { id, name: type, status, description: command, input: command, output: output.slice(0, 1200) },
        });
      } else {
        this.appendEvent({ type: "log", text: output ? `item_done> ${type}: ${output.slice(0, 1200)}` : `item_done> ${type}` });
      }
      return;
    }
    if (method === "turn/completed") {
      const status = String(extractNested(params, "turn", "status") ?? "completed");
      const error = String(extractNested(params, "turn", "error", "message") ?? "").trim();
      this.complete(status === "failed" ? "failed" : "completed", error);
      return;
    }
    if (method === "thread/status/changed") {
      const status = String(extractNested(params, "status", "type") ?? "");
      if (status === "idle" && this.turnStarted) this.complete("completed", "");
      return;
    }
    if (method === "error") {
      const willRetry = Boolean(params?.willRetry);
      const error = String(extractNested(params, "error", "message") ?? params?.message ?? "Codex error");
      this.appendEvent({ type: willRetry ? "log" : "error", text: error });
      if (!willRetry) this.complete("failed", error);
      return;
    }
    this.appendEvent({ type: "log", text: `${method}` });
  }

  complete(status, error) {
    if (this.done) return;
    this.done = true;
    this.onDone({ status, error });
  }
}

export function createCodexAdapter({ appendEvent, registerCancel, requestApproval, approvalMode }) {
  const execHelpers = createExecHelpers();
  const active = new Map();
  const runPolicy = codexRunPolicyForApprovalMode(approvalMode);

  return {
    provider: "codex",
    async sendMessage(ctx) {
      const executablePath = ctx.agent.executablePath || "codex";
      const workdir = await ensureProviderWorkdir(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
      await injectPersonalAgentContext({ workdir, provider: ctx.agent.provider, workspaceRoot: ctx.workspaceRoot, accessibleWorkspaceRoots: ctx.accessibleWorkspaceRoots });

      const args = ["app-server", "--listen", "stdio://", ...(ctx.agent.customArgs ?? [])];
      const command = stringifyAgentCommand(executablePath, args);
      appendEvent({ type: "log", text: command });
      const child = spawn(executablePath, args, {
        cwd: ctx.workspaceRoot,
        env: execHelpers.processEnv({ PWD: ctx.workspaceRoot }),
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
      let sessionId = "";
      let doneResolve;
      const done = new Promise((resolve) => {
        doneResolve = resolve;
      });
      const rpc = new CodexRpcClient({
        child,
        appendEvent,
        onAssistantText: (text) => {
          outputParts.push(text);
          appendEvent({ type: "assistant_chunk", text });
        },
        onSession: (threadId) => {
          sessionId = threadId;
        },
        onError: (error) => appendEvent({ type: "error", text: error }),
        onDone: (result) => {
          doneResolve(result);
        },
        requestApproval,
        approvalMode,
        runId: ctx.runId,
        cwd: ctx.workspaceRoot,
      });

      try {
        await rpc.request("initialize", {
          clientInfo: { name: "onmyagent-personal-assistant", title: "OnMyAgent Personal Assistant", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        });
        rpc.notify("initialized");

        const stored = await readSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
        const priorThreadId = String(ctx.resumeKey ?? ctx.providerSessionId ?? stored.sessionId ?? stored.threadId ?? "").trim();
        const developerInstructions = buildDeveloperInstructions(ctx.workspaceRoot, ctx.accessibleWorkspaceRoots);
        let threadId = "";
        if (priorThreadId) {
          try {
            const resumed = await rpc.request("thread/resume", {
              threadId: priorThreadId,
              cwd: ctx.workspaceRoot,
              model: nilIfEmpty(ctx.model),
              approvalPolicy: runPolicy.approvalPolicy,
              approvalsReviewer: runPolicy.approvalsReviewer,
              sandbox: runPolicy.threadSandbox,
              developerInstructions,
            });
            threadId = extractThreadID(resumed);
            appendEvent({ type: "log", text: `Codex thread resumed ${threadId || priorThreadId}` });
          } catch (error) {
            appendEvent({ type: "log", text: `Codex thread resume failed; starting new thread: ${error.message}` });
          }
        }
        if (!threadId) {
          const started = await rpc.request("thread/start", {
            model: nilIfEmpty(ctx.model),
            modelProvider: null,
            profile: null,
            cwd: ctx.workspaceRoot,
            approvalPolicy: runPolicy.approvalPolicy,
            approvalsReviewer: runPolicy.approvalsReviewer,
            sandbox: runPolicy.threadSandbox,
            config: null,
            baseInstructions: null,
            developerInstructions,
            compactPrompt: null,
            includeApplyPatchTool: null,
            experimentalRawEvents: false,
            persistExtendedHistory: true,
          });
          threadId = extractThreadID(started);
          if (!threadId) throw new Error("codex thread/start returned no thread id");
          appendEvent({ type: "log", text: `Codex thread started ${threadId}` });
        }
        rpc.threadId = threadId;
        sessionId = threadId;
        await writeSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id, {
          sessionId: threadId,
          threadId,
          workdir,
          updatedAt: Date.now(),
        });

        await rpc.request("turn/start", {
          threadId,
          input: [{ type: "text", text: ctx.prompt }],
          approvalPolicy: runPolicy.approvalPolicy,
          approvalsReviewer: runPolicy.approvalsReviewer,
          sandboxPolicy: runPolicy.turnSandboxPolicy,
        });

        const terminal = await Promise.race([
          done,
          new Promise((resolve) => setTimeout(() => resolve({ status: "failed", error: "Codex app-server turn timed out" }), DEFAULT_TURN_TIMEOUT_MS)),
        ]);
        if (terminal.status === "failed") throw new Error(terminal.error || "Codex turn failed");
        const output = outputParts.join("\n").trim();
        if (!output) throw new Error("Codex app-server completed without assistant text");
        return {
          output,
          command: [command, `threadID=${sessionId}`, `cwd=${ctx.workspaceRoot}`, ctx.model ? `model=${ctx.model}` : "model=<default>"].join("\n"),
          sessionId,
          providerSessionId: sessionId,
          resumeKey: sessionId,
          workdir,
          pid: child.pid ?? null,
        };
      } finally {
        if (ctx.runId) active.delete(ctx.runId);
        cleanupChildAsync(child, rpc);
      }
    },
    async cancel(ctx) {
      const child = active.get(ctx.runId);
      if (!child) throw new Error("Codex run is not active");
      child.kill("SIGTERM");
      active.delete(ctx.runId);
    },
  };
}

export const __test__ = {
  codexApprovalResponseForRequest,
  codexRunPolicyForApprovalMode,
  buildDeveloperInstructions,
};
