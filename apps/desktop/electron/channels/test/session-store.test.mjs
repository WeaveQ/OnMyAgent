/**
 * ChannelSessionStore unit tests
 */

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChannelSessionStore } from "../ChannelSessionStore.mjs";

// Create temp directory
const tmpDir = path.join(os.tmpdir(), `session-store-test-${Date.now()}`);
await fs.mkdir(tmpDir, { recursive: true });

// Test 1: Initialization
console.log("Test 1: Initialization");
const sessionStore = new ChannelSessionStore({ userDataDir: tmpDir });
await sessionStore.initialize();
console.log("✓ Session store initialized");

// Test 2: Create session
console.log("Test 2: Create session");
const session = await sessionStore.getOrCreateSession({
  platformType: "wechat",
  platformUserId: "user-abc",
  agentType: "codex",
  workspace: "/tmp/test-workspace",
  chatId: "chat-xyz",
});
assert.ok(session.id);
assert.equal(session.platformType, "wechat");
assert.equal(session.platformUserId, "user-abc");
assert.equal(session.agentType, "codex");
assert.equal(session.workspace, "/tmp/test-workspace");
assert.equal(session.chatId, "chat-xyz");
console.log("✓ Session created correctly");

// Test 3: Get existing session (should return same for same user+agent)
console.log("Test 3: Get existing session");
const sameSession = await sessionStore.getOrCreateSession({
  platformType: "wechat",
  platformUserId: "user-abc",
  agentType: "codex",
});
assert.equal(sameSession.id, session.id);
console.log("✓ Same session returned for same user+agent");

// Test 4: Different agent should get different session
console.log("Test 4: Different agent gets different session");
const claudeSession = await sessionStore.getOrCreateSession({
  platformType: "wechat",
  platformUserId: "user-abc",
  agentType: "claude-code",
});
assert.notEqual(claudeSession.id, session.id);
console.log("✓ Different session for different agent");

// Test 5: Add message to session
console.log("Test 5: Add message to session");
await sessionStore.addSessionMessage(session.id, {
  role: "user",
  content: "Hello, world!",
  timestamp: Date.now(),
});
await sessionStore.addSessionMessage(session.id, {
  role: "assistant",
  content: "Hi there!",
  timestamp: Date.now(),
});
const messages = sessionStore.getSessionMessages(session.id);
assert.equal(messages.length, 2);
assert.equal(messages[0].content, "Hello, world!");
assert.equal(messages[1].content, "Hi there!");
console.log("✓ Messages added and retrieved correctly");

// Test 6: Get session by ID
console.log("Test 6: Get session by ID");
const retrieved = sessionStore.getSession(session.id);
assert.equal(retrieved.id, session.id);
console.log("✓ Session retrieved by ID correctly");

// Test 7: Get sessions by platform
console.log("Test 7: Get sessions by platform");
const wechatSessions = sessionStore.getSessionsByPlatform("wechat");
assert.ok(wechatSessions.length >= 2);
console.log("✓ Sessions retrieved by platform correctly");

// Test 8: Get sessions by user
console.log("Test 8: Get sessions by user");
const userSessions = sessionStore.getSessionsByUser("wechat", "user-abc");
assert.ok(userSessions.length >= 2);
console.log("✓ Sessions retrieved by user correctly");

// Test 9: Update session metadata
console.log("Test 9: Update session metadata");
await sessionStore.updateSessionMetadata(session.id, { key: "value" });
const updated = sessionStore.getSession(session.id);
assert.deepEqual(updated.metadata, { key: "value" });
console.log("✓ Session metadata updated correctly");

// Test 9b: conversationId field + bindConversation + getConversationId (parity S1)
console.log("Test 9b: conversationId bind + get");
assert.equal(sessionStore.getConversationId(session.id), null, "fresh session has no conversationId");
const bound = await sessionStore.bindConversation(session.id, "conv-test-123");
assert.equal(bound.conversationId, "conv-test-123");
assert.equal(sessionStore.getConversationId(session.id), "conv-test-123");
// Idempotent rebind of same id
await sessionStore.bindConversation(session.id, "conv-test-123");
assert.equal(sessionStore.getConversationId(session.id), "conv-test-123");
// Persistence: reload store from disk reflects the binding
const reloaded = new ChannelSessionStore({ userDataDir: tmpDir });
await reloaded.initialize();
assert.equal(reloaded.getConversationId(session.id), "conv-test-123", "conversationId persists across reload");
await reloaded.dispose();
console.log("✓ conversationId bound and persisted correctly");

// Test 10: Close session
console.log("Test 10: Close session");
const sessionToClose = await sessionStore.getOrCreateSession({
  platformType: "feishu",
  platformUserId: "temp-user",
  agentType: "codex",
});
await sessionStore.closeSession(sessionToClose.id);
const closed = sessionStore.getSession(sessionToClose.id);
assert.ok(closed.closedAt);
console.log("✓ Session closed correctly");

// Cleanup
await sessionStore.dispose();
await fs.rm(tmpDir, { recursive: true, force: true });

console.log("\n✅ All ChannelSessionStore tests passed!");
