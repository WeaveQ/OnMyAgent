import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
let nextId = 1000;
const pending = new Map();
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id >= 1000) {
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message); }
    return;
  }
  if (message.method === "hang") return;
  if (message.method === "oversized") {
    process.stdout.write(`${"x".repeat(1024 * 1024 + 1)}\n`);
  }
  if (message.method === "session/cancel") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "cancel/observed", params: message.params })}\n`);
    return;
  }
  if (message.method === "initialize") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, resume: {}, close: {} } },
      _meta: { agentVersion: "1.0.0" },
    } })}\n`);
    return;
  }
  if (message.method === "error") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -1, message: "secret detail" } })}\n`);
    return;
  }
  if (message.method === "auth-error") {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "Authentication required", data: "secret provider detail" } })}\n`);
    return;
  }
  if (message.method === "permission") {
    const id = nextId++;
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "session/request_permission", params: { options: [{ optionId: "allow-once" }] } })}\n`);
    pending.set(id, (response) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: response.result })}\n`));
    return;
  }
  process.stdout.write("not-json\n");
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "x.ai/unknown", params: { safe: true } })}\n`);
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } })}\n`);
});
