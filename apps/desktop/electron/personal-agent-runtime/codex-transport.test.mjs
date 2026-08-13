import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { __test__, preferCodexHttpsTransport } from "./codex-transport.mjs";

function codexHome(authMode, config = "") {
  const root = mkdtempSync(path.join(os.tmpdir(), "onmyagent-codex-transport-"));
  const home = path.join(root, ".codex");
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "auth.json"), JSON.stringify({ auth_mode: authMode, tokens: { secret: "not-read" } }));
  if (config) writeFileSync(path.join(home, "config.toml"), config);
  return { root, home };
}

test("managed Codex ACP uses an HTTPS-only provider for ChatGPT auth", () => {
  const fixture = codexHome("chatgpt");
  const result = preferCodexHttpsTransport({ HOME: fixture.root, PATH: "/bin" });
  const config = JSON.parse(result.CODEX_CONFIG);
  assert.equal(result.MODEL_PROVIDER, __test__.HTTPS_PROVIDER_ID);
  assert.equal(config.model_provider, __test__.HTTPS_PROVIDER_ID);
  assert.deepEqual(config.model_providers[__test__.HTTPS_PROVIDER_ID], {
    name: "OpenAI HTTPS",
    base_url: __test__.CHATGPT_CODEX_BASE_URL,
    wire_api: "responses",
    requires_openai_auth: true,
    supports_websockets: false,
  });
});

test("HTTPS transport overlay preserves existing safe Codex config", () => {
  const fixture = codexHome("api_key");
  const result = preferCodexHttpsTransport({
    CODEX_HOME: fixture.home,
    CODEX_CONFIG: JSON.stringify({ model: "gpt-test", features: { apps: true } }),
  });
  const config = JSON.parse(result.CODEX_CONFIG);
  assert.equal(config.model, "gpt-test");
  assert.deepEqual(config.features, { apps: true });
  assert.equal(config.model_providers[__test__.HTTPS_PROVIDER_ID].base_url, __test__.API_KEY_CODEX_BASE_URL);
});

test("explicit and configured custom Codex providers are never replaced", () => {
  const explicit = codexHome("chatgpt");
  const explicitEnvironment = { CODEX_HOME: explicit.home, MODEL_PROVIDER: "company-gateway" };
  assert.equal(preferCodexHttpsTransport(explicitEnvironment), explicitEnvironment);

  const configured = codexHome("chatgpt", 'model_provider = "codeproxy"\n');
  const configuredEnvironment = { CODEX_HOME: configured.home };
  assert.equal(preferCodexHttpsTransport(configuredEnvironment), configuredEnvironment);

  const overlay = codexHome("chatgpt");
  const overlayEnvironment = { CODEX_HOME: overlay.home, CODEX_CONFIG: JSON.stringify({ model_provider: "overlay" }) };
  assert.equal(preferCodexHttpsTransport(overlayEnvironment), overlayEnvironment);
});

test("unknown auth and malformed overlays remain unchanged", () => {
  const unknown = codexHome("enterprise_sso");
  const unknownEnvironment = { CODEX_HOME: unknown.home };
  assert.equal(preferCodexHttpsTransport(unknownEnvironment), unknownEnvironment);

  const malformed = codexHome("chatgpt");
  const malformedEnvironment = { CODEX_HOME: malformed.home, CODEX_CONFIG: "{secret" };
  assert.equal(preferCodexHttpsTransport(malformedEnvironment), malformedEnvironment);
});
