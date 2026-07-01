#!/usr/bin/env node
import { createInterface } from "node:readline";

let sessionCounter = 0;
const noSetModel = process.argv.includes("--no-set-model");
const failToolAfterAssistant = process.argv.includes("--fail-tool-after-assistant");

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
    sessionCounter += 1;
    sendResponse(id, {
      sessionId: `fake-session-${sessionCounter}`,
      configOptions: [],
      models: { currentModelId: "fake-model-1", availableModels: [{ id: "fake-model-1", name: "Fake Model" }] },
    });
    return;
  }
  if (method === "session/prompt") {
    const sessionId = params?.sessionId || "unknown";
    const promptText = Array.isArray(params?.prompt) && params.prompt[0]?.text ? params.prompt[0].text : "unknown";
    const response = `Fake response to: ${promptText}`;
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
    sendResponse(id, { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } });
    return;
  }
  if (method === "session/cancel") return;
  if (method === "session/set_model" && noSetModel) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: session/set_model" } })}\n`);
    return;
  }
  if (["session/set_mode", "session/set_model", "session/set_config_option"].includes(method)) {
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
