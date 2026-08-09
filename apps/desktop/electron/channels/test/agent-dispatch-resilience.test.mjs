import { strict as assert } from "node:assert";
import test from "node:test";

import {
  __test__,
  createChannelAgentDispatcher,
} from "../agent-dispatch.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitFor(predicate, details = () => "condition", timeoutMs = 2_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${details()}`);
}

function activeRecord(overrides = {}) {
  return {
    accountId: "acct",
    runKey: "chat-1::agent:opencode/opencode",
    runId: "run-1",
    chatId: "chat-1",
    senderId: "user-1",
    workspaceRoot: "/workspace",
    historyKey: "chat-1::agent:opencode/opencode",
    userText: "original prompt",
    agent: { id: "opencode", name: "OpenCode", provider: "opencode" },
    status: "running",
    startedAt: Date.now(),
    ...overrides,
  };
}

function createStore({ records = [], deleteFailures = 0, writeFailures = 0 } = {}) {
  const runs = new Map(records.map((record) => [record.runKey, { ...record }]));
  const appendedHistories = [];
  let deleteAttempts = 0;
  let writeAttempts = 0;
  let clearHistoryCalls = 0;
  return {
    appendedHistories,
    runs,
    get clearHistoryCalls() { return clearHistoryCalls; },
    get deleteAttempts() { return deleteAttempts; },
    get writeAttempts() { return writeAttempts; },
    async loadAccount(accountId) {
      return { accountId, token: "token" };
    },
    async writeConfig(value) {
      return value;
    },
    async readActiveRun(_accountId, runKey) {
      const record = runs.get(runKey);
      return record ? { ...record } : null;
    },
    async listActiveRuns() {
      return [...runs.values()].map((record) => ({ ...record }));
    },
    async writeActiveRun(accountId, runKey, patch) {
      writeAttempts += 1;
      if (writeFailures > 0) {
        writeFailures -= 1;
        throw new Error("active run write is locked");
      }
      const next = { ...(runs.get(runKey) ?? {}), ...patch, accountId, runKey };
      runs.set(runKey, next);
      return { ...next };
    },
    async deleteActiveRun(_accountId, runKey) {
      deleteAttempts += 1;
      if (deleteFailures > 0) {
        deleteFailures -= 1;
        const error = new Error("active run file is locked");
        error.code = "EPERM";
        throw error;
      }
      return runs.delete(runKey);
    },
    async readChatHistory() {
      return [];
    },
    async appendChatHistory(_accountId, historyKey, entries) {
      appendedHistories.push({ historyKey, entries });
      return entries;
    },
    async readChatSetting() {
      return null;
    },
    async writeChatSetting(_accountId, _chatId, value) {
      return value;
    },
    async clearChatHistory() {
      clearHistoryCalls += 1;
      return true;
    },
  };
}

function inbound(text, messageId) {
  return {
    accountId: "acct",
    senderId: "user-1",
    chatId: "chat-1",
    chatType: "dm",
    text,
    messageId,
  };
}

function createDispatcher({ store, runtime, sendTextTo, editMessageTo = null, maxMessageLength = 2000 }) {
  return createChannelAgentDispatcher({
    platformType: "test-channel",
    platformName: "Test Channel",
    store,
    runtime,
    sendTextTo,
    editMessageTo,
    maxMessageLength,
    sendChunkDelayMs: 0,
    normalizeInbound: (raw) => raw,
  });
}

async function startDispatcher(dispatcher) {
  const result = await dispatcher.start({
    accountId: "acct",
    workspaceRoot: "/workspace",
    dmPolicy: "open",
    textBatchDelayMs: 0,
    sendChunkDelayMs: 0,
    agent: { id: "opencode", name: "OpenCode", provider: "opencode" },
  });
  assert.equal(result.ok, true);
}

test("splitTextForPlatform keeps UTF-16 surrogate pairs intact", () => {
  const chunks = __test__.splitTextForPlatform("abcd😀ef", 5);
  assert.deepEqual(chunks, ["abcd", "😀ef"]);
  assert.equal(chunks.join(""), "abcd😀ef");
  for (const chunk of chunks) {
    assert.doesNotMatch(chunk, /[\uD800-\uDBFF]$/u);
    assert.doesNotMatch(chunk, /^[\uDC00-\uDFFF]/u);
  }
});

