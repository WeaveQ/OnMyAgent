import assert from "node:assert/strict";
import test from "node:test";

import { createRunPersistence } from "./run-persistence.mjs";

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimer(callback, delay) {
    const timer = {
      id: nextId,
      dueAt: now + Number(delay),
      delay: Number(delay),
      unrefCalled: false,
      unref() {
        this.unrefCalled = true;
        return this;
      },
      callback,
    };
    nextId += 1;
    timers.set(timer.id, timer);
    return timer;
  }

  function clearTimer(timer) {
    timers.delete(timer?.id);
  }

  async function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const due = [...timers.values()]
        .filter((timer) => timer.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0];
      if (!due) break;
      timers.delete(due.id);
      now = due.dueAt;
      due.callback();
      await Promise.resolve();
    }
    now = target;
    await Promise.resolve();
  }

  return {
    setTimer,
    clearTimer,
    advance,
    pending: () => [...timers.values()],
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate, label) {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(`timed out waiting for ${label}`);
}

test("schedulePersistRun debounces a burst into one write", async () => {
  const timers = createFakeTimers();
  const state = {};
  let writes = 0;
  const persistence = createRunPersistence({
    persistRun: async () => { writes += 1; },
    runs: new Map(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  persistence.schedulePersistRun(state);
  persistence.schedulePersistRun(state);
  persistence.schedulePersistRun(state);

  assert.equal(timers.pending().length, 1);
  assert.equal(timers.pending()[0].delay, 250);
  assert.equal(timers.pending()[0].unrefCalled, true);
  await timers.advance(249);
  assert.equal(writes, 0);
  await timers.advance(1);
  await persistence.flushPersistRun(state);
  assert.equal(writes, 1);
  assert.equal(timers.pending().length, 0);
});

test("flush serializes writes and drains dirty state added during a write", async () => {
  const writes = [];
  let activeWrites = 0;
  let maxActiveWrites = 0;
  const state = {};
  const persistence = createRunPersistence({
    persistRun: () => {
      const gate = deferred();
      writes.push(gate);
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      return gate.promise.finally(() => { activeWrites -= 1; });
    },
    runs: new Map(),
  });

  const flushing = persistence.flushPersistRun(state, true);
  await waitFor(() => writes.length === 1, "the first persist");
  persistence.schedulePersistRun(state);
  assert.equal(writes.length, 1);
  assert.equal(activeWrites, 1);

  writes[0].resolve();
  await waitFor(() => writes.length === 2, "the dirty follow-up persist");
  assert.equal(activeWrites, 1);
  assert.equal(maxActiveWrites, 1);
  writes[1].resolve();
  await flushing;

  assert.equal(writes.length, 2);
  assert.equal(activeWrites, 0);
  assert.equal(state.persistDirty, false);
});

test("force flush cancels a pending debounce and persists immediately", async () => {
  const timers = createFakeTimers();
  const state = {};
  let writes = 0;
  const persistence = createRunPersistence({
    persistRun: async () => { writes += 1; },
    runs: new Map(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  persistence.schedulePersistRun(state);
  assert.equal(timers.pending().length, 1);
  await persistence.flushPersistRun(state, true);
  assert.equal(writes, 1);
  assert.equal(timers.pending().length, 0);
  await persistence.flushPersistRun(state);
  assert.equal(writes, 1);
  await persistence.flushPersistRun(state, true);
  assert.equal(writes, 2);
  await timers.advance(250);
  assert.equal(writes, 2);
});

test("retention evicts terminal runs after five minutes but keeps running state", async () => {
  const timers = createFakeTimers();
  const completed = { runId: "completed", status: "completed" };
  const running = { runId: "running", status: "running" };
  const runs = new Map([
    [completed.runId, completed],
    [running.runId, running],
  ]);
  const persistence = createRunPersistence({
    persistRun: async () => undefined,
    runs,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  persistence.retainCompletedRunBriefly(completed);
  persistence.retainCompletedRunBriefly(running);
  assert.deepEqual(timers.pending().map((timer) => timer.delay), [5 * 60_000, 5 * 60_000]);
  assert.equal(timers.pending().every((timer) => timer.unrefCalled), true);

  await timers.advance(5 * 60_000 - 1);
  assert.equal(runs.get(completed.runId), completed);
  assert.equal(runs.get(running.runId), running);
  await timers.advance(1);
  assert.equal(runs.has(completed.runId), false);
  assert.equal(runs.get(running.runId), running);
});
