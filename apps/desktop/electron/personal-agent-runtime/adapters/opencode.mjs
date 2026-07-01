import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

import { injectPersonalAgentContext } from "../context-injection.mjs";
import { readSession, writeSession } from "../session-store.mjs";
import { ensureProviderWorkdir } from "../workdir.mjs";

function unwrap(result) {
  if (result?.error) {
    throw new Error(formatOpenCodeError(result.error));
  }
  return result?.data;
}

function formatOpenCodeError(error) {
  if (!error) return "Unknown OpenCode error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const message = error?.message ?? error?.data?.message ?? error?.error?.message;
  if (message) return String(message);
  try {
    const json = JSON.stringify(error);
    return json && json !== "{}" ? json : String(error);
  } catch {
    return String(error);
  }
}

function modelRefFromString(value) {
  const text = String(value ?? "").trim();
  const separator = text.indexOf("/");
  if (separator <= 0 || separator >= text.length - 1) return undefined;
  return { providerID: text.slice(0, separator), modelID: text.slice(separator + 1) };
}

function assistantMessageText(message) {
  const role = String(message?.info?.role ?? message?.role ?? "").toLowerCase();
  if (role !== "assistant") return "";
  return (message?.parts ?? [])
    .map((part) => {
      if ((part?.type === "text" || part?.type === "reasoning") && typeof part.text === "string") return part.text;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.errorText === "string") return part.errorText;
      return "";
    })
    .filter((part) => part.trim())
    .join("\n")
    .trim();
}

function partsText(parts = []) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => {
      if (part?.ignored) return "";
      if ((part?.type === "text" || part?.type === "reasoning") && typeof part.text === "string") return part.text;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.errorText === "string") return part.errorText;
      return "";
    })
    .filter((part) => part.trim())
    .join("\n")
    .trim();
}

function assistantMessageKey(message) {
  const id = String(message?.info?.id ?? message?.info?.messageID ?? message?.id ?? "").trim();
  if (id) return `id:${id}`;
  const text = assistantMessageText(message);
  return text ? `text:${text}` : "";
}

function latestNewAssistantText(messages, existingKeys) {
  for (const message of messages.slice().reverse()) {
    const key = assistantMessageKey(message);
    if (key && existingKeys.has(key)) continue;
    const text = assistantMessageText(message);
    if (text) return text;
  }
  return "";
}

function summarizeOpenCodeMessages(messages = []) {
  return messages.slice(-5).map((message) => {
    const role = String(message?.info?.role ?? message?.role ?? "unknown");
    const id = String(message?.info?.id ?? message?.info?.messageID ?? message?.id ?? "no-id");
    const parts = Array.isArray(message?.parts)
      ? message.parts.map((part) => String(part?.type ?? "unknown")).join("+")
      : "no-parts";
    return `${role}:${id}:${parts}`;
  }).join(" | ");
}

function normalizeApprovalMode(value) {
  const mode = String(value ?? "ask").trim();
  if (mode === "auto" || mode === "ask" || mode === "read-only-auto") return mode;
  return "ask";
}

function opencodePermissionKind(permission = {}) {
  const name = String(permission.permission ?? permission.type ?? permission.name ?? "").toLowerCase();
  if (/bash|shell|exec|command|terminal/.test(name)) return "command";
  if (/edit|write|patch|delete|move|rename/.test(name)) return "file_change";
  return "permissions";
}

