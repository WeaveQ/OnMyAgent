import { spawn } from "node:child_process";
import net from "node:net";

import { injectPersonalAgentContext } from "../context-injection.mjs";
import { extractAcpSessionId, normalizeAcpUpdate, spawnAcpClient, textFromAcpContent } from "../acp-client.mjs";
import { readSession, writeSession } from "../session-store.mjs";
import { createExecHelpers, stringifyAgentCommand } from "../utils.mjs";
import { ensureProviderWorkdir } from "../workdir.mjs";

const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_CODEX_REASONING_EFFORT = "medium";
const OPENCLAW_DEFAULT_GATEWAY_PORT = 18789;

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

function codexModeForApprovalMode(approvalMode) {
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

export function createGenericAcpAdapter({ appendEvent, registerCancel }) {
  const execHelpers = createExecHelpers();
  const active = new Map();

  return {
    provider: "acp",
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
      const { child, client } = spawnAcpClient({
        command: executablePath,
        args,
        cwd: workdir,
        env,
        appendEvent,
        onNotification: (params) => {
          const { type, data } = normalizeAcpUpdate(params.update ?? params);
          if (type === "agent_message_chunk") {
            const text = textFromAcpContent(data);
            if (text) {
              outputParts.push(text);
              appendEvent({ type: "assistant_chunk", text });
            }
            return;
          }
          if (type === "agent_thought_chunk") {
            const text = textFromAcpContent(data).trim();
            if (text) appendEvent({ type: "log", text: `thought> ${text.slice(0, 1200)}` });
            return;
          }
          if (type === "tool_call" || type === "tool_call_update") {
            const toolText = textFromAcpContent(data) || JSON.stringify(data ?? {});
            const toolCall = acpToolCallFromUpdate(type, data);
            appendEvent({ type: "tool", text: `acp_${type}> ${toolText}`, toolCall });
            if (type === "tool_call_update" && String(data?.status ?? "").toLowerCase() === "failed") {
              failedToolUpdates.push(toolText);
            }
          }
          if (type === "available_commands") appendEvent({ type: "status", text: `acp_available_commands> ${JSON.stringify(data?.commands ?? data?.availableCommands ?? data ?? [])}` });
          if (type === "context_usage" || type === "usage_update") appendEvent({ type: "status", text: `acp_${type}> ${JSON.stringify(data ?? {})}` });
          if (type === "error") appendEvent({ type: "error", text: textFromAcpContent(data) || JSON.stringify(data ?? {}) });
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
        child.kill("SIGTERM");
        if (ctx.runId) active.delete(ctx.runId);
      });

      try {
        await client.request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "onmyagent-personal-agent", version: "0.1.0" },
          clientCapabilities: {},
        });
        const stored = await readSession(ctx.workspaceRoot, provider, ctx.agent.id);
        const explicitSessionId = normalizeExplicitSessionId(provider, ctx.resumeKey ?? ctx.providerSessionId);
        const storedSessionId = shouldResumeProviderSession(provider, ctx, stored)
          ? String(explicitSessionId || stored.sessionId || "").trim()
          : "";
        const modelId = normalizeModelId(provider, ctx.model);
        if (storedSessionId) {
          try {
            const resumed = await client.request("session/resume", { sessionId: storedSessionId, cwd: workdir, ...(modelId ? { model: modelId } : {}) });
            sessionId = extractAcpSessionId(resumed) || storedSessionId;
            appendEvent({ type: "log", text: `${provider} ACP session resumed ${sessionId}` });
          } catch (error) {
            appendEvent({ type: "log", text: `${provider} ACP resume failed; creating new session: ${error.message}` });
          }
        }
        if (!sessionId) {
          const created = await client.request("session/new", { cwd: workdir, mcpServers: [], ...(modelId ? { model: modelId } : {}) });
          sessionId = extractAcpSessionId(created);
          if (!sessionId) throw new Error(`${provider} ACP session/new returned no sessionId`);
          appendEvent({ type: "log", text: `${provider} ACP session created ${sessionId}` });
        }
        if (provider === "codex") {
          const modeId = codexModeForApprovalMode(ctx.approvalMode);
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
        await client.request("session/prompt", { sessionId, prompt: [{ type: "text", text: ctx.prompt }] }, DEFAULT_TURN_TIMEOUT_MS);
        const output = outputParts.join("").trim();
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
        return {
          output,
          command: [command, `sessionID=${sessionId}`, `cwd=${workdir}`, modelId ? `model=${modelId}` : "model=<default>"].join("\n"),
          connectionMode: `${ctx.agent.name || provider} ACP session`,
          providerSessionId: sessionId,
          resumeKey: sessionId,
          sessionId,
          workdir,
          pid: child.pid ?? null,
          metadata: { agent_type: "acp", provider, connectionMode: `${ctx.agent.name || provider} ACP session`, managedAcpTool: ctx.agent.managedAcpTool ?? null },
        };
      } finally {
        if (ctx.runId) active.delete(ctx.runId);
        client.dispose();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        await waitForExit(child);
        for (const owned of ownedProcesses) {
          if (owned.exitCode === null && owned.signalCode === null) owned.kill("SIGTERM");
          await waitForExit(owned, 2_000);
        }
      }
    },
    async cancel(ctx) {
      const child = active.get(ctx.runId);
      if (!child) throw new Error("ACP run is not active");
      child.kill("SIGTERM");
      active.delete(ctx.runId);
    },
  };
}

export const __test__ = {
  normalizeModelId,
  shouldResumeProviderSession,
  normalizeExplicitSessionId,
  acpFailureCode,
  codexModeForApprovalMode,
  supportsSessionSetModel,
  createGenericAcpAdapterForTest: createGenericAcpAdapter,
};
