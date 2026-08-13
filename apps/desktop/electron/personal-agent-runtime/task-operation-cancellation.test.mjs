import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { createPersonalAgentRuntime } from "./index.mjs";
import { clearAgentProcesses, flushAgentProcessRegistry, getAgentProcess } from "./process-registry.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";

const roots = [];
const runtimes = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close?.()));
  clearAgentProcesses({ persist: false });
  await flushAgentProcessRegistry().catch(() => undefined);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function trackedRuntime(options) {
  const runtime = createPersonalAgentRuntime(options);
  runtimes.push(runtime);
  return runtime;
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

async function waitUntil(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for late process cleanup");
}

function makeLegacy() {
  return {
    normalizeAgent: async (input) => ({ id: "codex", name: "Codex", provider: "codex", executablePath: "codex", ...input }),
    detectAgent: async (agent) => ({ ...agent, id: "codex", provider: "codex", status: "online" }),
    listAgents: async () => ({ agents: [] }),
    start: async () => ({ status: "legacy-start" }),
    run: async () => ({ status: "legacy-run" }),
    status: () => ({ status: "missing" }),
    cancel: async () => ({ ok: true }),
  };
}

function fullAllowGrant(workspaceRoot) {
  return {
    id: "grant-1",
    policyVersion: 1,
    mode: "full-allow",
    taskId: "task-1",
    taskRunId: "run-1",
    taskRevision: 1,
    contractHash: "a".repeat(64),
    workspaceRoot,
    realWorkspaceRoot: workspaceRoot,
    allowedProviders: ["codex"],
    allowedProfileIds: ["codex"],
    issuedAt: Date.now() - 1_000,
    expiresAt: Date.now() + 60_000,
  };
}

async function runtimeRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  configurePersonalAgentRuntimeState({ runtimeStateRoot: path.join(root, "runtime-state") });
  return root;
}

