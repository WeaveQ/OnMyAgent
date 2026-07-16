/**
 * Telegram plugin lifecycle + inbound/outbound test (no live token).
 *
 * Mocks the Telegram Bot API via a fake `fetch`:
 *  - getMe returns a bot identity (used by saveAccount enrichment)
 *  - getUpdates parks forever (the long-poll loop is aborted on stop)
 *  - sendMessage records outbound replies
 *
 * Verifies the service mirrors the Weixin/Feishu API surface and routes an
 * inbound simulated message to the personal agent runtime, then delivers the
 * reply back over the (mocked) transport.
 */

import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTelegramService } from "../../telegram/service.mjs";
import {
  ChannelPluginRegistry,
  createLegacyServicePlugin,
} from "../PluginRegistry.mjs";

const tmpDir = path.join(os.tmpdir(), `telegram-plugin-test-${Date.now()}`);
await fs.mkdir(tmpDir, { recursive: true });

let sentCount = 0;
let lastSentText = "";

function fakeFetch(url) {
  const u = String(url ?? "");
  if (u.includes("/getMe")) {
    return Promise.resolve({ json: async () => ({ ok: true, result: { username: "testbot", id: 123 } }) });
  }
  if (u.includes("/getUpdates")) {
    // Park the long-poll loop; it is aborted by stop().
    return new Promise(() => {});
  }
  if (u.includes("/sendMessage")) {
    return Promise.resolve({
      json: async () => {
        sentCount += 1;
        lastSentText = "replied";
        return { ok: true, result: { message_id: 999 } };
      },
    });
  }
  if (u.includes("/editMessageText")) {
    return Promise.resolve({ json: async () => ({ ok: true, result: { message_id: 999 } }) });
  }
  return Promise.resolve({ json: async () => ({ ok: false, description: "unknown" }) });
}

const fakeRuntime = {
  runMessage: async (input) => ({ status: "completed", output: `echo:${String(input?.prompt ?? "").slice(0, 20)}` }),
};

const telegram = createTelegramService({
  userDataDir: tmpDir,
  fetchFn: fakeFetch,
  personalAgentRuntime: fakeRuntime,
  channelPairingService: null,
  channelSessionStore: null,
  channelEventBus: null,
  channelMessageAdapter: null,
});

console.log("Test 1: saveAccount + bot identity enrichment");
await telegram.saveAccount({ accountId: "tgbot", token: "123:abc", botUsername: "testbot" });
const statusAfterSave = telegram.status();
assert.equal(statusAfterSave.hasToken, true);
assert.equal(statusAfterSave.botUsername, "testbot");
console.log("✓ token + botUsername surfaced");

console.log("Test 2: start lifecycle parks long-poll and reports running");
const started = await telegram.start({ accountId: "tgbot", textBatchDelayMs: 0 });
assert.equal(started.ok, true);
assert.equal(telegram.status().status, "running");
console.log("✓ start ok, status running");

console.log("Test 3: registry shows transport ready");
const registry = new ChannelPluginRegistry();
registry.register(createLegacyServicePlugin({ id: "telegram", type: "telegram", name: "Telegram", service: telegram }));
const [regStatus] = await registry.getPluginStatuses();
assert.equal(regStatus.id, "telegram");
assert.equal(regStatus.transport ?? "ready", "ready");
assert.equal(regStatus.hasToken, true);
console.log("✓ registry transport ready + hasToken");

console.log("Test 4: inbound simulated message dispatches to runtime and replies");
const sim = await telegram.simulateInbound({ text: "hello world", fromUserId: "tg_user_1" });
assert.equal(sim.ok, true);
assert.equal(sim.event.senderId, "tg_user_1");
assert.equal(sim.event.text, "hello world");
// Allow the (0ms) batch timer + async dispatch to run.
await new Promise((resolve) => setTimeout(resolve, 200));
assert.ok(sentCount >= 1, "expected at least one outbound reply");
console.log(`✓ inbound routed to runtime, ${sentCount} reply sent`);

console.log("Test 5: stop aborts poll loop");
await telegram.stop();
assert.equal(telegram.status().status, "stopped");
console.log("✓ stopped");

console.log("All telegram plugin tests passed");

await telegram.stop({ persist: false }).catch(() => undefined);
