import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGenericAcpAdapter } from "./adapters/acp-generic.mjs";
import { __test__ as codexTest } from "./adapters/codex.mjs";
import { createOpenCodeAdapter } from "./adapters/opencode.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";

function fakeCodexChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = {
    writes: [],
    write(payload, _encoding, callback) {
      this.writes.push(String(payload));
      callback?.();
      return true;
    },
    destroy() {},
  };
  child.exitCode = 0;
  child.signalCode = null;
  return child;
}

test("Codex auto fast path declines an already-expired provider request", async () => {
  const child = fakeCodexChild();
  const events = [];
  let requestApprovalCalls = 0;
  const client = new codexTest.CodexRpcClient({
    child,
    appendEvent: (event) => events.push(event),
    onAssistantText: () => undefined,
    onDone: () => undefined,
    onSession: () => undefined,
    onError: () => undefined,
    requestApproval: async () => {
      requestApprovalCalls += 1;
      return { decision: "accept" };
    },
    approvalMode: "auto",
    runId: "codex-expired",
    cwd: "/tmp",
  });
  try {
    await client.handleServerRequest(1, "item/commandExecution/requestApproval", {
      command: "rm -rf should-not-run",
      expiresAt: Date.now() - 1,
    });
    assert.equal(requestApprovalCalls, 0);
    assert.equal(JSON.parse(child.stdin.writes[0]).result.decision, "decline");
    assert.equal(events.some((event) => /approval_decline_expired/.test(String(event.text ?? ""))), true);
  } finally {
    client.dispose();
  }
});

test("OpenCode auto and duplicate fast paths reject an expired permission", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "adapter-opencode-expiry-"));
  const replies = [];
  let requestApprovalCalls = 0;
  let permissionListCalls = 0;
  const events = [];
  const client = {
    session: {
      get: async () => ({ data: { id: "opencode-expiry-session" } }),
      create: async () => ({ data: { id: "opencode-expiry-session" } }),
      abort: async () => ({ data: {} }),
      prompt: async () => ({ data: { parts: [{ type: "text", text: "expired permission handled" }] } }),
      messages: async () => ({ data: [] }),
    },
    permission: {
      list: async () => {
        permissionListCalls += 1;
        if (permissionListCalls > 1) return { data: [] };
        return {
          data: [{
            id: "expired-permission",
            sessionID: "opencode-expiry-session",
            permission: "bash",
            metadata: { command: "rm -rf should-not-run" },
            expiresAt: Date.now() - 1,
          }],
        };
      },
      respond: async (input) => {
        replies.push(input);
        return { data: {} };
      },
    },
  };
  try {
    const adapter = createOpenCodeAdapter({
      opencodeBaseUrl: "http://127.0.0.1:9999/opencode",
      onmyagentServerToken: "test-token",
      appendEvent: (event) => events.push(event),
      registerCancel: () => undefined,
      requestApproval: async () => {
        requestApprovalCalls += 1;
        return { decision: "accept" };
      },
      approvalMode: "auto",
      createClient: () => client,
    });
    const result = await adapter.sendMessage({
      runId: "opencode-expired",
      workspaceRoot,
      conversationWorkdir: workspaceRoot,
      prompt: "handle permission",
      approvalMode: "auto",
      agent: { id: "opencode", provider: "opencode", name: "OpenCode" },
    });
    assert.match(result.output, /expired permission handled/);
    assert.equal(requestApprovalCalls, 0);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].response, "reject");
    assert.equal(events.some((event) => /approval_decline_expired/.test(String(event.text ?? ""))), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("generic ACP auto fast path declines an expired permission before prompting", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "adapter-acp-expiry-"));
  const runtimeStateRoot = await mkdtemp(path.join(os.tmpdir(), "adapter-acp-expiry-state-"));
  configurePersonalAgentRuntimeState({ runtimeStateRoot });
  const events = [];
  let requestApprovalCalls = 0;
  const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-acp-cli.mjs");
  const adapter = createGenericAcpAdapter({
    appendEvent: (event) => events.push(event),
    registerCancel: () => undefined,
  });
  try {
    const result = await adapter.sendMessage({
      runId: "acp-expired",
      workspaceRoot,
      conversationWorkdir: workspaceRoot,
      prompt: "approval please",
      approvalMode: "auto",
      requestApproval: async () => {
        requestApprovalCalls += 1;
        return { decision: "accept" };
      },
      agent: {
        id: "custom",
        name: "Custom ACP",
        provider: "custom",
        executablePath: process.execPath,
        customArgs: [fixture, "--approval-expired"],
      },
    });
    assert.match(result.output, /Fake response to: approval please/);
    assert.equal(requestApprovalCalls, 0);
    assert.equal(events.some((event) => /task permission decline: approval-expired/.test(String(event.text ?? ""))), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(runtimeStateRoot, { recursive: true, force: true });
  }
});