test("edit-capable delivery rolls over before the platform limit", async () => {
  const calls = [];
  const dispatcher = createDispatcher({
    store: createStore(),
    runtime: {},
    maxMessageLength: 10,
    sendTextTo: async (_chatId, text) => {
      calls.push({ type: "send", text });
      return { ok: true, messageId: `message-${calls.length}` };
    },
    editMessageTo: async (_chatId, _messageId, text) => {
      calls.push({ type: "edit", text });
      return { ok: true };
    },
  });

  const result = await dispatcher.deliverReply({}, "chat-1", "user-1", "abcdefghijklmnopqrstuvwxyz");

  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.type), ["send", "send", "send"]);
  assert.ok(calls.every((call) => call.text.length <= 10));
});

test("edit-capable delivery checks each edit result and never exceeds the limit", async () => {
  const calls = [];
  const dispatcher = createDispatcher({
    store: createStore(),
    runtime: {},
    maxMessageLength: 10,
    sendTextTo: async (_chatId, text) => {
      calls.push({ type: "send", text });
      return { ok: true, messageId: "message-1" };
    },
    editMessageTo: async (_chatId, _messageId, text) => {
      calls.push({ type: "edit", text });
      return { ok: false, error: "edit rejected" };
    },
  });

  const result = await dispatcher.deliverReply({}, "chat-1", "user-1", "abcdef\n\nxyz");

  assert.equal(result.ok, false);
  assert.deepEqual(calls.map((call) => call.type), ["send", "edit"]);
  assert.ok(calls.every((call) => call.text.length <= 10));
  assert.match(result.error, /edit rejected/);
});

test("synchronous terminal delivery failure does not append full assistant history", async () => {
  const store = createStore();
  let runCalls = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async runMessage() {
        runCalls += 1;
        return { runId: "sync-1", status: "completed", output: "complete output" };
      },
    },
    sendTextTo: async () => ({ ok: false, error: "transport down" }),
  });
  await startDispatcher(dispatcher);

  await dispatcher.processInbound(inbound("hello", "sync-message-1"));
  await waitFor(() => runCalls === 1, () => `runCalls=${runCalls}`);
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(store.appendedHistories.length, 0);
  assert.match(dispatcher.status().lastError, /transport down/);
  await dispatcher.stop({ persist: false });
});

