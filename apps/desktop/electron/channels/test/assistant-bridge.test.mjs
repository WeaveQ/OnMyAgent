import { strict as assert } from "node:assert";

import { runAssistantBridgeTurn, runAssistantTurn } from "../assistant-bridge.mjs";

function createMockClient({ assistantText = "你好，我是本地助理" } = {}) {
  const calls = { create: 0, get: 0, messages: 0, prompt: 0, lastPrompt: null };
  const sessionMessages = new Map();
  const sessions = new Map();
  const client = {
    async workspaces() {
      return { items: [{ id: "workspace", path: "/tmp/ws" }] };
    },
    async create(workspaceId) {
      calls.create += 1;
      const productSessionId = `sess-${calls.create}`;
      sessions.set(productSessionId, { productSessionId, workspaceId, cwd: "/tmp/ws" });
      sessionMessages.set(productSessionId, []);
      return { session: sessions.get(productSessionId) };
    },
    async get(_workspaceId, sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        const error = new Error("not found");
        error.status = 404;
        throw error;
      }
      calls.get += 1;
      return { session };
    },
    async messages(_workspaceId, sessionId) {
      calls.messages += 1;
      return {
        productSessionId: sessionId,
        messages: sessionMessages.get(sessionId) ?? [],
        complete: true,
      };
    },
    async prompt(_workspaceId, sessionId, text) {
      calls.prompt += 1;
      calls.lastPrompt = text;
      const list = sessionMessages.get(sessionId) ?? [];
      list.push({
        id: `m-${calls.prompt}`,
        productSessionId: sessionId,
        role: "assistant",
        parts: [{ type: "text", id: `text-${calls.prompt}`, text: assistantText }],
        createdAt: calls.prompt,
        completedAt: calls.prompt,
      });
      sessionMessages.set(sessionId, list);
      return { ok: true };
    },
  };
  return { client, calls };
}

const connection = {
  onmyagentServerBaseUrl: "http://127.0.0.1:4096",
  onmyagentServerToken: "tok",
};

console.log("Test 1: first turn creates one selected-runtime session and returns assistant text");
let stored = null;
const { client, calls } = createMockClient();
const r1 = await runAssistantTurn({
  runtimeConnection: connection,
  workspaceRoot: "/tmp/ws",
  chatId: "chat-1",
  text: "你好",
  readSessionId: async () => null,
  writeSessionId: async (id) => { stored = id; },
  createClient: () => client,
});
assert.equal(calls.create, 1, "should create exactly one session");
assert.equal(stored, "sess-1", "should persist product session id");
assert.equal(calls.prompt, 1, "should prompt once");
assert.equal(calls.lastPrompt, "你好", "prompt text must pass through");
assert.equal(r1.output, "你好，我是本地助理");

console.log("Test 2: second turn reuses the sticky product session");
const r2 = await runAssistantTurn({
  runtimeConnection: connection,
  workspaceRoot: "/tmp/ws",
  chatId: "chat-1",
  text: "再问一次",
  readSessionId: async () => stored,
  writeSessionId: async () => {},
  createClient: () => client,
});
assert.equal(calls.create, 1, "no second session created for same chat");
assert.equal(calls.prompt, 2, "second prompt sent");
assert.equal(r2.sessionId, stored);

console.log("Test 3: stale persisted binding is recreated");
const { client: staleClient, calls: staleCalls } = createMockClient();
const r3 = await runAssistantTurn({
  runtimeConnection: connection,
  workspaceRoot: "/tmp/ws",
  chatId: "chat-2",
  text: "hi",
  readSessionId: async () => "old-stale",
  writeSessionId: async () => {},
  createClient: () => staleClient,
});
assert.equal(staleCalls.create, 1, "stale session recreated");
assert.ok(r3.sessionId && r3.sessionId !== "old-stale", "new product session id assigned");

console.log("Test 4: missing canonical connection fails visibly");
await assert.rejects(
  () => runAssistantTurn({
    runtimeConnection: { onmyagentServerBaseUrl: null, onmyagentServerToken: null },
    workspaceRoot: "/tmp/ws",
    chatId: "c",
    text: "x",
    createClient: () => client,
  }),
  /主运行时连接不可用/,
);

console.log("Test 5: ambiguous workspace mapping fails before session creation");
await assert.rejects(
  () => runAssistantTurn({
    runtimeConnection: connection,
    workspaceRoot: "/tmp/other",
    chatId: "c",
    text: "x",
    createClient: () => client,
  }),
  /workspace is unavailable or ambiguous/,
);

console.log("Test 6: channel bridge persists the sticky session and delivers the canonical reply");
const { client: dispatchClient } = createMockClient({ assistantText: "channel reply" });
const writtenSettings = [];
const delivered = [];
const dispatchResult = await runAssistantBridgeTurn({
  runtime: {
    async getPrimaryRuntimeConnection() {
      return connection;
    },
  },
  store: {
    async writeChatSetting(accountId, chatId, value) {
      writtenSettings.push({ accountId, chatId, value });
    },
  },
  session: {
    account: { accountId: "account-1" },
    options: { workspaceRoot: "/tmp/ws" },
  },
  event: { chatId: "channel-chat", senderId: "user", text: "from channel" },
  platformLabel: "Fixture",
  async readChatSetting() { return null; },
  async deliverReply(_session, event, text) {
    delivered.push({ chatId: event.chatId, text });
  },
  createClient: () => dispatchClient,
});
assert.equal(dispatchResult.output, "channel reply");
assert.deepEqual(writtenSettings, [{
  accountId: "account-1",
  chatId: "channel-chat",
  value: { assistantSessionId: "sess-1" },
}]);
assert.deepEqual(delivered, [{ chatId: "channel-chat", text: "channel reply" }]);

console.log("Test 7: channel bridge waits for a terminal message projection, not the first streamed chunk");
const { client: streamingClient, calls: streamingCalls } = createMockClient({ assistantText: "complete channel reply" });
const originalStreamingMessages = streamingClient.messages;
let streamingPolls = 0;
streamingClient.messages = async (...args) => {
  const result = await originalStreamingMessages(...args);
  streamingPolls += 1;
  if (streamingPolls === 2 && result.messages.length) {
    return {
      ...result,
      messages: result.messages.map((message) => ({ ...message, completedAt: undefined })),
    };
  }
  return result;
};
const delayed = await runAssistantTurn({
  runtimeConnection: connection,
  workspaceRoot: "/tmp/ws",
  chatId: "chat-streaming",
  text: "streaming",
  createClient: () => streamingClient,
});
assert.equal(delayed.output, "complete channel reply");
assert.ok(streamingCalls.messages >= 3, "must poll beyond the first non-terminal chunk");

console.log("\n✅ All canonical assistant-bridge tests passed!");
