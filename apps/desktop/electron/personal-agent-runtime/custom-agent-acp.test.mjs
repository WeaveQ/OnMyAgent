import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createCustomAgent, listCustomAgents, updateCustomAgent } from "./custom-agent-store.mjs";
import { normalizePersonalLocalAgent, personalAgentCapability, personalLocalAgentConnectionMode } from "./provider-registry.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";
import { createPersonalAgentRuntime } from "./index.mjs";

let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(() => fn());
  chain = run.then(() => {}, () => {});
  return run;
}

async function tempWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-custom-acp-"));
  configurePersonalAgentRuntimeState({ runtimeStateRoot: path.join(workspaceRoot, "user-data", "runtime-state") });
  return workspaceRoot;
}

test("custom-agent-store persists ACP adapter fields", (t) => serial(async () => {
  const workspaceRoot = await tempWorkspace();
  const { agent: created } = await createCustomAgent(workspaceRoot, {
    id: "ext-codebuddy",
    name: "CodeBuddy",
    executablePath: "npx",
    customArgs: ["@tencent-ai/codebuddy-code"],
    connectionType: "cli",
    acpArgs: ["--acp"],
    supportsStreaming: true,
    supportsResume: false,
    supportsApproval: true,
    supportsModelOverride: true,
    authRequired: true,
  });

  assert.equal(created.connectionType, "cli");
  assert.deepEqual(created.acpArgs, ["--acp"]);
  assert.equal(created.supportsAcp, true);
  assert.equal(created.supportsStreaming, true);
  assert.equal(created.supportsApproval, true);
  assert.equal(created.authRequired, true);
  assert.equal(created.connectionMode, "Custom ACP session");

  const listed = await listCustomAgents(workspaceRoot);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "ext-codebuddy");
  assert.equal(listed[0].supportsAcp, true);

  const { agent: updated } = await updateCustomAgent(workspaceRoot, "ext-codebuddy", { connectionType: "raw" });
  assert.equal(updated.connectionType, "raw");
  assert.equal(updated.supportsAcp, false);
  assert.equal(updated.connectionMode, "Custom command");
}));

test("normalizePersonalLocalAgent carries ACP metadata for custom provider", () => {
  const normalized = normalizePersonalLocalAgent({
    id: "ext-buddy",
    name: "Buddy",
    provider: "custom",
    executablePath: "npx",
    customArgs: ["buddy"],
    connectionType: "cli",
    acpArgs: ["--acp"],
    supportsStreaming: true,
    supportsResume: true,
    supportsApproval: true,
    supportsModelOverride: true,
    authRequired: true,
  });
  assert.equal(normalized.provider, "custom");
  assert.equal(normalized.connectionType, "cli");
  assert.deepEqual(normalized.acpArgs, ["--acp"]);
  assert.equal(normalized.supportsAcp, true);
  assert.equal(normalized.supportsStreaming, true);
});

test("personalAgentCapability honors custom ACP capability", () => {
  const capability = personalAgentCapability("custom", "online", {
    customAgent: {
      provider: "custom",
      connectionType: "cli",
      supportsAcp: true,
      supportsStreaming: true,
      supportsResume: false,
      supportsApproval: true,
      supportsModelOverride: true,
      supportsPermissionAutoApprove: false,
      authRequired: true,
    },
  });
  assert.equal(capability.supportsAcp, true);
  assert.equal(capability.supportsStreaming, true);
  assert.equal(capability.supportsApproval, true);
  assert.equal(capability.supportsModelOverride, true);
  assert.equal(capability.authRequired, true);
  assert.equal(capability.targetKind, "model");
});

test("personalLocalAgentConnectionMode maps custom ACP to ACP mode label", () => {
  const acp = personalLocalAgentConnectionMode("custom", { provider: "custom", connectionType: "cli", supportsAcp: true });
  const raw = personalLocalAgentConnectionMode("custom", { provider: "custom", connectionType: "raw" });
  assert.equal(acp, "Custom ACP session");
  assert.equal(raw, "Custom command");
});

test("testCustomAgent returns fail_cli for empty command", (t) => serial(async () => {
  const workspaceRoot = await tempWorkspace();
  const runtime = createPersonalAgentRuntime({ legacy: { listAgents: async () => ({ agents: [] }), normalizeAgent: async (agent) => agent, detectAgent: async (agent) => agent } });
  const result = await runtime.testCustomAgent({ command: "" });
  assert.equal(result.step, "fail_cli");
  assert.ok(result.error);
  assert.equal(result.durationMs, 0);
}));

test("testCustomAgent returns fail_cli for non-existent command", (t) => serial(async () => {
  const workspaceRoot = await tempWorkspace();
  const runtime = createPersonalAgentRuntime({ legacy: { listAgents: async () => ({ agents: [] }), normalizeAgent: async (agent) => agent, detectAgent: async (agent) => agent } });
  const result = await runtime.testCustomAgent({ command: "__not_exist__", timeoutMs: 2000 });
  assert.equal(result.step, "fail_cli");
  assert.ok(result.error);
  assert.ok(result.durationMs > 0);
}));