test("starting reservation prevents duplicate starts and protects new/cancel commands", async () => {
  const store = createStore();
  const startGate = deferred();
  const sent = [];
  let startCalls = 0;
  let resetCalls = 0;
  let cancelCalls = 0;
  const runtime = {
    async startMessage() {
      startCalls += 1;
      return await startGate.promise;
    },
    async getRun({ runId }) {
      return { runId, status: "running" };
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
  const dispatcher = createDispatcher({
    store,
    runtime,
    sendTextTo: async (_chatId, text) => {
      sent.push(text);
      return { ok: true, messageId: `message-${sent.length}` };
    },
  });
  await startDispatcher(dispatcher);

  await dispatcher.processInbound(inbound("first", "reservation-1"));
  await waitFor(() => startCalls === 1, () => `startCalls=${startCalls}`);
  await dispatcher.processInbound(inbound("second", "reservation-2"));
  await dispatcher.processInbound(inbound("#new", "reservation-new"));
  await dispatcher.processInbound(inbound("#cancel", "reservation-cancel"));
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(startCalls, 1);
  assert.equal(resetCalls, 0);
  assert.equal(cancelCalls, 0);
  assert.ok(sent.some((text) => text.includes("正在启动")));

  startGate.resolve({ runId: "reserved-run", status: "running" });
  await waitFor(() => store.runs.has("chat-1::agent:opencode/opencode"));
  assert.equal(startCalls, 1);
  await dispatcher.stop({ persist: false });
});

test("failed initial active-run persistence keeps an authoritative overlay until completion", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore({ writeFailures: 1 });
  const pollGate = deferred();
  const sent = [];
  let startCalls = 0;
  let getRunCalls = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async startMessage() {
        startCalls += 1;
        return { runId: "overlay-run", status: "running" };
      },
      async getRun({ runId }) {
        getRunCalls += 1;
        assert.equal(runId, "overlay-run");
        return await pollGate.promise;
      },
    },
    sendTextTo: async (_chatId, text) => {
      sent.push(text);
      return { ok: true, messageId: `message-${sent.length}` };
    },
  });
  await startDispatcher(dispatcher);

  await dispatcher.processInbound(inbound("first", "overlay-first"));
  await waitFor(() => store.writeAttempts === 1 && getRunCalls === 1, () => `writes=${store.writeAttempts} polls=${getRunCalls}`);
  assert.equal(store.runs.has(runKey), false, "the injected first disk write must fail");

  await dispatcher.processInbound(inbound("second", "overlay-second"));
  await waitFor(() => sent.some((text) => text.includes("还在处理上一条消息")), () => `sent=${JSON.stringify(sent)}`);
  assert.equal(startCalls, 1, "the in-memory overlay must prevent a second provider run");

  pollGate.resolve({ runId: "overlay-run", status: "completed", output: "overlay completed" });
  await waitFor(() => sent.some((text) => text.includes("overlay completed")) && store.appendedHistories.length === 1);
  await waitFor(() => !store.runs.has(runKey));

  assert.equal(startCalls, 1);
  assert.equal(store.appendedHistories[0]?.entries[1]?.text, "overlay completed");
  await dispatcher.stop({ persist: false });
});

test("stop cancels a run that finishes starting after the channel is stopped", async () => {
  const store = createStore();
  const startGate = deferred();
  let startCalls = 0;
  let cancelCalls = 0;
  let sends = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async startMessage() {
        startCalls += 1;
        return await startGate.promise;
      },
      async getRun() {
        return { status: "running" };
      },
      async cancelRun(runId) {
        assert.equal(runId, "late-start-run");
        cancelCalls += 1;
        return { ok: true };
      },
    },
    sendTextTo: async () => {
      sends += 1;
      return { ok: true };
    },
  });
  await startDispatcher(dispatcher);
  await dispatcher.processInbound(inbound("late start", "late-start-message"));
  await waitFor(() => startCalls === 1, () => `startCalls=${startCalls}`);

  await dispatcher.stop({ persist: false });
  startGate.resolve({ runId: "late-start-run", status: "running" });
  await waitFor(() => cancelCalls === 1, () => `cancelCalls=${cancelCalls}`);

  assert.equal(sends, 0);
  assert.equal(store.runs.size, 0);
});

test("stop during the initial active-run write cancels the late run and removes its lock", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore();
  const writeEntered = deferred();
  const writeGate = deferred();
  const originalWriteActiveRun = store.writeActiveRun.bind(store);
  store.writeActiveRun = async (...args) => {
    if (args[2]?.runId === "late-write-run") {
      writeEntered.resolve();
      await writeGate.promise;
    }
    return await originalWriteActiveRun(...args);
  };
  const cancelled = [];
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async startMessage() {
        return { runId: "late-write-run", status: "running" };
      },
      async getRun() {
        return { status: "running" };
      },
      async cancelRun(runId, options) {
        cancelled.push({ runId, options });
        return { ok: true };
      },
    },
    sendTextTo: async () => ({ ok: true }),
  });
  await startDispatcher(dispatcher);
  await dispatcher.processInbound(inbound("stop during write", "late-write-message"));
  await writeEntered.promise;

  await dispatcher.stop({ persist: false });
  writeGate.resolve();
  await waitFor(() => cancelled.length === 1, () => `cancelled=${JSON.stringify(cancelled)}`);

  assert.deepEqual(cancelled, [{
    runId: "late-write-run",
    options: { reason: "test-channel_stopped" },
  }]);
  assert.equal(store.runs.has(runKey), false);
});