describe("Personal caller-owned task operations", () => {
  it("rejects new interactive/channel starts while a main-owned lifecycle fence is held", async () => {
    const root = await runtimeRoot("personal-start-fence-");
    let legacyStarts = 0;
    const legacy = makeLegacy();
    legacy.start = async () => { legacyStarts += 1; return { status: "legacy-start" }; };
    const runtime = trackedRuntime({ legacy, adapters: {} });
    const release = runtime.blockStarts("engine_restart");
    await assert.rejects(
      runtime.startMessage({ workspaceRoot: root, prompt: "must not start", agent: { provider: "unknown" } }),
      (error) => error?.code === "LOCAL_AGENT_START_BLOCKED" && error?.reason === "engine_restart",
    );
    assert.equal(legacyStarts, 0);
    release();
    assert.equal((await runtime.startMessage({ workspaceRoot: root, prompt: "may start", agent: { provider: "unknown" } })).status, "legacy-start");
    assert.equal(legacyStarts, 1);
  });

  it("close cancels and drains deferred startup reconciliation before runtime-state cleanup", async () => {
    const root = await runtimeRoot("personal-startup-close-");
    const runtime = trackedRuntime({
      legacy: makeLegacy(),
      adapters: {},
      deferStartupReconcileMs: 60_000,
    });
    await runtime.close();
    await rm(root, { recursive: true, force: true });
    roots.splice(roots.indexOf(root), 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(stat(root), /ENOENT/);
  });

  it("fences a late PID/run result after the caller deadline and reaps registry residue", async () => {
    const root = await runtimeRoot("personal-task-operation-late-");
    const gate = deferred();
    let alive = false;
    const terminated = [];
    const runtime = trackedRuntime({
      legacy: makeLegacy(),
      processRegistryFile: path.join(root, "process-registry.json"),
      isProcessTreeAlive: () => alive,
      terminateProcessTreeByPid: async (record) => {
        terminated.push(record);
        alive = false;
        return { terminated: true };
      },
      cancelHandlerTimeoutMs: 20,
      cancelEscalationTimeoutMs: 20,
      adapters: {
        codex: ({ registerCancel, appendEvent }) => {
          registerCancel(async () => undefined);
          return {
            sendMessage: async () => {
              await gate.promise;
              alive = true;
              appendEvent({ type: "log", text: "pid 424244" });
              return {
                output: "late result must be fenced",
                command: "fake-codex",
                providerSessionId: "late-provider-session",
                resumeKey: "late-provider-session",
                pid: 424244,
              };
            },
          };
        },
      },
    });

    const operationId = "task-op-late-1";
    const startPromise = runtime.startMessage({ workspaceRoot: root, prompt: "held", agent: { provider: "codex" }, operationId });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelled = await runtime.cancelTaskOperation({ operationId, reason: "runtime-deadline" });
    assert.equal(cancelled.ok, true);
    gate.resolve();
    const started = await startPromise;
    await waitUntil(() =>
      terminated.length === 1 &&
      getAgentProcess(started.runId) === null &&
      runtime.getTaskOperation({ operationId })?.finishedAt !== null,
    );
    assert.equal(runtime.getRun({ runId: started.runId, workspaceRoot: root }).status, "cancelled");
    assert.equal(getAgentProcess(started.runId), null);
    assert.equal(terminated.length, 1);
    assert.equal(runtime.getTaskOperation({ operationId }).status, "cancelled");
    assert.doesNotMatch(JSON.stringify(started), /late result must be fenced/);
  });

  it("deduplicates concurrent cancellation calls for one operation", async () => {
    const root = await runtimeRoot("personal-task-operation-dedupe-");
    const gate = deferred();
    let cancelCalls = 0;
    let alive = true;
    const runtime = trackedRuntime({
      legacy: makeLegacy(),
      processRegistryFile: path.join(root, "process-registry.json"),
      isProcessTreeAlive: () => alive,
      terminateProcessTreeByPid: async () => { alive = false; return { terminated: true }; },
      adapters: {
        codex: ({ registerCancel, appendEvent }) => {
          registerCancel(async () => { cancelCalls += 1; });
          return {
            sendMessage: async () => {
              appendEvent({ type: "log", text: "pid 424245" });
              await gate.promise;
              return { output: "held", command: "fake-codex", pid: 424245 };
            },
          };
        },
      },
    });
    const operationId = "task-op-dedupe-1";
    const started = await runtime.startMessage({ workspaceRoot: root, prompt: "held", agent: { provider: "codex" }, operationId });
    const [first, second] = await Promise.all([
      runtime.cancelTaskOperation({ operationId }),
      runtime.cancelTaskOperation({ operationId }),
    ]);
    assert.deepEqual(second, first);
    assert.equal(cancelCalls, 1);
    assert.equal(getAgentProcess(started.runId), null);
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  it("finishes the operation when the provider settles before a slow cancellation handler", async () => {
    const root = await runtimeRoot("personal-task-operation-reverse-settle-");
    const providerGate = deferred();
    const cancelGate = deferred();
    const runtime = trackedRuntime({
      legacy: makeLegacy(),
      adapters: {
        codex: ({ registerCancel }) => {
          registerCancel(async () => { await cancelGate.promise; });
          return {
            sendMessage: async () => {
              await providerGate.promise;
              return { output: "provider settled", command: "fake-codex", terminationConfirmed: true };
            },
          };
        },
      },
    });
    const operationId = "task-op-reverse-settle-1";
    const started = await runtime.startMessage({ workspaceRoot: root, prompt: "held", agent: { provider: "codex" }, operationId });
    const cancelling = runtime.cancelTaskOperation({ operationId });
    providerGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(runtime.getTaskOperation({ operationId }).finishedAt, null);
    cancelGate.resolve();
    assert.equal((await cancelling).ok, true);
    await waitUntil(() => runtime.getTaskOperation({ operationId }).finishedAt !== null);
    assert.equal(runtime.getTaskOperation({ operationId }).status, "cancelled");
  });

  it("records an early startMessage exception as a failed operation", async () => {
    const root = await runtimeRoot("personal-task-operation-start-error-");
    const runtime = trackedRuntime({
      legacy: makeLegacy(),
      adapters: { codex: () => ({ sendMessage: async () => ({ output: "unused" }) }) },
    });
    const operationId = "task-op-start-error-1";
    await assert.rejects(
      runtime.startMessage({ prompt: "missing workspace", agent: { provider: "codex" }, operationId }),
      /workspaceRoot is required/,
    );
    const operation = runtime.getTaskOperation({ operationId });
    assert.equal(operation.status, "failed");
    assert.equal(operation.ok, false);
    assert.equal(Number.isFinite(operation.finishedAt), true);
  });

  it("settles the operation as failed when the final durable flush fails", async () => {
    const root = await runtimeRoot("personal-task-operation-final-persist-");
    const runtime = trackedRuntime({
      legacy: makeLegacy(),
      persistRun: async () => {
        throw new Error("simulated ENOSPC");
      },
      adapters: {
        codex: () => ({
          sendMessage: async () => ({ output: "completed before flush", command: "fake-codex", terminationConfirmed: true }),
        }),
      },
    });
    const operationId = "task-op-final-persist-1";
    const started = await runtime.startMessage({ workspaceRoot: root, prompt: "complete", agent: { provider: "codex" }, operationId });
    await waitUntil(() => runtime.getTaskOperation({ operationId })?.finishedAt !== null);
    const operation = runtime.getTaskOperation({ operationId });
    assert.equal(operation.status, "failed");
    assert.equal(operation.ok, false);
    assert.equal(runtime.getRun({ runId: started.runId, workspaceRoot: root }).status, "failed");
  });

  it("removes a pending runtime approval when the owning ACP request is aborted", async () => {
    const root = await runtimeRoot("personal-task-operation-approval-abort-");
    const runtime = trackedRuntime({
      legacy: makeLegacy(),
      adapters: {
        codex: () => ({
          sendMessage: async (context) => {
            const controller = new AbortController();
            const approvalPromise = context.requestApproval({
              id: "approval-abort-1",
              kind: "permissions",
              summary: "held approval",
              signal: controller.signal,
            });
            controller.abort();
            const approval = await approvalPromise;
            assert.equal(approval.decision, "decline");
            assert.equal(approval.cancelled, true);
            return { output: "declined safely", command: "fake-codex", terminationConfirmed: true };
          },
        }),
      },
    });
    const started = await runtime.startMessage({ workspaceRoot: root, prompt: "approval", agent: { provider: "codex" } });
    await waitUntil(() => runtime.getRun({ runId: started.runId, workspaceRoot: root }).status !== "running");
    const run = runtime.getRun({ runId: started.runId, workspaceRoot: root });
    assert.equal(run.status, "completed");
    assert.deepEqual(run.pendingApprovals, []);
  });

  it("cancels a pending createConversation through an AbortSignal without logging the signal payload", async () => {
    const root = await runtimeRoot("personal-task-operation-create-");
    const gate = deferred();
    const controller = new AbortController();
    const legacy = makeLegacy();
    legacy.normalizeAgent = async () => {
      await gate.promise;
      return { id: "codex", name: "Codex", provider: "codex", executablePath: "codex" };
    };
    const runtime = trackedRuntime({ legacy, adapters: {} });
    const operationId = "task-op-create-1";
    const createPromise = runtime.createConversation({ workspaceRoot: root, agent: { provider: "codex" }, operationId, signal: controller.signal });
    controller.abort();
    const cancelled = await runtime.cancelTaskOperation({ operationId, reason: "deadline" });
    assert.equal(cancelled.ok, true);
    gate.resolve();
    const result = await createPromise;
    assert.equal(result.cancelled, true);
    assert.equal(runtime.getTaskOperation({ operationId }).status, "cancelled");
    assert.doesNotMatch(JSON.stringify(result), /secret|token|password/i);
  });

  it("keeps ordinary Personal sessions outside the caller-owned operation map", async () => {
    const root = await runtimeRoot("personal-task-operation-ordinary-");
    const runtime = trackedRuntime({
      legacy: makeLegacy(),
      adapters: {
        codex: () => ({ sendMessage: async () => ({ output: "ordinary", command: "fake-codex" }) }),
      },
    });
    const started = await runtime.startMessage({ workspaceRoot: root, prompt: "ordinary", agent: { provider: "codex" } });
    assert.equal(started.status, "running");
    assert.equal(started.operationId ?? null, null);
    assert.equal(runtime.getTaskOperation({ operationId: "ordinary-no-op" }), null);
    await runtime.cancelRun(started.runId);
  });

  it("reports unsupported full-allow when the adapter cannot prove intent-before-effect", async () => {
    const root = await runtimeRoot("personal-task-operation-capability-");
    let sends = 0;
    const runtime = trackedRuntime({
      legacy: makeLegacy(),
      adapters: {
        codex: () => ({
          sendMessage: async () => {
            sends += 1;
            return { output: "must not execute", command: "fake-codex" };
          },
        }),
      },
    });
    const capability = await runtime.getTaskCapability({ agent: { provider: "codex", id: "codex" } });
    assert.equal(capability.supportsTaskIntentHook, false);
    assert.equal(capability.supportsScopedFullAllow, false);
    assert.match(capability.diagnostic, /intent hook/i);
    const result = await runtime.runMessage({
      workspaceRoot: root,
      prompt: "must be rejected before provider execution",
      agent: { provider: "codex", id: "codex" },
      taskPermissionMode: "full-allow",
      requireTaskIntentHook: true,
      taskId: "task-1",
      taskRunId: "run-1",
      taskRevision: 1,
      taskContractHash: "a".repeat(64),
      taskProfileId: "codex",
      taskPermissionGrant: fullAllowGrant(root),
    });
    assert.equal(result.status, "failed");
    assert.equal(result.errorInfo?.code, "task_full_allow_unsupported");
    assert.equal(sends, 0);
  });
});
