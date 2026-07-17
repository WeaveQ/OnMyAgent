import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentManagementProviders } from "./agent-management-providers.mjs";

test("preserves provider-advertised output token limits when fetching models", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{
      id: "glm-5.2",
      name: "GLM-5.2",
      context_window: 200_000,
      max_output_tokens: 131_072,
    }],
  }), { status: 200, headers: { "content-type": "application/json" } });

  const providers = createAgentManagementProviders({ getRealHomeDir: () => os.tmpdir() });
  const result = await providers.agentManagementFetchModels({
    appType: "opencode",
    baseUrl: "https://example.test/v1",
  });

  assert.deepEqual(result.models, [{
    id: "glm-5.2",
    name: "GLM-5.2",
    contextWindow: 200_000,
    outputTokenLimit: 131_072,
  }]);
});

test("falls back to Volcengine Ark /api/plan/v1/models for agent plan baseUrl", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const seenUrls = [];
  globalThis.fetch = async (url) => {
    seenUrls.push(String(url));
    // `/api/plan/v3/models` -> 404 (plan v3 path has no models sub-resource)
    if (String(url).includes("/api/plan/v3/models")) {
      return new Response("not found", { status: 404 });
    }
    // `/api/plan/v1/models` -> 200 with the real Ark agent-plan model list
    if (String(url).endsWith("/api/plan/v1/models")) {
      return new Response(JSON.stringify({
        data: [{ id: "doubao-pro", name: "Doubao Pro" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };

  const providers = createAgentManagementProviders({ getRealHomeDir: () => os.tmpdir() });
  const result = await providers.agentManagementFetchModels({
    appType: "opencode",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
  });

  assert.ok(seenUrls.some((u) => u.endsWith("/api/plan/v1/models")),
    `expected candidate list to include /api/plan/v1/models, got: ${seenUrls.join(", ")}`);
  assert.deepEqual(result.models, [{ id: "doubao-pro", name: "Doubao Pro" }]);
});

test("writes explicit model capabilities into OpenCode provider config", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "onmyagent-provider-"));
  try {
    const providers = createAgentManagementProviders({ getRealHomeDir: () => home });
    await providers.agentManagementProviderAction({
      action: "save",
      appType: "opencode",
      syncLive: true,
      provider: {
        id: "zai",
        name: "Z.AI",
        simple: {
          id: "zai",
          name: "Z.AI",
          baseUrl: "https://api.example.test/v1",
          models: "glm-5.2",
          modelCapabilities: [{
            id: "glm-5.2",
            contextWindow: 200_000,
            outputTokenLimit: 131_072,
          }],
        },
      },
    });

    const config = JSON.parse(await readFile(
      path.join(home, ".config", "opencode", "opencode.json"),
      "utf8",
    ));
    assert.deepEqual(config.provider.zai.models["glm-5.2"].limit, {
      context: 200_000,
      output: 131_072,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
