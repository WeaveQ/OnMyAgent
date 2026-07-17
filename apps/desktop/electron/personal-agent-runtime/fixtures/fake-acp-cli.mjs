#!/usr/bin/env node
import { createInterface } from "node:readline";

let sessionCounter = 0;
const noSetModel = process.argv.includes("--no-set-model");
const failToolAfterAssistant = process.argv.includes("--fail-tool-after-assistant");
const truncatedReply = process.argv.includes("--truncated-reply");
const maxTokensStop = process.argv.includes("--max-tokens-stop");
const continuationCompletes = process.argv.includes("--continuation-completes");
const authRequired = process.argv.includes("--auth-required");
const emitThoughtStream = process.argv.includes("--emit-thought-stream");
const emitReasoningInline = process.argv.includes("--emit-reasoning-inline");
const emitPlanUpdate = process.argv.includes("--emit-plan-update");
let promptCounter = 0;

function sendResponse(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendNotification(method, params) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
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
    sessionCounter += 1;
    sendResponse(id, {
      sessionId: `fake-session-${sessionCounter}`,
      configOptions: [],
      models: { currentModelId: "fake-model-1", availableModels: [{ id: "fake-model-1", name: "Fake Model" }] },
    });
    return;
  }
  if (method === "session/prompt") {
    promptCounter += 1;
    const sessionId = params?.sessionId || "unknown";
    const promptText = Array.isArray(params?.prompt) && params.prompt[0]?.text ? params.prompt[0].text : "unknown";
    const isContinuation = /previous response appears incomplete|continue exactly from where it stopped/i.test(promptText);
    let response = continuationCompletes && isContinuation
      ? "，后续补齐内容，形成完整结论。"
      : truncatedReply
        ? "**3. AI 对就业影响成为主流议题**"
        : `Fake response to: ${promptText}`;
    if (/approval/i.test(promptText)) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: `perm-${id}`, method: "session/request_permission", params: { toolName: "Bash", command: "touch /tmp/fake-acp", options: [{ optionId: "reject", label: "Reject" }, { optionId: "approve", label: "Approve" }, { optionId: "approve_for_session", label: "Approve for session" }] } })}\n`);
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
    const stopReason = maxTokensStop && (!continuationCompletes || promptCounter === 1) ? "max_tokens" : "end_turn";
    sendResponse(id, { stopReason, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } });
    return;
  }
  if (method === "session/cancel") return;
  if (method === "session/set_model" && noSetModel) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: session/set_model" } })}\n`);
    return;
  }
  if (method === "config/set" || method === "session/set_config_option") {
    sendResponse(id, {
      confirmation: `Set ${params?.optionId ?? params?.id ?? "option"}`,
      config_options: [{ id: params?.optionId ?? "mode", label: "Mode", type: "select", value: params?.value ?? null, options: ["default", "plan"] }],
    });
    return;
  }
  if (["session/set_mode", "session/set_model"].includes(method)) {
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
