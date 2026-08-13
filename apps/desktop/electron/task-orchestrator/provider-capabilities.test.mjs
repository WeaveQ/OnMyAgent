import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeProviderCapabilities,
  providerCapabilitySnapshot,
  preflightProviderCapabilities,
  preflightProviderSelection,
} from "./provider-capabilities.mjs";

function onlineMetadata(overrides = {}) {
  return {
    id: "codex",
    name: "Codex",
    provider: "codex",
    status: "online",
    capability: {
      authenticated: true,
      supportsMcp: true,
      supportsTools: true,
      supportsModelOverride: true,
      supportsApproval: true,
      supportsPermissionAutoApprove: true,
      supportsContextUsage: true,
      supportsNativeCompact: true,
      supportsResume: true,
      supportsStreaming: true,
    },
    handshake: {
      available_models: [{ id: "gpt-5-codex", name: "GPT-5 Codex", aliases: ["codex-latest"] }],
      available_commands: [{ name: "/help" }],
      agent_capabilities: { _meta: { supportsModelOverride: true } },
    },
    ...overrides,
  };
}

describe("provider capability normalization", () => {
  it("canonicalizes model aliases and emits only bounded secret-free fields", () => {
    const metadata = onlineMetadata({
      apiKey: "sk-live-secret",
      token: "bearer-secret",
      env: [{ name: "API_KEY", value: "secret-value" }],
      executablePath: "/private/provider/bin/codex",
      rawMetadata: { nested: "must-not-leak" },
    });
    const result = normalizeProviderCapabilities({
      metadata,
      selection: { agentId: "codex", provider: "codex", model: "codex-latest", fullAllow: true },
    });

    assert.equal(result.agent.id, "codex");
    assert.equal(result.provider, "codex");
    assert.equal(result.requested.model, "codex-latest");
    assert.equal(result.effective.model, "gpt-5-codex");
    assert.equal(result.effective.modelResolution, "catalog");
    assert.equal(result.supports.mcp, true);
    assert.equal(result.supports.tools, true);
    assert.equal(result.supports.modelOverride, true);
    assert.equal(result.supports.fullAllow, true);
    assert.equal(result.preflight.ok, true);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /sk-live-secret|bearer-secret|secret-value|must-not-leak|executablePath/);
    assert.equal(result.metadata, undefined);
    assert.equal(result.rawMetadata, undefined);
    const snapshot = providerCapabilitySnapshot(result);
    assert.equal(snapshot.requestedModel, "codex-latest");
    assert.equal(snapshot.effectiveModel, "gpt-5-codex");
    assert.equal(snapshot.supports.context, true);
    assert.equal(snapshot.catalogFreshness, "unknown");
    assert.doesNotMatch(JSON.stringify(snapshot), /executablePath|sk-live-secret|nested/);
  });

  it("derives hard native-delegation isolation only from the three built-in Task adapters", () => {
    for (const provider of ["codex", "claude", "opencode"]) {
      const result = normalizeProviderCapabilities({
        metadata: onlineMetadata({
          id: `${provider}-agent`,
          name: provider,
          provider,
          modelOptions: [{ id: `${provider}-model`, label: `${provider} model` }],
          capability: { authenticated: true, supportsTaskMcp: true, supportsModelOverride: true },
        }),
        selection: { agentId: `${provider}-agent`, provider, model: `${provider}-model` },
      });
      const snapshot = providerCapabilitySnapshot(result);
      assert.equal(result.nativeDelegationIsolated, true);
      assert.equal(result.supports.nativeDelegationIsolated, true);
      assert.equal(snapshot.nativeDelegationIsolated, true);
      assert.equal(snapshot.supports.nativeDelegationIsolated, true);
      assert.equal(result.preflight.ok, true);
    }
  });

  it("fails closed for unsupported native-delegation providers without trusting metadata claims", () => {
    const result = normalizeProviderCapabilities({
      metadata: onlineMetadata({
        id: "hermes-agent",
        provider: "hermes",
        nativeDelegationIsolated: true,
        capability: { authenticated: true, supportsTaskMcp: true, supportsModelOverride: true },
        modelOptions: [{ id: "hermes-model", label: "Hermes model" }],
        apiKey: "secret-must-not-leak",
      }),
      selection: { agentId: "hermes-agent", provider: "hermes", model: "hermes-model" },
    });
    assert.equal(result.nativeDelegationIsolated, "unknown");
    assert.equal(result.supports.nativeDelegationIsolated, "unknown");
    assert.equal(result.preflight.ok, false);
    assert.ok(result.reasonCodes.includes("native_delegation_isolation_unsupported"));
    assert.match(result.reasons.join(" "), /Codex, Claude, or OpenCode/);
    assert.doesNotMatch(JSON.stringify(result), /secret-must-not-leak/);
  });

  it("derives a canonical model from live current-model metadata", () => {
    const result = normalizeProviderCapabilities({
      metadata: onlineMetadata({
        modelOptions: [{ id: "model-a", label: "Model A" }, { id: "model-b", label: "Model B" }],
        handshake: { current_model_id: "model-b", available_models: [{ id: "model-a", label: "Model A" }, { id: "model-b", label: "Model B" }] },
      }),
      selection: { agentId: "codex" },
    });

    assert.equal(result.requested.model, null);
    assert.equal(result.effective.model, "model-b");
    assert.equal(result.effective.modelResolution, "current");
    assert.equal(result.preflight.ok, true);
  });

  it("accepts object-shaped model catalogs from provider adapters", () => {
    const result = normalizeProviderCapabilities({
      metadata: onlineMetadata({
        modelOptions: { "provider-model": { label: "Provider Model", aliases: ["pm"] } },
        handshake: { available_models: { "provider-model": { name: "Provider Model" } } },
      }),
      selection: { model: "pm" },
    });
    assert.equal(result.effective.model, "provider-model");
    assert.equal(result.preflight.ok, true);
  });

  it("marks an old catalog stale and adds a non-sensitive warning", () => {
    const result = normalizeProviderCapabilities({
      metadata: onlineMetadata({
        catalog: { revision: "catalog-17", source: "personal-registry", updatedAt: 1_000 },
      }),
      selection: { model: "GPT-5 Codex" },
    }, { now: 10_000, staleAfterMs: 2_000 });

    assert.equal(result.catalog.revision, "catalog-17");
    assert.equal(result.catalog.freshness, "stale");
    assert.equal(result.catalog.stale, true);
    assert.equal(result.catalog.ageMs, 9_000);
    assert.match(result.catalog.warning ?? "", /stale/i);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.preflight.ok, true);
  });

  it("fails closed for missing, offline, unauthenticated, and explicitly unsupported selections", () => {
    const missing = normalizeProviderCapabilities({ selection: { agentId: "missing" } });
    assert.equal(missing.preflight.ok, false);
    assert.ok(missing.reasonCodes.includes("agent_missing"));
    assert.ok(missing.reasonCodes.includes("model_missing"));

    const offline = normalizeProviderCapabilities({ metadata: onlineMetadata({ status: "offline" }), selection: { model: "gpt-5-codex" } });
    assert.ok(offline.reasonCodes.includes("agent_offline"));

    const unauthenticated = normalizeProviderCapabilities({ metadata: onlineMetadata({ capability: { authenticated: false } }), selection: { model: "gpt-5-codex" } });
    assert.ok(unauthenticated.reasonCodes.includes("agent_unauthenticated"));

    const mcpDisabled = normalizeProviderCapabilities({ metadata: onlineMetadata({ capability: { supportsMcp: false } }), selection: { model: "gpt-5-codex" } });
    assert.ok(mcpDisabled.reasonCodes.includes("task_mcp_unsupported"));
    const taskMcpDisabled = normalizeProviderCapabilities({ metadata: onlineMetadata(), selection: { model: "gpt-5-codex", taskMcp: false } });
    assert.ok(taskMcpDisabled.reasonCodes.includes("task_mcp_unsupported"));

    const overrideDisabled = normalizeProviderCapabilities({ metadata: onlineMetadata({ capability: { supportsModelOverride: false } }), selection: { model: "gpt-5-codex", requireModelOverride: true } });
    assert.ok(overrideDisabled.reasonCodes.includes("model_override_unsupported"));

    const fullAllowDisabled = normalizeProviderCapabilities({ metadata: onlineMetadata({ capability: { supportsPermissionAutoApprove: false } }), selection: { model: "gpt-5-codex", fullAllow: true } });
    assert.ok(fullAllowDisabled.reasonCodes.includes("full_allow_unsupported"));
  });

  it("keeps absent optional capabilities unknown without blocking a valid model", () => {
    const result = normalizeProviderCapabilities({
      metadata: {
        id: "custom-agent",
        name: "Custom Agent",
        provider: "codex",
        status: "online",
        model: "custom-model",
      },
      selection: { agentId: "custom-agent", provider: "codex", model: "custom-model" },
    });

    assert.equal(result.preflight.ok, true);
    assert.equal(result.supports.mcp, "unknown");
    assert.equal(result.supports.tools, "unknown");
    assert.equal(result.supports.modelOverride, "unknown");
    assert.equal(result.supports.approval, "unknown");
    assert.equal(result.supports.fullAllow, "unknown");
    assert.equal(result.supports.contextUsage, "unknown");
    assert.equal(result.supports.nativeCompact, "unknown");
    assert.equal(result.supports.nativeResume, "unknown");
    assert.equal(result.supports.streaming, "unknown");
  });

  it("supports preflight-only and canonical-record APIs", () => {
    const input = { metadata: onlineMetadata(), selection: { model: "gpt-5-codex" } };
    const record = preflightProviderSelection(input);
    assert.equal(record.ok, true);
    assert.equal(record.preflight.status, "ready");
    assert.equal(preflightProviderCapabilities(input).ok, true);
  });

  it("treats the Task MCP adapter capability separately from provider MCP transport metadata", () => {
    const result = normalizeProviderCapabilities({
      metadata: onlineMetadata({
        supportsTaskMcp: true,
        handshake: { agent_capabilities: { mcpCapabilities: { stdio: false, http: false, sse: false } }, available_models: [{ id: "gpt-5-codex" }] },
      }),
      selection: { agentId: "codex", model: "gpt-5-codex", taskMcp: true },
    });
    assert.equal(result.supports.mcp, true);
    assert.equal(result.preflight.ok, true);
  });
});
