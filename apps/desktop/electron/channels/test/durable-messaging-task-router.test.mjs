import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMessagingTaskAdapter } from "../messaging-task-adapter.mjs";
import { createMessagingTaskStore } from "../messaging-task-store.mjs";
import { createDurableMessagingTaskRouter } from "../durable-messaging-task-router.mjs";

function envelope(text = "#task inspect the workspace") {
  return {
    platform: "telegram",
    accountId: "bot-1",
    chatId: "chat-1",
    senderId: "user-1",
    messageId: "message-1",
    text,
  };
}

function createdSnapshot() {
  return {
    task: { id: "task-1", revision: 1, latestRunId: null, definitionStatus: "alignment" },
    run: null,
    gates: [],
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "durable-messaging-task-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let clock = 1_000;
  let sequence = 0;
  const requests = [];
  const store = await createMessagingTaskStore({
    userDataDir: root,
    now: () => clock,
    randomUUID: () => `uuid-${++sequence}`,
    receiptLeaseMs: 1_000,
    deliveryLeaseMs: 1_000,
  });
  t.after(() => store.close());
  const taskClient = {
    async request(method, params, options) {
      requests.push({ method, params, options });
      if (method === "taskOrchestratorTaskCreate") return createdSnapshot();
      throw new Error(`unexpected method ${method}`);
    },
    async getTask() { return createdSnapshot(); },
  };
  const router = createDurableMessagingTaskRouter({
    store,
    taskClient,
    resolveCreateInput: async (input) => ({ idea: input.command.args, workspaceRoot: "/workspace" }),
  });
  return { root, store, router, requests, advance: (ms) => { clock += ms; } };
}

test("duplicate inbound Task create reuses Supervisor idempotency and cannot create twice", async (t) => {
  const { store, router, requests } = await fixture(t);
  const adapter = createMessagingTaskAdapter({ taskMessageRouter: router });
  const replies = [];
  const first = await adapter.tryRoute(envelope(), { reply: async (text) => replies.push(text) });
  const duplicate = await adapter.tryRoute(envelope(), { reply: async (text) => replies.push(text) });

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.idempotencyKey.startsWith("channel:"), true);
  assert.equal(replies.length, 1, "acked delivery must not be emitted again for a duplicate webhook");
  assert.deepEqual(store.counts(), { acked: 1 });
  assert.equal(store.getBinding(envelope()).taskId, "task-1");
});

test("lost channel send ack is retried from durable outbox without rerunning the task command", async (t) => {
  const { store, router, requests, advance } = await fixture(t);
  const adapter = createMessagingTaskAdapter({ taskMessageRouter: router });
  await adapter.tryRoute(envelope(), { reply: async () => { throw new Error("network down"); } });
  assert.equal(requests.length, 1);
  assert.deepEqual(store.counts(), { available: 1 });

  const beforeBackoff = [];
  await adapter.tryRoute(envelope(), { reply: async (text) => beforeBackoff.push(text) });
  assert.deepEqual(beforeBackoff, []);
  advance(1_000);
  const afterBackoff = [];
  await adapter.tryRoute(envelope(), { reply: async (text) => afterBackoff.push(text) });
  assert.equal(afterBackoff.length, 1);
  assert.equal(requests.length, 1);
  assert.deepEqual(store.counts(), { acked: 1 });
});

test("stale receipt claim can be reclaimed after process loss", async (t) => {
  const { store, advance } = await fixture(t);
  const parsed = { action: "create", args: "inspect" };
  const input = { ...envelope(), command: parsed };
  const first = store.claimInbound(input, parsed);
  assert.equal(first.state, "claimed");
  assert.equal(store.claimInbound(input, parsed).state, "processing");
  advance(1_001);
  const reclaimed = store.claimInbound(input, parsed);
  assert.equal(reclaimed.state, "claimed");
  assert.notEqual(reclaimed.claimToken, first.claimToken);
});

test("same channel message identity with changed command is rejected", async (t) => {
  const { store } = await fixture(t);
  const input = { ...envelope(), command: { action: "create", args: "one" } };
  store.claimInbound(input, input.command);
  assert.throws(
    () => store.claimInbound({ ...input, command: { action: "cancel", args: "" } }, { action: "cancel", args: "" }),
    { code: "MESSAGE_ID_CONFLICT" },
  );
});

