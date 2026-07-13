import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBrowserUseRunStore } from "./run-store.mjs";

test("persists safe session history, deduplicates events, and recovers interrupted runs", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "onmyagent-browser-use-runs-"));
  const filePath = path.join(root, "browser-use-agent", "runs.json");
  try {
    const store = createBrowserUseRunStore({ filePath, now: () => 1_000 });
    store.saveRun({
      runId: "run-1",
      sessionId: "session-1",
      userMessageId: "message-1",
      ownerId: "expert:session-1",
      status: "running",
      environment: { ONMYAGENT_MODEL_GATEWAY_TOKEN: "model-secret" },
      events: [
        { id: "event-1", type: "ready", sequence: 1, timestamp: 100 },
        { id: "event-1", type: "ready", sequence: 1, timestamp: 100 },
        {
          id: "event-2",
          type: "narration",
          sequence: 2,
          timestamp: 200,
          text: "Open the target page",
          thinking: "private thought",
          cdpUrl: "http://127.0.0.1:9823",
          brokerToken: "browser-secret",
        },
      ],
    });

    assert.equal(existsSync(filePath), true);
    assert.deepEqual(readdirSync(path.dirname(filePath)).sort(), ["runs.json"]);
    const active = store.listBySession("session-1");
    assert.equal(active.length, 1);
    assert.equal(active[0].events.length, 2);
    assert.equal(active[0].events[1].text, "Open the target page");
    assert.doesNotMatch(JSON.stringify(active), /model-secret|browser-secret|9823|private thought/);

    const restored = createBrowserUseRunStore({ filePath, now: () => 2_000 });
    const history = restored.listBySession("session-1");
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "interrupted");
    assert.equal(history[0].events.at(-1).type, "error");
    assert.equal(history[0].events.at(-1).error, "");
    assert.equal(history[0].events.at(-1).errorCode, "interrupted");
    assert.equal(history[0].events.at(-1).timestamp, 2_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bounds persisted runs and events", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "onmyagent-browser-use-bounds-"));
  const filePath = path.join(root, "runs.json");
  try {
    const store = createBrowserUseRunStore({
      filePath,
      maxRuns: 2,
      maxEventsPerRun: 3,
      now: () => 5_000,
    });
    for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
      store.saveRun({
        runId: `run-${runIndex}`,
        sessionId: "session-1",
        userMessageId: `message-${runIndex}`,
        status: "completed",
        updatedAt: runIndex,
        events: Array.from({ length: 5 }, (_, eventIndex) => ({
          id: `run-${runIndex}-event-${eventIndex}`,
          type: "operation_progress",
          sequence: eventIndex,
          timestamp: eventIndex,
        })),
      });
    }
    const history = store.listBySession("session-1");
    assert.deepEqual(history.map((run) => run.runId), ["run-2", "run-3"]);
    assert.deepEqual(history.map((run) => run.events.length), [3, 3]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
