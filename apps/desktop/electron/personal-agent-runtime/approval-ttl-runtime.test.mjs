import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { createPersonalAgentRuntime } from "./index.mjs";
import { getStoredApprovalDecision, listRememberedApprovalDecisions, rememberApprovalDecision } from "./approval-store.mjs";

const roots = [];
const activeRuns = [];

afterEach(async () => {
  // A provider may resolve the approval and still be flushing its terminal
  // conversation events after `resolveApproval` returns.  Drain that run
  // before removing its workspace; otherwise the late write races cleanup
  // and leaves an ENOTEMPTY temp directory behind.
  for (const entry of activeRuns.splice(0)) await drainRun(entry);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function drainRun(entry) {
  if (!entry?.runtime || !entry.runId) return;
  const input = { runId: entry.runId, workspaceRoot: entry.workspaceRoot };
  const deadline = Date.now() + 5_000;
  let snapshot = await Promise.resolve(entry.runtime.getRun(input));
  while (snapshot?.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    snapshot = await Promise.resolve(entry.runtime.getRun(input));
  }
  if (snapshot?.status === "running") {
    await entry.runtime.cancelRun(entry.runId, { reason: "test-cleanup" }).catch(() => undefined);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      snapshot = await Promise.resolve(entry.runtime.getRun(input));
      if (snapshot?.status !== "running") break;
    }
  }
  // Terminal status is published before the final persistence flush.  Wait
  // for the durable conversation terminal event as proof that no background
  // writer still owns the workspace before afterEach removes it.
  const conversationId = snapshot?.conversationId;
  if (!conversationId) return;
  while (Date.now() < deadline) {
    const status = await entry.runtime.getConversationStatus({
      workspaceRoot: entry.workspaceRoot,
      agent: entry.agent,
      conversationId,
    }).catch(() => null);
    const messages = status?.conversationMessages ?? [];
    if (status && status.running === false && messages.some((message) => ["finish", "error", "status"].includes(message?.type))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function legacy() {
  return {
    listAgents: async () => ({ agents: [] }),
    normalizeAgent: async (input) => ({ id: "primary", provider: "codex", name: "Codex", executablePath: process.execPath, ...input }),
    detectAgent: async (agent) => ({ ...agent, id: "primary", provider: "codex", status: "online" }),
    start: async () => ({}),
    run: async () => ({}),
    status: () => ({ status: "missing" }),
    cancel: async () => ({ ok: true }),
  };
}

test("always-allow remembered write crossing TTL is compensated and cannot accept", async () => {
  const runtimeStateRoot = await mkdtemp(path.join(os.tmpdir(), "approval-ttl-runtime-state-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "approval-ttl-runtime-workspace-"));
  roots.push(runtimeStateRoot, workspaceRoot);
  let rememberStarted;
  const rememberReady = new Promise((resolve) => { rememberStarted = resolve; });
  const runtime = createPersonalAgentRuntime({
    runtimeStateRoot,
    legacy: legacy(),
    rememberApprovalDecision: async (...args) => {
      rememberStarted();
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      return rememberApprovalDecision(...args);
    },
    adapters: {
      codex: () => ({
        sendMessage: async (ctx) => {
          const result = await ctx.requestApproval({
            id: "approval-ttl",
            method: "session/request_permission",
            kind: "command",
            title: "Command",
            summary: "Run a command",
            command: "echo ttl",
            cwd: workspaceRoot,
            expiresAt: Date.now() + 1_000,
          });
          return { output: result.decision, connectionMode: "test" };
        },
      }),
    },
  });
  const started = await runtime.startMessage({
    operationId: "approval-ttl-remember-write",
    workspaceRoot,
    agent: { id: "primary", provider: "codex" },
    prompt: "approval",
    approvalMode: "ask",
    taskPermissionMode: "restricted",
    sessionStrategy: "new",
    useRememberedApprovals: false,
  });
  activeRuns.push({
    runtime,
    runId: started.runId,
    workspaceRoot,
    agent: { id: "primary", provider: "codex" },
  });
  let waiting = started;
  const deadline = Date.now() + 1_000;
  while (!(waiting.pendingApprovals?.length)) {
    if (Date.now() >= deadline) throw new Error("approval was not exposed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    waiting = await runtime.getRun({ runId: started.runId, workspaceRoot });
  }
  const resolving = runtime.resolveApproval({
    runId: started.runId,
    approvalId: waiting.pendingApprovals[0].id,
    decision: "acceptForSession",
    alwaysAllow: true,
  });
  await rememberReady;
  const result = await resolving;
  assert.equal(result.ok, false);
  assert.equal(result.code, "APPROVAL_EXPIRED");
  assert.deepEqual(await listRememberedApprovalDecisions(workspaceRoot), []);
  const operationDeadline = Date.now() + 2_000;
  while (runtime.getTaskOperation({ operationId: "approval-ttl-remember-write" })?.status === "pending") {
    if (Date.now() >= operationDeadline) throw new Error("expired approval provider turn did not drain");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
});

test("remembered write compensation failure remains fail-closed after TTL", async () => {
  const runtimeStateRoot = await mkdtemp(path.join(os.tmpdir(), "approval-ttl-forget-failure-state-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "approval-ttl-forget-failure-workspace-"));
  roots.push(runtimeStateRoot, workspaceRoot);
  let rememberStarted;
  const rememberReady = new Promise((resolve) => { rememberStarted = resolve; });
  const runtime = createPersonalAgentRuntime({
    runtimeStateRoot,
    legacy: legacy(),
    rememberApprovalDecision: async (...args) => {
      rememberStarted();
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      return rememberApprovalDecision(...args);
    },
    forgetRememberedApprovalDecision: async () => {
      throw new Error("injected forget failure");
    },
    adapters: {
      codex: () => ({
        sendMessage: async (ctx) => {
          const result = await ctx.requestApproval({
            id: "approval-ttl-forget-failure",
            method: "session/request_permission",
            kind: "command",
            title: "Command",
            summary: "Run a command",
            command: "echo ttl",
            cwd: workspaceRoot,
            expiresAt: Date.now() + 1_000,
          });
          return { output: result.decision, connectionMode: "test" };
        },
      }),
    },
  });
  const started = await runtime.startMessage({
    operationId: "approval-ttl-forget-failure",
    workspaceRoot,
    agent: { id: "primary", provider: "codex" },
    prompt: "approval",
    approvalMode: "ask",
    taskPermissionMode: "restricted",
    sessionStrategy: "new",
    useRememberedApprovals: false,
  });
  activeRuns.push({ runtime, runId: started.runId, workspaceRoot, agent: { id: "primary", provider: "codex" } });
  let waiting = started;
  const deadline = Date.now() + 1_000;
  while (!(waiting.pendingApprovals?.length)) {
    if (Date.now() >= deadline) throw new Error("approval was not exposed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    waiting = await runtime.getRun({ runId: started.runId, workspaceRoot });
  }
  const approval = waiting.pendingApprovals[0];
  const resolving = runtime.resolveApproval({
    operationId: "approval-ttl-forget-resolution",
    runId: started.runId,
    approvalId: approval.id,
    decision: "acceptForSession",
    alwaysAllow: true,
  });
  await rememberReady;
  const result = await resolving;
  assert.equal(result.ok, false);
  assert.equal(result.code, "APPROVAL_EXPIRED");
  // The injected forget failure leaves the expired JSON record for diagnosis,
  // but a subsequent lookup must never turn it into authorization.
  assert.equal((await listRememberedApprovalDecisions(workspaceRoot)).length, 1);
  assert.equal(await getStoredApprovalDecision(workspaceRoot, {
    provider: "codex",
    agentId: "primary",
    approval,
  }), null);
});