function opencodePermissionCommand(permission = {}) {
  const metadata = permission.metadata && typeof permission.metadata === "object" ? permission.metadata : {};
  const candidates = [
    metadata.command,
    metadata.cmd,
    metadata.description,
    metadata.filepath,
    metadata.filePath,
    metadata.path,
    metadata.url,
    metadata.query,
    Array.isArray(permission.patterns) ? permission.patterns.join(", ") : null,
    permission.pattern,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function opencodePermissionTitle(permission = {}) {
  const name = String(permission.permission ?? "OpenCode 权限").trim();
  if (name === "bash") return "OpenCode 请求执行命令";
  if (name === "edit") return "OpenCode 请求修改文件";
  if (name === "read") return "OpenCode 请求读取文件";
  return `OpenCode 请求权限：${name || "unknown"}`;
}

function isReadOnlyOpenCodePermission(permission = {}) {
  const name = String(permission.permission ?? permission.type ?? permission.name ?? "").toLowerCase();
  if (!name) return false;
  if (/bash|shell|exec|command|terminal|edit|write|patch|delete|move|rename/.test(name)) return false;
  return /read|grep|glob|search|list|ls|view/.test(name);
}

function openCodeReplyForDecision(decision) {
  if (decision === "accept") return "once";
  if (decision === "acceptForSession") return "always";
  return "reject";
}

function opencodePermissionFingerprint(permission = {}) {
  const metadata = permission.metadata && typeof permission.metadata === "object" ? permission.metadata : {};
  const permissionName = String(permission.permission ?? permission.type ?? permission.name ?? "").trim();
  const command = opencodePermissionCommand(permission);
  const target = [
    command,
    metadata.filepath,
    metadata.filePath,
    metadata.path,
    metadata.url,
    metadata.query,
    permission.pattern,
    Array.isArray(permission.patterns) ? permission.patterns.join(",") : null,
  ].find((value) => typeof value === "string" && value.trim());
  return `${permissionName}:${String(target ?? "").trim()}`;
}

function trackPromise(promise) {
  const state = { status: "pending", value: undefined, reason: undefined };
  promise.then(
    (value) => {
      state.status = "fulfilled";
      state.value = value;
      return value;
    },
    (reason) => {
      state.status = "rejected";
      state.reason = reason;
    },
  );
  return state;
}

async function listOpenCodePermissions(client, directories = []) {
  if (!client.permission?.list) return [];
  const uniqueDirectories = [null, ...directories.map((directory) => String(directory ?? "").trim()).filter(Boolean)];
  const seen = new Set();
  const permissions = [];
  let lastError = null;
  for (const directory of uniqueDirectories) {
    try {
      const result = directory ? await client.permission.list({ directory }) : await client.permission.list();
      if (result?.error) throw new Error(formatOpenCodeError(result.error));
      const items = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
      for (const item of items) {
        const id = String(item?.id ?? "").trim();
        const key = id || JSON.stringify(item ?? {});
        if (seen.has(key)) continue;
        seen.add(key);
        permissions.push(item);
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (!permissions.length && lastError) throw lastError;
  return permissions;
}

async function replyOpenCodePermission(client, input) {
  if (client.permission?.respond && input.sessionID) {
    const result = await client.permission.respond({
      sessionID: input.sessionID,
      permissionID: input.requestID,
      response: input.reply === "always" ? "always" : input.reply === "once" ? "once" : "reject",
    });
    if (result?.error) {
      const message = formatOpenCodeError(result.error);
      if (/permission request not found/i.test(message)) return { notFound: true, message };
      throw new Error(message);
    }
    return { ok: true, method: "respond" };
  }
  if (client.permission?.reply) {
    const result = await client.permission.reply({
      requestID: input.requestID,
      reply: input.reply,
      directory: input.directory,
    });
    if (result?.error) {
      const message = formatOpenCodeError(result.error);
      if (/permission request not found/i.test(message)) return { notFound: true, message };
      throw new Error(message);
    }
    return { ok: true, method: "reply" };
  }
  return { ok: false };
}

function buildPrompt(userPrompt) {
  return [
    "你正在作为 OnMyAgent 的个人助理通过本机 Agent 执行用户请求。",
    "必须在结束前输出一段可以直接展示给用户的最终回复；不要只发工具调用或空结果。",
    "如果创建、修改或读取了文件，请在回复里列出相对当前工作区的文件路径。",
    "如果用户只是打招呼，也要正常简短回应。",
    "",
    "用户消息：",
    userPrompt,
  ].join("\n");
}

function extractInteractiveSudoCommand(prompt) {
  const text = String(prompt ?? "");
  const match = text.match(/(?:^|[\s`"'：:])sudo\s+([^\n`"']+)/i);
  if (!match) return "";
  return `sudo ${String(match[1] ?? "").trim()}`.trim();
}

function sudoFallbackCommand(command) {
  return command.replace(/^sudo\s+/i, "").trim();
}

function interactiveSudoMessage(command) {
  const fallback = sudoFallbackCommand(command);
  return [
    `不能在当前 OpenCode 聊天窗口里执行 \`${command}\`。`,
    "原因：本地 Agent 通过 OpenCode SDK 的非交互 session 运行，没有可输入 macOS sudo 密码的 TTY；Studio 的审批按钮只能批准 Agent 工具权限，不能代替系统密码输入。",
    fallback ? `如果只是读取普通目录，请改用不带 sudo 的命令：\`${fallback}\`。` : null,
    "如果确实需要管理员权限，请在系统终端里手动执行 sudo 命令。",
  ].filter(Boolean).join("\n");
}

export function createOpenCodeAdapter({ opencodeBaseUrl, onmyagentServerToken, opencodeAuthorization, appendEvent, registerCancel, requestApproval, approvalMode = "ask", createClient = createOpencodeClient }) {
  const mode = normalizeApprovalMode(approvalMode);
  return {
    provider: "opencode",
    async sendMessage(ctx) {
      const sudoCommand = extractInteractiveSudoCommand(ctx.prompt);
      if (sudoCommand) {
        appendEvent({ type: "status", text: `OpenCode skipped interactive sudo command: ${sudoCommand}` });
        return {
          output: interactiveSudoMessage(sudoCommand),
          command: `OpenCode SDK preflight blocked interactive sudo\ncommand=${sudoCommand}`,
          connectionMode: "OpenCode SDK session (sudo preflight)",
          workdir: ctx.workspaceRoot,
          metadata: { blockedReason: "interactive_sudo", command: sudoCommand },
        };
      }
      const authorization = opencodeAuthorization || (onmyagentServerToken ? `Bearer ${onmyagentServerToken}` : "");
      if (!opencodeBaseUrl || !authorization) {
        throw new Error("OpenCode SDK 连接不可用：缺少 opencodeBaseUrl 或认证信息。");
      }
      const workdir = await ensureProviderWorkdir(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
      await injectPersonalAgentContext({ workdir, provider: ctx.agent.provider, workspaceRoot: ctx.workspaceRoot, accessibleWorkspaceRoots: ctx.accessibleWorkspaceRoots });

      const client = createClient({
        baseUrl: opencodeBaseUrl,
        directory: workdir,
        headers: { authorization },
      });

      const session = await readSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
      let sessionId = String(ctx.resumeKey ?? ctx.providerSessionId ?? session.sessionId ?? session.opencodeSessionId ?? "").trim();
      if (sessionId) {
        const existing = await client.session.get({ sessionID: sessionId, directory: workdir });
        if (existing.error) sessionId = "";
      }
      if (!sessionId) {
        appendEvent({ type: "log", text: `OpenCode SDK creating session directory=${workdir}` });
        const created = unwrap(await client.session.create({
          directory: workdir,
          title: `OnMyAgent Local Agent - ${ctx.agent.id || ctx.agent.provider}`,
        }));
        sessionId = created.id;
        await writeSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id, {
          sessionId,
          workdir,
          updatedAt: Date.now(),
        });
      }
      appendEvent({ type: "log", text: `OpenCode SDK sessionID ${sessionId}` });
      registerCancel?.(async () => {
        unwrap(await client.session.abort({ sessionID: sessionId }));
      });

      const beforeMessages = await client.session.messages({ sessionID: sessionId, directory: workdir, limit: 100 });
      if (beforeMessages.error) throw new Error(formatOpenCodeError(beforeMessages.error));
      const existingAssistantKeys = new Set((beforeMessages.data ?? []).map((message) => assistantMessageKey(message)).filter(Boolean));

      const promptPayload = {
        sessionID: sessionId,
        directory: workdir,
        agent: ctx.agent.customArgs?.includes("--agent") ? undefined : "build",
        model: modelRefFromString(ctx.model),
        parts: [{ type: /** @type {"text"} */ ("text"), text: buildPrompt(ctx.prompt) }],
      };

      const handledPermissionIds = new Set();
      const acceptedPermissionFingerprints = new Set();
      const permissionDirectories = [workdir, ctx.workspaceRoot, ...(Array.isArray(ctx.accessibleWorkspaceRoots) ? ctx.accessibleWorkspaceRoots : [])];

      const handlePendingPermissions = async () => {
        const permissions = await listOpenCodePermissions(client, permissionDirectories);
        const pending = permissions.filter((permission) => {
          const id = String(permission?.id ?? "").trim();
          const permissionSessionId = String(permission?.sessionID ?? permission?.sessionId ?? "").trim();
          return id && permissionSessionId === sessionId && !handledPermissionIds.has(id);
        });
        for (const permission of pending) {
          const id = String(permission.id).trim();
          handledPermissionIds.add(id);
          const readonly = isReadOnlyOpenCodePermission(permission);
          const fingerprint = opencodePermissionFingerprint(permission);
          let decision = "decline";
          if (mode === "auto" || (mode === "read-only-auto" && readonly)) {
            decision = "acceptForSession";
            appendEvent({ type: "approval_decision", text: `OpenCode approval_auto_accept> ${permission.permission ?? id}` });
          } else if (fingerprint && acceptedPermissionFingerprints.has(fingerprint)) {
            decision = "accept";
            appendEvent({ type: "approval_decision", text: `OpenCode approval_auto_accept_duplicate> ${permission.permission ?? id}` });
          } else {
            const kind = opencodePermissionKind(permission);
            const command = opencodePermissionCommand(permission);
            appendEvent({ type: "status", text: `waiting_approval> ${kind}: ${opencodePermissionTitle(permission)}` });
            const result = await requestApproval?.({
              id: `${ctx.runId || "opencode"}-${id}`,
              method: "opencode/permission.reply",
              kind,
              title: opencodePermissionTitle(permission),
              summary: command ? `OpenCode 请求：${command}` : "OpenCode 请求执行受限操作。",
              command: kind === "command" ? command : null,
              cwd: workdir,
              readonly,
              params: permission,
            });
            decision = result?.decision ?? "decline";
          }
          const reply = openCodeReplyForDecision(decision);
          const replyResult = await replyOpenCodePermission(client, {
            requestID: id,
            sessionID: sessionId,
            reply,
            directory: workdir,
          });
          if (replyResult?.notFound) {
            appendEvent({ type: "log", text: `OpenCode permission stale ${id}: ${replyResult.message}` });
          } else {
            if ((decision === "accept" || decision === "acceptForSession") && fingerprint) acceptedPermissionFingerprints.add(fingerprint);
            appendEvent({ type: "log", text: `OpenCode permission ${reply} ${id}${replyResult?.method ? ` via ${replyResult.method}` : ""}` });
          }
        }
      };

      const pollPrompt = async (promptState, label, { allowEmptyOnFulfilled = false } = {}) => {
        let output = "";
        const deadline = Date.now() + 180_000;
        let lastMessageSummary = "";
        let lastPromptState = "pending";

        while (Date.now() < deadline) {
          await handlePendingPermissions();
          if (promptState.status === "rejected") throw promptState.reason;
          if (promptState.status === "fulfilled" && promptState.value?.error) {
            throw new Error(formatOpenCodeError(promptState.value.error));
          }
          if (promptState.status === "fulfilled") {
            const data = promptState.value?.data ?? promptState.value;
            const directOutput = partsText(data?.parts ?? promptState.value?.parts ?? []);
            if (directOutput.trim()) return { output: directOutput, promptResult: promptState.value };
          }
          const messagesResult = await client.session.messages({ sessionID: sessionId, directory: workdir, limit: 50 });
          if (messagesResult.error) throw new Error(formatOpenCodeError(messagesResult.error));
          const messageSummary = summarizeOpenCodeMessages(messagesResult.data ?? []);
          const promptStatus = promptState.status;
          if (messageSummary !== lastMessageSummary || promptStatus !== lastPromptState) {
            lastMessageSummary = messageSummary;
            lastPromptState = promptStatus;
            appendEvent({
              type: "log",
              text: `OpenCode SDK poll ${label}=${promptStatus} messages=${(messagesResult.data ?? []).length}${messageSummary ? ` latest=${messageSummary}` : ""}`,
            });
          }
          output = latestNewAssistantText(messagesResult.data ?? [], existingAssistantKeys);
          if (output.trim() && promptState.status === "fulfilled") return { output, promptResult: promptState.value };
          if (promptState.status === "fulfilled" && allowEmptyOnFulfilled) {
            return { output: "", promptResult: promptState.value };
          }
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
        await handlePendingPermissions();
        if (promptState.status === "rejected") throw promptState.reason;
        if (promptState.status === "fulfilled" && promptState.value?.error) {
          throw new Error(formatOpenCodeError(promptState.value.error));
        }
        if (allowEmptyOnFulfilled && promptState.status === "fulfilled") return { output: "", promptResult: promptState.value };
        throw new Error("OpenCode session 已返回，但没有读取到可展示的 assistant 文本。");
      };

      if (typeof client.session.prompt === "function") {
        appendEvent({ type: "log", text: "OpenCode SDK prompt dispatched" });
        const promptState = trackPromise(client.session.prompt({
          sessionID: sessionId,
          directory: workdir,
          agent: promptPayload.agent,
          model: promptPayload.model,
          parts: promptPayload.parts,
        }));
        const result = await pollPrompt(promptState, "prompt", { allowEmptyOnFulfilled: true });
        if (result.output.trim()) {
          await writeSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id, {
            sessionId,
            workdir,
            updatedAt: Date.now(),
          });
          return {
            output: result.output,
            command: [
              "OpenCode SDK session.prompt",
              `baseUrl=${opencodeBaseUrl}`,
              `sessionID=${sessionId}`,
              `directory=${workdir}`,
              "agent=build",
              ctx.model ? `model=${ctx.model}` : "model=<default>",
            ].join("\n"),
            sessionId,
            providerSessionId: sessionId,
            resumeKey: sessionId,
            workdir,
          };
        }
        const data = result.promptResult?.data ?? result.promptResult;
        appendEvent({ type: "log", text: `OpenCode SDK prompt returned no direct text parts=${Array.isArray(data?.parts ?? result.promptResult?.parts) ? (data?.parts ?? result.promptResult?.parts).map((part) => part?.type ?? "unknown").join(",") : "none"}; falling back to promptAsync polling` });
      }

      const promptState = trackPromise(client.session.promptAsync(promptPayload));
      appendEvent({ type: "log", text: "OpenCode SDK promptAsync dispatched" });
      const { output } = await pollPrompt(promptState, "promptAsync");
      await writeSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id, {
        sessionId,
        workdir,
        updatedAt: Date.now(),
      });
      return {
        output,
        command: [
          "OpenCode SDK session.promptAsync",
          `baseUrl=${opencodeBaseUrl}`,
          `sessionID=${sessionId}`,
          `directory=${workdir}`,
          "agent=build",
          ctx.model ? `model=${ctx.model}` : "model=<default>",
        ].join("\n"),
        sessionId,
        providerSessionId: sessionId,
        resumeKey: sessionId,
        workdir,
      };
    },
    async cancel(ctx) {
      const authorization = opencodeAuthorization || (onmyagentServerToken ? `Bearer ${onmyagentServerToken}` : "");
      if (!opencodeBaseUrl || !authorization) throw new Error("OpenCode SDK 连接不可用");
      const session = await readSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
      const sessionId = String(session.sessionId ?? "").trim();
      if (!sessionId) throw new Error("OpenCode session 未找到");
      const client = createClient({
        baseUrl: opencodeBaseUrl,
        directory: ctx.workspaceRoot,
        headers: { authorization },
      });
      unwrap(await client.session.abort({ sessionID: sessionId }));
    },
  };
}

export const __test__ = {
  isReadOnlyOpenCodePermission,
  opencodePermissionKind,
  opencodePermissionCommand,
  opencodePermissionFingerprint,
  openCodeReplyForDecision,
  extractInteractiveSudoCommand,
  interactiveSudoMessage,
};
