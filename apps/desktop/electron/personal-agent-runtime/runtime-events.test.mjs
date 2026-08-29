import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeEventPublisher } from "./runtime-events.mjs";

test("runtime event publisher emits catalog invalidation without a run identity", () => {
  const events = [];
  const publisher = createRuntimeEventPublisher({ onEvent: (event) => events.push(event) });
  publisher.invalidateCatalog("/workspace/example");
  assert.deepEqual(events, [{
    type: "catalog.invalidated",
    runId: null,
    workspaceRoot: "/workspace/example",
    conversationId: null,
    status: "completed",
    updatedAt: events[0].updatedAt,
  }]);
});

test("runtime event publisher coalesces bounded deltas with contiguous revisions", () => {
  const events = [];
  const timers = [];
  const publisher = createRuntimeEventPublisher({
    onEvent: (event) => events.push(event),
    setTimer: (callback) => {
      const timer = { callback };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  const state = { runId: "run-1", workspaceRoot: "/ws", conversationId: "chat-1", status: "running" };
  const stored = [];
  publisher.register(stored, state);
  for (const text of ["a", " ", "b"]) {
    publisher.append((target, event) => {
      target.push({ ...event });
      return event;
    }, stored, { type: "assistant_chunk", text, at: 1 });
  }
  assert.equal(timers.length, 1);
  timers.shift().callback();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "run.delta");
  assert.equal(events[0].revisionStart, 1);
  assert.equal(events[0].revision, 3);
  assert.deepEqual(events[0].events.map((event) => event.text), ["a", " ", "b"]);
  assert.deepEqual(events[0].events.map((event) => event.eventId), ["run-1:1", "run-1:2", "run-1:3"]);
});

test("runtime event publisher flushes a pending delta in the terminal notification", () => {
  const events = [];
  const timers = [];
  const publisher = createRuntimeEventPublisher({
    onEvent: (event) => events.push(event),
    setTimer: (callback) => {
      const timer = { callback };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  const state = { runId: "run-1", workspaceRoot: "/ws", conversationId: "chat-1", status: "running" };
  const stored = [];
  publisher.register(stored, state);
  publisher.append((target, event) => {
    target.push({ ...event });
    return event;
  }, stored, { type: "finish", text: "done", at: 2 });
  state.status = "completed";
  publisher.publish(state, "run.finished");
  assert.equal(timers.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "run.finished");
  assert.equal(events[0].status, "completed");
  assert.equal(events[0].revision, 1);
  assert.equal(events[0].events[0].text, "done");
  publisher.publish(state, "run.finished");
  assert.equal(events.length, 1);
});
