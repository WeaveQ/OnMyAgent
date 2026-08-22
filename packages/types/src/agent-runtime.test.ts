// @ts-expect-error -- this package intentionally omits Node.js runtime types.
import test from "node:test";
// @ts-expect-error -- this package intentionally omits Node.js runtime types.
import assert from "node:assert/strict";
import {
  agentRuntimeEventSchema,
  agentRuntimeConnectorToolsResponseSchema,
  agentRuntimePermissionDecisionSchema,
  agentRuntimeSessionProfileSchema,
  agentRuntimeSelectionConfigSchema,
  agentRuntimeUsageSchema,
  runtimeSessionBindingSchema,
} from "@onmyagent/types/agent-runtime";

const binding = {
  productSessionId: "product-session",
  runtimeKind: "grok-build",
  runtimeSessionId: "runtime-session",
  workspaceId: "workspace",
  cwd: "C:\\Users\\agent\\workspace",
  profileId: "system",
  runtimeHome: "C:\\Users\\agent\\.grok",
  modelRef: { providerId: "grok-build", modelId: "runtime-model" },
  createdAt: 1_800_000_000_000,
  source: "explicit",
} as const;

test("accepts runtime-scoped selection and sticky session binding contracts", () => {
  assert.deepEqual(runtimeSessionBindingSchema.parse(binding), binding);
  assert.deepEqual(runtimeSessionBindingSchema.parse({
    ...binding,
    modelRef: { modelId: "grok-4" },
  }).modelRef, { modelId: "grok-4" });
  assert.deepEqual(agentRuntimeSelectionConfigSchema.parse({
    version: 1,
    revision: 0,
    defaultRuntimeKind: "opencode",
    workspaceOverrides: { workspace: "grok-build" },
    grokBuild: {
      profileId: "system",
      homeMode: "system",
      binaryMode: "system",
    },
  }).workspaceOverrides, { workspace: "grok-build" });
  assert.equal(agentRuntimeSessionProfileSchema.parse({
    kind: "expert",
    expertId: "expert-a",
    name: "Expert A",
    description: "Fixture expert",
    systemPrompt: "You are Expert A.",
    approvedAgentIds: ["researcher"],
  }).kind, "expert");
});

test("rejects unknown runtime, selection, and binding fields", () => {
  assert.throws(() => runtimeSessionBindingSchema.parse({
    ...binding,
    runtimeKind: "personal",
  }));
  assert.throws(() => runtimeSessionBindingSchema.parse({
    ...binding,
    secret: "must-not-persist",
  }));
  assert.throws(() => agentRuntimeSelectionConfigSchema.parse({
    version: 1,
    revision: 0,
    defaultRuntimeKind: "opencode",
    workspaceOverrides: {},
    grokBuild: { binaryPath: "/Users/fixture/.grok/bin/grok" },
  }));
  assert.throws(() => agentRuntimeSelectionConfigSchema.parse({
    version: 1,
    revision: 0,
    defaultRuntimeKind: "grok-build",
    workspaceOverrides: {},
    grokBuild: { profileId: "system", homeMode: "managed" },
  }));
  assert.throws(() => agentRuntimeSelectionConfigSchema.parse({
    version: 1,
    revision: 0,
    defaultRuntimeKind: "opencode",
    workspaceOverrides: {},
    opencode: {
      profileId: "managed",
      runtimeHome: "/fixture/opencode-data",
    },
  }));
});

test("requires a selected permission option only for selected outcomes", () => {
  const selected = {
    permissionId: "permission",
    outcome: "selected",
    optionId: "allow-once",
    decidedAt: 1,
  };
  assert.deepEqual(agentRuntimePermissionDecisionSchema.parse(selected), selected);
  assert.throws(() => agentRuntimePermissionDecisionSchema.parse({
    permissionId: "permission",
    outcome: "selected",
    decidedAt: 1,
  }));
  assert.throws(() => agentRuntimePermissionDecisionSchema.parse({
    permissionId: "permission",
    outcome: "cancelled",
    optionId: "allow-once",
    decidedAt: 1,
  }));
});

test("accepts only redacted runtime connector availability", () => {
  const value = {
    runtimeKind: "grok-build",
    workspaceId: "workspace",
    items: [{
      connectorId: "kdocs",
      accountConnected: true,
      toolAvailable: false,
      reason: "runtime_projection_unavailable",
    }],
    complete: true,
  } as const;
  assert.deepEqual(agentRuntimeConnectorToolsResponseSchema.parse(value), value);
  assert.throws(() => agentRuntimeConnectorToolsResponseSchema.parse({
    ...value,
    items: [{ ...value.items[0], accessToken: "secret" }],
  }));
});

test("normalizes usage and canonical events without native payload leakage", () => {
  const usage = agentRuntimeUsageSchema.parse({
    inputTokens: 12,
    outputTokens: 3,
    modelRef: { providerId: "grok-build", modelId: "runtime-model" },
  });
  const event = agentRuntimeEventSchema.parse({
    eventId: "event",
    runtimeKind: "grok-build",
    productSessionId: "product-session",
    emittedAt: 2,
    kind: "usage.updated",
    usage,
  });
  assert.equal(event.kind, "usage.updated");
  assert.throws(() => agentRuntimeEventSchema.parse({
    ...event,
    rawNativePayload: { prompt: "must-not-leak" },
  }));
});
