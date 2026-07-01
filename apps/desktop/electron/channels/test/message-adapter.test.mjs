/**
 * ChannelMessageAdapter unit tests
 */

import { strict as assert } from "node:assert";
import { ChannelMessageAdapter } from "../ChannelMessageAdapter.mjs";

// Test 1: Format streaming delta
console.log("Test 1: Format streaming delta");
const adapter = new ChannelMessageAdapter();
const delta = adapter.formatStreamingDelta({
  text: "Hello",
  toolCalls: [{ name: "execute_command", arguments: {} }],
  isStreaming: true,
}, "wechat");
assert.equal(delta.text.includes("Hello"), true);
assert.equal(delta.isStreaming, true);
console.log("✓ Streaming delta formatted correctly");

// Test 2: Format agent response
console.log("Test 2: Format agent response");
const response = adapter.formatAgentResponse({
  content: "This is the answer",
  toolCalls: [{ name: "execute_command" }],
  approvalRequests: [{ id: "req-1", title: "Approve this?" }],
}, "feishu");
assert.equal(response.content.includes("This is the answer"), true);
assert.equal(response.toolCalls.length, 1);
console.log("✓ Agent response formatted correctly");

// Test 3: Rate limiting
console.log("Test 3: Rate limiting");
for (let i = 0; i < 10; i++) {
  const limited = adapter.checkRateLimit("wechat", "user1");
  assert.equal(limited, false);
}
// 11th message should be rate limited
const limited = adapter.checkRateLimit("wechat", "user1");
assert.equal(limited, true);
console.log("✓ Rate limiting works correctly");

// Test 4: Deduplication
console.log("Test 4: Deduplication");
const msgId = "test-msg-123";
assert.equal(adapter.isDuplicate(msgId), false);
adapter.markAsSeen(msgId);
assert.equal(adapter.isDuplicate(msgId), true);
console.log("✓ Deduplication works correctly");

// Test 5: Parse incoming message with command
console.log("Test 5: Parse incoming message with command");
const parsed1 = adapter.parseIncomingMessage({
  id: "msg-1",
  userId: "user1",
  content: "#agent codex",
}, "wechat");
assert.equal(parsed1.command, "agent");
assert.deepEqual(parsed1.commandArgs, ["codex"]);
console.log("✓ Command parsing works correctly");

// Test 6: Parse incoming message without command
console.log("Test 6: Parse incoming message without command");
const parsed2 = adapter.parseIncomingMessage({
  id: "msg-2",
  userId: "user1",
  content: "Hello, how are you?",
}, "wechat");
assert.equal(parsed2.command, null);
assert.equal(parsed2.commandArgs, null);
console.log("✓ Non-command message parsing works correctly");

// Test 7: WeChat truncation
console.log("Test 7: WeChat truncation");
const longText = "x".repeat(2500);
const truncated = adapter._truncateForWechat(longText);
assert.ok(truncated.length < 2000, "Truncated text should be under 2000 chars");
assert.ok(truncated.includes("截断"), "Should include truncation indicator");
console.log("✓ WeChat truncation works correctly");

// Test 8: Tool call formatting
console.log("Test 8: Tool call formatting");
const toolCallsText = adapter._formatToolCalls([
  { name: "execute_command" },
  { name: "read_file" },
]);
assert.ok(toolCallsText.includes("execute_command"), "Should include execute_command");
assert.ok(toolCallsText.includes("read_file"), "Should include read_file");
console.log("✓ Tool call formatting works correctly");

// Cleanup
adapter.dispose();

console.log("\n✅ All ChannelMessageAdapter tests passed!");
