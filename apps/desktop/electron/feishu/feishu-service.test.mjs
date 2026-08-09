import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFeishuService, __test__ } from "./service.mjs";
import { createFeishuStore } from "./store.mjs";
import { __test__ as wsTest } from "./ws-client.mjs";
import { ChannelPairingService } from "../channels/ChannelPairingService.mjs";
import { ChannelSessionStore } from "../channels/ChannelSessionStore.mjs";

async function withService(fn, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-feishu-test-"));
  const sent = [];
  const runs = new Map();
  const client = {
    async getWebSocketEndpoint() {
      return { url: "ws://127.0.0.1:9/callback?device_id=device_test&service_id=100", clientConfig: { PingInterval: 120 } };
    },
    async sendText(input) {
      sent.push(input);
      if (typeof options.sendText === "function") {
        return await options.sendText(input, { attempt: sent.length, sent });
      }
      return { code: 0, data: { message_id: `om_${sent.length}` } };
    },
  };
  const runtime = options.runtime ?? {
    async startMessage(input) {
      const runId = `run-${runs.size + 1}`;
      runs.set(runId, { status: "completed", output: `reply:${input.prompt}`, input });
      return { status: "completed", runId, output: `reply:${input.prompt}` };
    },
    async getRun({ runId }) {
      return runs.get(runId) ?? { status: "missing" };
    },
    async resetConversation() {
      return { ok: true };
    },
    async cancelRun(runId) {
      runs.set(runId, { status: "cancelled" });
      return { ok: true };
    },
    async resolveApproval() {
      return { ok: true };
    },
  };
  const store = createFeishuStore(dir);
  const service = createFeishuService({ store, client, personalAgentRuntime: runtime, WebSocketCtor: options.WebSocketCtor, wsReconnectIntervalMs: 50, wsEndpointRetryMs: 50 });
  try {
    await store.saveAccount({ appId: "cli_xxx", appSecret: "secret", baseUrl: "https://open.feishu.cn" });
    return await fn({ service, store, sent, runs, runtime, dir });
  } finally {
    await service.stop({ persist: false }).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function basicStartInput(extra = {}) {
  return {
    accountId: "cli_xxx",
    workspaceRoot: "/tmp/studio",
    textBatchDelayMs: 0,
    agent: { id: "opencode", provider: "opencode", name: "OpenCode" },
    availableAgents: [
      { id: "opencode", provider: "opencode", name: "OpenCode" },
      { id: "codex", provider: "codex", name: "Codex" },
    ],
    dmPolicy: "open",
    connectionMode: "webhook",
    webhookPort: 0,
    ...extra,
  };
}

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.binaryType = "";
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    FakeWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 0);
  }

  send(data) {
    this.sent.push(Buffer.from(data));
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }

  receiveFrame(frame) {
    this.onmessage?.({ data: wsTest.encodeFeishuFrame(frame) });
  }
}

