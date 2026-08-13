#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

let sessionCounter = 0;
const noSetModel = process.argv.includes("--no-set-model");
const noModelConfigOption = process.argv.includes("--no-model-config-option");
const noStandardConfig = process.argv.includes("--no-standard-config");
const noLegacyConfig = process.argv.includes("--no-legacy-config");
const rejectStandardConfig = process.argv.includes("--reject-standard-config");
const failToolAfterAssistant = process.argv.includes("--fail-tool-after-assistant");
const transportDisconnectAfterAssistant = process.argv.includes("--transport-disconnect-after-assistant");
const truncatedReply = process.argv.includes("--truncated-reply");
const emptyReply = process.argv.includes("--empty-reply");
const maxTokensStop = process.argv.includes("--max-tokens-stop");
const contextLengthStop = process.argv.includes("--context-length-stop");
const continuationCompletes = process.argv.includes("--continuation-completes");
const expiredApproval = process.argv.includes("--approval-expired");
const correlatedApprovalTool = process.argv.includes("--correlated-approval-tool");
const claudeModeSensitiveApproval = process.argv.includes("--claude-mode-sensitive-approval");
const authRequired = process.argv.includes("--auth-required");
const emitThoughtStream = process.argv.includes("--emit-thought-stream");
const emitReasoningInline = process.argv.includes("--emit-reasoning-inline");
const emitPlanUpdate = process.argv.includes("--emit-plan-update");
const taskOrchestratorMode = process.argv.includes("--task-orchestrator-mode")
  || process.env.TASK_ORCHESTRATOR_FAKE_MODE === "1";
const taskOrchestratorDelayMs = Math.max(
  0,
  Number(process.env.TASK_ORCHESTRATOR_FAKE_DELAY_MS ?? 0) || 0,
);
const sessionEventsFile = process.argv.find((arg) => arg.startsWith("--session-events-file="))?.slice("--session-events-file=".length)
  ?? process.env.TASK_ORCHESTRATOR_FAKE_SESSION_EVENTS_FILE
  ?? "";
let promptCounter = 0;
let sessionCwd = "";
let sessionPermissionMode = claudeModeSensitiveApproval ? "bypassPermissions" : "default";

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendNotification(method, params) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function recordSessionMethod(method, params) {
  if (!sessionEventsFile) return;
  appendFileSync(sessionEventsFile, `${JSON.stringify({
    method,
    cwd: params?.cwd ?? null,
    processCwd: process.cwd(),
    sessionId: params?.sessionId ?? null,
    model: params?.model ?? null,
    modelId: params?.modelId ?? null,
    configId: params?.configId ?? null,
    optionId: params?.optionId ?? null,
    value: params?.value ?? null,
  })}\n`, "utf8");
}

