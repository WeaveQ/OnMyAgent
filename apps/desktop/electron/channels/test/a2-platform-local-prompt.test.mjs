import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFeishuService } from "../../feishu/service.mjs";
import { createFeishuStore } from "../../feishu/store.mjs";
import { createWeixinService } from "../../weixin/service.mjs";
import { createWeixinStore } from "../../weixin/store.mjs";

async function tempRoot(label) {
  return await mkdtemp(path.join(os.tmpdir(), `onmyagent-${label}-a2-`));
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
}

function failedRuntime() {
  return {
    async startMessage() { return { status: "failed", error: "synthetic failure" }; },
    async getRun() { return null; },
  };
}

function completedRuntime(output) {
  return {
    async runMessage() { return { status: "completed", output }; },
  };
}

function transcriptRecorder(messages) {
  return {
    setActiveAgent() {},
    async recordOperatorPrompt(message) { messages.push({ ...message, role: "operator" }); },
    async recordLocalNotice(message) { messages.push(message); },
    async recordOutbound(message) { messages.push({ ...message, role: "assistant" }); },
  };
}

test("Feishu A2 sends only the successful bound-Agent final reply externally", async () => {
  const root = await tempRoot("feishu-success");
  const sent = [];
  const transcript = [];
  const store = createFeishuStore(root);
  const service = createFeishuService({
    store,
    client: {
      async sendText(input) { sent.push(input); return { code: 0, data: { message_id: "om-final" } }; },
    },
    personalAgentRuntime: completedRuntime("feishu final answer"),
    channelTranscriptStore: transcriptRecorder(transcript),
  });
  try {
    await store.saveAccount({ appId: "cli_xxx", appSecret: "secret", baseUrl: "https://open.feishu.cn" });
    await service.start({
      accountId: "cli_xxx",
      workspaceRoot: root,
      connectionMode: "webhook",
      webhookPort: 0,
      agent: { id: "agent-a", name: "Agent A", provider: "codex" },
    });
    const result = await service.runLocalPrompt({ accountId: "cli_xxx", chatId: "oc_chat", platformUserId: "ou_user", text: "private feishu request" });
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /feishu final answer/);
    assert.doesNotMatch(sent[0].text, /private feishu request/);
    assert.deepEqual(transcript.map((message) => message.role), ["operator", "assistant"]);
  } finally {
    await service.stop({ persist: false }).catch(() => undefined);
    await cleanup(root);
  }
});

test("Weixin Studio prompts mirror before the bound-Agent final reply", async () => {
  const root = await tempRoot("weixin-success");
  const sent = [];
  const transcript = [];
  const store = createWeixinStore(root);
  const service = createWeixinService({
    store,
    client: {
      async getUpdates({ signal }) {
        return await new Promise((resolve) => signal.addEventListener("abort", () => resolve({ ret: 0, msgs: [], get_updates_buf: "" }), { once: true }));
      },
      async sendMessage(input) { sent.push(input); return { ret: 0 }; },
    },
    personalAgentRuntime: completedRuntime("weixin final answer"),
    channelTranscriptStore: transcriptRecorder(transcript),
  });
  try {
    await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
    await service.start({ accountId: "acct", workspaceRoot: root, autoStart: false, agent: { id: "agent-a", name: "Agent A", provider: "codex" } });
    const result = await service.runLocalPrompt({ accountId: "acct", chatId: "chat-a", platformUserId: "peer-a", text: "private weixin request" });
    assert.equal(result.ok, true);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].text, "你（Studio）：private weixin request");
    assert.match(sent[1].text, /weixin final answer/);
    assert.deepEqual(transcript.map((message) => message.role), ["operator", "assistant"]);
  } finally {
    await service.stop({ persist: false }).catch(() => undefined);
    await cleanup(root);
  }
});

