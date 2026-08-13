import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createMessagingTaskAdapter,
  parseMessagingTaskCommand,
  TASK_ROUTER_MESSAGE_ID_REQUIRED_REPLY,
  TASK_ROUTER_SAFE_ERROR_REPLY,
} from "../messaging-task-adapter.mjs";
import { createChannelAgentDispatcher } from "../agent-dispatch.mjs";
import { createChannelStore } from "../agent-store.mjs";
import { createMessagingChannelServices } from "../../channel-runtime.mjs";

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for asynchronous channel dispatch");
}

test("parser claims only the explicit Task namespace", () => {
  for (const text of ["hello", "task build this", "#status", "/status", "#cancel", "#approve"]) {
    assert.equal(parseMessagingTaskCommand(text), null, text);
  }
  assert.deepEqual(parseMessagingTaskCommand("#task"), {
    namespace: "task",
    action: "help",
    args: "",
    rawText: "#task",
    requiresStableMessageId: false,
  });
  assert.equal(parseMessagingTaskCommand("/task status").action, "status");
  assert.equal(parseMessagingTaskCommand("#TASK list").action, "list");
  assert.deepEqual(parseMessagingTaskCommand("#task ship the release"), {
    namespace: "task",
    action: "create",
    args: "ship the release",
    rawText: "#task ship the release",
    requiresStableMessageId: true,
  });
  assert.equal(parseMessagingTaskCommand("/task run inspect logs").action, "create");
  assert.equal(parseMessagingTaskCommand("/task run inspect logs").args, "inspect logs");
});

test("adapter is a zero-behavior-change no-op without an injected router", async () => {
  const adapter = createMessagingTaskAdapter();
  assert.equal(adapter.enabled, false);
  assert.equal(adapter.canRoute("#task inspect"), false);
  assert.deepEqual(await adapter.tryRoute({ text: "#task inspect" }), { handled: false });
});

test("side-effecting Task commands fail closed without a stable message id", async () => {
  let routerCalls = 0;
  const replies = [];
  const adapter = createMessagingTaskAdapter({
    taskMessageRouter: async () => {
      routerCalls += 1;
      return { ok: true };
    },
  });
  const result = await adapter.tryRoute({
    platform: "telegram",
    accountId: "bot-1",
    chatId: "chat-1",
    senderId: "user-1",
    text: "#task create deploy",
  }, {
    reply: async (text) => replies.push(text),
  });
  assert.equal(result.handled, true);
  assert.equal(result.code, "stable_message_id_required");
  assert.equal(routerCalls, 0);
  assert.deepEqual(replies, [TASK_ROUTER_MESSAGE_ID_REQUIRED_REPLY]);
});

test("read-only commands may route without message id and receive the complete envelope", async () => {
  let received = null;
  const replies = [];
  const adapter = createMessagingTaskAdapter({
    taskMessageRouter: async (input) => {
      received = input;
      return { ok: true, replyText: "running: 2" };
    },
  });
  const result = await adapter.tryRoute({
    platform: "feishu",
    accountId: "app-1",
    chatId: "chat-1",
    senderId: "user-1",
    text: "/task status",
  }, {
    reply: async (text) => replies.push(text),
  });
  assert.equal(result.handled, true);
  assert.equal(result.ok, true);
  assert.deepEqual(replies, ["running: 2"]);
  assert.deepEqual(received, {
    platform: "feishu",
    accountId: "app-1",
    chatId: "chat-1",
    senderId: "user-1",
    messageId: "",
    text: "/task status",
    command: {
      namespace: "task",
      action: "status",
      args: "",
      rawText: "/task status",
      requiresStableMessageId: false,
    },
    attachments: [],
  });
});

test("a claimed router failure emits a redacted safe reply and never falls through", async () => {
  const replies = [];
  const logs = [];
  const adapter = createMessagingTaskAdapter({
    taskMessageRouter: async () => {
      throw new Error("secret=/Users/alice/private provider-token=abc");
    },
  });
  const result = await adapter.tryRoute({
    platform: "discord",
    accountId: "bot-1",
    chatId: "chat-1",
    senderId: "user-1",
    messageId: "message-1",
    text: "#task create private prompt",
  }, {
    reply: async (text) => replies.push(text),
    appendLog: (entry) => logs.push(entry),
  });
  assert.equal(result.handled, true);
  assert.equal(result.code, "task_router_failed");
  assert.deepEqual(replies, [TASK_ROUTER_SAFE_ERROR_REPLY]);
  assert.equal(JSON.stringify(logs).includes("private"), false);
  assert.equal(JSON.stringify(logs).includes("token"), false);
});

