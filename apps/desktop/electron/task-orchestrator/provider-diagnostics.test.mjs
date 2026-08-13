import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createTaskOrchestrator } from "./index.mjs";
import {
  cleanupDirectories,
  contract,
  createRuntime,
  selection,
  taskInput,
  temporaryDirectory,
  waitForSnapshot,
} from "./v2-test-helpers.mjs";

const temporaryDirectories = [];

afterEach(async () => cleanupDirectories(temporaryDirectories.splice(0)));

function diagnosticsSnapshot(snapshot, status = snapshot?.status ?? "completed") {
  return snapshot ? {
    ...snapshot,
    status,
    providerSessionId: "provider-session-1",
    effectiveModel: "canonical-model",
    transport: "stdio",
    connectionMode: "Codex ACP session",
    requestId: "request-1",
    transportFallbackCount: 2,
    metadata: {
      effectiveModel: "canonical-model",
      apiKey: "must-not-persist",
      executablePath: "/private/provider/bin/codex",
    },
  } : snapshot;
}

describe("Task Center provider execution diagnostics", () => {
  it("persists bounded provider session/model/transport diagnostics on the matching attempt lease", async () => {
    const userDataDir = await temporaryDirectory("task-provider-diagnostics-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-diagnostics-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        }
        return { output: "completed", status: "completed" };
      },
    });
    const startMessage = runtime.startMessage.bind(runtime);
    runtime.startMessage = async (input) => diagnosticsSnapshot(await startMessage(input));
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        primary: selection("primary-agent", "codex", "primary-model", "Primary"),
        allowedWorkers: [],
        contractFinalization: "model-recommended-auto",
      }));
      const finished = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      const diagnostics = finished.run.primaryAttempts[0].providerDiagnostics;
      assert.deepEqual(diagnostics, {
        providerSessionId: "provider-session-1",
        effectiveModel: "canonical-model",
        transport: "stdio",
        connectionMode: "Codex ACP session",
        requestId: "request-1",
        transportFallbackCount: 2,
      });
      assert.doesNotMatch(JSON.stringify(diagnostics), /must-not-persist|executablePath|private\/provider/);
    } finally {
      await orchestrator.close();
    }
  });

  it("does not apply a late provider diagnostic after the attempt lease is revoked", async () => {
    const userDataDir = await temporaryDirectory("task-provider-diagnostics-late-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-diagnostics-late-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        const tools = input.taskControlPlane?.describe?.().tools ?? [];
        const alignment = tools.length === 1 && tools[0] === "propose_contract";
        if (alignment) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        }
        return alignment
          ? { output: "alignment complete", status: "completed" }
          : { output: "still running", status: "running" };
      },
    });
    const startMessage = runtime.startMessage.bind(runtime);
    runtime.startMessage = async (input) => {
      const started = await startMessage(input);
      return { ...started, providerSessionId: null, effectiveModel: null, transport: null, connectionMode: null };
    };
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        primary: selection("primary-agent", "codex", "primary-model", "Primary"),
        allowedWorkers: [],
        contractFinalization: "model-recommended-auto",
      }));
      const running = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => (
        snapshot.run?.status === "running" && Boolean(snapshot.run.primaryAttempts[0]?.personalRunId)
      ));
      await orchestrator.stopRun({ taskRunId: running.run.id });
      const stopped = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "cancelled");
      assert.equal(stopped.run.primaryAttempts[0].providerDiagnostics, null);
    } finally {
      await orchestrator.close();
    }
  });
});
