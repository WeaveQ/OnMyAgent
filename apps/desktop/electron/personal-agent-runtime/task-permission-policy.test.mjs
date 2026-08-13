import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { __test__ as acpGenericTest } from "./adapters/acp-generic.mjs";
import { buildRestoredRunSnapshot, buildRunMeta, buildRunSnapshot } from "./run-helpers.mjs";
import { classifyTaskOperation, evaluateTaskPermission, sanitizeTaskPermissionGrant } from "./task-permission-policy.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "task-permission-policy-"));
  roots.push(root);
  await mkdir(path.join(root, "src"));
  return root;
}

function grant(root, overrides = {}) {
  return {
    id: "grant-1",
    policyVersion: 1,
    taskId: "task-1",
    taskRunId: "run-1",
    taskRevision: 1,
    contractHash: "a".repeat(64),
    workspaceRoot: root,
    realWorkspaceRoot: root,
    allowedProviders: ["codex", "claude"],
    allowedProfileIds: ["primary", "worker"],
    mode: "full-allow",
    issuedAt: 1_000,
    expiresAt: 9_000,
    ...overrides,
  };
}

function request(root, operation, overrides = {}) {
  return {
    taskPermissionGrant: grant(root),
    taskId: "task-1",
    taskRunId: "run-1",
    contractHash: "a".repeat(64),
    provider: "codex",
    taskProfileId: "primary",
    workspaceRoot: root,
    now: 2_000,
    operation,
    ...overrides,
  };
}

