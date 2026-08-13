import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { createPersonalAgentRuntime } from "./index.mjs";
import { __test__ as acpGenericTest } from "./adapters/acp-generic.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";
import { createSideEffectController } from "../task-orchestrator/side-effects.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function grant(workspaceRoot, overrides = {}) {
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
    allowedProfileIds: ["primary"],
    allowedProviders: ["codex", "claude", "custom"],
    issuedAt: 1_000,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

function legacy() {
  return {
    listAgents: async () => ({ agents: [] }),
    normalizeAgent: async (input) => ({ id: "primary", name: "Codex", provider: "codex", executablePath: "codex", ...input }),
    detectAgent: async (agent) => ({ ...agent, id: "primary", provider: "codex", status: "online" }),
    start: async () => ({}),
    run: async () => ({}),
    status: () => ({ status: "missing" }),
    cancel: async () => ({ ok: true }),
  };
}

async function runtimeHarness(workspaceRoot, observer) {
  await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  const runtimeStateRoot = path.join(workspaceRoot, "runtime-state");
  const calls = [];
  const runtime = createPersonalAgentRuntime({
    runtimeStateRoot,
    legacy: legacy(),
    adapters: {
      codex: () => ({
        sendMessage: async (ctx) => {
          calls.push("send");
          const approval = await ctx.requestApproval({
            id: "intent-1",
            toolCallId: "tool-intent-1",
            method: "session/request_permission",
            kind: "command",
            title: "Write a file",
            summary: "Write a file in the task workspace",
            command: `touch ${path.join(workspaceRoot, "src", "new.txt")}`,
            cwd: workspaceRoot,
          });
          calls.push(`decision:${approval.decision}`);
          return { output: "ok", command: "fake codex", connectionMode: "Codex ACP session" };
        },
      }),
    },
  });
  return { runtime, calls, taskExecutionObserver: observer };
}

async function runScoped(runtime, workspaceRoot, taskExecutionObserver) {
  return runtime.runMessage({
    workspaceRoot,
    agent: { id: "primary", provider: "codex" },
    prompt: "perform the bounded task operation",
    taskPermissionMode: "full-allow",
    taskId: "task-1",
    taskRunId: "run-1",
    taskRevision: 1,
    taskContractHash: "a".repeat(64),
    taskProfileId: "primary",
    taskPermissionGrant: grant(workspaceRoot),
    taskExecutionObserver,
  });
}

