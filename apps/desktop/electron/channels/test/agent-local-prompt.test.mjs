import { strict as assert } from "node:assert";
import test from "node:test";

import { createChannelAgentDispatcher } from "../agent-dispatch.mjs";

test("runLocalPrompt persists a private prompt, preserves the Agent snapshot, and rejects busy runs", async () => {
  const runs = new Map();
  const transcript = [];
  let startCalls = 0;
  let simulateInboundCalls = 0;
  const externalSends = [];
  const store = {
    async loadAccount(accountId) { return { accountId, token: "test-token" }; },
    async writeConfig(value) { return value; },
    async readChatHistory() { return []; },
    async appendChatHistory() { return true; },
    async readChatSetting() { return null; },
    async writeChatSetting(_accountId, _chatId, value) { return value; },
    async readActiveRun(_accountId, runKey) { return runs.get(runKey) ?? null; },
    async listActiveRuns() { return [...runs.values()]; },
    async writeActiveRun(accountId, runKey, value) {
      const next = { ...(runs.get(runKey) ?? {}), ...value, accountId, runKey };
      runs.set(runKey, next);
      return next;
    },
    async deleteActiveRun(_accountId, runKey) { runs.delete(runKey); return true; },
  };
  const runtime = {
    async startMessage() {
      startCalls += 1;
      return { runId: "local-run-1", status: "running" };
    },
    async getRun() { return { status: "running" }; },
  };
  const transcriptStore = {
    setActiveAgent() {},
    async recordOperatorPrompt(message) { transcript.push({ ...message, direction: "local" }); },
    async recordOutbound() { transcript.push({ direction: "outbound" }); },
  };
  const dispatcher = createChannelAgentDispatcher({
    platformType: "telegram",
    platformName: "Telegram",
    store,
    runtime,
    channelTranscriptStore: transcriptStore,
    sendTextTo: async (_chatId, text) => { externalSends.push(text); return { ok: true, messageId: "external-message" }; },
    normalizeInbound: (raw) => raw,
    sendChunkDelayMs: 0,
  });
  const originalSimulate = dispatcher.simulateInbound;
  dispatcher.simulateInbound = async (...args) => {
    simulateInboundCalls += 1;
    return originalSimulate(...args);
  };
  await dispatcher.start({ accountId: "acct", dmPolicy: "open", textBatchDelayMs: 0, agent: { id: "agent-a", name: "Agent A", provider: "codex" } });

  const accepted = await dispatcher.runLocalPrompt({ accountId: "acct", chatId: "chat-a", platformUserId: "peer-a", text: "private request" });
  assert.equal(accepted.ok, true);
  assert.equal(startCalls, 1);
  assert.equal(simulateInboundCalls, 0);
  assert.equal(transcript.length, 1);
  assert.equal(transcript[0].direction, "local");
  assert.equal(transcript[0].content, "private request");
  const persistedRun = [...runs.values()][0];
  assert.equal(persistedRun.isLocalPrompt, true);
  assert.equal(persistedRun.agent.id, "agent-a");
  assert.equal(persistedRun.agent.name, "Agent A");

  const busy = await dispatcher.runLocalPrompt({ accountId: "acct", chatId: "chat-a", platformUserId: "peer-a", text: "second request" });
  assert.equal(busy.ok, false);
  assert.equal(busy.existingRun, true);
  assert.equal(startCalls, 1);
  assert.equal(transcript.length, 1);
  assert.equal(externalSends.length, 0);
  await dispatcher.stop({ persist: false });
});

