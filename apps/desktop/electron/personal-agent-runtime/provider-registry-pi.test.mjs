import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PERSONAL_LOCAL_AGENT_PROVIDERS,
  PERSONAL_LOCAL_AGENT_CAPABILITIES,
  defaultPersonalLocalAgents,
  isPersonalLocalAgentProvider,
  normalizePersonalLocalAgent,
  personalAgentCapability,
  personalLocalAgentConnectionMode,
} from "./provider-registry.mjs";

test("pi is a built-in personal local agent provider", () => {
  assert.equal(isPersonalLocalAgentProvider("pi"), true);
  const spec = PERSONAL_LOCAL_AGENT_PROVIDERS.pi;
  assert.equal(spec.id, "pi");
  assert.equal(spec.name, "Pi CLI");
  assert.equal(spec.executable, "pi");
  assert.deepEqual(spec.versionArgs, ["--version"]);
  assert.equal(spec.modelMode, "flag");
});

test("pi capabilities declare ACP bridge via pi-acp, no approval (first release)", () => {
  const cap = PERSONAL_LOCAL_AGENT_CAPABILITIES.pi;
  assert.equal(cap.supportsAcp, true);
  assert.equal(cap.supportsApproval, false);
  assert.equal(cap.supportsStreaming, true);
  assert.equal(cap.supportsResume, true);
  assert.equal(cap.supportsModelOverride, true);
  assert.equal(cap.supportsPermissionAutoApprove, true);
  assert.equal(cap.targetKind, "model");
  assert.match(cap.smokePrompt, /PI_LOCAL_AGENT_OK/);
  assert.match(cap.warning, /pi-acp/);
});

test("defaultPersonalLocalAgents includes pi", () => {
  const defaults = defaultPersonalLocalAgents();
  const pi = defaults.find((agent) => agent.id === "pi");
  assert.ok(pi, "pi should be in the built-in default list");
  assert.equal(pi.name, "Pi CLI");
  assert.equal(pi.provider, "pi");
  assert.equal(pi.executablePath, "pi");
});

test("normalizePersonalLocalAgent keeps pi provider identity", () => {
  const normalized = normalizePersonalLocalAgent({ id: "pi", name: "Pi CLI", provider: "pi", executablePath: "pi" });
  assert.equal(normalized.provider, "pi");
  assert.equal(normalized.id, "pi");
  assert.equal(normalized.executablePath, "pi");
});

test("personalAgentCapability('pi', 'online') surfaces installed + acp", () => {
  const cap = personalAgentCapability("pi", "online");
  assert.equal(cap.installed, true);
  assert.equal(cap.authenticated, "unknown");
  assert.equal(cap.supportsAcp, true);
  assert.equal(cap.supportsApproval, false);
  assert.equal(cap.targetKind, "model");
  assert.equal(cap.minVersionOk, true);
});

test("personalLocalAgentConnectionMode('pi') labels the ACP bridge", () => {
  assert.equal(personalLocalAgentConnectionMode("pi"), "Pi ACP session");
});

test("unknown providers still collapse to opencode defaults", () => {
  const normalized = normalizePersonalLocalAgent({ provider: "not-a-provider" });
  assert.equal(normalized.provider, "opencode");
});