test("stop after the initial write returns keeps the durable run resumable in the same dispatcher", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore();
  const stopped = deferred();
  const pollGate = deferred();
  let dispatcher;
  let stopQueued = false;
  const originalWriteActiveRun = store.writeActiveRun.bind(store);
  store.writeActiveRun = async (...args) => {
    const stored = await originalWriteActiveRun(...args);
    if (args[2]?.runId !== "durable-before-stop-run") return stored;
    return new Proxy(stored, {
      ownKeys(target) {
        if (!stopQueued) {
          stopQueued = true;
          queueMicrotask(async () => {
            await dispatcher.stop({ persist: false });
            stopped.resolve();
          });
        }
        return Reflect.ownKeys(target);
      },
    });
  };
  let startCalls = 0;
  let getRunCalls = 0;
  dispatcher = createDispatcher({
    store,
    runtime: {
      async startMessage() {
        startCalls += 1;
        return { runId: "durable-before-stop-run", status: "running" };
      },
      async getRun() {
        getRunCalls += 1;
        return await pollGate.promise;
      },
    },
    sendTextTo: async () => ({ ok: true, messageId: "message-1" }),
  });
  await startDispatcher(dispatcher);
  await dispatcher.processInbound(inbound("durable before stop", "durable-before-stop-message"));
  await stopped.promise;
  assert.equal(store.runs.get(runKey)?.runId, "durable-before-stop-run");

  await startDispatcher(dispatcher);
  await waitFor(() => getRunCalls === 1, () => `getRunCalls=${getRunCalls}`);
  await dispatcher.processInbound(inbound("must stay busy", "durable-before-stop-second-message"));
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(startCalls, 1);

  pollGate.resolve({ runId: "durable-before-stop-run", status: "completed", output: "resumed" });
  await waitFor(() => !store.runs.has(runKey));
  await dispatcher.stop({ persist: false });
});

test("stop after a durable terminal claim but before transport preserves and resumes the reply", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore({ records: [activeRecord()] });
  const claimPersisted = deferred();
  const claimReturnGate = deferred();
  const originalWriteActiveRun = store.writeActiveRun.bind(store);
  store.writeActiveRun = async (...args) => {
    const stored = await originalWriteActiveRun(...args);
    if (args[2]?.terminalDeliveryClaimedRunId === "run-1") {
      claimPersisted.resolve();
      await claimReturnGate.promise;
    }
    return stored;
  };
  const sent = [];
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async getRun({ runId }) {
        return { runId, status: "completed", output: "resume after zero attempts" };
      },
    },
    sendTextTo: async (_chatId, text) => {
      sent.push(text);
      return { ok: true, messageId: `message-${sent.length}` };
    },
  });
  await startDispatcher(dispatcher);
  await claimPersisted.promise;

  await dispatcher.stop({ persist: false });
  claimReturnGate.resolve();
  await waitFor(
    () => store.runs.has(runKey) && store.runs.get(runKey)?.terminalDeliveryClaimedRunId == null,
    () => JSON.stringify(store.runs.get(runKey)),
  );
  assert.equal(sent.length, 0);

  await startDispatcher(dispatcher);
  await waitFor(() => sent.length === 1 && !store.runs.has(runKey));
  assert.match(sent[0], /resume after zero attempts/);
  assert.equal(store.appendedHistories.length, 1);
  await dispatcher.stop({ persist: false });
});

test("stop while the first transport marker is pending prevents a post-stop send and resumes later", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore({ records: [activeRecord()] });
  const markerPersisted = deferred();
  const markerReturnGate = deferred();
  const originalWriteActiveRun = store.writeActiveRun.bind(store);
  store.writeActiveRun = async (...args) => {
    const stored = await originalWriteActiveRun(...args);
    if (args[2]?.terminalDeliveryAttemptedTransports === 1) {
      markerPersisted.resolve();
      await markerReturnGate.promise;
    }
    return stored;
  };
  const sent = [];
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async getRun({ runId }) {
        return { runId, status: "completed", output: "resume after marker stop" };
      },
    },
    sendTextTo: async (_chatId, text) => {
      sent.push(text);
      return { ok: true, messageId: `message-${sent.length}` };
    },
  });
  await startDispatcher(dispatcher);
  await markerPersisted.promise;

  await dispatcher.stop({ persist: false });
  markerReturnGate.resolve();
  await waitFor(
    () => store.runs.has(runKey) && store.runs.get(runKey)?.terminalDeliveryClaimedRunId == null,
    () => JSON.stringify(store.runs.get(runKey)),
  );
  assert.equal(sent.length, 0);

  await startDispatcher(dispatcher);
  await waitFor(() => sent.length === 1 && !store.runs.has(runKey));
  assert.match(sent[0], /resume after marker stop/);
  await dispatcher.stop({ persist: false });
});

