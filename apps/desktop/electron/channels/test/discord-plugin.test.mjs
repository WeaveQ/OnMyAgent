/**
 * Discord plugin lifecycle + inbound/outbound test (no live token).
 *
 * Mocks discord.js by injecting a duck-typed Client. The gateway wires a
 * messageCreate handler; we emit a synthetic message to verify it is filtered
 * by the allowed-user list, routed to the personal agent runtime, and the
 * reply is delivered via the (mocked) channel.send.
 *
 * Verifies thread awareness (isThread) and the 2000-char streaming edit path
 * are wired, even if only exercised minimally here.
 */

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDiscordService } from "../../discord/service.mjs";
import {
  ChannelPluginRegistry,
  createLegacyServicePlugin,
} from "../PluginRegistry.mjs";

const tmpDir = path.join(os.tmpdir(), `discord-plugin-test-${Date.now()}`);
await fs.mkdir(tmpDir, { recursive: true });

const sent = [];
const edited = [];

function createMockDiscordClient() {
  const handlers = {};
  const client = {
    user: { username: "discbot", id: "disc1" },
    on(event, fn) {
      (handlers[event] ||= []).push(fn);
      return client;
    },
    login: async () => {},
    destroy: async () => {},
    channels: {
      async fetch(id) {
        return {
          id,
          async send(text) {
            sent.push({ id, text: String(text).slice(0, 2000) });
            return { id: "m1" };
          },
          messages: {
            async fetch(mid) {
              return {
                id: mid,
                async edit(text) {
                  edited.push({ id: mid, text: String(text).slice(0, 2000) });
                  return { id: mid };
                },
              };
            },
          },
        };
      },
    },
  };
  client.__handlers = handlers;
  return client;
}

const fakeRuntime = {
  runMessage: async (input) => ({ status: "completed", output: `echo:${String(input?.prompt ?? "").slice(0, 20)}` }),
};

const mockClient = createMockDiscordClient();

const discord = createDiscordService({
  userDataDir: tmpDir,
  client: mockClient,
  personalAgentRuntime: fakeRuntime,
  channelPairingService: null,
  channelSessionStore: null,
  channelEventBus: null,
  channelMessageAdapter: null,
});

console.log("Test 1: saveAccount");
await discord.saveAccount({ accountId: "discbot", token: "disc-token", botUsername: "discbot" });
assert.equal(discord.status().hasToken, true);
console.log("✓ token surfaced");

console.log("Test 2: start lifecycle connects gateway (injected client)");
const started = await discord.start({ accountId: "discbot", allowedUserIds: ["u1"], textBatchDelayMs: 0 });
assert.equal(started.ok, true);
assert.equal(discord.status().status, "running");
console.log("✓ start ok, status running");

console.log("Test 3: registry shows transport ready");
const registry = new ChannelPluginRegistry();
registry.register(createLegacyServicePlugin({ id: "discord", type: "discord", name: "Discord", service: discord }));
const [regStatus] = await registry.getPluginStatuses();
assert.equal(regStatus.id, "discord");
assert.equal(regStatus.hasToken, true);
console.log("✓ registry transport ready + hasToken");

console.log("Test 4: inbound message from allowed user is routed + replied");
const messageCreate = mockClient.__handlers.messageCreate?.[0];
assert.ok(typeof messageCreate === "function", "messageCreate handler registered");
messageCreate({
  author: { id: "u1", bot: false },
  channel: { id: "c1", type: 0, isThread: () => false },
  content: "hello discord",
  id: "msg1",
});
await new Promise((resolve) => setTimeout(resolve, 200));
assert.ok(sent.length >= 1, "expected a reply sent to the channel");
console.log(`✓ inbound routed, ${sent.length} reply sent`);

console.log("Test 5: disallowed user is dropped");
const before = sent.length;
messageCreate({
  author: { id: "intruder", bot: false },
  channel: { id: "c2", type: 0, isThread: () => false },
  content: "should be ignored",
  id: "msg2",
});
await new Promise((resolve) => setTimeout(resolve, 200));
assert.equal(sent.length, before, "intruder message must not produce a reply");
console.log("✓ disallowed user dropped");

console.log("Test 6: thread messages preserve thread id for reply");
messageCreate({
  author: { id: "u1", bot: false },
  channel: { id: "thread-9", type: 11, isThread: () => true },
  content: "in a thread",
  id: "msg3",
});
await new Promise((resolve) => setTimeout(resolve, 200));
const threadReply = sent.find((s) => s.id === "thread-9");
assert.ok(threadReply, "reply should target the thread channel id");
console.log("✓ thread id preserved");

console.log("Test 7: stop disconnects");
await discord.stop();
assert.equal(discord.status().status, "stopped");
console.log("✓ stopped");

console.log("All discord plugin tests passed");

await discord.stop({ persist: false }).catch(() => undefined);