test("serializes Feishu active-run mutations across run keys", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-feishu-store-race-"));
  try {
    const store = createFeishuStore(dir);
    for (let index = 0; index < 25; index += 1) {
      const runA = `chat-a-${index}`;
      const runB = `chat-b-${index}`;
      await Promise.all([
        store.writeActiveRun("cli_concurrent", runA, { runId: `run-a-${index}`, status: "running" }),
        store.writeActiveRun("cli_concurrent", runB, { runId: `run-b-${index}`, status: "running" }),
      ]);
      assert.equal((await store.readActiveRun("cli_concurrent", runA))?.runId, `run-a-${index}`);
      assert.equal((await store.readActiveRun("cli_concurrent", runB))?.runId, `run-b-${index}`);

      await Promise.all([
        store.deleteActiveRun("cli_concurrent", runA),
        store.writeActiveRun("cli_concurrent", runB, { status: "pending_approval" }),
      ]);
      assert.equal(await store.readActiveRun("cli_concurrent", runA), null);
      assert.equal((await store.readActiveRun("cli_concurrent", runB))?.status, "pending_approval");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a caught Feishu active-run write failure does not leak an unhandled rejection", async () => {
  const root = path.join(os.tmpdir(), `studio-feishu-store-failure-${process.pid}-${Date.now()}`);
  let unhandled = null;
  const onUnhandled = (error) => { unhandled = error; };
  process.on("unhandledRejection", onUnhandled);
  try {
    await writeFile(root, "not a directory", "utf8");
    const store = createFeishuStore(root);
    await assert.rejects(
      store.writeActiveRun("cli_failure", "chat-a", { runId: "failed-run" }),
      (error) => error?.code === "ENOTDIR",
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandled, null);

    await rm(root, { force: true });
    await mkdir(root, { recursive: true });
    await store.writeActiveRun("cli_failure", "chat-b", { runId: "recovered-run" });
    assert.equal((await store.readActiveRun("cli_failure", "chat-b"))?.runId, "recovered-run");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await rm(root, { recursive: true, force: true });
  }
});

test("serializes concurrent Feishu history and chat-setting updates", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-feishu-history-race-"));
  try {
    const store = createFeishuStore(dir);
    for (let index = 0; index < 25; index += 1) {
      const chatA = `history-a-${index}`;
      const chatB = `history-b-${index}`;
      await Promise.all([
        store.appendChatHistory("cli_history", chatA, [{ role: "user", text: `a-${index}` }]),
        store.appendChatHistory("cli_history", chatB, [{ role: "user", text: `b-${index}` }]),
      ]);
      assert.equal((await store.readChatHistory("cli_history", chatA, 10))[0]?.text, `a-${index}`);
      assert.equal((await store.readChatHistory("cli_history", chatB, 10))[0]?.text, `b-${index}`);
      await Promise.all([
        store.clearChatHistory("cli_history", chatA),
        store.appendChatHistory("cli_history", chatB, [{ role: "assistant", text: `b-reply-${index}` }]),
      ]);
      assert.deepEqual(await store.readChatHistory("cli_history", chatA, 10), []);
      assert.deepEqual((await store.readChatHistory("cli_history", chatB, 10)).map((entry) => entry.text), [
        `b-${index}`,
        `b-reply-${index}`,
      ]);

      const sameChat = `history-same-${index}`;
      await Promise.all([
        store.appendChatHistory("cli_history", sameChat, [{ role: "user", text: `first-${index}` }]),
        store.appendChatHistory("cli_history", sameChat, [{ role: "assistant", text: `second-${index}` }]),
      ]);
      assert.deepEqual((await store.readChatHistory("cli_history", sameChat, 10)).map((entry) => entry.text), [
        `first-${index}`,
        `second-${index}`,
      ]);

      await Promise.all([
        store.writeChatSetting("cli_history", chatA, { promptMode: "raw" }),
        store.writeChatSetting("cli_history", chatB, { promptMode: "debug" }),
      ]);
      assert.equal((await store.readChatSetting("cli_history", chatA))?.promptMode, "raw");
      assert.equal((await store.readChatSetting("cli_history", chatB))?.promptMode, "debug");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizes Feishu webhook text event", () => {
  const event = __test__.normalizeFeishuWebhookEvent({
    header: { app_id: "cli_xxx" },
    event: {
      sender: { sender_id: { open_id: "ou_user" } },
      message: {
        message_id: "om_1",
        chat_id: "oc_chat",
        chat_type: "p2p",
        content: JSON.stringify({ text: "hello" }),
      },
    },
  });
  assert.equal(event.accountId, "cli_xxx");
  assert.equal(event.senderId, "ou_user");
  assert.equal(event.chatId, "oc_chat");
  assert.equal(event.chatType, "dm");
  assert.equal(event.text, "hello");
});

test("starts a Feishu app and dispatches inbound text to the selected local agent", async () => {
  await withService(async ({ service, sent, runs }) => {
    await service.start(basicStartInput());
    const inbound = await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_chat", fromUserId: "ou_user", text: "ping" });
    assert.equal(inbound.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(sent.at(-1).receiveId, "oc_chat");
    assert.match(sent.at(-1).text, /^▎OpenCode · \d{2}:\d{2}\n\nreply:ping$/);
    const run = runs.get("run-1");
    assert.equal(run.input.workspaceRoot, "/tmp/studio");
    assert.equal(run.input.agent.id.startsWith("opencode-feishu-"), true);
  });
});

test("requires local pairing approval before dispatching Feishu messages and stores channel sessions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-feishu-gated-test-"));
  let service;
  let pairingService;
  let sessionStore;
  try {
    const sent = [];
    const runs = [];
    const client = {
      async sendText(input) {
        sent.push(input);
        return { code: 0, data: { message_id: `om_${sent.length}` } };
      },
    };
    const runtime = {
      async runMessage(input) {
        runs.push(input);
        return { status: "completed", output: "authorized reply" };
      },
    };
    const store = createFeishuStore(dir);
    pairingService = new ChannelPairingService({ userDataDir: dir });
    sessionStore = new ChannelSessionStore({ userDataDir: dir });
    await pairingService.initialize();
    await sessionStore.initialize();
    await store.saveAccount({ appId: "cli_xxx", appSecret: "secret", baseUrl: "https://open.feishu.cn" });
    service = createFeishuService({
      store,
      client,
      personalAgentRuntime: runtime,
      channelPairingService: pairingService,
      channelSessionStore: sessionStore,
    });
    await service.start(basicStartInput());
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_chat", fromUserId: "ou_user", text: "ping" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(sent.at(-1).text, /配对码/);
    assert.equal(runs.length, 0);
    const pending = pairingService.getPendingRequests();
    assert.equal(pending.length, 1);
    await pairingService.approvePairing(pending[0].code);
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_chat", fromUserId: "ou_user", text: "ping after approve" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(runs.length, 1);
    await waitForFeishu(() => sessionStore.getSessionsByUser("feishu", "ou_user").some((session) => session.messages.length === 2));
    const sessions = sessionStore.getSessionsByUser("feishu", "ou_user");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].agentType, "opencode/opencode");
    assert.equal(sessions[0].messages[0].content, "ping after approve");
  } finally {
    await service?.stop({ persist: false }).catch(() => undefined);
    await pairingService?.dispose();
    await sessionStore?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("defaults Feishu connection mode to websocket like Hermes", () => {
  const options = __test__.normalizeRuntimeOptions({});
  assert.equal(options.connectionMode, "websocket");
  assert.equal(__test__.normalizeConnectionMode("webhook"), "webhook");
  assert.equal(__test__.normalizeConnectionMode("unknown"), "websocket");
});

test("keeps Feishu active-run locks within the 12-hour runtime ceiling", () => {
  assert.equal(__test__.ACTIVE_RUN_MAX_AGE_MS, 12 * 60 * 60 * 1000 + 15 * 60 * 1000);
});

test("keeps UTF-16 surrogate pairs intact when splitting Feishu text", () => {
  const raw = "abc😀def";
  const chunks = __test__.splitTextForFeishu(raw, 4);
  assert.equal(chunks.join(""), raw);
  for (const chunk of chunks) {
    assert.equal(chunk.charCodeAt(0) >= 0xDC00 && chunk.charCodeAt(0) <= 0xDFFF, false);
    const lastCode = chunk.charCodeAt(chunk.length - 1);
    assert.equal(lastCode >= 0xD800 && lastCode <= 0xDBFF, false);
  }
  assert.deepEqual(__test__.splitTextForFeishu("😀x", 1), ["😀", "x"]);
});

test("receives Feishu websocket frame, dispatches to local agent, and acks", async () => {
  FakeWebSocket.instances = [];
  const runs = new Map();
  await withService(async ({ service, sent }) => {
    const result = await service.start(basicStartInput({ connectionMode: "websocket" }));
    assert.equal(result.ok, true);
    const ws = FakeWebSocket.instances[0];
    assert.ok(ws);
    ws.receiveFrame({
      service: 100,
      method: wsTest.FRAME_DATA,
      headers: [
        { key: wsTest.HEADER_TYPE, value: wsTest.TYPE_EVENT },
        { key: wsTest.HEADER_MESSAGE_ID, value: "om_ws_1" },
        { key: wsTest.HEADER_TRACE_ID, value: "trace_ws_1" },
        { key: wsTest.HEADER_SUM, value: "1" },
        { key: wsTest.HEADER_SEQ, value: "0" },
      ],
      payload: Buffer.from(JSON.stringify({
        header: { app_id: "cli_xxx", event_type: "im.message.receive_v1" },
        event: {
          sender: { sender_id: { open_id: "ou_user" } },
          message: { message_id: "om_ws_1", chat_id: "oc_ws_chat", chat_type: "p2p", content: JSON.stringify({ text: "hello ws" }) },
        },
      }), "utf8"),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(sent.at(-1).receiveId, "oc_ws_chat");
    assert.match(sent.at(-1).text, /^▎OpenCode · \d{2}:\d{2}\n\nws-reply:hello ws$/);
    const ack = wsTest.decodeFeishuFrame(ws.sent.at(-1));
    assert.equal(ack.method, wsTest.FRAME_DATA);
    assert.equal(JSON.parse(ack.payload.toString("utf8")).code, 200);
    assert.equal(runs.get("run-ws").input.agent.id.startsWith("opencode-feishu-"), true);
  }, {
    WebSocketCtor: FakeWebSocket,
    runtime: {
      async startMessage(input) {
        runs.set("run-ws", { status: "completed", output: `ws-reply:${input.prompt}`, input });
        return { status: "completed", runId: "run-ws", output: `ws-reply:${input.prompt}` };
      },
      async getRun({ runId }) {
        return runs.get(runId) ?? { status: "missing" };
      },
    },
  });
});

test("switches Feishu chat agent and keeps per-agent history isolated", async () => {
  const prompts = [];
  await withService(async ({ service, sent }) => {
    await service.start(basicStartInput({ promptMode: "debug" }));
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_chat", fromUserId: "ou_user", text: "first opencode" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    prompts.push(sent.at(-1).text);
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_chat", fromUserId: "ou_user", text: "#agent codex" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_chat", fromUserId: "ou_user", text: "codex turn" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const codexReply = sent.at(-1).text;
    assert.match(codexReply, /codex turn/);
    assert.doesNotMatch(codexReply, /first opencode/);
  });
  assert.match(prompts[0], /first opencode/);
});

test("reports pending approval and resolves it from Feishu command", async () => {
  let status = "running";
  const approvals = [{ id: "approval-1", title: "Run command", command: "pnpm check" }];
  const runtime = {
    async startMessage() {
      return { status: "running", runId: "run-approval" };
    },
    async getRun() {
      if (status === "running") return { status: "running", pendingApprovals: approvals };
      return { status: "completed", output: "approved output" };
    },
    async resolveApproval(input) {
      assert.equal(input.runId, "run-approval");
      assert.equal(input.approvalId, "approval-1");
      status = "completed";
      return { ok: true };
    },
  };
  await withService(async ({ service, sent }) => {
    await service.start(basicStartInput());
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_chat", fromUserId: "ou_user", text: "need approval" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.match(sent.at(-1).text, /本地 Agent 请求权限审批/);
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_chat", fromUserId: "ou_user", text: "#approve" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.match(sent.at(-1).text, /^▎OpenCode · \d{2}:\d{2}\n\napproved output$/);
  }, { runtime });
});

test("starts a new Feishu conversation for the current agent", async () => {
  let resetInput = null;
  const runtime = {
    async startMessage(input) {
      return { status: "completed", runId: "run-1", output: `reply:${input.prompt}` };
    },
    getRun() {
      return { status: "completed", output: "done" };
    },
    async resetConversation(input) {
      resetInput = input;
      return { ok: true };
    },
  };
  await withService(async ({ service, sent }) => {
    await service.start(basicStartInput());
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_chat", fromUserId: "ou_user", text: "#new" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(sent.at(-1).text, /开启新的/);
    assert.equal(resetInput.agent.id.startsWith("opencode-feishu-"), true);
  }, { runtime });
});

test("reserves a Feishu chat while startMessage is in flight", async () => {
  const startGate = deferred();
  let startCalls = 0;
  let resetCalls = 0;
  let cancelCalls = 0;
  const runtime = {
    async startMessage() {
      startCalls += 1;
      if (startCalls === 1) return await startGate.promise;
      return { status: "completed", runId: `run-${startCalls}`, output: `reply-${startCalls}` };
    },
    async getRun() {
      return { status: "completed", output: "unused" };
    },
    async resetConversation() {
      resetCalls += 1;
      return { ok: true };
    },
    async cancelRun() {
      cancelCalls += 1;
      return { ok: true };
    },
  };
  await withService(async ({ service, sent }) => {
    await service.start(basicStartInput());
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_starting", fromUserId: "ou_user", text: "first" });
    await waitForFeishu(() => startCalls === 1);

    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_starting", fromUserId: "ou_user", text: "second" });
    await waitForFeishu(() => sent.some((item) => item.text.includes("还在处理上一条消息")));
    assert.equal(startCalls, 1);

    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_starting", fromUserId: "ou_user", messageId: "starting-new", text: "#new" });
    assert.match(sent.at(-1).text, /还有运行中的任务/);
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_starting", fromUserId: "ou_user", messageId: "starting-cancel", text: "#cancel" });
    assert.match(sent.at(-1).text, /任务正在启动/);
    assert.equal(resetCalls, 0);
    assert.equal(cancelCalls, 0);

    startGate.resolve({ status: "completed", runId: "run-1", output: "first done" });
    await waitForFeishu(() => sent.some((item) => item.text.includes("first done")));
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_starting", fromUserId: "ou_user", text: "third" });
    await waitForFeishu(() => startCalls === 2);
    assert.equal(sent.filter((item) => item.text.includes("reply-2")).length, 1);
  }, { runtime });
});

test("stop releases a starting reservation and quarantines the late run", async () => {
  const firstStart = deferred();
  let startCalls = 0;
  let cancelCalls = 0;
  const runtime = {
    async startMessage() {
      startCalls += 1;
      if (startCalls === 1) return await firstStart.promise;
      return { status: "completed", runId: "replacement-run", output: "replacement output" };
    },
    async getRun() {
      return { status: "completed", output: "replacement output" };
    },
    async cancelRun(runId) {
      assert.equal(runId, "late-feishu-run");
      cancelCalls += 1;
      return { ok: true };
    },
  };
  await withService(async ({ service, sent }) => {
    await service.start(basicStartInput());
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_restart", fromUserId: "ou_user", messageId: "before-stop", text: "before stop" });
    await waitForFeishu(() => startCalls === 1);
    await service.stop({ persist: false });

    await service.start(basicStartInput());
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_restart", fromUserId: "ou_user", messageId: "after-stop", text: "after stop" });
    await waitForFeishu(() => startCalls === 2);
    await waitForFeishu(() => sent.some((item) => item.text.includes("replacement output")));

    firstStart.resolve({ status: "running", runId: "late-feishu-run" });
    await waitForFeishu(() => cancelCalls === 1);
    assert.equal(sent.some((item) => item.text.includes("还在处理上一条消息")), false);
  }, { runtime });
});

test("stop during the initial active-run write cancels the untracked Feishu run", async () => {
  const writeEntered = deferred();
  const writeGate = deferred();
  const cancelled = [];
  const runtime = {
    async startMessage() {
      return { status: "running", runId: "late-feishu-write-run" };
    },
    async getRun() {
      return { status: "running" };
    },
    async cancelRun(runId, options) {
      cancelled.push({ runId, options });
      return { ok: true };
    },
  };
  await withService(async ({ service, store }) => {
    const originalWriteActiveRun = store.writeActiveRun.bind(store);
    store.writeActiveRun = async (...args) => {
      if (args[2]?.runId === "late-feishu-write-run") {
        writeEntered.resolve();
        await writeGate.promise;
      }
      return await originalWriteActiveRun(...args);
    };

    await service.start(basicStartInput());
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_stop_write", fromUserId: "ou_user", text: "stop during write" });
    await writeEntered.promise;
    await service.stop({ persist: false });
    writeGate.resolve();

    await waitForFeishu(() => cancelled.length === 1);
    assert.deepEqual(cancelled[0], {
      runId: "late-feishu-write-run",
      options: { reason: "feishu_stopped" },
    });
    const runKey = __test__.activeRunKey("oc_stop_write", basicStartInput().agent);
    assert.equal(await store.readActiveRun("cli_xxx", runKey), null);
  }, { runtime });
});

test("stop during deferred Feishu polling returns promptly without late delivery", async () => {
  const pollGate = deferred();
  let getRunCalls = 0;
  const runtime = {
    async startMessage() {
      return { status: "running", runId: "deferred-stop-run" };
    },
    async getRun() {
      getRunCalls += 1;
      return await pollGate.promise;
    },
  };
  await withService(async ({ service, store, sent }) => {
    await service.start(basicStartInput());
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_stop_poll", fromUserId: "ou_user", messageId: "stop-poll", text: "stop poll" });
    await waitForFeishu(() => getRunCalls === 1);

    const stoppedAt = Date.now();
    await service.stop({ persist: false });
    assert.equal(Date.now() - stoppedAt < 100, true);
    pollGate.resolve({ status: "completed", output: "must not send after stop" });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const runKey = __test__.activeRunKey("oc_stop_poll", basicStartInput().agent);
    assert.ok(await store.readActiveRun("cli_xxx", runKey));
    assert.equal(sent.length, 0);
  }, { runtime });
});

test("deduplicates deferred Feishu polls and delivers terminal output once", async () => {
  const runGate = deferred();
  let getRunCalls = 0;
  const agent = { id: "opencode", provider: "opencode", name: "OpenCode" };
  const runtime = {
    async startMessage() {
      return { status: "running", runId: "run-deferred" };
    },
    async getRun() {
      getRunCalls += 1;
      return await runGate.promise;
    },
  };
  await withService(async ({ service, store, sent }) => {
    await service.start(basicStartInput({ agent }));
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_deferred", fromUserId: "ou_user", text: "first deferred" });
    await waitForFeishu(() => getRunCalls === 1);

    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_deferred", fromUserId: "ou_user", text: "second deferred" });
    await waitForFeishu(() => sent.some((item) => item.text.includes("还在处理上一条消息")));
    assert.equal(getRunCalls, 1);

    runGate.resolve({ status: "completed", output: "deferred terminal" });
    const runKey = __test__.activeRunKey("oc_deferred", agent);
    await waitForFeishu(async () => (await store.readActiveRun("cli_xxx", runKey)) === null);
    const history = await store.readChatHistory("cli_xxx", runKey, 10);
    assert.deepEqual(history.map((item) => item.text), ["first deferred", "deferred terminal"]);
    assert.equal(sent.filter((item) => item.text.includes("deferred terminal")).length, 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(getRunCalls, 1);
  }, { runtime });
});

test("a persisted terminal claim prevents replay when cleanup succeeds after restart", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-feishu-claim-"));
  const durableStore = createFeishuStore(dir);
  let deleteCalls = 0;
  const store = new Proxy(durableStore, {
    get(target, property, receiver) {
      if (property === "deleteActiveRun") {
        return async (...args) => {
          deleteCalls += 1;
          if (deleteCalls === 1) throw new Error("locked");
          return await target.deleteActiveRun(...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const sent = [];
  const client = { async sendText(input) { sent.push(input); return { code: 0 }; } };
  const runtime = {
    async startMessage() { return { status: "running", runId: "feishu-claimed-run" }; },
    async getRun() { return { status: "completed", output: "terminal once" }; },
  };
  let firstService = null;
  let secondService = null;
  try {
    await durableStore.saveAccount({ appId: "cli_xxx", appSecret: "secret", baseUrl: "https://open.feishu.cn" });
    firstService = createFeishuService({ store, client, personalAgentRuntime: runtime });
    await firstService.start(basicStartInput());
    await firstService.simulateInbound({ accountId: "cli_xxx", chatId: "oc_claim_restart", fromUserId: "ou_user", text: "claim once" });
    await waitForFeishu(() => sent.filter((item) => item.text.includes("terminal once")).length === 1 && deleteCalls === 1);
    const runKey = __test__.activeRunKey("oc_claim_restart", basicStartInput().agent);
    const claimed = await durableStore.readActiveRun("cli_xxx", runKey);
    assert.equal(claimed.terminalDeliveryClaimedRunId, "feishu-claimed-run");
    await firstService.stop({ persist: false });

    secondService = createFeishuService({ store, client, personalAgentRuntime: runtime });
    await secondService.start(basicStartInput());
    await waitForFeishu(async () => (await durableStore.readActiveRun("cli_xxx", runKey)) === null);
    assert.equal(sent.filter((item) => item.text.includes("terminal once")).length, 1);
    assert.equal((await durableStore.readChatHistory("cli_xxx", runKey, 10)).filter((item) => item.role === "assistant").length, 1);
    assert.equal(deleteCalls, 2);
  } finally {
    await firstService?.stop({ persist: false }).catch(() => undefined);
    await secondService?.stop({ persist: false }).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("does not replay a completed Feishu result after a later chunk fails", async () => {
  const output = "x".repeat(9_000);
  const agent = { id: "opencode", provider: "opencode", name: "OpenCode" };
  const runtime = {
    async startMessage() {
      return { status: "running", runId: "run-chunk-failure" };
    },
    async getRun() {
      return { status: "completed", output };
    },
  };
  await withService(async ({ service, store, sent }) => {
    await service.start(basicStartInput({ agent, sendChunkDelayMs: 0 }));
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_chunk_failure", fromUserId: "ou_user", text: "large result" });
    await waitForFeishu(() => sent.length === 2);
    const runKey = __test__.activeRunKey("oc_chunk_failure", agent);
    await waitForFeishu(async () => (await store.readActiveRun("cli_xxx", runKey)) === null);
    assert.deepEqual(await store.readChatHistory("cli_xxx", runKey, 10), []);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sent.length, 2);
  }, {
    runtime,
    async sendText(_input, { attempt }) {
      if (attempt === 2) throw new Error("second Feishu chunk rejected");
      return { code: 0 };
    },
  });
});

test("cleans terminal Feishu locks when cancel or failure notices cannot be sent", async () => {
  for (const status of ["cancelled", "failed"]) {
    const agent = { id: "opencode", provider: "opencode", name: "OpenCode" };
    const runtime = {
      async startMessage() {
        return { status: "running", runId: `run-${status}` };
      },
      async getRun() {
        return { status, error: status === "failed" ? "boom" : undefined };
      },
    };
    await withService(async ({ service, store, sent }) => {
      await service.start(basicStartInput({ agent }));
      const chatId = `oc_${status}`;
      await service.simulateInbound({ accountId: "cli_xxx", chatId, fromUserId: "ou_user", text: `start ${status}` });
      await waitForFeishu(() => sent.length === 1);
      const runKey = __test__.activeRunKey(chatId, agent);
      await waitForFeishu(async () => (await store.readActiveRun("cli_xxx", runKey)) === null);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(sent.length, 1);
    }, {
      runtime,
      async sendText() {
        throw new Error(`cannot deliver ${status}`);
      },
    });
  }
});

test("reschedules Feishu polling when the first approval prompt fails", async () => {
  let getRunCalls = 0;
  const approvals = [{ id: "approval-retry", title: "Retry approval prompt" }];
  const agent = { id: "opencode", provider: "opencode", name: "OpenCode" };
  const runtime = {
    async startMessage() {
      return { status: "running", runId: "run-approval-retry" };
    },
    async getRun() {
      getRunCalls += 1;
      return { status: "running", pendingApprovals: approvals };
    },
  };
  await withService(async ({ service, store, sent }) => {
    await service.start(basicStartInput({ agent }));
    await service.simulateInbound({ accountId: "cli_xxx", chatId: "oc_approval_retry", fromUserId: "ou_user", text: "needs retry" });
    await waitForFeishu(() => sent.length === 1);
    await waitForFeishu(() => getRunCalls >= 2, 4_500);
    const runKey = __test__.activeRunKey("oc_approval_retry", agent);
    const record = await store.readActiveRun("cli_xxx", runKey);
    assert.equal(record.status, "pending_approval");
    assert.equal(record.pendingApprovals[0].id, "approval-retry");
  }, {
    runtime,
    async sendText() {
      throw new Error("approval prompt rejected");
    },
  });
});

async function waitForFeishu(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met");
}
