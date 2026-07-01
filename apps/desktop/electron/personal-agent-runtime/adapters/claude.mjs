import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { injectPersonalAgentContext } from "../context-injection.mjs";
import { readSession, writeSession } from "../session-store.mjs";
import { createExecHelpers, stringifyAgentCommand } from "../utils.mjs";
import { ensureProviderWorkdir } from "../workdir.mjs";

const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;

function normalizeApprovalMode(value) {
  const mode = String(value ?? "ask").trim();
  if (mode === "auto" || mode === "ask" || mode === "read-only-auto") return mode;
  return "ask";
}

function shouldPreflightClaudeRun(approvalMode, prompt = "") {
  const mode = normalizeApprovalMode(approvalMode);
  if (mode === "auto") return false;
  const text = String(prompt ?? "").toLowerCase();
  return /\b(bash|shell|terminal|command|exec|run|write|edit|delete|move|rename|curl|pwd|mkdir|printf|touch|rm|git|npm|pnpm|python|node)\b|执行|运行|命令|终端|写入|修改|删除|创建|联网/.test(text);
}

function buildArgs(ctx, sessionId, approvalMode = "ask", forceBypassPermissions = false) {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--disallowedTools",
    "AskUserQuestion",
  ];
  if (forceBypassPermissions || normalizeApprovalMode(approvalMode) === "auto") {
    args.push("--permission-mode", "bypassPermissions");
  }
  const addDirs = new Set([ctx.workspaceRoot, ...(Array.isArray(ctx.accessibleWorkspaceRoots) ? ctx.accessibleWorkspaceRoots : [])].map((item) => String(item ?? "").trim()).filter(Boolean));
  for (const dir of addDirs) args.push("--add-dir", dir);
  if (ctx.model) args.push("--model", ctx.model);
  if (sessionId) args.push("--resume", sessionId);
  args.push(...(ctx.agent.customArgs ?? []));
  return args;
}