test("a successful Studio prompt sends only the bound Agent's final reply to the IM chat", async () => {
  const transcript = [];
  const history = [];
  const externalSends = [];
  const store = {
    async loadAccount(accountId) { return { accountId, token: "test-token" }; },
    async writeConfig(value) { return value; },
    async readChatHistory() { return []; },
    async appendChatHistory(_accountId, _historyKey, entries) { history.push(...entries); return true; },
    async readChatSetting() { return null; },
    async readActiveRun() { return null; },
    async listActiveRuns() { return []; },
  };
  const dispatcher = createChannelAgentDispatcher({
    platformType: "telegram",
    platformName: "Telegram",
    store,
    runtime: {
      async runMessage() { return { status: "completed", output: "approved final answer" }; },
    },
    channelTranscriptStore: {
      setActiveAgent() {},
      async recordOperatorPrompt(message) { transcript.push({ ...message, direction: "local", role: "operator" }); },
      async recordOutbound(message) { transcript.push({ ...message, direction: "outbound", role: "assistant" }); },
    },
    sendTextTo: async (_chatId, text) => {
      externalSends.push(text);
      return { ok: true, messageId: "external-final" };
    },
    normalizeInbound: (raw) => raw,
    sendChunkDelayMs: 0,
  });
  await dispatcher.start({
    accountId: "acct",
    agent: { id: "agent-a", name: "Agent A", provider: "codex" },
  });

  const result = await dispatcher.runLocalPrompt({
    accountId: "acct",
    chatId: "chat-a",
    platformUserId: "peer-a",
    text: "private operator prompt",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(externalSends.length, 1);
  assert.match(externalSends[0], /approved final answer/);
  assert.doesNotMatch(externalSends[0], /private operator prompt/);
  assert.deepEqual(transcript.map((message) => message.direction), ["local", "outbound"]);
  assert.equal(transcript[0].content, "private operator prompt");
  assert.match(transcript[1].content, /approved final answer/);
  assert.equal(history[0].text, "private operator prompt");
  assert.equal(history[1].text, "approved final answer");
  await dispatcher.stop({ persist: false });
});

test("a rejected final delivery returns failure and leaves an actionable local notice", async () => {
  const transcript = [];
  const history = [];
  const store = {
    async loadAccount(accountId) { return { accountId, token: "test-token" }; },
    async writeConfig(value) { return value; },
    async readChatHistory() { return []; },
    async appendChatHistory(_accountId, _historyKey, entries) { history.push(...entries); return true; },
    async readChatSetting() { return null; },
    async readActiveRun() { return null; },
    async listActiveRuns() { return []; },
  };
  const dispatcher = createChannelAgentDispatcher({
    platformType: "telegram",
    platformName: "Telegram",
    store,
    runtime: {
      async runMessage() { return { status: "completed", output: "finished answer" }; },
    },
    channelTranscriptStore: {
      setActiveAgent() {},
      async recordOperatorPrompt(message) { transcript.push({ ...message, role: "operator" }); },
      async recordLocalNotice(message) { transcript.push(message); },
    },
    sendTextTo: async () => ({ ok: false, error: "transport down" }),
    normalizeInbound: (raw) => raw,
  });
  await dispatcher.start({
    accountId: "acct",
    agent: { id: "agent-a", name: "Agent A", provider: "codex" },
  });

  const result = await dispatcher.runLocalPrompt({
    accountId: "acct",
    chatId: "chat-a",
    text: "private operator prompt",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.match(result.error, /transport down/);
  assert.deepEqual(transcript.map((message) => message.role), ["operator", "error"]);
  assert.match(transcript[1].content, /transport down/);
  assert.equal(history.length, 0);
  await dispatcher.stop({ persist: false });
});

test("a failed Studio prompt stays local and never sends an intermediate failure to the IM chat", async () => {
  const transcript = [];
  const externalSends = [];
  const store = {
    async loadAccount(accountId) { return { accountId, token: "test-token" }; },
    async writeConfig(value) { return value; },
    async readChatHistory() { return []; },
    async appendChatHistory() { return true; },
    async readChatSetting() { return null; },
    async writeChatSetting(_accountId, _chatId, value) { return value; },
    async readActiveRun() { return null; },
    async listActiveRuns() { return []; },
    async writeActiveRun(_accountId, _runKey, value) { return value; },
    async deleteActiveRun() { return true; },
  };
  const transcriptStore = {
    setActiveAgent() {},
    async recordOperatorPrompt(message) { transcript.push({ ...message, direction: "local", role: "operator" }); },
    async recordLocalNotice(message) { transcript.push({ ...message, direction: "local" }); },
  };
  const dispatcher = createChannelAgentDispatcher({
    platformType: "discord",
    platformName: "Discord",
    store,
    runtime: {
      async startMessage() { return { status: "failed", error: "synthetic failure" }; },
      async getRun() { return null; },
    },
    channelTranscriptStore: transcriptStore,
    sendTextTo: async (_chatId, text) => { externalSends.push(text); return { ok: true }; },
    normalizeInbound: (raw) => raw,
  });
  await dispatcher.start({ accountId: "acct", agent: { id: "agent-a", name: "Agent A", provider: "codex" } });
  const result = await dispatcher.runLocalPrompt({ accountId: "acct", chatId: "chat-a", text: "private request" });
  assert.equal(result.ok, false);
  assert.equal(externalSends.length, 0);
  assert.deepEqual(transcript.map((message) => message.role), ["operator", "error"]);
  await dispatcher.stop({ persist: false });
});

test("a failed Studio prompt bound to the OnMyAgent assistant also stays local", async () => {
  const transcript = [];
  const externalSends = [];
  const store = {
    async loadAccount(accountId) { return { accountId, token: "test-token" }; },
    async writeConfig(value) { return value; },
    async readChatSetting() { return null; },
    async writeChatSetting(_accountId, _chatId, value) { return value; },
    async listActiveRuns() { return []; },
    async readActiveRun() { return null; },
  };
  const dispatcher = createChannelAgentDispatcher({
    platformType: "telegram",
    platformName: "Telegram",
    store,
    runtime: {
      async runMessage() { throw new Error("unexpected personal runtime call"); },
      async getOpencodeConnection() { return null; },
    },
    channelAssistantBindingStore: {
      getChatAssistant() { return { assistant_id: "onmyagent" }; },
      getPlatformSettings() { return null; },
    },
    channelTranscriptStore: {
      setActiveAgent() {},
      async recordOperatorPrompt(message) { transcript.push({ ...message, role: "operator" }); },
      async recordLocalNotice(message) { transcript.push(message); },
    },
    sendTextTo: async (_chatId, text) => { externalSends.push(text); return { ok: true }; },
    normalizeInbound: (raw) => raw,
  });
  await dispatcher.start({
    accountId: "acct",
    agent: { id: "onmyagent", name: "OnMyAgent", provider: "onmyagent-assistant" },
  });
  const result = await dispatcher.runLocalPrompt({ accountId: "acct", chatId: "chat-a", text: "private request" });
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(externalSends.length, 0);
  assert.deepEqual(transcript.map((message) => message.role), ["operator", "error"]);
  await dispatcher.stop({ persist: false });
});