test("a fresh dispatcher retries a zero-attempt terminal claim when release persistence fails", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore({ records: [activeRecord()] });
  const claimPersisted = deferred();
  const claimReturnGate = deferred();
  const releaseFailed = deferred();
  const originalWriteActiveRun = store.writeActiveRun.bind(store);
  let failRelease = true;
  store.writeActiveRun = async (...args) => {
    if (args[2]?.terminalDeliveryClaimedRunId == null && failRelease) {
      failRelease = false;
      releaseFailed.resolve();
      throw new Error("terminal claim release is locked");
    }
    const stored = await originalWriteActiveRun(...args);
    if (args[2]?.terminalDeliveryClaimedRunId === "run-1") {
      claimPersisted.resolve();
      await claimReturnGate.promise;
    }
    return stored;
  };
  const runtime = { async getRun({ runId }) { return { runId, status: "completed", output: "fresh retry" }; } };
  let sends = 0;
  const sendTextTo = async () => ({ ok: true, messageId: `message-${++sends}` });
  const first = createDispatcher({ store, runtime, sendTextTo });
  await startDispatcher(first);
  await claimPersisted.promise;
  await first.stop({ persist: false });
  claimReturnGate.resolve();
  await releaseFailed.promise;
  assert.equal(store.runs.get(runKey)?.terminalDeliveryAttemptedTransports, 0);

  const second = createDispatcher({ store, runtime, sendTextTo });
  await startDispatcher(second);
  await waitFor(() => !store.runs.has(runKey));
  assert.equal(sends, 1);
  assert.equal(store.appendedHistories.length, 1);
  await second.stop({ persist: false });
});

test("a stale active-run read cannot resurrect a cancelled lock", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore();
  const staleReadEntered = deferred();
  const staleReadGate = deferred();
  const originalReadActiveRun = store.readActiveRun.bind(store);
  let reads = 0;
  store.readActiveRun = async (...args) => {
    reads += 1;
    const snapshot = await originalReadActiveRun(...args);
    if (reads === 1) {
      staleReadEntered.resolve();
      await staleReadGate.promise;
    }
    return snapshot;
  };
  let startCalls = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async startMessage() {
        startCalls += 1;
        return { runId: "replacement-run", status: "running" };
      },
      async getRun({ runId }) {
        return { runId, status: "completed", output: "replacement completed" };
      },
      async cancelRun() {
        return { ok: true };
      },
    },
    sendTextTo: async () => ({ ok: true, messageId: "message" }),
  });
  await startDispatcher(dispatcher);
  store.runs.set(runKey, activeRecord());

  const staleStatus = dispatcher.processInbound(inbound("#status", "stale-status"));
  await staleReadEntered.promise;
  await dispatcher.processInbound(inbound("#cancel", "stale-cancel"));
  staleReadGate.resolve();
  await staleStatus;

  await dispatcher.processInbound(inbound("replacement", "stale-replacement"));
  await waitFor(() => startCalls === 1, () => `startCalls=${startCalls}`);
  await waitFor(() => !store.runs.has(runKey));
  await dispatcher.stop({ persist: false });
});