describe("Task Center intent observer", () => {
  it("calls beforeOperation immediately before runtime approval acceptance", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "task-intent-observer-runtime-"));
    roots.push(workspaceRoot);
    const order = [];
    const observer = {
      beforeOperation: async (operation) => {
        order.push(["observer", operation.method, operation.command]);
        return { recorded: true, idempotency: "intent-1" };
      },
    };
    const { runtime, calls } = await runtimeHarness(workspaceRoot, observer);
    const result = await runScoped(runtime, workspaceRoot, observer);

    assert.equal(result.status, "completed");
    assert.deepEqual(calls, ["send", "decision:accept"]);
    assert.equal(order.length, 1);
    assert.equal(order[0][0], "observer");
    assert.equal(order[0][1], "session/request_permission");
    assert.equal(order[0][2].startsWith("touch "), true);
    assert.equal(result.pendingApprovals?.length ?? 0, 0);
  });

  it("declines without creating a prompt when durable intent recording fails", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "task-intent-observer-failure-"));
    roots.push(workspaceRoot);
    const calls = [];
    const observer = {
      beforeOperation: async () => {
        calls.push("observer");
        throw new Error("sqlite write failed");
      },
    };
    const { runtime } = await runtimeHarness(workspaceRoot, observer);
    const result = await runScoped(runtime, workspaceRoot, observer);

    assert.equal(result.status, "completed");
    assert.deepEqual(calls, ["observer"]);
    assert.equal(result.pendingApprovals?.length ?? 0, 0);
    assert.equal(result.events.some((event) => event.type === "approval_request"), false);
    assert.equal(result.events.some((event) => /task-intent-observer-failed/.test(String(event.text ?? ""))), false);
  });

  it("accepts read-only operations that are explicitly unrecorded", async () => {
    const calls = [];
    const result = await acpGenericTest.beforeTaskOperation({
      beforeOperation: async () => {
        calls.push("observer");
        return { recorded: false, idempotency: "read-only" };
      },
    }, { method: "session/request_permission", command: "cat src/file.txt" });

    assert.deepEqual(calls, ["observer"]);
    assert.equal(result.ok, true);
    assert.equal(result.result.idempotency, "read-only");
  });

  it("durably records a restricted side-effect immediately before a human approval is released", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "task-intent-observer-restricted-"));
    roots.push(workspaceRoot);
    const order = [];
    const observer = {
      beforeOperation: async (operation) => {
        order.push(["intent", operation.toolCallId, operation.command]);
        return { recorded: true, idempotency: "non-idempotent" };
      },
    };
    const { runtime, calls } = await runtimeHarness(workspaceRoot, observer);
    const started = await runtime.startMessage({
      workspaceRoot,
      agent: { id: "primary", provider: "codex" },
      prompt: "perform the restricted operation",
      approvalMode: "ask",
      sessionStrategy: "new",
      taskPermissionMode: "restricted",
      taskExecutionObserver: observer,
    });
    let waiting = started;
    const deadline = Date.now() + 1_000;
    while (!(waiting.pendingApprovals?.length)) {
      if (Date.now() >= deadline) throw new Error("Restricted approval was not exposed");
      await new Promise((resolve) => setTimeout(resolve, 5));
      waiting = await runtime.getRun({ runId: started.runId, workspaceRoot });
    }
    assert.deepEqual(order, []);
    assert.deepEqual(
      await runtime.resolveApproval({ runId: started.runId, approvalId: waiting.pendingApprovals[0].id, decision: "accept" }),
      { ok: true },
    );
    assert.equal(order.length, 1);
    assert.equal(order[0][0], "intent");
    assert.equal(order[0][1], "tool-intent-1");
    assert.equal(order[0][2].startsWith("touch "), true);
    let completed = await runtime.getRun({ runId: started.runId, workspaceRoot });
    while (completed.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed = await runtime.getRun({ runId: started.runId, workspaceRoot });
    }
    assert.equal(completed.status, "completed");
    assert.deepEqual(calls, ["send", "decision:accept"]);
  });
});