test("shared Telegram/Discord dispatcher preserves Personal fallback and does not double-execute claimed failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "messaging-task-fallback-"));
  const store = createChannelStore({ rootDir: root, platformDir: "shared-test" });
  const routed = [];
  const personalPrompts = [];
  const replies = [];
  const dispatcher = createChannelAgentDispatcher({
    platformType: "telegram",
    platformName: "Telegram",
    store,
    runtime: {
      async runMessage(input) {
        personalPrompts.push(input.prompt);
        return { status: "completed", runId: "personal-run", output: "personal reply" };
      },
    },
    taskMessageRouter: async (input) => {
      routed.push(input);
      throw new Error("private prompt must not escape");
    },
    sendTextTo: async (_chatId, text) => {
      replies.push(text);
      return { ok: true, messageId: `reply-${replies.length}` };
    },
    normalizeInbound: (raw) => raw,
  });

  try {
    await store.saveAccount({ accountId: "bot", token: "token" });
    await dispatcher.start({
      accountId: "bot",
      workspaceRoot: root,
      dmPolicy: "open",
      textBatchDelayMs: 0,
      sendChunkDelayMs: 0,
      agent: { id: "opencode", provider: "opencode", name: "OpenCode" },
    });

    await dispatcher.processInbound({
      accountId: "bot",
      senderId: "user",
      chatId: "chat",
      chatType: "dm",
      messageId: "ordinary-message",
      text: "ordinary Personal message",
    });
    await waitFor(() => personalPrompts.length === 1);

    for (const [index, text] of ["#status", "#cancel", "#approve"].entries()) {
      await dispatcher.processInbound({
        accountId: "bot",
        senderId: "user",
        chatId: "chat",
        chatType: "dm",
        messageId: `legacy-command-${index}`,
        text,
      });
    }
    assert.equal(routed.length, 0, "legacy Personal commands must bypass the Task router");

    await dispatcher.processInbound({
      accountId: "bot",
      senderId: "user",
      chatId: "chat",
      chatType: "dm",
      messageId: "task-message",
      text: "#task create inspect",
    });
    assert.equal(routed.length, 1);
    assert.equal(personalPrompts.length, 1, "claimed Task failure must never fall through to Personal");
    assert.ok(replies.includes(TASK_ROUTER_SAFE_ERROR_REPLY));
  } finally {
    await dispatcher.stop({ persist: false }).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("channel runtime injects the same optional router into all four platform services", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "messaging-task-router-"));
  const calls = [];
  const services = createMessagingChannelServices({
    userDataDir: root,
    personalAgentRuntime: {
      async startMessage() {
        throw new Error("Personal runtime must not receive an explicit Task command");
      },
    },
    taskMessageRouter: async (input) => {
      calls.push(input);
      return { ok: true };
    },
  });

  try {
    await services.initialize();
    for (const [platformType, platformUserId] of [
      ["wechat", "wx-user"],
      ["feishu", "fs-user"],
      ["telegram", "tg-user"],
      ["discord", "dc-user"],
    ]) {
      const requested = await services.pairingService.requestPairing({
        platformType,
        platformUserId,
        chatId: `${platformUserId}-chat`,
      });
      await services.pairingService.approvePairing(requested.pairingRequest.code);
    }
    await services.weixinService.saveAccount({ accountId: "wx-bot", token: "wx-token" });
    await services.feishuService.saveAccount({ appId: "fs-bot", appSecret: "fs-secret" });
    await services.telegramService.saveAccount({ accountId: "tg-bot", token: "tg-token" });
    await services.discordService.saveAccount({ accountId: "dc-bot", token: "dc-token" });

    await services.weixinService.simulateInbound({
      accountId: "wx-bot",
      fromUserId: "wx-user",
      messageId: "wx-message",
      text: "#task create inspect weixin",
      dmPolicy: "open",
    });
    await services.feishuService.simulateInbound({
      accountId: "fs-bot",
      fromUserId: "fs-user",
      chatId: "fs-chat",
      messageId: "fs-message",
      text: "#task create inspect feishu",
      dmPolicy: "open",
    });
    await services.telegramService.simulateInbound({
      accountId: "tg-bot",
      fromUserId: "tg-user",
      chatId: "tg-chat",
      messageId: "tg-message",
      text: "#task create inspect telegram",
      dmPolicy: "open",
    });
    await services.discordService.simulateInbound({
      accountId: "dc-bot",
      fromUserId: "dc-user",
      chatId: "dc-chat",
      messageId: "dc-message",
      text: "#task create inspect discord",
      dmPolicy: "open",
    });

    assert.deepEqual(calls.map((call) => call.platform), [
      "weixin",
      "feishu",
      "telegram",
      "discord",
    ]);
    assert.deepEqual(calls.map((call) => call.messageId), [
      "wx-message",
      "fs-message",
      "tg-message",
      "dc-message",
    ]);
    assert.ok(calls.every((call) => call.command.action === "create"));
  } finally {
    await services.dispose().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("channel simulation does not invent an idempotency key for Task mutations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "messaging-task-no-id-"));
  let calls = 0;
  const services = createMessagingChannelServices({
    userDataDir: root,
    personalAgentRuntime: {},
    taskMessageRouter: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  try {
    await services.initialize();
    const requested = await services.pairingService.requestPairing({
      platformType: "telegram",
      platformUserId: "tg-user",
      chatId: "tg-chat",
    });
    await services.pairingService.approvePairing(requested.pairingRequest.code);
    await services.telegramService.saveAccount({ accountId: "tg-bot", token: "tg-token" });
    const simulated = await services.telegramService.simulateInbound({
      accountId: "tg-bot",
      fromUserId: "tg-user",
      chatId: "tg-chat",
      text: "#task create inspect",
      dmPolicy: "open",
    });
    assert.equal(simulated.event.messageId, "");
    assert.equal(calls, 0);
  } finally {
    await services.dispose().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
