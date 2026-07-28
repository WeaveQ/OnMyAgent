import { strict as assert } from "node:assert";

import { runAssistantTurn } from "../assistant-bridge.mjs";

function createMockClient({ assistantText = "你好，我是本地助理" } = {}) {
  const calls = { create: 0, get: 0, messages: 0, promptAsync: 0, lastPromptParts: null, lastCreateTitle: null };
  const sessionMessages = new Map();
  function makeClient(_config) {
    return {
      session: {
        async create({ directory, title }) {
          calls.create += 1;
          calls.lastCreateTitle = title;
          const id = `sess-${calls.create}`;
          sessionMessages.set(id, []);
          return { data: { id } };
        },
        async get({ sessionID }) {
          calls.get += 1;
          return sessionMessages.has(sessionID) ? { data: { id: sessionID } } : { error: "not found" };
        },
        async messages({ sessionID }) {
          calls.messages += 1;
          return { data: sessionMessages.get(sessionID) ?? [] };
        },
        async promptAsync({ sessionID, directory, parts }) {
          calls.promptAsync += 1;
          calls.lastPromptParts = parts;
          const list = sessionMessages.get(sessionID) ?? [];
          list.push({ info: { role: "assistant", id: `m-${calls.promptAsync}` }, parts: [{ type: "text", text: assistantText }] });
          sessionMessages.set(sessionID, list);
          return { data: {} };
        },
      },
    };
  }
  return { makeClient, calls };
}

const connection = { opencodeBaseUrl: "http://127.0.0.1:4096/w/x/opencode", onmyagentServerToken: "tok" };

console.log("Test 1: first turn creates one session, prompts, returns assistant text");
let stored = null;
const { makeClient, calls } = createMockClient();
const r1 = await runAssistantTurn({
  opencodeConnection: connection,
  workspaceRoot: "/tmp/ws",
  chatId: "chat-1",
  text: "你好",
  readSessionId: async () => null,
  writeSessionId: async (id) => {
    stored = id;
  },
  createClient: makeClient,
});
assert.equal(calls.create, 1, "should create exactly one session");
assert.equal(stored, "sess-1", "should persist session id");
assert.equal(calls.promptAsync, 1, "should prompt once");
assert.equal(calls.lastPromptParts?.[0]?.text, "你好", "prompt text must pass through");
assert.ok(calls.lastCreateTitle?.includes("chat-1"), "title must carry channel chatId");
assert.equal(r1.output, "你好，我是本地助理");
console.log("✓ created once, prompted, returned text");

console.log("Test 2: second turn reuses the persisted session (no second create)");
const r2 = await runAssistantTurn({
  opencodeConnection: connection,
  workspaceRoot: "/tmp/ws",
  chatId: "chat-1",
  text: "再问一次",
  readSessionId: async () => stored,
  writeSessionId: async () => {},
  createClient: makeClient,
});
assert.equal(calls.create, 1, "no second session created for same chat");
assert.equal(calls.promptAsync, 2, "second prompt sent");
assert.equal(r2.output, "你好，我是本地助理");
console.log("✓ reused session");

console.log("Test 3: stale persisted session is recreated");
const { makeClient: makeStale, calls: staleCalls } = createMockClient();
const r3 = await runAssistantTurn({
  opencodeConnection: connection,
  workspaceRoot: "/tmp/ws",
  chatId: "chat-2",
  text: "hi",
  readSessionId: async () => "old-stale",
  writeSessionId: async () => {},
  createClient: (cfg) => {
    const c = makeStale(cfg);
    c.session.get = async () => ({ error: "not found" });
    return c;
  },
});
assert.equal(staleCalls.create, 1, "stale session recreated");
assert.ok(r3.sessionId && r3.sessionId !== "old-stale", "new session id assigned");
console.log("✓ stale recreated");

console.log("Test 4: missing connection throws a clear error");
await assert.rejects(
  () =>
    runAssistantTurn({
      opencodeConnection: { opencodeBaseUrl: null, onmyagentServerToken: null },
      workspaceRoot: "/tmp/ws",
      chatId: "c",
      text: "x",
      readSessionId: async () => null,
      writeSessionId: async () => {},
      createClient: makeClient,
    }),
  /连接不可用/,
);
console.log("✓ missing connection rejected");

console.log("\n✅ All assistant-bridge (P2-03) tests passed!");
