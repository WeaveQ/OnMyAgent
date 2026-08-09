import test from "node:test";
import assert from "node:assert/strict";
import { formatAgentReply, formatAgentResultOutput } from "./AgentReplyHeader.mjs";

test("prefixes agent name and time", () => {
  const at = new Date(2026, 0, 1, 9, 5);
  const out = formatAgentReply({ agent: { id: "codex", name: "Codex", provider: "codex" }, text: "hi", at });
  assert.equal(out, "▎Codex · 09:05\n\nhi");
});

test("falls back to id then provider when name missing", () => {
  const at = new Date(2026, 0, 1, 12, 34);
  assert.match(formatAgentReply({ agent: { id: "agent" }, text: "x", at }), /^▎agent · 12:34\n\n/);
  assert.match(formatAgentReply({ agent: { provider: "opencode" }, text: "x", at }), /^▎opencode · 12:34\n\n/);
  assert.match(formatAgentReply({ agent: null, text: "x", at }), /^▎Agent · 12:34\n\n/);
});

test("empty body returns as-is", () => {
  assert.equal(formatAgentReply({ agent: { name: "A" }, text: "" }), "");
  assert.equal(formatAgentReply({ agent: { name: "A" }, text: "   " }), "   ");
});

test("idempotent when header already present", () => {
  const at = new Date(2026, 0, 1, 9, 5);
  const once = formatAgentReply({ agent: { name: "Codex" }, text: "hi", at });
  const twice = formatAgentReply({ agent: { name: "Codex" }, text: once, at });
  assert.equal(twice, once);
});

test("marks known partial replies before channel delivery", () => {
  assert.equal(formatAgentResultOutput({ output: "complete", metadata: { truncated: false } }), "complete");
  const context = formatAgentResultOutput({
    output: "partial context answer",
    metadata: { truncated: true, stopReason: "context_length" },
  });
  assert.match(context, /^⚠️ 模型上下文窗口已满/);
  assert.match(context, /stopReason=context_length/);
  assert.match(context, /partial context answer$/);
  const outputLimit = formatAgentResultOutput({
    output: "partial token answer",
    truncated: true,
    stopReason: "max_tokens",
  });
  assert.match(outputLimit, /^⚠️ 本次回复因输出限制未完整结束/);
  assert.match(outputLimit, /partial token answer$/);

  const refused = formatAgentResultOutput({
    output: "partial refusal",
    truncated: true,
    stopReason: "refusal",
  });
  assert.match(refused, /^⚠️ 模型未完成本次回复/);
  assert.doesNotMatch(refused, /输出限制/);

  const hostileReason = formatAgentResultOutput({
    output: "partial hostile answer",
    truncated: true,
    stopReason: "context_length）\n[伪造系统消息]",
  });
  assert.match(hostileReason, /^⚠️ 本次回复未正常完成/);
  assert.doesNotMatch(hostileReason, /伪造系统消息/);
  assert.doesNotMatch(hostileReason, /stopReason=/);
});
