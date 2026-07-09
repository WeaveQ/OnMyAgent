/**
 * Channel <-> Studio conversation sync (parity S1/S2/S3) — focused unit tests.
 *
 * Covers:
 * - conversation-store.createConversation({ source: "channel", metadata }) persists
 *   source + channelChatId (parity S1-03).
 * - ChannelSessionStore rebind reuse: same chat binds one conversation and
 *   subsequent lookups reuse it (parity S2-02).
 * - ChannelStreamRelay mock-stream fan-out to an IM send sink (parity S3-04).
 */

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ChannelSessionStore } from "../ChannelSessionStore.mjs";
import { createConversation, listConversations, getConversation } from "../../personal-agent-runtime/conversation-store.mjs";
import { ChannelStreamRelay } from "../ChannelStreamRelay.mjs";

const tmpBase = path.join(os.tmpdir(), `chan-conv-sync-test-${Date.now()}`);
const channelDir = path.join(tmpBase, "channel");
const workspaceRoot = path.join(tmpBase, "workspace");

await fs.mkdir(channelDir, { recursive: true });
await fs.mkdir(workspaceRoot, { recursive: true });

// ---- Test A: conversation-store accepts source:"channel" + channelChatId (S1-03) ----
console.log("Test A: createConversation source:channel persists metadata");
const conv = await createConversation(workspaceRoot, "codex", "agent-1", {
  source: "channel",
  title: "微信 user@chat",
  metadata: { channelChatId: "chat-abc", platformType: "wechat", platformUserId: "user-1" },
});
assert.equal(conv.source, "channel");
assert.equal(conv.metadata?.channelChatId, "chat-abc");
assert.equal(conv.metadata?.platformType, "wechat");
// Reload from disk to prove durability.
const listed = await listConversations(workspaceRoot, "codex", "agent-1");
const reloaded = listed.conversations.find((c) => c.id === conv.id);
assert.ok(reloaded, "conversation durable on disk");
assert.equal(reloaded.source, "channel");
assert.equal(reloaded.metadata?.channelChatId, "chat-abc");
console.log("✓ conversation created with source:channel + channelChatId persisted");

// ---- Test B: session binds one conversation, reused (S2-02) ----
console.log("Test B: ChannelSessionStore reuse of bound conversation");
const sessionStore = new ChannelSessionStore({ userDataDir: channelDir });
await sessionStore.initialize();

const s1 = await sessionStore.getOrCreateSession({
  platformType: "wechat",
  platformUserId: "user-1",
  agentType: "codex/agent-1",
  workspace: workspaceRoot,
  chatId: "chat-abc",
});
await sessionStore.bindConversation(s1.id, conv.id);
const s1b = await sessionStore.getOrCreateSession({
  platformType: "wechat",
  platformUserId: "user-1",
  agentType: "codex/agent-1",
});
assert.equal(s1b.id, s1.id, "same chat+agent returns same session");
assert.equal(sessionStore.getConversationId(s1b.id), conv.id, "same conversation reused, no second create");
await sessionStore.dispose();
console.log("✓ same chat reuses bound conversation (no duplicate)");

// ---- Test C: ChannelStreamRelay pushes agent output to IM sink (S3-04) ----
console.log("Test C: ChannelStreamRelay fan-out to IM");
const sent = [];
const relay = new ChannelStreamRelay({
  sendText: async (chatId, text) => {
    sent.push({ chatId, text });
  },
  formatResponse: (response) => ({ content: response.content }),
});
const conversationId = "conv-relay-1";
const chatId = "chat-relay";
relay.subscribeConversation(conversationId, { chatId, platformType: "wechat" });
// Simulate agent stream events (Text deltas + finish + a tool call).
relay.pushEvent(conversationId, { type: "text", text: "Hello " });
relay.pushEvent(conversationId, { type: "text", text: "from agent" });
relay.pushEvent(conversationId, { type: "tool", name: "read_file", status: "completed" });
relay.pushEvent(conversationId, { type: "finish", text: "Hello from agent" });
assert.equal(sent.length, 1, "finish flushes a single aggregated message");
assert.ok(sent[0].text.includes("Hello from agent"), "aggregated text delivered");
assert.equal(sent[0].chatId, chatId);
// Unknown conversation id should not push.
relay.pushEvent("conv-unknown", { type: "finish", text: "nope" });
assert.equal(sent.length, 1, "events for unsubscribed conversations are ignored");
relay.unsubscribeConversation(conversationId);
relay.pushEvent(conversationId, { type: "finish", text: "after unsub" });
assert.equal(sent.length, 1, "unsubscribed conversation produces no push");
console.log("✓ ChannelStreamRelay delivered aggregated agent output to IM");

await fs.rm(tmpBase, { recursive: true, force: true });
console.log("\n✅ Channel conversation sync tests passed!");
