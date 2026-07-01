import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
    const result = await fn({ service, store, sent, runs, runtime, dir });
    await service.stop({ persist: false }).catch(() => undefined);
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    assert.equal(sent.at(-1).text, "reply:ping");
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
    assert.equal(sent.at(-1).text, "ws-reply:hello ws");
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
    assert.equal(sent.at(-1).text, "approved output");
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

async function waitForFeishu(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met");
}
