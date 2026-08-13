import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS } from "@onmyagent/types/task-orchestrator";

import { createTaskOrchestrator } from "./index.mjs";
import { createTaskOrchestratorStore } from "./store-factory.mjs";
import {
  cleanupDirectories,
  contract,
  createRuntime,
  selection,
  taskInput,
  temporaryDirectory,
  waitForSnapshot,
} from "./v2-test-helpers.mjs";

describe("Task Center provider preflight", () => {
  const temporaryDirectories = [];
  afterEach(async () => cleanupDirectories(temporaryDirectories.splice(0)));

  it("rejects full-allow without a finite frozen deadline before persistence", async () => {
    const userDataDir = await temporaryDirectory("task-provider-deadline-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-deadline-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: createRuntime(),
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      await assert.rejects(
        orchestrator.createTask(taskInput(workspaceRoot, {
          permissionMode: "full-allow",
          endConditions: {
            ...TASK_ORCHESTRATOR_DEFAULT_END_CONDITIONS,
            deadlineAt: null,
            maxElapsedMs: null,
          },
        })),
        /requires a finite deadline or maximum elapsed time/,
      );
      assert.deepEqual((await orchestrator.listTasks({ workspaceRoot })).tasks, []);
    } finally {
      await orchestrator.close();
    }
  });

  it("rejects an explicitly unsupported Task MCP provider before persisting a task", async () => {
    const userDataDir = await temporaryDirectory("task-provider-preflight-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-preflight-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        }
        return { output: "alignment complete" };
      },
    });
    runtime.listAvailableAgentMetadata = async () => ({
      agents: [{
        id: "primary-agent",
        name: "Primary",
        provider: "codex",
        status: "online",
        supportsTaskMcp: false,
        modelOptions: [{ id: "primary-model", label: "Primary model" }],
        capability: { authenticated: true, supportsModelOverride: true, supportsPermissionAutoApprove: true },
      }],
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      await assert.rejects(
        orchestrator.createTask(taskInput(workspaceRoot, { allowedWorkers: [] })),
        /task_mcp_unsupported/,
      );
      const store = createTaskOrchestratorStore({ userDataDir });
      try {
        assert.deepEqual((await store.listTasks({ workspaceRoot })).tasks, []);
      } finally {
        await store.close();
      }
    } finally {
      await orchestrator.close();
    }
  });

  it("rejects an unsupported primary provider before task persistence", async () => {
    const userDataDir = await temporaryDirectory("task-provider-isolation-primary-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-isolation-primary-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime();
    runtime.listAvailableAgentMetadata = async () => ({
      agents: [{
        id: "primary-agent",
        name: "Hermes primary",
        provider: "hermes",
        status: "online",
        supportsTaskMcp: true,
        modelOptions: [{ id: "primary-model", label: "Primary model" }],
        capability: { authenticated: true, supportsModelOverride: true, supportsPermissionAutoApprove: true },
      }],
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      await assert.rejects(
        orchestrator.createTask(taskInput(workspaceRoot, {
          primary: selection("primary-agent", "hermes", "primary-model", "Hermes primary"),
          allowedWorkers: [],
        })),
        /native_delegation_isolation_unsupported/,
      );
      const store = createTaskOrchestratorStore({ userDataDir });
      try {
        assert.deepEqual((await store.listTasks({ workspaceRoot })).tasks, []);
      } finally {
        await store.close();
      }
    } finally {
      await orchestrator.close();
    }
  });

  it("rejects an unsupported worker provider before task persistence", async () => {
    const userDataDir = await temporaryDirectory("task-provider-isolation-worker-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-isolation-worker-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime();
    runtime.listAvailableAgentMetadata = async () => ({
      agents: [
        {
          id: "primary-agent",
          name: "Codex primary",
          provider: "codex",
          status: "online",
          supportsTaskMcp: true,
          modelOptions: [{ id: "primary-model", label: "Primary model" }],
          capability: { authenticated: true, supportsModelOverride: true, supportsPermissionAutoApprove: true },
        },
        {
          id: "worker-agent",
          name: "OpenClaw worker",
          provider: "openclaw",
          status: "online",
          supportsTaskMcp: true,
          modelOptions: [{ id: "worker-model", label: "Worker model" }],
          capability: { authenticated: true, supportsModelOverride: true, supportsPermissionAutoApprove: true },
        },
      ],
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      await assert.rejects(
        orchestrator.createTask(taskInput(workspaceRoot, {
          allowedWorkers: [selection("worker-agent", "openclaw", "worker-model", "OpenClaw worker")],
        })),
        /native_delegation_isolation_unsupported/,
      );
      const store = createTaskOrchestratorStore({ userDataDir });
      try {
        assert.deepEqual((await store.listTasks({ workspaceRoot })).tasks, []);
      } finally {
        await store.close();
      }
    } finally {
      await orchestrator.close();
    }
  });

  it("bounds a held Personal catalog call before task persistence", async () => {
    const userDataDir = await temporaryDirectory("task-provider-catalog-timeout-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-catalog-timeout-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let catalogStarted = false;
    const runtime = createRuntime();
    runtime.listAvailableAgentMetadata = async () => {
      catalogStarted = true;
      return new Promise(() => undefined);
    };
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      runtimeCallTimeoutMs: 5,
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      await assert.rejects(
        orchestrator.createTask(taskInput(workspaceRoot, { allowedWorkers: [] })),
        (error) => error?.code === "TASK_RUNTIME_CALL_TIMEOUT" && /catalog/i.test(error.message),
      );
      assert.equal(catalogStarted, true);
      const store = createTaskOrchestratorStore({ userDataDir });
      try {
        assert.deepEqual((await store.listTasks({ workspaceRoot })).tasks, []);
      } finally {
        await store.close();
      }
    } finally {
      await orchestrator.close();
    }
  });

  it("does not let an unrelated full-catalog probe block selected-provider preflight", async () => {
    const userDataDir = await temporaryDirectory("task-provider-targeted-catalog-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-targeted-catalog-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let fullCatalogCalls = 0;
    let targetedCalls = 0;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        }
        return { output: "alignment complete" };
      },
    });
    runtime.listAvailableAgentMetadata = async () => {
      fullCatalogCalls += 1;
      return new Promise(() => undefined);
    };
    runtime.getTaskAgentMetadata = async ({ agent }) => {
      targetedCalls += 1;
      return {
        agent: {
          id: agent.id,
          name: "Primary",
          backend: agent.provider,
          status: "online",
          available: true,
          supportsTaskMcp: true,
          handshake: { available_models: [{ id: "primary-model", label: "Primary model" }] },
          capability: { authenticated: true, supportsAcp: true, supportsModelOverride: true },
        },
      };
    };
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      runtimeCallTimeoutMs: 20,
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        allowedWorkers: [],
        contractFinalization: "model-recommended-auto",
      }));
      await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "succeeded");
      assert.equal(fullCatalogCalls, 0);
      assert.ok(targetedCalls >= 2, "create and execution preflight should both revalidate the selected provider");
    } finally {
      await orchestrator.close();
    }
  });

  it("accepts a model resolved by live preflight when legacy catalog extraction cannot see it", async () => {
    const userDataDir = await temporaryDirectory("task-provider-nested-model-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-nested-model-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        }
        return { status: "completed", output: "nested catalog model accepted" };
      },
    });
    runtime.getTaskAgentMetadata = async ({ agent }) => ({
      agent: {
        id: agent.id,
        name: "Primary",
        provider: agent.provider,
        status: "online",
        supportsTaskMcp: true,
        // provider-capabilities intentionally understands this live handshake
        // shape; the older catalogModels helper does not.
        sessionMetadata: {
          availableModels: [{ id: "primary-model", label: "Live primary model" }],
        },
        capability: {
          authenticated: true,
          supportsAcp: true,
          supportsModelOverride: true,
        },
      },
    });
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        allowedWorkers: [],
        contractFinalization: "model-recommended-auto",
      }));
      assert.equal(created.task.primary.model, "primary-model");
      assert.equal(created.task.primary.capabilitySnapshot?.effectiveModel, "primary-model");
    } finally {
      await orchestrator.close();
    }
  });

  it("bounds a held approval control call and fences the gate fail-closed", async () => {
    const userDataDir = await temporaryDirectory("task-provider-control-timeout-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-control-timeout-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    let approvalStarted = false;
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
          return { output: "alignment complete" };
        }
        return {
          status: "running",
          pendingApprovals: [{ id: "approval-held", kind: "command", command: "pnpm test" }],
          output: "waiting for approval",
        };
      },
      resolveApproval: async () => {
        approvalStarted = true;
        return new Promise(() => undefined);
      },
    });
    const orchestrator = createTaskOrchestrator({
      userDataDir,
      personalAgentRuntime: runtime,
      runtimeCallTimeoutMs: 5,
      pollMs: 1,
      awaitAlignment: true,
    });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        contractFinalization: "model-recommended-auto",
        allowedWorkers: [],
      }));
      const waiting = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "waiting-approval");
      await assert.rejects(
        orchestrator.resolveGate({ taskRunId: waiting.run.id, gateId: waiting.gates[0].id, decision: "approve" }),
        (error) => error?.code === "TASK_RUNTIME_CALL_TIMEOUT",
      );
      assert.equal(approvalStarted, true);
      const afterTimeout = await waitForSnapshot(orchestrator, created.task.id, (snapshot) => snapshot.run?.status === "blocked");
      assert.equal(afterTimeout.gates[0].status, "cancelled");
      assert.equal(afterTimeout.run.primaryAttempts[0].status, "blocked");
      assert.equal(afterTimeout.run.primaryAttempts[0].leaseId, null);
      assert.equal(runtime.cancelCalls.filter((call) => call.runId?.startsWith("personal-")).length, 1);
      await assert.rejects(
        orchestrator.resolveGate({ taskRunId: afterTimeout.run.id, gateId: afterTimeout.gates[0].id, decision: "approve" }),
        /already resolved|expired|stale/i,
      );
    } finally {
      await orchestrator.close();
    }
  });

  it("revalidates a frozen-scope full-allow mode against every selected provider", async () => {
    const userDataDir = await temporaryDirectory("task-provider-full-allow-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-full-allow-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        }
        return { output: "alignment complete" };
      },
    });
    runtime.listAvailableAgentMetadata = async () => ({
      agents: [
        {
          id: "primary-agent", name: "Primary", provider: "codex", status: "online", supportsTaskMcp: true,
          modelOptions: [{ id: "primary-model", label: "Primary model" }],
          capability: { authenticated: true, supportsModelOverride: true, supportsPermissionAutoApprove: true },
        },
        {
          id: "worker-agent", name: "Worker", provider: "claude", status: "online", supportsTaskMcp: true,
          modelOptions: [{ id: "worker-model", label: "Worker model" }],
          capability: { authenticated: true, supportsModelOverride: true, supportsPermissionAutoApprove: false },
        },
      ],
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      await assert.rejects(
        orchestrator.createTask(taskInput(workspaceRoot, {
          permissionMode: "full-allow",
          primary: selection(),
          allowedWorkers: [selection("worker-agent", "claude", "worker-model", "Worker")],
        })),
        /full_allow_unsupported/,
      );
    } finally {
      await orchestrator.close();
    }
  });

  it("freezes requested aliases, canonical effective models, and bounded capabilities", async () => {
    const userDataDir = await temporaryDirectory("task-provider-snapshot-user-");
    const workspaceRoot = await temporaryDirectory("task-provider-snapshot-workspace-");
    temporaryDirectories.push(userDataDir, workspaceRoot);
    const runtime = createRuntime({
      start: async ({ input }) => {
        if (input.taskControlPlane?.propose_contract) {
          await input.taskControlPlane.propose_contract({ contract: contract() });
        }
        return { output: "alignment complete" };
      },
    });
    runtime.listAvailableAgentMetadata = async () => ({
      agents: [{
        id: "primary-agent",
        name: "Primary",
        provider: "codex",
        status: "online",
        supportsTaskMcp: true,
        modelOptions: [{ id: "canonical-model", label: "Canonical model", aliases: ["provider-alias"] }],
        catalog: { revision: "catalog-7", updatedAt: Date.now() },
        capability: {
          authenticated: true,
          supportsModelOverride: true,
          supportsPermissionAutoApprove: true,
          supportsContextUsage: true,
          supportsNativeCompact: true,
          supportsNativeResume: true,
          supportsStreaming: true,
        },
      }],
    });
    const orchestrator = createTaskOrchestrator({ userDataDir, personalAgentRuntime: runtime, pollMs: 1, awaitAlignment: true });
    try {
      const created = await orchestrator.createTask(taskInput(workspaceRoot, {
        primary: selection("primary-agent", "codex", "provider-alias", "Primary"),
        allowedWorkers: [],
        contractFinalization: "model-recommended-auto",
      }));
      const snapshot = await waitForSnapshot(orchestrator, created.task.id, (current) => current.run?.status === "succeeded");
      const capability = snapshot.task.primary.capabilitySnapshot;
      assert.equal(snapshot.task.primary.model, "canonical-model");
      assert.equal(snapshot.run.definition.primary.model, "canonical-model");
      assert.ok(runtime.startCalls.length >= 2, "alignment and execution must both launch with the canonical model");
      assert.ok(runtime.startCalls.every((call) => call.input.model === "canonical-model"));
      assert.equal(capability.requestedModel, "provider-alias");
      assert.equal(capability.effectiveModel, "canonical-model");
      assert.equal(capability.modelResolution, "catalog");
      assert.equal(capability.catalogRevision, "catalog-7");
      assert.equal(capability.supports.taskMcp, true);
      assert.equal(capability.supports.context, true);
      assert.equal(capability.nativeDelegationIsolated, true);
      assert.equal(capability.supports.nativeDelegationIsolated, true);
      assert.deepEqual(snapshot.run.definition.primary.capabilitySnapshot, capability);
      assert.equal(snapshot.run.primaryAttempts[0].providerDiagnostics, null);
      assert.equal(JSON.stringify(capability).includes("modelOptions"), false);
    } finally {
      await orchestrator.close();
    }
  });
});