function handleRequest(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    sendResponse(id, {
      protocolVersion: 1,
      capabilities: { streaming: true, sessionManagement: true, permissions: true },
      agentInfo: { name: "fake-acp-cli", version: "1.0.0" },
      configOptions: [{ id: "mode", label: "Mode", type: "select", options: ["default", "plan"] }],
      availableCommands: [{ name: "/help", description: "Show help" }],
      models: { currentModelId: "fake-model-1", availableModels: [{ id: "fake-model-1", name: "Fake Model" }] },
    });
    return;
  }
  if (method === "session/new") {
    if (authRequired) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32001, message: "Authentication required: please login first" } })}\n`);
      return;
    }
    sessionCwd = String(params?.cwd ?? "");
    recordSessionMethod(method, params);
    sessionCounter += 1;
    sendResponse(id, {
      sessionId: `fake-session-${sessionCounter}`,
      configOptions: noModelConfigOption
        ? []
        : [
          ...(claudeModeSensitiveApproval ? [{
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            currentValue: sessionPermissionMode,
            options: [
              { value: "default", name: "Default" },
              { value: "bypassPermissions", name: "Bypass permissions" },
            ],
          }] : []),
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "fake-model-1",
            options: [
              { value: "sonnet", name: "deepseek-v4-flash" },
              { value: "claude-sonnet-test", name: "Claude Sonnet Test" },
              { value: "fake-model-1", name: "Fake Model" },
            ],
          },
        ],
      models: { currentModelId: "fake-model-1", availableModels: [{ id: "fake-model-1", name: "Fake Model" }] },
    });
    return;
  }
  if (method === "session/resume") {
    recordSessionMethod(method, params);
    if (params?.sessionId === "missing-provider-session") {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32004, message: "Session not found" } })}\n`);
      return;
    }
    sendResponse(id, { sessionId: params?.sessionId ?? "fake-resumed-session" });
    return;
  }
  if (method === "session/prompt") {
    promptCounter += 1;
    const sessionId = params?.sessionId || "unknown";
    const promptText = Array.isArray(params?.prompt) && params.prompt[0]?.text ? params.prompt[0].text : "unknown";
    const isContinuation = /previous response appears incomplete|continue exactly from where it stopped/i.test(promptText);
    const taskRole = /Role: (planner|implementer|verifier)/.exec(promptText)?.[1] ?? "";
    if (taskOrchestratorMode && taskRole === "implementer") {
      if (!sessionCwd) throw new Error("task orchestrator fake ACP received no session cwd");
      writeFileSync(path.join(sessionCwd, "proof.txt"), "FAKE_ACP_TASK_MUTATION\n", "utf8");
    }
    let response = emptyReply
      ? ""
      : taskOrchestratorMode && taskRole === "planner"
        ? "# Plan\nCreate proof.txt in the task workspace and verify it."
        : taskOrchestratorMode && taskRole === "implementer"
          ? "Created proof.txt in the task workspace."
          : taskOrchestratorMode && taskRole === "verifier"
            ? 'Verified proof.txt.\n<task-orchestrator-verdict>{"verdict":"approved","summary":"Fake ACP workspace mutation verified.","issues":[]}</task-orchestrator-verdict>'
            : continuationCompletes && isContinuation
              ? "，后续补齐内容，形成完整结论。"
              : truncatedReply
                ? "**3. AI 对就业影响成为主流议题**"
                : `Fake response to: ${promptText}`;
    if (transportDisconnectAfterAssistant) {
      response = `${response}\nstream disconnected before completion: error sending request for url (https://example.invalid/responses)`;
    }
    if (/approval/i.test(promptText) || claudeModeSensitiveApproval) {
      if (correlatedApprovalTool) {
        sendNotification("session/update", {
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call-fake-write",
            title: "Terminal",
            kind: "execute",
            status: "pending",
            rawInput: { command: "printf proof > proof.txt", description: "Create proof" },
            _meta: { claudeCode: { toolName: "Bash" } },
          },
        });
      }
      if (!claudeModeSensitiveApproval || sessionPermissionMode !== "bypassPermissions") {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: `perm-${id}`, method: "session/request_permission", params: correlatedApprovalTool ? { toolCall: { toolCallId: "call-fake-write", kind: "execute", status: "pending" }, ...(expiredApproval ? { expiresAt: Date.now() - 1 } : {}), options: [{ optionId: "reject", label: "Reject" }, { optionId: "approve", label: "Approve" }, { optionId: "approve_for_session", label: "Approve for session" }] } : { toolName: "Bash", command: "touch /tmp/fake-acp", ...(expiredApproval ? { expiresAt: Date.now() - 1 } : {}), options: [{ optionId: "reject", label: "Reject" }, { optionId: "approve", label: "Approve" }, { optionId: "approve_for_session", label: "Approve for session" }] } })}\n`);
      }
      if (correlatedApprovalTool) {
        sendNotification("session/update", {
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-fake-write",
            status: "completed",
            rawOutput: "proof created",
          },
        });
      }
    }
    sendNotification("session/update", {
      sessionId,
      update: { sessionUpdate: "available_commands", commands: [{ name: "/help", description: "Show help" }] },
    });
    sendNotification("session/update", {
      sessionId,
      update: { sessionUpdate: "context_usage", used: 10, total: 100 },
    });
    if (emitThoughtStream) {
      sendNotification("session/update", { sessionId, update: { sessionUpdate: "thought", content: { type: "text", text: "step-a " }, msg_id: "thought-1" } });
      sendNotification("session/update", { sessionId, update: { sessionUpdate: "thought", content: { type: "text", text: "step-b" }, msg_id: "thought-1" } });
    }
    if (emitReasoningInline) {
      sendNotification("session/update", { sessionId, update: { sessionUpdate: "agent_message_chunk", content: [{ type: "thought", text: "inline-thought " }, { type: "text", text: "hello" }], msg_id: "m-inline" } });
    }
    if (emitPlanUpdate) {
      sendNotification("session/update", { sessionId, update: { sessionUpdate: "plan", entries: [{ content: "Step 1", status: "in_progress" }, { content: "Step 2", status: "pending" }] } });
    }
    for (const chunk of [response.slice(0, 10), response.slice(10)]) {
      sendNotification("session/update", {
        sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } },
      });
    }
    if (failToolAfterAssistant) {
      sendNotification("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          status: "failed",
          content: [{ type: "text", text: "User refused permission to run tool" }],
        },
      });
    }
    const stopReason = contextLengthStop
      ? "context_length"
      : maxTokensStop && (!continuationCompletes || promptCounter === 1)
        ? "max_tokens"
        : "end_turn";
    const finishPrompt = () => {
      sendResponse(id, { stopReason, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } });
    };
    if (taskOrchestratorMode && taskRole === "implementer" && taskOrchestratorDelayMs > 0) {
      setTimeout(finishPrompt, taskOrchestratorDelayMs);
    } else {
      finishPrompt();
    }
    return;
  }
  if (method === "session/cancel") return;
  if (method === "session/set_model" && noSetModel) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: session/set_model" } })}\n`);
    return;
  }
  if (method === "config/set") {
    recordSessionMethod(method, params);
    if (noLegacyConfig) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: config/set" } })}\n`);
      return;
    }
    sendResponse(id, {
      confirmation: `Set ${params?.optionId ?? "option"}`,
      config_options: [{ id: params?.optionId ?? "mode", value: params?.value ?? null }],
    });
    return;
  }
  if (method === "session/set_config_option") {
    recordSessionMethod(method, params);
    if (noStandardConfig) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: session/set_config_option" } })}\n`);
      return;
    }
    if (rejectStandardConfig) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message: `Config option not found: ${params?.configId ?? "unknown"}` } })}\n`);
      return;
    }
    const canonicalValue = params?.value === "deepseek-v4-flash" ? "sonnet" : params?.value ?? null;
    if (params?.configId === "mode") sessionPermissionMode = String(canonicalValue ?? "");
    sendResponse(id, {
      configOptions: [{
        id: params?.configId ?? "mode",
        name: params?.configId === "model" ? "Model" : "Mode",
        category: params?.configId === "model" ? "model" : "mode",
        type: "select",
        currentValue: canonicalValue,
        options: [],
      }],
    });
    return;
  }
  if (["session/set_mode", "session/set_model"].includes(method)) {
    recordSessionMethod(method, params);
    sendResponse(id, {});
    return;
  }
  if (id !== undefined) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } })}\n`);
  }
}

const stdin = createInterface({ input: process.stdin, terminal: false });
stdin.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handleRequest(JSON.parse(trimmed));
  } catch (error) {
    process.stderr.write(`parse error: ${error.message}\n`);
  }
});