function buildInput(prompt) {
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
  })}\n`;
}

function contentText(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .map((part) => (part?.type === "text" && typeof part?.text === "string" ? part.text : ""))
    .filter((part) => part.trim())
    .join("\n")
    .trim();
}

function claudeControlRequestTitle(message = {}) {
  return String(message.title ?? message.request?.title ?? message.tool_name ?? message.toolName ?? message.name ?? "Claude Code 请求权限").trim();
}

function claudeControlRequestCommand(message = {}) {
  const direct = message.command ?? message.cmd ?? message.input?.command ?? message.request?.command ?? message.request?.input?.command;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const toolInput = message.tool_input ?? message.toolInput ?? message.input ?? message.request?.input;
  if (toolInput && typeof toolInput === "object") {
    const command = toolInput.command ?? toolInput.cmd ?? toolInput.pattern ?? toolInput.path ?? toolInput.file_path;
    if (typeof command === "string" && command.trim()) return command.trim();
  }
  return "";
}

function claudeControlRequestKind(message = {}) {
  const tool = String(message.tool_name ?? message.toolName ?? message.name ?? message.request?.tool_name ?? "").toLowerCase();
  if (/write|edit|patch|delete|move|rename/.test(tool)) return "file_change";
  if (/bash|shell|exec|command|terminal/.test(tool)) return "command";
  return "permissions";
}

function isReadOnlyClaudeControlRequest(message = {}) {
  const tool = String(message.tool_name ?? message.toolName ?? message.name ?? message.request?.tool_name ?? "").toLowerCase();
  if (!tool) return false;
  if (/write|edit|patch|delete|move|rename|bash|shell|exec|command|terminal/.test(tool)) return false;
  return /read|grep|glob|search|list|ls|view/.test(tool);
}

function claudeControlResponseForDecision(decision) {
  return { behavior: decision === "decline" || decision === "cancel" ? "deny" : "allow" };
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

export function createClaudeAdapter({ appendEvent, registerCancel, requestApproval, approvalMode = "ask" }) {
  const execHelpers = createExecHelpers();
  const active = new Map();
  const mode = normalizeApprovalMode(approvalMode);

  return {
    provider: "claude",
    async sendMessage(ctx) {
      const executablePath = ctx.agent.executablePath || "claude";
      const workdir = await ensureProviderWorkdir(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
      await injectPersonalAgentContext({ workdir, provider: ctx.agent.provider, workspaceRoot: ctx.workspaceRoot, accessibleWorkspaceRoots: ctx.accessibleWorkspaceRoots });
      const stored = await readSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
      const priorSessionId = String(ctx.resumeKey ?? ctx.providerSessionId ?? stored.sessionId ?? "").trim();
      let forceBypassPermissions = false;
      if (shouldPreflightClaudeRun(mode, ctx.prompt)) {
        const approvalId = `${ctx.runId || "claude"}-preflight`;
        appendEvent({ type: "status", text: "waiting_approval> permissions: Claude Code 本轮执行权限" });
        const approval = await requestApproval?.({
          id: approvalId,
          method: "claude/preflight_bypass_permissions",
          kind: "permissions",
          title: "Claude Code 请求本轮执行权限",
          summary: "Claude Code 的非交互 stream-json 模式不会稳定暴露逐工具审批回调；批准后 Studio 将只对本轮运行启用 Claude 原生 bypassPermissions，避免 Claude 直接回复 approval required。",
          command: null,
          cwd: workdir,
          readonly: false,
          params: { approvalMode: mode, provider: "claude" },
        });
        const decision = approval?.decision ?? "decline";
        appendEvent({ type: "approval_decision", text: `Claude preflight ${decision}` });
        if (decision === "decline" || decision === "cancel") {
          throw new Error("用户未批准 Claude Code 本轮执行权限，已取消运行。");
        }
        forceBypassPermissions = true;
      }
      const args = buildArgs(ctx, priorSessionId, mode, forceBypassPermissions);
      const command = stringifyAgentCommand(executablePath, args);
      appendEvent({ type: "log", text: command });

      const child = spawn(executablePath, args, {
        cwd: workdir,
        env: execHelpers.processEnv({ PWD: workdir }),
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
      let sessionId = priorSessionId;
      let finalError = "";
      let doneResolve;
      const done = new Promise((resolve) => {
        doneResolve = resolve;
      });

      const stdout = createInterface({ input: child.stdout });
      stdout.on("line", async (line) => {
        const trimmed = String(line ?? "").trim();
        if (!trimmed) return;
        let message;
        try {
          message = JSON.parse(trimmed);
        } catch {
          appendEvent({ type: "log", text: `stdout> ${trimmed}` });
          return;
        }
        if (message.type === "assistant") {
          let parsedMessage = message.message;
          if (typeof parsedMessage === "string") {
            try {
              parsedMessage = JSON.parse(parsedMessage);
            } catch {
              parsedMessage = null;
            }
          }
          const text = contentText(parsedMessage);
          if (text) {
            outputParts.push(text);
            appendEvent({ type: "assistant_chunk", text });
          }
          return;
        }
        if (message.type === "system") {
          if (message.session_id) {
            sessionId = String(message.session_id);
            appendEvent({ type: "log", text: `Claude session ${sessionId}` });
          }
          return;
        }
        if (message.type === "result") {
          if (message.session_id) sessionId = String(message.session_id);
          if (typeof message.result === "string" && message.result.trim()) {
            outputParts.length = 0;
            outputParts.push(message.result.trim());
          }
          if (message.is_error) finalError = String(message.result ?? "Claude result error").trim();
          doneResolve({ status: message.is_error ? "failed" : "completed", error: finalError });
          child.stdin.end();
          return;
        }
        if (message.type === "control_request") {
          const requestId = String(message.request_id ?? "");
          if (requestId) {
            const readonly = isReadOnlyClaudeControlRequest(message);
            let decision = "decline";
            if (mode === "auto" || (mode === "read-only-auto" && readonly)) {
              decision = "acceptForSession";
              appendEvent({ type: "approval_decision", text: `Claude approval_auto_accept> ${claudeControlRequestTitle(message)}` });
            } else {
              const kind = claudeControlRequestKind(message);
              const command = claudeControlRequestCommand(message);
              appendEvent({ type: "status", text: `waiting_approval> ${kind}: ${claudeControlRequestTitle(message)}` });
              const result = await requestApproval?.({
                id: `${ctx.runId || "claude"}-${requestId}`,
                method: "claude/control_request",
                kind,
                title: claudeControlRequestTitle(message),
                summary: command ? `Claude Code 请求执行：${command}` : "Claude Code 请求执行受限操作。",
                command: kind === "command" ? command : null,
                cwd: workdir,
                readonly,
                params: message,
              });
              decision = result?.decision ?? "decline";
            }
            const response = { type: "control_response", request_id: requestId, response: claudeControlResponseForDecision(decision) };
            child.stdin.write(`${JSON.stringify(response)}\n`, "utf8");
            appendEvent({ type: "log", text: `Claude control_request ${decision} ${requestId}` });
          }
          return;
        }
        if (message.type === "log") {
          const text = String(message.log?.message ?? "").trim();
          if (text) appendEvent({ type: "log", text: `claude> ${text}` });
          return;
        }
        appendEvent({ type: "log", text: `claude> ${message.type ?? "event"}` });
      });

      let stderrTail = "";
      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderrTail = `${stderrTail}${text}`.slice(-6000);
        const trimmed = text.trim();
        if (trimmed) appendEvent({ type: "log", text: `stderr> ${trimmed}` });
      });
      child.once("error", (error) => doneResolve({ status: "failed", error: error.message }));
      child.once("close", (code, signal) => {
        if (code === 0 && outputParts.join("\n").trim()) doneResolve({ status: "completed", error: "" });
        else doneResolve({ status: "failed", error: `claude exited: ${code ?? "null"}${signal ? ` signal ${signal}` : ""}` });
      });

      try {
        child.stdin.write(buildInput(ctx.prompt), "utf8");
        const terminal = await Promise.race([
          done,
          new Promise((resolve) => setTimeout(() => resolve({ status: "failed", error: "Claude Code stream-json timed out" }), DEFAULT_TURN_TIMEOUT_MS)),
        ]);
        if (terminal.status === "failed") {
          const tail = stderrTail.trim();
          throw new Error(tail ? `${terminal.error}\n${tail}` : terminal.error || "Claude Code failed");
        }
        const output = outputParts.join("\n").trim();
        if (!output) throw new Error("Claude Code completed without assistant text");
        if (sessionId) {
          await writeSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id, {
            sessionId,
            workdir,
            updatedAt: Date.now(),
          });
        }
        return {
          output,
          command: [command, sessionId ? `sessionID=${sessionId}` : "sessionID=<none>", `cwd=${workdir}`, ctx.model ? `model=${ctx.model}` : "model=<default>"].join("\n"),
          connectionMode: "Claude Code stream-json session",
          sessionId,
          providerSessionId: sessionId || null,
          resumeKey: sessionId || null,
          workdir,
          pid: child.pid ?? null,
        };
      } finally {
        if (ctx.runId) active.delete(ctx.runId);
        stdout.close();
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (!child.stdin.destroyed) child.stdin.end();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        await waitForExit(child);
      }
    },
    async cancel(ctx) {
      const child = active.get(ctx.runId);
      if (!child) throw new Error("Claude run is not active");
      child.kill("SIGTERM");
      active.delete(ctx.runId);
    },
  };
}

export const __test__ = {
  buildArgs,
  shouldPreflightClaudeRun,
  isReadOnlyClaudeControlRequest,
  claudeControlRequestKind,
  claudeControlResponseForDecision,
};
