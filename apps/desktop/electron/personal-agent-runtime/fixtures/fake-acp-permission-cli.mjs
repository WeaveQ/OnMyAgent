#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

let nextSession = 1;
const pendingPrompts = new Map();

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function permissionOptions() {
  return [
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
    { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
    { optionId: "reject-once", name: "Reject", kind: "reject_once" },
  ];
}

async function handlePermissionResponse(message) {
  const pending = pendingPrompts.get(String(message.id));
  if (!pending) return;
  pendingPrompts.delete(String(message.id));
  const selected = message.result?.outcome?.outcome === "selected"
    ? String(message.result.outcome.optionId ?? "")
    : String(message.result?.optionId ?? "");
  const accepted = selected === "allow-once" || selected === "allow-always";
  if (accepted && pending.fixturePath) {
    await writeFile(pending.fixturePath, "accepted\n", "utf8");
  }
  const text = accepted ? "permission accepted" : "permission denied";
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: pending.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  })}\n`);
  respond(pending.promptId, { stopReason: "end_turn" });
}

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    respond(id, {
      protocolVersion: 1,
      capabilities: { permissions: true },
      agentInfo: { name: "fake-acp-permission-cli", version: "1.0.0" },
    });
    return;
  }
  if (method === "session/new") {
    respond(id, { sessionId: `permission-session-${nextSession++}` });
    return;
  }
  if (method === "session/prompt") {
    const sessionId = String(params?.sessionId ?? "permission-session");
    const fixturePath = String(params?.prompt?.[0]?.text ?? "").replace(/^fixture:/, "").trim();
    const permissionId = `permission-${id}`;
    pendingPrompts.set(permissionId, { fixturePath, promptId: id, sessionId });
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: permissionId,
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: { toolCallId: `tool-${id}`, title: "Write isolated fixture" },
        toolName: "Write",
        command: `write ${fixturePath}`,
        cwd: fixturePath ? fixturePath.replace(/[/\\][^/\\]+$/, "") : null,
        options: permissionOptions(),
      },
    })}\n`);
    return;
  }
  if (method === "session/cancel") {
    respond(id, {});
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
  Promise.resolve()
    .then(() => {
      const message = JSON.parse(trimmed);
      if (message.method === undefined && message.id !== undefined) {
        return handlePermissionResponse(message);
      }
      return handleRequest(message);
    })
    .catch((error) => process.stderr.write(`fake permission ACP error: ${error.message}\n`));
});