test("stop while the initial active-run read is pending prevents the first runtime start", async () => {
  const store = createStore();
  const readEntered = deferred();
  const readGate = deferred();
  store.readActiveRun = async () => {
    readEntered.resolve();
    await readGate.promise;
    return null;
  };
  let startCalls = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async startMessage() {
        startCalls += 1;
        return { runId: "must-not-start", status: "running" };
      },
      async getRun() {
        return { status: "running" };
      },
    },
    sendTextTo: async () => ({ ok: true }),
  });
  await startDispatcher(dispatcher);
  await dispatcher.processInbound(inbound("pending read", "pending-read-message"));
  await readEntered.promise;

  await dispatcher.stop({ persist: false });
  readGate.resolve();
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(startCalls, 0);
  assert.equal(store.runs.size, 0);
});

test("active-run polling deduplicates pending nudges while terminal delivery is in flight", async () => {
  const store = createStore({ records: [activeRecord()] });
  const deliveryGate = deferred();
  let getRunCalls = 0;
  let terminalAttempts = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async getRun({ runId }) {
        getRunCalls += 1;
        return { runId, status: "completed", output: "terminal output" };
      },
    },
    sendTextTo: async (_chatId, text) => {
      if (text.includes("terminal output")) {
        terminalAttempts += 1;
        return await deliveryGate.promise;
      }
      return { ok: true, messageId: "status-message" };
    },
  });
  await startDispatcher(dispatcher);
  await waitFor(() => terminalAttempts === 1, () => `terminalAttempts=${terminalAttempts}`);

  await Promise.all([
    dispatcher.processInbound(inbound("#status", "poll-status-1")),
    dispatcher.processInbound(inbound("#status", "poll-status-2")),
    dispatcher.processInbound(inbound("#status", "poll-status-3")),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(getRunCalls, 1);

  deliveryGate.resolve({ ok: true, messageId: "terminal-message" });
  await waitFor(() => !store.runs.has("chat-1::agent:opencode/opencode"));

  assert.equal(getRunCalls, 1);
  assert.equal(terminalAttempts, 1);
  assert.equal(store.appendedHistories.length, 1);
  assert.equal(store.deleteAttempts, 1);
  await dispatcher.stop({ persist: false });
});

test("stop returns during deferred polling and leaves the run resumable without post-stop side effects", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore({ records: [activeRecord()] });
  const pollGate = deferred();
  let firstGetRunCalls = 0;
  let sends = 0;
  const first = createDispatcher({
    store,
    runtime: {
      async getRun() {
        firstGetRunCalls += 1;
        return await pollGate.promise;
      },
    },
    sendTextTo: async () => {
      sends += 1;
      return { ok: true, messageId: "post-stop-message" };
    },
  });
  await startDispatcher(first);
  await waitFor(() => firstGetRunCalls === 1, () => `firstGetRunCalls=${firstGetRunCalls}`);

  const stoppedAt = Date.now();
  await first.stop({ persist: false });
  assert.ok(Date.now() - stoppedAt < 100, "stop must not await a provider getRun call");
  pollGate.resolve({ runId: "run-1", status: "completed", output: "late terminal output" });
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(sends, 0);
  assert.equal(store.deleteAttempts, 0);
  assert.equal(store.appendedHistories.length, 0);
  assert.ok(store.runs.has(runKey), "the next dispatcher must be able to resume the active run");

  const second = createDispatcher({
    store,
    runtime: {
      async getRun({ runId }) {
        return { runId, status: "completed", output: "resumed terminal output" };
      },
    },
    sendTextTo: async () => {
      sends += 1;
      return { ok: true, messageId: "resumed-message" };
    },
  });
  await startDispatcher(second);
  await waitFor(() => !store.runs.has(runKey));
  assert.equal(sends, 1);
  assert.equal(store.appendedHistories.length, 1);
  await second.stop({ persist: false });
});

test("stop during terminal delivery prevents later chunks and history writes", async () => {
  const store = createStore({ records: [activeRecord()] });
  const firstSendGate = deferred();
  let sends = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async getRun({ runId }) {
        return { runId, status: "completed", output: "x".repeat(45) };
      },
    },
    maxMessageLength: 20,
    sendTextTo: async () => {
      sends += 1;
      if (sends === 1) return await firstSendGate.promise;
      return { ok: true, messageId: `message-${sends}` };
    },
  });
  await startDispatcher(dispatcher);
  await waitFor(() => sends === 1, () => `sends=${sends}`);

  await dispatcher.stop({ persist: false });
  firstSendGate.resolve({ ok: true, messageId: "first-message" });
  await waitFor(() => store.deleteAttempts === 1, () => `deleteAttempts=${store.deleteAttempts}`);

  assert.equal(sends, 1);
  assert.equal(store.appendedHistories.length, 0);
  assert.equal(store.runs.size, 0);
});

