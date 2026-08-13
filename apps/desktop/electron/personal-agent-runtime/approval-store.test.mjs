import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  forgetRememberedApprovalDecision,
  getStoredApprovalDecision,
  rememberApprovalDecision,
  listRememberedApprovalDecisions,
} from "./approval-store.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function approval(command) {
  return {
    id: `approval-${command}`,
    kind: "command",
    method: "session/request_permission",
    summary: command,
    command,
    cwd: "/tmp",
    params: { command },
  };
}

test("approval store serializes concurrent remember/forget and preserves sibling keys", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "approval-store-state-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "approval-store-workspace-"));
  roots.push(stateRoot, workspaceRoot);
  configurePersonalAgentRuntimeState({ runtimeStateRoot: stateRoot });
  const a = approval("echo a");
  const b = approval("echo b");
  const c = approval("echo c");

  const [rememberedA, rememberedB] = await Promise.all([
    rememberApprovalDecision(workspaceRoot, { provider: "codex", agentId: "primary", approval: a, decision: "acceptForSession" }),
    rememberApprovalDecision(workspaceRoot, { provider: "claude", agentId: "worker", approval: b, decision: "acceptForSession" }),
  ]);
  assert.ok(rememberedA?.key);
  assert.ok(rememberedB?.key);

  await Promise.all([
    forgetRememberedApprovalDecision(workspaceRoot, { key: rememberedA.key, expected: rememberedA }),
    rememberApprovalDecision(workspaceRoot, { provider: "opencode", agentId: "primary", approval: c, decision: "acceptForSession" }),
  ]);
  assert.equal(await getStoredApprovalDecision(workspaceRoot, { provider: "codex", agentId: "primary", approval: a }), null);
  assert.ok(await getStoredApprovalDecision(workspaceRoot, { provider: "claude", agentId: "worker", approval: b }));
  assert.ok(await getStoredApprovalDecision(workspaceRoot, { provider: "opencode", agentId: "primary", approval: c }));
  assert.equal((await listRememberedApprovalDecisions(workspaceRoot)).length, 2);
});

test("remembered approval preserves provider TTL and reads fail closed after expiry", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "approval-store-expiry-state-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "approval-store-expiry-workspace-"));
  roots.push(stateRoot, workspaceRoot);
  configurePersonalAgentRuntimeState({ runtimeStateRoot: stateRoot });
  const future = approval("echo ttl");
  future.expiresAt = Date.now() + 10_000;
  const remembered = await rememberApprovalDecision(workspaceRoot, {
    provider: "codex",
    agentId: "primary",
    approval: future,
    decision: "acceptForSession",
  });
  assert.equal(remembered.expiresAt, future.expiresAt);
  assert.equal((await getStoredApprovalDecision(workspaceRoot, {
    provider: "codex",
    agentId: "primary",
    approval: future,
  }))?.expiresAt, future.expiresAt);

  const expired = approval("echo expired");
  expired.expiresAt = Date.now() - 1;
  await rememberApprovalDecision(workspaceRoot, {
    provider: "codex",
    agentId: "primary",
    approval: expired,
    decision: "acceptForSession",
  });
  assert.equal(await getStoredApprovalDecision(workspaceRoot, {
    provider: "codex",
    agentId: "primary",
    approval: expired,
  }), null);
});