describe("generic ACP Task Center approval observer", () => {
  it("correlates Claude tool updates with a later nested permission request", () => {
    const operations = new Map();
    acpGenericTest.rememberAcpToolOperation(operations, {
      toolCallId: "call-claude-write",
      title: "Terminal",
      kind: "execute",
      rawInput: {},
      _meta: { claudeCode: { toolName: "Bash" } },
    });
    acpGenericTest.rememberAcpToolOperation(operations, {
      toolCallId: "call-claude-write",
      title: "printf proof > proof.txt",
      kind: "execute",
      rawInput: { command: "printf proof > proof.txt", description: "Create proof" },
    });
    const operation = acpGenericTest.permissionOperation({
      toolCall: { toolCallId: "call-claude-write", kind: "execute", status: "pending" },
    }, 7, "session/request_permission", "/tmp", operations);
    assert.equal(operation.toolCallId, "call-claude-write");
    assert.equal(operation.command, "printf proof > proof.txt");
    assert.equal(operation.input.description, "Create proof");
    assert.equal(operation.toolName, "Bash");
  });

  it("runs the observer in onRequest before accepting scoped permission", async () => {
    const stateRoot = await mkdtemp(path.join("/tmp", "task-intent-observer-acp-"));
    roots.push(stateRoot);
    configurePersonalAgentRuntimeState({ runtimeStateRoot: stateRoot });
    const workspaceRoot = "/tmp";
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const events = [];
    const order = [];
    let observedOperation = null;
    const adapter = acpGenericTest.createGenericAcpAdapterForTest({
      appendEvent: (event) => events.push(event),
      registerCancel: () => undefined,
    });
    const result = await adapter.sendMessage({
      workspaceRoot,
      conversationWorkdir: "/tmp",
      prompt: "approval please",
      approvalMode: "ask",
      sessionStrategy: "new",
      taskPermissionMode: "full-allow",
      taskId: "task-1",
      taskRunId: "run-1",
      taskRevision: 1,
      taskContractHash: "a".repeat(64),
      taskProfileId: "primary",
      taskPermissionGrant: grant(workspaceRoot),
      taskExecutionObserver: {
        beforeOperation: async (operation) => {
          observedOperation = operation;
          order.push(operation.method);
          return { recorded: true, idempotency: "intent-1" };
        },
      },
      agent: {
        id: "primary",
        name: "Custom ACP",
        provider: "custom",
        executablePath: process.execPath,
        customArgs: [fixture],
      },
    });

    assert.match(result.output, /Fake response to: approval please/);
    assert.deepEqual(order, ["session/request_permission"]);
    assert.ok(String(observedOperation?.toolCallId ?? "").trim());
    assert.equal(events.some((event) => /task permission accept: scoped-full-allow/.test(String(event.text ?? ""))), true);
  });

  it("forces a Claude Task session out of bypassPermissions before the exact write and records one durable receipt", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "task-intent-observer-claude-mode-"));
    roots.push(workspaceRoot);
    const sessionEventsFile = path.join(workspaceRoot, "session-events.jsonl");
    const events = [];
    let sequence = 0;
    const attempt = { id: "worker-claude", turnId: null, leaseId: "lease-claude", status: "running" };
    const run = {
      id: "run-1",
      status: "running",
      updatedAt: 1,
      primaryAttempts: [],
      workerAttempts: [attempt],
      checkerAttempts: [],
      sideEffects: [],
    };
    const sideEffects = createSideEffectController({
      store: {
        requireRun: async () => run,
        writeRun: async () => run,
      },
      serialized: async (operation) => operation(),
      now: () => 100 + sequence,
      createId: (prefix) => `${prefix}-${++sequence}`,
    });
    const adapter = acpGenericTest.createGenericAcpAdapterForTest({
      appendEvent: (event) => events.push(event),
      registerCancel: () => undefined,
    });
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const result = await adapter.sendMessage({
      workspaceRoot,
      conversationWorkdir: workspaceRoot,
      prompt: "perform the exact write",
      model: "deepseek-v4-flash",
      approvalMode: "auto",
      sessionStrategy: "new",
      taskPermissionMode: "full-allow",
      taskId: "task-1",
      taskRunId: run.id,
      taskRevision: 1,
      taskContractHash: "a".repeat(64),
      taskProfileId: "worker-1",
      taskPermissionGrant: grant(workspaceRoot, { allowedProfileIds: ["worker-1"] }),
      taskExecutionObserver: {
        beforeOperation: (operation) => sideEffects.recordIntent("task-1", run.id, attempt.id, attempt.leaseId, operation),
      },
      requireTaskIntentHook: true,
      agent: {
        id: "claude",
        name: "Claude Code",
        provider: "claude",
        executablePath: process.execPath,
        customArgs: [fixture, "--correlated-approval-tool", "--claude-mode-sensitive-approval", `--session-events-file=${sessionEventsFile}`],
        managedAcpTool: { id: "claude-agent-acp-test" },
      },
    });

    await sideEffects.synchronize("task-1", run.id, attempt.id, attempt.leaseId, { status: "completed", events });
    assert.equal(run.sideEffects.length, 1);
    assert.equal(run.sideEffects[0].toolCallId, "call-fake-write");
    assert.equal(run.sideEffects[0].intentSource, "pre-execute");
    assert.equal(run.sideEffects[0].receiptStatus, "completed");
    const sessionEvents = (await readFile(sessionEventsFile, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(sessionEvents.map((event) => [event.method, event.configId, event.value]), [
      ["session/new", null, null],
      ["session/set_config_option", "mode", "default"],
      ["session/set_config_option", "model", "deepseek-v4-flash"],
    ]);
    assert.match(result.output, /Fake response/);
    assert.equal(events.some((event) => /task permission accept: scoped-full-allow/.test(String(event.text ?? ""))), true);
  });

  it("passes the correlated ACP tool identity through the restricted approval boundary", async () => {
    const stateRoot = await mkdtemp(path.join("/tmp", "task-intent-observer-acp-restricted-"));
    roots.push(stateRoot);
    configurePersonalAgentRuntimeState({ runtimeStateRoot: stateRoot });
    const events = [];
    let approvalRequest = null;
    let sequence = 0;
    const attempt = { id: "primary-restricted", turnId: null, leaseId: "lease-restricted", status: "running" };
    const run = {
      id: "run-restricted",
      status: "running",
      updatedAt: 1,
      primaryAttempts: [attempt],
      workerAttempts: [],
      checkerAttempts: [],
      sideEffects: [],
    };
    const sideEffects = createSideEffectController({
      store: {
        requireRun: async () => run,
        writeRun: async () => run,
      },
      serialized: async (operation) => operation(),
      now: () => 100 + sequence,
      createId: (prefix) => `${prefix}-${++sequence}`,
    });
    const adapter = acpGenericTest.createGenericAcpAdapterForTest({
      appendEvent: (event) => events.push(event),
      registerCancel: () => undefined,
    });
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const result = await adapter.sendMessage({
      workspaceRoot: "/tmp",
      conversationWorkdir: "/tmp",
      prompt: "nested approval please",
      approvalMode: "ask",
      sessionStrategy: "new",
      taskPermissionMode: "restricted",
      requestApproval: async (request) => {
        approvalRequest = request;
        await sideEffects.recordIntent("task-restricted", run.id, attempt.id, attempt.leaseId, request);
        return { decision: "accept" };
      },
      agent: {
        id: "primary",
        name: "Custom ACP",
        provider: "custom",
        executablePath: process.execPath,
        customArgs: [fixture, "--correlated-approval-tool"],
      },
    });

    assert.match(result.output, /Fake response to: nested approval please/);
    assert.ok(approvalRequest);
    assert.notEqual(approvalRequest.id, approvalRequest.toolCallId);
    assert.equal(approvalRequest.toolCallId, "call-fake-write");
    assert.equal(approvalRequest.command, "printf proof > proof.txt");
    const toolUpdates = events.filter((event) => event.type === "acp_tool_call");
    assert.equal(toolUpdates.length, 2);
    assert.equal(toolUpdates.every((event) => event.update?.toolCallId === "call-fake-write"), true);
    await sideEffects.synchronize("task-restricted", run.id, attempt.id, attempt.leaseId, { status: "completed", events });
    assert.equal(run.sideEffects.length, 1);
    assert.equal(run.sideEffects[0].toolCallId, "call-fake-write");
    assert.equal(run.sideEffects[0].intentSource, "pre-execute");
    assert.equal(run.sideEffects[0].receiptStatus, "completed");
  });

  it("declines on observer rejection and never invokes the interactive prompt", async () => {
    const stateRoot = await mkdtemp(path.join("/tmp", "task-intent-observer-acp-failure-"));
    roots.push(stateRoot);
    configurePersonalAgentRuntimeState({ runtimeStateRoot: stateRoot });
    const workspaceRoot = "/tmp";
    const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
    const events = [];
    let promptCount = 0;
    const adapter = acpGenericTest.createGenericAcpAdapterForTest({
      appendEvent: (event) => events.push(event),
      registerCancel: () => undefined,
    });
    const result = await adapter.sendMessage({
      workspaceRoot,
      conversationWorkdir: "/tmp",
      prompt: "approval please",
      approvalMode: "ask",
      sessionStrategy: "new",
      taskPermissionMode: "full-allow",
      taskId: "task-1",
      taskRunId: "run-1",
      taskRevision: 1,
      taskContractHash: "a".repeat(64),
      taskProfileId: "primary",
      taskPermissionGrant: grant(workspaceRoot),
      requestApproval: async () => {
        promptCount += 1;
        return { decision: "accept" };
      },
      taskExecutionObserver: {
        beforeOperation: async () => {
          throw new Error("durable intent unavailable");
        },
      },
      agent: {
        id: "primary",
        name: "Custom ACP",
        provider: "custom",
        executablePath: process.execPath,
        customArgs: [fixture],
      },
    });

    assert.match(result.output, /Fake response to: approval please/);
    assert.equal(promptCount, 0);
    const deadline = Date.now() + 500;
    while (!events.some((event) => /task permission decline: task-intent-observer-failed/.test(String(event.text ?? "")))) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for observer rejection event: ${JSON.stringify(events)}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(events.some((event) => /task permission decline: task-intent-observer-failed/.test(String(event.text ?? ""))), true);
    assert.equal(events.some((event) => /task permission decline: scoped-full-allow/.test(String(event.text ?? ""))), true);
  });
});
