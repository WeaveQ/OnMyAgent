import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createTaskOrchestrator } from "./index.mjs";
import {
  cleanupDirectories,
  contract,
  createRuntime,
  taskInput,
  temporaryDirectory,
  waitForSnapshot,
} from "./v2-test-helpers.mjs";

const temporaryDirectories = [];

afterEach(async () => cleanupDirectories(temporaryDirectories.splice(0)));

async function createRunningOrchestrator({ runtime, workspacePrefix = "task-progress-workspace-" }) {
  const userDataDir = await temporaryDirectory("task-progress-user-");
  const workspaceRoot = await temporaryDirectory(workspacePrefix);
  temporaryDirectories.push(userDataDir, workspaceRoot);
  const orchestrator = createTaskOrchestrator({
    userDataDir,
    personalAgentRuntime: runtime,
    pollMs: 1,
    awaitAlignment: true,
  });
  const created = await orchestrator.createTask(taskInput(workspaceRoot, {
    contractFinalization: "model-recommended-auto",
    allowedWorkers: [],
  }));
  return { orchestrator, taskId: created.task.id };
}

test("empty Personal polls do not advance the durable attempt progress clock", async () => {
  const runtime = createRuntime({
    autoCompletePrimary: false,
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { status: "completed", output: "alignment complete" };
      }
      return { status: "running", output: "held", events: [] };
    },
  });
  const { orchestrator, taskId } = await createRunningOrchestrator({ runtime });
  try {
    const running = await waitForSnapshot(orchestrator, taskId, (snapshot) => (
      snapshot.run?.status === "running" && Boolean(snapshot.run?.primaryAttempts[0]?.personalRunId)
    ));
    const initialProgressAt = running.run.primaryAttempts[0].progressAt;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const polled = await orchestrator.getTask({ taskId, taskRunId: running.run.id });
    assert.equal(polled.run.primaryAttempts[0].progressAt, initialProgressAt);
    await orchestrator.stopRun({ taskRunId: running.run.id });
  } finally {
    await orchestrator.close();
  }
});

test("context and tool events advance progress only after a changed provider snapshot", async () => {
  let pollCount = 0;
  let clock = 10_000;
  const runtime = createRuntime({
    autoCompletePrimary: false,
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { status: "completed", output: "alignment complete" };
      }
      return { status: "running", output: "held", events: [] };
    },
    getRun: async ({ current }) => {
      pollCount += 1;
      if (pollCount === 1) {
        return { ...current, events: [{ type: "context_usage", at: ++clock, text: "context usage" }] };
      }
      if (pollCount === 2) {
        return { ...current, events: [{ type: "acp_tool_call", at: ++clock, update: { id: "tool-1", status: "running" } }] };
      }
      return current;
    },
  });
  const { orchestrator, taskId } = await createRunningOrchestrator({ runtime });
  try {
    const first = await waitForSnapshot(orchestrator, taskId, (snapshot) => (
      snapshot.run?.status === "running" && snapshot.run.primaryAttempts[0].progressAt > 10_000
    ));
    const firstProgressAt = first.run.primaryAttempts[0].progressAt;
    const second = await waitForSnapshot(orchestrator, taskId, (snapshot) => (
      snapshot.run?.primaryAttempts[0].progressAt > firstProgressAt
    ));
    assert.ok(second.run.primaryAttempts[0].progressAt > firstProgressAt);
    await orchestrator.stopRun({ taskRunId: first.run.id });
  } finally {
    await orchestrator.close();
  }
});

test("changed context telemetry is lease-fenced into the current turn without duplicate writes", async () => {
  let pollCount = 0;
  let usedTokens = 10;
  const runtime = createRuntime({
    autoCompletePrimary: false,
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { status: "completed", output: "alignment complete" };
      }
      return {
        status: "running",
        output: "held",
        conversationMessages: [{ contextUsage: { used: 10, total: 100, totalSource: "runtime", modelId: "model" } }],
      };
    },
    getRun: async ({ current }) => {
      pollCount += 1;
      if (pollCount === 1) {
        usedTokens = 20;
      }
      return {
        ...current,
        conversationMessages: [{ contextUsage: { used: usedTokens, total: 100, totalSource: "runtime", modelId: "model" } }],
      };
    },
  });
  const { orchestrator, taskId } = await createRunningOrchestrator({ runtime, workspacePrefix: "task-context-persistence-workspace-" });
  try {
    const observed = await waitForSnapshot(orchestrator, taskId, (snapshot) => snapshot.run?.turns[0]?.context?.usedTokens === 20);
    assert.deepEqual(observed.run.turns[0].context, {
      usedTokens: 20,
      totalTokens: 100,
      percent: 20,
      source: "runtime",
      modelId: "model",
      observedAt: observed.run.turns[0].context.observedAt,
    });
    await orchestrator.stopRun({ taskRunId: observed.run.id });
  } finally {
    await orchestrator.close();
  }
});

test("a real terminal provider snapshot advances progress before the run is blocked", async () => {
  const runtime = createRuntime({
    autoCompletePrimary: false,
    start: async ({ input }) => {
      if (input.taskControlPlane?.propose_contract) {
        await input.taskControlPlane.propose_contract({ contract: contract() });
        return { status: "completed", output: "alignment complete" };
      }
      return { status: "completed", output: "provider terminal output" };
    },
  });
  const { orchestrator, taskId } = await createRunningOrchestrator({ runtime });
  try {
    const blocked = await waitForSnapshot(orchestrator, taskId, (snapshot) => snapshot.run?.status === "blocked");
    const attempt = blocked.run.primaryAttempts[0];
    assert.equal(attempt.status, "blocked");
    assert.ok(Number.isInteger(attempt.progressAt));
    assert.ok(attempt.progressAt >= attempt.startedAt);
  } finally {
    await orchestrator.close();
  }
});
