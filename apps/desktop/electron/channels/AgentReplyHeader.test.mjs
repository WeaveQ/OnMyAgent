import test from "node:test";
import assert from "node:assert/strict";
import { formatAgentReply } from "./AgentReplyHeader.mjs";

test("prefixes agent name and time", () => {
  const at = new Date(2026, 0, 1, 9, 5);
  const out = formatAgentReply({ agent: { id: "codex", name: "Codex", provider: "codex" }, text: "hi", at });
  assert.equal(out, "▎Codex · 09:05\n\nhi");
});

test("falls back to id then provider when name missing", () => {
  const at = new Date(2026, 0, 1, 12, 34);
  assert.match(formatAgentReply({ agent: { id: "aion" }, text: "x", at }), /^▎aion · 12:34\n\n/);
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
