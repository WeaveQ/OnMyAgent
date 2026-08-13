import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentManagementProviders } from "./agent-management-providers.mjs";

test("probes a single model via chat/completions", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method, body: init?.body });
    if (String(url).endsWith("/v1/chat/completions") && init?.method === "POST") {
      return new Response(JSON.stringify({
        id: "chatcmpl-test",
        choices: [{ message: { role: "assistant", content: "ok" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };

  const providers = createAgentManagementProviders({ getRealHomeDir: () => os.tmpdir() });
  const result = await providers.agentManagementTestModel({
    appType: "opencode",
    baseUrl: "https://example.test/v1",
    apiKey: "sk-test",
    modelId: "glm-5.2",
  });

  assert.equal(result.ok, true);
  assert.equal(result.modelId, "glm-5.2");
  assert.ok(result.elapsedMs >= 0);
  assert.ok(
    seen.some((item) => item.url.endsWith("/v1/chat/completions")),
    `expected chat/completions call, got: ${seen.map((s) => s.url).join(", ")}`,
  );
  const body = JSON.parse(seen.find((s) => s.url.endsWith("/chat/completions"))?.body ?? "{}");
  assert.equal(body.model, "glm-5.2");
  assert.equal(body.max_tokens, 1);
});

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

test("re-edit form save without settingsConfig rewrites models from simple", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "onmyagent-provider-form-save-"));
  try {
    const providers = createAgentManagementProviders({ getRealHomeDir: () => home });
    await providers.agentManagementProviderAction({
      action: "save",
      appType: "opencode",
      syncLive: true,
      provider: {
        id: "qwen",
        name: "Qwen",
        simple: {
          id: "qwen",
          name: "Qwen",
          baseUrl: "https://api.example.test/v1",
          apiKey: "sk-1",
          models: "model-a",
        },
      },
    });

    // Re-save like the settings dialog: only simple fields (no stale settingsJson).
    const result = await providers.agentManagementProviderAction({
      action: "save",
      appType: "opencode",
      syncLive: true,
      setDefault: false,
      provider: {
        id: "qwen",
        name: "千问 TokenPlan",
        simple: {
          id: "qwen",
          name: "千问 TokenPlan",
          baseUrl: "https://api.example.test/v1",
          apiKey: "sk-1",
          models: "model-a\nmodel-b\nglm-5.2",
        },
      },
    });

    const config = JSON.parse(await readFile(
      path.join(home, ".config", "opencode", "opencode.json"),
      "utf8",
    ));
    assert.deepEqual(Object.keys(config.provider.qwen.models).sort(), [
      "glm-5.2",
      "model-a",
      "model-b",
    ]);

    // Save response inventory must already list the expanded models (settings
    // UI uses this to refresh before the user opens Edit again).
    const fromSave = result.providers.byAgent.opencode.find((item) => item.id === "qwen");
    assert.ok(fromSave);
    assert.deepEqual(fromSave.models.map((m) => m.id).sort(), [
      "glm-5.2",
      "model-a",
      "model-b",
    ]);

    const snapshot = await providers.readAgentManagementProvidersSnapshot();
    const listed = snapshot.byAgent.opencode.find((item) => item.id === "qwen");
    assert.ok(listed);
    assert.deepEqual(listed.models.map((m) => m.id).sort(), [
      "glm-5.2",
      "model-a",
      "model-b",
    ]);
    // Live settingsConfig must match so re-edit prefill can rebuild model rows.
    assert.deepEqual(Object.keys(listed.settingsConfig.models ?? {}).sort(), [
      "glm-5.2",
      "model-a",
      "model-b",
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("snapshot prefers live opencode.json models over stale DB catalog", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "onmyagent-provider-live-prefer-"));
  try {
    const providers = createAgentManagementProviders({ getRealHomeDir: () => home });
    await providers.agentManagementProviderAction({
      action: "save",
      appType: "opencode",
      syncLive: true,
      provider: {
        id: "qwen",
        name: "Qwen",
        simple: {
          id: "qwen",
          name: "Qwen",
          baseUrl: "https://api.example.test/v1",
          apiKey: "sk-1",
          models: "model-a",
        },
      },
    });

    // Live file advanced ahead of DB (simulates successful write + lagging inventory).
    const configPath = path.join(home, ".config", "opencode", "opencode.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.provider.qwen.models = {
      "model-a": { name: "model-a" },
      "model-b": { name: "model-b" },
      "glm-5.2": { name: "glm-5.2" },
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const snapshot = await providers.readAgentManagementProvidersSnapshot();
    const listed = snapshot.byAgent.opencode.find((item) => item.id === "qwen");
    assert.ok(listed);
    assert.deepEqual(listed.models.map((m) => m.id).sort(), [
      "glm-5.2",
      "model-a",
      "model-b",
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("re-edit merges form fields into existing OpenCode settingsConfig", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "onmyagent-provider-reedit-"));
  try {
    const providers = createAgentManagementProviders({ getRealHomeDir: () => home });
    await providers.agentManagementProviderAction({
      action: "save",
      appType: "opencode",
      syncLive: true,
      setDefault: true,
      provider: {
        id: "custom1",
        name: "Custom 1",
        simple: {
          id: "custom1",
          name: "Custom 1",
          baseUrl: "https://api.example.test/v1",
          apiKey: "sk-old",
          models: "model-a",
        },
      },
    });

    const result = await providers.agentManagementProviderAction({
      action: "save",
      appType: "opencode",
      syncLive: true,
      setDefault: false,
      provider: {
        id: "custom1",
        name: "Custom 1 Updated",
        // Stale advanced JSON from first save (as the edit form would send).
        settingsConfig: JSON.stringify({
          npm: "@ai-sdk/openai-compatible",
          name: "Custom 1",
          options: { baseURL: "https://api.example.test/v1", apiKey: "sk-old", timeout: 600000 },
          models: { "model-a": { name: "model-a" } },
        }),
        simple: {
          id: "custom1",
          name: "Custom 1 Updated",
          baseUrl: "https://api.example.test/v2",
          apiKey: "sk-new",
          models: "model-b",
        },
      },
    });

    assert.equal(result.defaultModel, null);
    assert.equal(result.defaultModelId, "model-b");

    const config = JSON.parse(await readFile(
      path.join(home, ".config", "opencode", "opencode.json"),
      "utf8",
    ));
    assert.equal(config.provider.custom1.name, "Custom 1 Updated");
    assert.equal(config.provider.custom1.options.baseURL, "https://api.example.test/v2");
    assert.equal(config.provider.custom1.options.apiKey, "sk-new");
    assert.ok(config.provider.custom1.models["model-b"]);
    assert.equal(config.provider.custom1.models["model-a"], undefined);

    const snapshot = await providers.readAgentManagementProvidersSnapshot();
    const listed = snapshot.byAgent.opencode.find((item) => item.id === "custom1");
    assert.ok(listed);
    assert.equal(listed.name, "Custom 1 Updated");
    assert.equal(listed.settingsConfig.options.apiKey, "sk-new");
    assert.equal(listed.settingsConfig.options.baseURL, "https://api.example.test/v2");
    assert.deepEqual(listed.models.map((model) => model.id), ["model-b"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("pi: save writes provider into models-store.json and snapshot lists it", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "onmyagent-provider-pi-"));
  try {
    const providers = createAgentManagementProviders({ getRealHomeDir: () => home });
    await providers.agentManagementProviderAction({
      action: "save",
      appType: "pi",
      syncLive: true,
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        simple: {
          id: "deepseek",
          name: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          apiKey: "sk-test",
          models: "deepseek-v4-flash\ndeepseek-v4-pro",
        },
      },
    });

    const store = JSON.parse(await readFile(
      path.join(home, ".pi", "agent", "models-store.json"),
      "utf8",
    ));
    assert.ok(store.deepseek, "pi models-store should contain provider key");
    assert.equal(store.deepseek.models.length, 2);
    assert.equal(store.deepseek.models[0].id, "deepseek-v4-flash");
    assert.equal(store.deepseek.models[0].baseUrl, "https://api.deepseek.com");
    assert.equal(store.deepseek.models[0].provider, "deepseek");

    const snapshot = await providers.readAgentManagementProvidersSnapshot();
    const listed = snapshot.byAgent.pi.find((item) => item.id === "deepseek");
    assert.ok(listed, "pi provider should appear in snapshot byAgent.pi");
    assert.equal(listed.livePresent, true);
    assert.deepEqual(listed.models.map((model) => model.id), ["deepseek-v4-flash", "deepseek-v4-pro"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("pi: importLive surfaces existing models-store providers", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "onmyagent-provider-pi-import-"));
  try {
    const storePath = path.join(home, ".pi", "agent", "models-store.json");
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify({
      deepseek: {
        models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", baseUrl: "https://api.deepseek.com", provider: "deepseek" }],
      },
    }, null, 2), "utf8");

    const providers = createAgentManagementProviders({ getRealHomeDir: () => home });
    const snapshot = await providers.readAgentManagementProvidersSnapshot();
    const listed = snapshot.byAgent.pi.find((item) => item.id === "deepseek");
    assert.ok(listed);
    assert.equal(listed.livePresent, true);
    assert.equal(listed.models[0].id, "deepseek-v4-flash");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("pi: delete removes provider from models-store.json", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "onmyagent-provider-pi-del-"));
  try {
    const storePath = path.join(home, ".pi", "agent", "models-store.json");
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify({
      deepseek: { models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", baseUrl: "https://api.deepseek.com", provider: "deepseek" }] },
      qwen: { models: [{ id: "qwen-max", name: "Qwen Max", baseUrl: "https://api.example.test/v1", provider: "qwen" }] },
    }, null, 2), "utf8");

    const providers = createAgentManagementProviders({ getRealHomeDir: () => home });
    await providers.agentManagementProviderAction({
      action: "delete",
      appType: "pi",
      providerId: "deepseek",
    });

    const store = JSON.parse(await readFile(storePath, "utf8"));
    assert.equal(store.deepseek, undefined);
    assert.ok(store.qwen);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