test("same-dispatcher restart releases a claimed run without letting its late delivery delete the replacement", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore({ records: [activeRecord()] });
  const firstSendGate = deferred();
  let oldSendAttempts = 0;
  let replacementStarts = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async startMessage() {
        replacementStarts += 1;
        return { runId: "replacement-run", status: "running" };
      },
      async getRun({ runId }) {
        if (runId === "run-1") return { runId, status: "completed", output: "old terminal output" };
        return { runId, status: "running" };
      },
    },
    sendTextTo: async (_chatId, text) => {
      if (text.includes("old terminal output")) {
        oldSendAttempts += 1;
        return await firstSendGate.promise;
      }
      return { ok: true, messageId: "message" };
    },
  });
  await startDispatcher(dispatcher);
  await waitFor(() => oldSendAttempts === 1, () => `oldSendAttempts=${oldSendAttempts}`);

  await dispatcher.stop({ persist: false });
  await startDispatcher(dispatcher);
  await waitFor(() => !store.runs.has(runKey));

  await dispatcher.processInbound(inbound("replacement", "replacement-after-restart"));
  await waitFor(() => replacementStarts === 1 && store.runs.get(runKey)?.runId === "replacement-run");
  firstSendGate.resolve({ ok: true, messageId: "old-message" });
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(store.runs.get(runKey)?.runId, "replacement-run");
  await dispatcher.stop({ persist: false });
});

test("terminal output waits for a durable claim before delivery", async () => {
  const store = createStore({ records: [activeRecord()], writeFailures: 1 });
  let terminalSends = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async getRun({ runId }) {
        return { runId, status: "completed", output: "claim before send" };
      },
    },
    sendTextTo: async (_chatId, text) => {
      if (text.includes("claim before send")) terminalSends += 1;
      return { ok: true, messageId: `message-${terminalSends}` };
    },
  });
  await startDispatcher(dispatcher);
  await waitFor(() => store.writeAttempts >= 1, () => `writeAttempts=${store.writeAttempts}`);
  assert.equal(terminalSends, 0);

  await waitFor(() => !store.runs.has("chat-1::agent:opencode/opencode"), () => `writeAttempts=${store.writeAttempts}`, 2_500);
  assert.equal(terminalSends, 1);
  assert.equal(store.appendedHistories.length, 1);
  await dispatcher.stop({ persist: false });
});

test("cancel wins a race with the durable terminal claim without delivery or resurrection", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore({ records: [activeRecord()] });
  const claimEntered = deferred();
  const releaseClaim = deferred();
  const writeActiveRun = store.writeActiveRun.bind(store);
  store.writeActiveRun = async (accountId, key, patch) => {
    if (patch?.terminalDeliveryClaimedRunId === "run-1") {
      claimEntered.resolve();
      await releaseClaim.promise;
    }
    return await writeActiveRun(accountId, key, patch);
  };
  const sent = [];
  const cancelEntered = deferred();
  const releaseCancel = deferred();
  let cancelCalls = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async getRun({ runId }) {
        return { runId, status: "completed", output: "must not be delivered" };
      },
      async cancelRun(runId) {
        assert.equal(runId, "run-1");
        cancelCalls += 1;
        cancelEntered.resolve();
        return await releaseCancel.promise;
      },
    },
    sendTextTo: async (_chatId, text) => {
      sent.push(text);
      return { ok: true, messageId: `message-${sent.length}` };
    },
  });
  await startDispatcher(dispatcher);
  await claimEntered.promise;

  const cancelTask = dispatcher.processInbound(inbound("#cancel", "claim-cancel"));
  await cancelEntered.promise;
  assert.equal(cancelCalls, 1);
  assert.equal(store.runs.has(runKey), false);
  releaseClaim.resolve();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(sent.filter((text) => text.includes("must not be delivered")).length, 0);
  releaseCancel.resolve({ ok: true });
  await cancelTask;
  await waitFor(() => store.deleteAttempts >= 2, () => `deleteAttempts=${store.deleteAttempts}`);
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(sent.filter((text) => text.includes("must not be delivered")).length, 0);
  assert.equal(store.appendedHistories.length, 0);
  assert.equal(store.runs.has(runKey), false, "the late claim write must be tombstoned");
  await dispatcher.stop({ persist: false });
});

