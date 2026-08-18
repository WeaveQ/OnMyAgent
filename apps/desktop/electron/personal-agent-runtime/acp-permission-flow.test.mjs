import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPersonalAgentRuntime } from "./index.mjs";

const fixtureCli = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-permission-cli.mjs");

function legacyForFixture() {
  return {
    normalizeAgent: async (input) => ({
      id: "permission-fixture",
      name: "Permission fixture",
      provider: "custom",
      connectionType: "cli",
      supportsAcp: true,
      executablePath: process.execPath,
      acpArgs: [fixtureCli],
      customArgs: [],
      ...input,
    }),
    detectAgent: async (agent) => ({ ...agent, status: "online" }),
    listAgents: async () => ({ agents: [] }),
    start: async () => ({ status: "legacy-start" }),
    run: async () => ({ status: "legacy-run" }),
    status: () => ({ status: "missing" }),
    cancel: async () => ({ ok: false }),
  };
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-acp-permission-"));
  const runtime = createPersonalAgentRuntime({
    legacy: legacyForFixture(),
    runtimeStateRoot: path.join(root, "runtime-state"),
  });
  return { root, runtime };
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function waitForApproval(runtime, runId) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const snapshot = runtime.getRun(runId);
    if (snapshot?.pendingApprovals?.length) return snapshot;
    if (snapshot?.status !== "running") throw new Error(`run stopped before approval: ${snapshot?.status}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("permission request was not surfaced");
}

async function waitForTerminal(runtime, runId) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const snapshot = runtime.getRun(runId);
    if (snapshot?.status !== "running") return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("run did not terminate");
}

async function startFixture(runtime, root, name) {
  const target = path.join(root, name);
  const started = await runtime.startMessage({
    workspaceRoot: root,
    prompt: `fixture:${target}`,
    approvalMode: "ask",
    agent: {
      id: "permission-fixture",
      name: "Permission fixture",
      provider: "custom",
      connectionType: "cli",
      supportsAcp: true,
      executablePath: process.execPath,
      acpArgs: [fixtureCli],
    },
  });
  return { runId: started.runId, target };
}

describe("ACP permission request through Personal approval bridge", () => {
  it("decline returns reject-once and never writes the isolated fixture", async () => {
    const { root, runtime } = await setup();
    try {
      const { runId, target } = await startFixture(runtime, root, "denied.txt");
      const waiting = await waitForApproval(runtime, runId);
      const approval = waiting.pendingApprovals[0];
      assert.equal(approval.kind, "command");
      assert.equal(approval.readonly, false);
      assert.deepEqual(await runtime.resolveApproval({ runId, approvalId: approval.id, decision: "decline" }), { ok: true });
      const terminal = await waitForTerminal(runtime, runId);
      assert.equal(terminal.status, "completed");
      assert.match(terminal.output, /permission denied/);
      assert.equal(await exists(target), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accept returns allow-once and writes only the isolated fixture", async () => {
    const { root, runtime } = await setup();
    try {
      const { runId, target } = await startFixture(runtime, root, "accepted.txt");
      const waiting = await waitForApproval(runtime, runId);
      assert.deepEqual(await runtime.resolveApproval({ runId, approvalId: waiting.pendingApprovals[0].id, decision: "accept" }), { ok: true });
      const terminal = await waitForTerminal(runtime, runId);
      assert.equal(terminal.status, "completed");
      assert.match(terminal.output, /permission accepted/);
      assert.equal(await exists(target), true);
      assert.equal(await exists(path.join(root, "denied.txt")), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const reason of ["user", "timeout"]) {
    it(`${reason} cancellation resolves the pending approval and writes nothing`, async () => {
      const { root, runtime } = await setup();
      try {
        const { runId, target } = await startFixture(runtime, root, `${reason}.txt`);
        await waitForApproval(runtime, runId);
        assert.deepEqual(await runtime.cancelRun(runId, { reason }), { ok: true });
        const terminal = await waitForTerminal(runtime, runId);
        assert.equal(terminal.status, reason === "timeout" ? "failed" : "cancelled");
        assert.equal(terminal.errorInfo?.code, reason === "timeout" ? "timeout" : "cancelled");
        assert.equal(terminal.pendingApprovals.length, 0);
        assert.equal(await exists(target), false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
