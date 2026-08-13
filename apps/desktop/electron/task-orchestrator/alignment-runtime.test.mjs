import assert from "node:assert/strict";
import test from "node:test";

import { createTaskOrchestrator } from "./index.mjs";
import {
  cleanupDirectories,
  createRuntime,
  taskInput,
  temporaryDirectory,
  waitForSnapshot,
} from "./v2-test-helpers.mjs";

test("alignment create is durable and non-blocking, can cancel, then continue in a fresh provider turn", async () => {
  const workspaceRoot = await temporaryDirectory("oma-alignment-workspace-");
  const userDataDir = await temporaryDirectory("oma-alignment-user-data-");
  let starts = 0;
  const runtime = createRuntime({
    start: async () => {
      starts += 1;
      return starts === 1
        ? { status: "running", output: "" }
        : { status: "completed", output: "A follow-up alignment response." };
    },
  });
  const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1 });
  try {
    const created = await orchestrator.createTask(taskInput(workspaceRoot));
    assert.equal(created.task.alignment.status, "running");
    assert.equal(created.task.definitionStatus, "alignment");

    const active = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => Boolean(snapshot.task.alignment.personalRunId));
    assert.equal(active.task.alignment.status, "running");
    const cancelled = await orchestrator.cancelAlignment({ taskId: created.task.id });
    assert.equal(cancelled.task.alignment.status, "cancelled");
    assert.match(cancelled.task.alignment.error, /cancelled/i);
    assert.equal(cancelled.events.some((event) => event.type === "alignment-cancelled"), true);

    const continued = await orchestrator.sendAlignmentMessage({ taskId: created.task.id, text: "Continue with a smaller scope." });
    assert.equal(continued.task.alignment.status, "running");
    const completed = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.task.alignment.status === "completed");
    assert.equal(completed.task.alignment.messages.at(-1)?.text, "A follow-up alignment response.");
    assert.equal(runtime.conversations.length, 1);
    assert.equal(runtime.startCalls.length, 2);
  } finally {
    await orchestrator.close();
    await cleanupDirectories([workspaceRoot, userDataDir]);
  }
});