test("cancel cleanup failure does not permanently busy-lock the chat", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore({ records: [activeRecord()], deleteFailures: 1 });
  const sent = [];
  let startCalls = 0;
  let cancelCalls = 0;
  const dispatcher = createDispatcher({
    store,
    runtime: {
      async startMessage() {
        startCalls += 1;
        return { runId: "replacement-run", status: "running" };
      },
      async getRun({ runId }) {
        if (runId === "run-1") return { runId, status: "running" };
        return { runId, status: "completed", output: "replacement completed" };
      },
      async cancelRun(runId) {
        assert.equal(runId, "run-1");
        cancelCalls += 1;
        return { ok: true };
      },
    },
    sendTextTo: async (_chatId, text) => {
      sent.push(text);
      return { ok: true, messageId: `message-${sent.length}` };
    },
  });
  await startDispatcher(dispatcher);

  await dispatcher.processInbound(inbound("#cancel", "delete-failure-cancel"));
  assert.equal(cancelCalls, 1);
  assert.equal(store.runs.get(runKey)?.runId, "run-1", "the injected EPERM leaves the stale disk record");
  assert.ok(sent.some((text) => text.includes("持久记录清理将在重启后重试")));
  assert.doesNotMatch(dispatcher.status().lastError ?? "", /inbound processing failed/);

  await dispatcher.processInbound(inbound("replacement", "delete-failure-replacement"));
  await waitFor(() => startCalls === 1, () => `startCalls=${startCalls}`);
  await waitFor(() => sent.some((text) => text.includes("replacement completed")));
  await waitFor(() => !store.runs.has(runKey));

  assert.equal(startCalls, 1);
  assert.equal(sent.filter((text) => text.includes("还在处理上一条消息")).length, 0);
  await dispatcher.stop({ persist: false });
});

test("failed active terminal delivery is claimed once, writes no history, and cannot lock or replay", async () => {
  const runKey = "chat-1::agent:opencode/opencode";
  const store = createStore({ records: [activeRecord()], deleteFailures: 1 });
  let firstTerminalAttempts = 0;
  const runtime = {
    async getRun({ runId }) {
      return { runId, status: "completed", output: "do not replay" };
    },
  };
  const first = createDispatcher({
    store,
    runtime,
    sendTextTo: async (_chatId, text) => {
      if (text.includes("do not replay")) firstTerminalAttempts += 1;
      return { ok: false, error: "terminal transport failed" };
    },
  });
  await startDispatcher(first);
  await waitFor(() => store.deleteAttempts === 1, () => `deleteAttempts=${store.deleteAttempts}`);

  assert.equal(firstTerminalAttempts, 1);
  assert.equal(store.appendedHistories.length, 0);
  assert.equal(store.runs.get(runKey)?.terminalDeliveryClaimedRunId, "run-1");
  await first.stop({ persist: false });

  let replayAttempts = 0;
  const second = createDispatcher({
    store,
    runtime,
    sendTextTo: async () => {
      replayAttempts += 1;
      return { ok: true, messageId: "unexpected-replay" };
    },
  });
  await startDispatcher(second);
  await waitFor(() => !store.runs.has(runKey), () => `run remains after ${store.deleteAttempts} cleanup attempts`);

  assert.equal(replayAttempts, 0);
  assert.equal(store.appendedHistories.length, 0);
  assert.equal(store.deleteAttempts, 2);
  await second.stop({ persist: false });
});
