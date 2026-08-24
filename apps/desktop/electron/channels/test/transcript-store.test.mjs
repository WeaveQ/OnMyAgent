import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ChannelTranscriptStore } from "../ChannelTranscriptStore.mjs";

test("canonical transcript normalizes aliases, isolates threads, and scopes external-id dedupe", async (t) => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "onmyagent-transcript-"));
  t.after(() => fs.rm(userDataDir, { recursive: true, force: true }));
  const events = [];
  const sessionStore = {
    getAllSessions() {
      return [{
        id: "legacy-session",
        platformType: "weixin",
        accountId: null,
        platformUserId: "peer-1",
        chatId: "chat-legacy",
        agentType: "opencode/legacy",
        messages: [{ id: "legacy-message", role: "user", content: "legacy hello", timestamp: 1 }],
      }];
    },
  };
  const eventBus = { publish(name, payload) { events.push({ name, payload }); } };
  const store = new ChannelTranscriptStore({ userDataDir, sessionStore, eventBus });
  await store.initialize();

  const legacyPage = store.read({ platformType: "wechat", accountId: "legacy-unknown-account", chatId: "chat-legacy" });
  assert.equal(legacyPage.messages.length, 1);
  assert.equal(legacyPage.messages[0].source, "legacy");
  assert.equal(legacyPage.messages[0].accountId, "legacy-unknown-account");

  await store.recordInbound({
    platformType: "weixin",
    accountId: "bot-a",
    chatId: "chat-a",
    platformUserId: "peer-a",
    externalId: "same-id",
    content: "hello",
  });
  const eventCountBeforeDuplicate = events.length;
  await store.recordInbound({
    platformType: "wechat",
    accountId: "bot-a",
    chatId: "chat-a",
    platformUserId: "peer-a",
    externalId: "same-id",
    content: "hello again",
  });
  assert.equal(events.length, eventCountBeforeDuplicate);
  await store.recordInbound({
    platformType: "wechat",
    accountId: "bot-a",
    chatId: "chat-b",
    platformUserId: "peer-b",
    externalId: "same-id",
    content: "other chat",
  });
  await store.recordInbound({
    platformType: "wechat",
    accountId: "bot-b",
    chatId: "chat-a",
    platformUserId: "peer-a",
    externalId: "same-id",
    content: "other account",
  });
  store.setActiveAgent({ platformType: "wechat", accountId: "bot-a", chatId: "chat-a", agentId: "agent-1", agentName: "Agent One" });
  await store.recordOperatorPrompt({
    platformType: "wechat",
    accountId: "bot-a",
    chatId: "chat-a",
    content: "private prompt",
    metadata: { token: "must-not-persist", visibility: "local" },
  });
  await store.recordOutbound({ platformType: "wechat", accountId: "bot-a", chatId: "chat-a", externalId: "reply-1", content: "agent reply" });
  await store.recordOutbound({
    platformType: "wechat",
    accountId: "bot-a",
    chatId: "chat-a",
    externalId: "reply-1",
    content: "agent reply edited",
    replaceExisting: true,
  });

  const chatA = store.read({ platformType: "wechat", accountId: "bot-a", chatId: "chat-a" });
  assert.equal(chatA.messages.length, 3);
  assert.equal(chatA.messages.filter((message) => message.externalId === "same-id").length, 1);
  assert.equal(chatA.messages.find((message) => message.direction === "local")?.role, "operator");
  assert.equal(chatA.messages.find((message) => message.direction === "outbound")?.agentId, "agent-1");
  assert.equal(chatA.messages.find((message) => message.direction === "outbound")?.content, "agent reply edited");
  assert.equal(chatA.messages.find((message) => message.direction === "local")?.metadata.token, undefined);
  assert.equal(store.read({ platformType: "wechat", accountId: "bot-a", chatId: "chat-b" }).messages.length, 1);
  assert.equal(store.read({ platformType: "wechat", accountId: "bot-b", chatId: "chat-a" }).messages.length, 1);

  const threads = store.listThreads("weixin", { accountId: "bot-a" });
  assert.deepEqual(threads.map((thread) => thread.chatId).sort(), ["chat-a", "chat-b"]);
  assert.ok(events.some((event) => event.name === "channel:transcript:updated"));

  for (const id of ["same-time-a", "same-time-b", "same-time-c"]) {
    await store.recordInbound({ id, platformType: "telegram", accountId: "bot-page", chatId: "chat-page", content: id, timestamp: 10 });
  }
  const newestPage = store.read({ platformType: "telegram", accountId: "bot-page", chatId: "chat-page", limit: 2 });
  assert.deepEqual(newestPage.messages.map((message) => message.id), ["same-time-b", "same-time-c"]);
  const olderPage = store.read({
    platformType: "telegram",
    accountId: "bot-page",
    chatId: "chat-page",
    limit: 2,
    before: newestPage.nextBefore,
    beforeId: newestPage.nextBeforeId,
  });
  assert.deepEqual(olderPage.messages.map((message) => message.id), ["same-time-a"]);

  const persisted = JSON.parse(await fs.readFile(path.join(userDataDir, "channel-transcript", "messages.json"), "utf8"));
  assert.equal(JSON.stringify(persisted).includes("must-not-persist"), false);
  await store.dispose();
});