test("Feishu A2 keeps failed Studio prompts local for personal and OnMyAgent agents", async () => {
  const root = await tempRoot("feishu");
  const sent = [];
  const transcript = [];
  const store = createFeishuStore(root);
  const service = createFeishuService({
    store,
    client: {
      async sendText(input) { sent.push(input); return { code: 0, data: { message_id: "om-test" } }; },
    },
    personalAgentRuntime: failedRuntime(),
    channelTranscriptStore: transcriptRecorder(transcript),
  });
  try {
    await store.saveAccount({ appId: "cli_xxx", appSecret: "secret", baseUrl: "https://open.feishu.cn" });
    await service.start({
      accountId: "cli_xxx",
      workspaceRoot: root,
      textBatchDelayMs: 0,
      agent: { id: "opencode", provider: "opencode", name: "OpenCode" },
      dmPolicy: "open",
      connectionMode: "webhook",
      webhookPort: 0,
    });
    const result = await service.runLocalPrompt({ accountId: "cli_xxx", chatId: "oc_chat", platformUserId: "ou_user", text: "private request" });
    assert.equal(result.ok, false);
    assert.equal(sent.length, 0);
    assert.deepEqual(transcript.map((message) => message.role), ["operator", "error"]);
    await service.start({
      accountId: "cli_xxx",
      workspaceRoot: root,
      connectionMode: "webhook",
      webhookPort: 0,
      agent: {
        id: "onmyagent",
        name: "OnMyAgent",
        provider: "onmyagent-assistant",
      },
    });
    const assistantResult = await service.runLocalPrompt({
      accountId: "cli_xxx",
      chatId: "oc_assistant",
      platformUserId: "ou_user",
      text: "private assistant request",
    });
    assert.equal(assistantResult.ok, false);
    assert.equal(sent.length, 0);
    assert.deepEqual(transcript.map((message) => message.role), ["operator", "error", "operator", "error"]);
  } finally {
    await service.stop({ persist: false }).catch(() => undefined);
    await cleanup(root);
  }
});

test("Weixin mirrors accepted Studio prompts even when the Agent run fails", async () => {
  const root = await tempRoot("weixin");
  const sent = [];
  const transcript = [];
  let typingCalls = 0;
  const store = createWeixinStore(root);
  const service = createWeixinService({
    store,
    client: {
      async getUpdates({ signal }) {
        return await new Promise((resolve) => signal.addEventListener("abort", () => resolve({ ret: 0, msgs: [], get_updates_buf: "" }), { once: true }));
      },
      async getConfig() { typingCalls += 1; return { typing_ticket: "ticket" }; },
      async sendTyping() { typingCalls += 1; return { ret: 0 }; },
      async sendMessage(input) { sent.push(input); return { ret: 0 }; },
    },
    personalAgentRuntime: failedRuntime(),
    channelTranscriptStore: transcriptRecorder(transcript),
  });
  try {
    await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
    await service.start({ accountId: "acct", workspaceRoot: root, autoStart: false, agent: { id: "agent-a", name: "Agent A", provider: "codex" } });
    const result = await service.runLocalPrompt({ accountId: "acct", chatId: "chat-a", platformUserId: "peer-a", text: "private request" });
    assert.equal(result.ok, false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, "你（Studio）：private request");
    assert.equal(typingCalls, 0);
    assert.deepEqual(transcript.map((message) => message.role), ["operator", "error"]);
    await service.start({ accountId: "acct", agent: { id: "onmyagent", name: "OnMyAgent", provider: "onmyagent-assistant" } });
    const assistantResult = await service.runLocalPrompt({
      accountId: "acct",
      chatId: "chat-assistant",
      platformUserId: "peer-a",
      text: "private assistant request",
    });
    assert.equal(assistantResult.ok, false);
    assert.equal(sent.length, 2);
    assert.equal(sent[1].text, "你（Studio）：private assistant request");
    assert.equal(typingCalls, 0);
    assert.deepEqual(transcript.map((message) => message.role), ["operator", "error", "operator", "error"]);
  } finally {
    await service.stop({ persist: false }).catch(() => undefined);
    await cleanup(root);
  }
});

test("Weixin does not start an Agent turn when Studio prompt mirroring fails", async () => {
  const root = await tempRoot("weixin-mirror-failure");
  const runtimeCalls = [];
  const transcript = [];
  const store = createWeixinStore(root);
  const service = createWeixinService({
    store,
    client: {
      async getUpdates({ signal }) {
        return await new Promise((resolve) => signal.addEventListener("abort", () => resolve({ ret: 0, msgs: [], get_updates_buf: "" }), { once: true }));
      },
      async sendMessage() { throw new Error("synthetic mirror outage"); },
    },
    personalAgentRuntime: {
      async runMessage() { runtimeCalls.push(true); return { status: "completed", output: "must not run" }; },
    },
    channelTranscriptStore: transcriptRecorder(transcript),
  });
  try {
    await store.saveAccount({ accountId: "acct", token: "tok", baseUrl: "https://weixin.example.com", userId: "owner" });
    await service.start({ accountId: "acct", workspaceRoot: root, autoStart: false, agent: { id: "agent-a", name: "Agent A", provider: "codex" } });
    const result = await service.runLocalPrompt({ accountId: "acct", chatId: "chat-a", platformUserId: "peer-a", text: "will not dispatch" });
    assert.equal(result.ok, false);
    assert.match(result.error, /mirror|sendmessage|outage/i);
    assert.equal(runtimeCalls.length, 0);
    assert.deepEqual(transcript, []);
  } finally {
    await service.stop({ persist: false }).catch(() => undefined);
    await cleanup(root);
  }
});