describe("Task Center scoped full-allow policy", () => {
  it("accepts ordinary local work in the real workspace, including a new target", async () => {
    const root = await workspace();
    const result = await evaluateTaskPermission(request(root, { kind: "file_change", cwd: root, path: path.join(root, "src", "new.txt"), method: "write" }));
    assert.equal(result.decision, "accept");
    assert.equal(result.reason, "scoped-full-allow");
  });

  it("accepts only the authenticated Task Center control surface without classifying worker prompt text as an external side effect", async () => {
    const root = await workspace();
    const spawn = {
      method: "session/request_permission",
      cwd: root,
      input: {
        server: "onmyagent-task-control",
        tool: "spawn_agent",
        arguments: {
          workerProfileId: "worker-1",
          prompt: "Do not deploy, publish, send messages, access credentials, or delete files.",
        },
      },
    };
    assert.deepEqual(classifyTaskOperation(spawn), {
      kind: "task-control",
      safe: true,
      reason: "task-control-operation",
    });
    const accepted = await evaluateTaskPermission(request(root, spawn));
    assert.equal(accepted.decision, "accept");
    assert.equal(accepted.reason, "scoped-full-allow");

    for (const operation of [
      { ...spawn, input: { ...spawn.input, server: "untrusted-task-control" } },
      { ...spawn, input: { ...spawn.input, tool: "arbitrary_shell" } },
    ]) {
      const denied = await evaluateTaskPermission(request(root, operation));
      assert.equal(denied.decision, "decline");
      assert.equal(denied.reason, "hard-deny-operation");
    }
  });

  it("declines outside paths, cwd escapes, network/publish/push, credentials and recursive deletion", async () => {
    const root = await workspace();
    const outside = path.join(path.dirname(root), "outside.txt");
    const cases = [
      { operation: { path: outside }, reason: "path-outside-workspace" },
      { operation: { cwd: path.dirname(root), path: outside }, reason: "cwd-outside-workspace" },
      { operation: { command: "curl https://example.com" }, reason: "hard-deny-operation" },
      { operation: { command: "git push --force origin main" }, reason: "hard-deny-operation" },
      { operation: { command: "npm publish" }, reason: "hard-deny-operation" },
      { operation: { path: path.join(root, ".ssh", "id_ed25519") }, reason: "hard-deny-operation" },
      { operation: { command: "rm -rf src" }, reason: "hard-deny-operation" },
      { operation: { recursive: true, path: path.join(root, "src") }, reason: "hard-deny-operation" },
    ];
    for (const entry of cases) {
      const result = await evaluateTaskPermission(request(root, entry.operation));
      assert.equal(result.decision, "decline", JSON.stringify(entry));
      assert.equal(result.reason, entry.reason, JSON.stringify(entry));
    }
  });

  it("resolves symlinks and nearest existing parents before allowing non-existing files", async () => {
    const root = await workspace();
    const outside = await mkdtemp(path.join(os.tmpdir(), "task-permission-outside-"));
    roots.push(outside);
    await symlink(outside, path.join(root, "escape"));
    const escaped = await evaluateTaskPermission(request(root, { path: path.join(root, "escape", "new.txt") }));
    assert.equal(escaped.decision, "decline");
    assert.equal(escaped.reason, "path-outside-workspace");
  });

  it("declines missing, expired, and mismatched grants without prompting", async () => {
    const root = await workspace();
    const invalid = await evaluateTaskPermission(request(root, {}, { taskPermissionGrant: null }));
    assert.deepEqual(invalid, { decision: "decline", reason: "missing-or-invalid-grant", grant: null });
    const expired = await evaluateTaskPermission(request(root, {}, { now: 9_000 }));
    assert.equal(expired.reason, "grant-expired");
    const mismatch = await evaluateTaskPermission(request(root, {}, { taskRunId: "run-other" }));
    assert.equal(mismatch.reason, "grant-mismatch");
    assert.equal((await evaluateTaskPermission(request(root, {}, { contractHash: "b".repeat(64) }))).reason, "grant-mismatch");
    assert.equal((await evaluateTaskPermission(request(root, {}, { taskProfileId: "unknown" }))).reason, "grant-mismatch");
    assert.equal((await evaluateTaskPermission(request(root, {}, { provider: "hermes" }))).reason, "grant-mismatch");
  });

  it("fails closed for opaque interpreters and indirect side effects", async () => {
    const root = await workspace();
    const commands = [
      "python3 -c 'import requests; requests.get(\"https://example.invalid\")'",
      "node -e 'require(\"https\").request({})'",
      "ruby -e 'Net::HTTP.get(URI(\"https://example.invalid\"))'",
      "perl -e 'print $ENV{API_TOKEN}'",
      "php -r 'mail(\"x@example.invalid\", \"x\", \"y\");'",
      "bash -c 'touch src/out.txt'",
      "sh -c 'rm -f src/out.txt'",
      "eval \"touch src/out.txt\"",
      "source ./build-env.sh",
      "node -e 'console.log(process.env.SECRET)'",
    ];
    for (const command of commands) {
      const classification = classifyTaskOperation({ method: "shell", command, cwd: root });
      assert.equal(classification.safe, false, command);
      const result = await evaluateTaskPermission(request(root, { method: "shell", command, cwd: root }));
      assert.equal(result.decision, "decline", command);
    }
  });

  it("keeps non-task Codex auto semantics while scoped tasks use the blocking read-only preset", () => {
    assert.equal(acpGenericTest.codexModeForApprovalMode("auto"), "agent-full-access");
    assert.equal(acpGenericTest.codexModeForApprovalMode("auto", { taskId: "task-1", taskPermissionMode: "full-allow" }), "read-only");
    assert.equal(acpGenericTest.codexModeForApprovalMode("ask", { taskId: "task-1", taskPermissionMode: "restricted" }), "read-only");
  });

  it("persists only bounded grant identity and restores it through run snapshots", () => {
    const rawGrant = grant("/workspace", { secret: "do-not-log", token: "do-not-log" });
    const state = {
      runId: "run-1",
      agentId: "codex",
      agentProvider: "codex",
      status: "running",
      workspaceRoot: "/workspace",
      startedAt: 1,
      finishedAt: null,
      pid: null,
      command: "codex",
      outputParts: [],
      error: null,
      events: [],
      connectionMode: "Codex ACP session",
      providerSessionId: null,
      resumeKey: null,
      metadata: null,
      workdir: null,
      debugSummary: null,
      errorInfo: null,
      approvalMode: "auto",
      taskId: "task-1",
      taskRunId: "run-1",
      taskRevision: 1,
      taskContractHash: "a".repeat(64),
      taskPermissionMode: "full-allow",
      taskPermissionGrant: rawGrant,
      pendingApprovals: [],
      artifacts: [],
      fileChanges: [],
    };
    const meta = buildRunMeta(state, { visibleArtifacts: (value) => value });
    assert.equal(meta.taskPermissionGrant.secret, undefined);
    assert.equal(meta.taskPermissionGrant.token, undefined);
    assert.equal(meta.taskPermissionGrant.taskRunId, "run-1");
    assert.equal(meta.taskId, "task-1");
    assert.equal(meta.taskRunId, "run-1");
    const restored = buildRestoredRunSnapshot(meta, [], "run-1", "/tmp/run.jsonl", { visibleArtifacts: (value) => value, runEventsToConversationMessages: () => [] });
    assert.equal(restored.taskPermissionGrant.contractHash, "a".repeat(64));
    assert.equal(restored.taskId, "task-1");
    assert.equal(restored.taskRunId, "run-1");
    const snapshot = buildRunSnapshot(state, { visibleArtifacts: (value) => value, runEventsToConversationMessages: () => [] });
    assert.equal(snapshot.taskPermissionGrant.providerSet[0], "codex");
    assert.deepEqual(sanitizeTaskPermissionGrant(rawGrant).token, undefined);
  });
});