test("significant task events persist local notification and deduplicated channel delivery", async (t) => {
  const { store } = await fixture(t);
  store.upsertBinding({ ...envelope(), taskId: "task-1", taskRunId: "run-1", revision: 1, status: "running" });
  const { createMessagingTaskEventEnqueuer } = await import("../durable-messaging-task-router.mjs");
  const enqueuer = createMessagingTaskEventEnqueuer({ store, taskClient: {} });
  const event = { id: "event-1", sequence: 7, taskId: "task-1", taskRunId: "run-1", type: "approval-required", message: "approve this" };
  assert.equal(enqueuer.handle(event), 1);
  assert.equal(enqueuer.handle(event), 1);
  assert.equal(store.unreadNotificationCount(), 1);
  assert.equal(store.counts().available, 1);
  assert.equal(store.getBinding(envelope()).eventCursor, 7);
});

test("Supervisor resync replays every task stream and persists notifications without a channel binding", async (t) => {
  const { store } = await fixture(t);
  const calls = [];
  const event = { id: "event-offline", sequence: 3, taskId: "task-offline", taskRunId: "run-offline", type: "run-failed", message: "failed while UI was absent" };
  const taskClient = {
    async listTasks(input) {
      calls.push(["tasks", input.cursor]);
      return { tasks: [{ id: "task-offline" }], hasMore: false, nextCursor: null };
    },
    async listRuns(input) {
      calls.push(["runs", input.cursor]);
      return { runs: [{ id: "run-offline" }], hasMore: false, nextCursor: null };
    },
    async listEvents(input) {
      calls.push(["events", input.taskRunId, input.cursor]);
      return input.taskRunId
        ? { events: input.cursor < 3 ? [event] : [], hasMore: false, nextCursor: null }
        : { events: [], hasMore: false, nextCursor: null };
    },
  };
  const { createMessagingTaskEventEnqueuer } = await import("../durable-messaging-task-router.mjs");
  const enqueuer = createMessagingTaskEventEnqueuer({ store, taskClient });
  await enqueuer.replay();
  await enqueuer.replay();
  assert.equal(store.unreadNotificationCount(), 1);
  assert.equal(store.notificationCursor("task-offline", "run-offline"), 3);
  assert.deepEqual(calls.filter(([kind]) => kind === "events").at(-1), ["events", "run-offline", 3]);
});

test("all bound control commands map to the durable Supervisor API", async (t) => {
  const { store } = await fixture(t);
  const snapshot = {
    task: { id: "task-1", revision: 2, latestRunId: "run-1", definitionStatus: "finalized" },
    run: { id: "run-1", status: "running" },
    gates: [{ id: "gate-1", status: "pending" }],
  };
  store.upsertBinding({ ...envelope(), taskId: "task-1", taskRunId: "run-1", revision: 2, status: "running" });
  const requests = [];
  const taskClient = {
    async getTask() { return snapshot; },
    async request(method, params, options) {
      requests.push({ method, params, options });
      return snapshot;
    },
  };
  const router = createDurableMessagingTaskRouter({ store, taskClient, resolveCreateInput: async () => ({}) });
  const adapter = createMessagingTaskAdapter({ taskMessageRouter: router });
  for (const [index, command] of ["pause", "resume", "cancel", "retry", "approve gate-1", "reject gate-1"].entries()) {
    const result = await adapter.tryRoute({ ...envelope(`#task ${command}`), messageId: `control-${index}` }, { reply: async () => undefined });
    assert.equal(result.ok, true, command);
  }
  assert.deepEqual(requests.map((item) => item.method), [
    "taskOrchestratorTaskPause",
    "taskOrchestratorTaskResume",
    "taskOrchestratorTaskStop",
    "taskOrchestratorPrimaryRetry",
    "taskOrchestratorGateResolve",
    "taskOrchestratorGateResolve",
  ]);
  assert.deepEqual(requests.slice(-2).map((item) => item.params.decision), ["approve", "reject"]);
  assert.equal(requests.every((item) => item.options.idempotencyKey.startsWith("channel:")), true);
});

test("receipts, bindings, and unsent outbox survive an Electron main restart", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "durable-messaging-restart-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await createMessagingTaskStore({ userDataDir: root });
  const input = { ...envelope(), command: { action: "create", args: "inspect" } };
  const claim = first.claimInbound(input, input.command);
  first.upsertBinding({ ...input, taskId: "task-restart", taskRunId: "run-restart", revision: 1, status: "running" });
  const delivery = first.enqueueDelivery({ ...input, dedupeKey: "restart-delivery", taskId: "task-restart", taskRunId: "run-restart", kind: "task-event", text: "still pending" });
  first.finishInbound(claim, { ok: true, taskId: "task-restart", taskRunId: "run-restart", deliveryId: delivery.id });
  first.close();

  const reopened = await createMessagingTaskStore({ userDataDir: root });
  t.after(() => reopened.close());
  assert.equal(reopened.claimInbound(input, input.command).state, "completed");
  assert.equal(reopened.getBinding(input).taskId, "task-restart");
  const claimed = reopened.claimDeliveries({ limit: 10 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].payload.text, "still pending");
});
