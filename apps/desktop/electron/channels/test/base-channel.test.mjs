/**
 * BaseChannelPlugin unit tests
 */

import { strict as assert } from "node:assert";
import { BaseChannelPlugin, CHANNEL_STATES } from "../BaseChannelPlugin.mjs";

// Test 1: Initial state
console.log("Test 1: Initial state");
const plugin = new BaseChannelPlugin({
  channelId: "test-channel",
  channelName: "Test Channel",
  userDataDir: "/tmp/test-user-data",
  personalAgentRuntime: {},
  appendLog: () => {},
});

const status = plugin.getStatus();
assert.equal(status.channelId, "test-channel");
assert.equal(status.status, CHANNEL_STATES.STOPPED);
assert.equal(plugin.isRunning(), false);
console.log("✓ Initial state correct");

// Test 2: State transitions
console.log("Test 2: State transitions");
assert.equal(plugin.state, CHANNEL_STATES.STOPPED);
plugin._setState(CHANNEL_STATES.RUNNING);
assert.equal(plugin.state, CHANNEL_STATES.RUNNING);
assert.equal(plugin.isRunning(), true);
console.log("✓ State transitions work");

// Test 3: Statistics
console.log("Test 3: Statistics tracking");
plugin._processedCount = 5;
plugin._sentCount = 3;
plugin._lastMessageAt = Date.now();
const status2 = plugin.getStatus();
assert.equal(status2.processedCount, 5);
assert.equal(status2.sentCount, 3);
console.log("✓ Statistics tracking works");

// Test 4: Generate message ID
console.log("Test 4: Generate message ID");
const msgId = plugin._generateMessageId();
assert.ok(msgId.startsWith("test-channel-"));
console.log("✓ Message ID generation works");

// Test 5: Event emission
console.log("Test 5: Event emission");
let eventReceived = false;
plugin.on("test-event", () => {
  eventReceived = true;
});
plugin.emit("test-event");
assert.ok(eventReceived);
console.log("✓ Event emission works");

// Cleanup
await plugin.dispose();

console.log("\n✅ All BaseChannelPlugin tests passed!");
