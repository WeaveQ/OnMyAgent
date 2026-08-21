import { describe, expect, it } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canonicalizeSettingsJsonApiKey,
  displaySettingsJsonWithApiKeyVisibility,
  maskSecretMiddle,
  parseDraftFromSettingsJson,
  stringifySettingsFromDraft,
  syncProviderDraftSettingsJson,
} from "../src/react-app/domains/local-agents/agent-management/provider-draft-settings-json";

const TEST_API_KEY = "ark-test-abcdef1234567890xyz";

const ollamaDraft = {
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  apiKey: "",
  modelRows: [
    {
      id: "ornith-1.5:9b",
      name: "ornith-1.5:9b",
      contextWindow: "",
      outputTokenLimit: "",
    },
    {
      id: "qwen3.8:27b-n",
      name: "qwen3.8:27b-mlx",
      contextWindow: "",
      outputTokenLimit: "",
    },
  ],
  settingsJson: "",
};

describe("provider draft settings JSON", () => {
  it("builds OpenCode JSON from form fields", () => {
    const json = stringifySettingsFromDraft("opencode", ollamaDraft);
    const parsed = JSON.parse(json) as {
      npm: string;
      name: string;
      options: { baseURL: string; apiKey: string };
      models: Record<string, { name: string }>;
    };
    expect(parsed.npm).toBe("@ai-sdk/openai-compatible");
    expect(parsed.name).toBe("Ollama");
    expect(parsed.options.baseURL).toBe("http://localhost:11434");
    expect(parsed.options.apiKey).toBe("");
    expect(parsed.models["ornith-1.5:9b"]?.name).toBe("ornith-1.5:9b");
    expect(parsed.models["qwen3.8:27b-n"]?.name).toBe("qwen3.8:27b-mlx");
  });

  it("fills the form from valid OpenCode JSON", () => {
    const json = stringifySettingsFromDraft("opencode", ollamaDraft);
    const fields = parseDraftFromSettingsJson("opencode", json);
    expect(fields).toMatchObject({
      name: "Ollama",
      baseUrl: "http://localhost:11434",
      apiKey: "",
    });
    expect(fields?.modelRows.map((row) => row.id)).toEqual([
      "ornith-1.5:9b",
      "qwen3.8:27b-n",
    ]);
  });

  it("keeps the JSON string while typing invalid JSON and does not wipe the form", () => {
    const current = syncProviderDraftSettingsJson("opencode", ollamaDraft, {}, "form");
    const next = syncProviderDraftSettingsJson(
      "opencode",
      current,
      { settingsJson: "{ \"options\": { \"baseURL\": " },
      "json",
    );
    expect(next.baseUrl).toBe("http://localhost:11434");
    expect(next.settingsJson).toContain("baseURL");
  });

  it("round-trips form → JSON → form for Ollama-shaped OpenCode config", () => {
    const afterForm = syncProviderDraftSettingsJson(
      "opencode",
      { ...ollamaDraft, settingsJson: "" },
      { baseUrl: "http://localhost:11434", name: "Ollama" },
      "form",
    );
    expect(afterForm.settingsJson).toContain("http://localhost:11434");
    const afterJson = syncProviderDraftSettingsJson(
      "opencode",
      afterForm,
      {
        settingsJson: JSON.stringify(
          {
            npm: "@ai-sdk/openai-compatible",
            name: "Ollama local",
            options: { baseURL: "http://127.0.0.1:11434", apiKey: "x" },
            models: { "llama3.1": { name: "Llama 3.1" } },
          },
          null,
          2,
        ),
      },
      "json",
    );
    expect(afterJson.name).toBe("Ollama local");
    expect(afterJson.baseUrl).toBe("http://127.0.0.1:11434");
    expect(afterJson.apiKey).toBe("x");
    expect(afterJson.modelRows).toEqual([
      { id: "llama3.1", name: "Llama 3.1", contextWindow: "", outputTokenLimit: "" },
    ]);
  });

  it("reads OpenCode limit.context and keeps extra model keys on form rewrite", () => {
    const json = JSON.stringify(
      {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama",
        options: { baseURL: "http://localhost:11434/v1", apiKey: "" },
        models: {
          "ornith-1.5:9b": {
            name: "ornith-1.5:9b",
            attachment: true,
            modalities: { input: ["text"], output: ["text"] },
            limit: { context: 128000, output: 8192 },
          },
        },
      },
      null,
      2,
    );
    const fields = parseDraftFromSettingsJson("opencode", json);
    expect(fields?.modelRows[0]).toMatchObject({
      id: "ornith-1.5:9b",
      contextWindow: "128000",
      outputTokenLimit: "8192",
    });
    const rewritten = stringifySettingsFromDraft("opencode", {
      name: fields?.name ?? "",
      baseUrl: fields?.baseUrl ?? "",
      apiKey: fields?.apiKey ?? "",
      modelRows: fields?.modelRows ?? [],
      settingsJson: json,
    });
    const parsed = JSON.parse(rewritten) as {
      models: Record<string, { attachment?: boolean; limit?: { context: number; output: number } }>;
    };
    expect(parsed.models["ornith-1.5:9b"]?.limit).toEqual({ context: 128000, output: 8192 });
    expect(parsed.models["ornith-1.5:9b"]?.attachment).toBe(true);
  });

  it("masks the middle of the API key and keeps the same length", () => {
    expect(maskSecretMiddle("ab")).toBe("**");
    expect(maskSecretMiddle("abcdef")).toBe("a****f");
    expect(maskSecretMiddle(TEST_API_KEY)).toBe(
      `${TEST_API_KEY.slice(0, 4)}${"*".repeat(TEST_API_KEY.length - 8)}${TEST_API_KEY.slice(-4)}`,
    );
    expect(maskSecretMiddle(TEST_API_KEY)).toHaveLength(TEST_API_KEY.length);
    expect(maskSecretMiddle(TEST_API_KEY)).not.toBe(TEST_API_KEY);
  });

  it("hides the stored key in JSON until revealed, then shows it in full", () => {
    const afterForm = syncProviderDraftSettingsJson(
      "opencode",
      { ...ollamaDraft, settingsJson: "" },
      { apiKey: TEST_API_KEY },
      "form",
    );
    const hidden = displaySettingsJsonWithApiKeyVisibility(
      afterForm.settingsJson,
      TEST_API_KEY,
      false,
    );
    const shown = displaySettingsJsonWithApiKeyVisibility(
      afterForm.settingsJson,
      TEST_API_KEY,
      true,
    );
    expect(afterForm.settingsJson).toContain(TEST_API_KEY);
    expect(hidden).not.toContain(TEST_API_KEY);
    expect(hidden).toContain(maskSecretMiddle(TEST_API_KEY));
    expect(shown).toContain(TEST_API_KEY);
    expect(shown).toBe(afterForm.settingsJson);
  });

  it("does not write a masked JSON key back into the form", () => {
    const afterForm = syncProviderDraftSettingsJson(
      "opencode",
      { ...ollamaDraft, settingsJson: "" },
      { apiKey: TEST_API_KEY, baseUrl: "https://ark.example/v1" },
      "form",
    );
    const hidden = displaySettingsJsonWithApiKeyVisibility(
      afterForm.settingsJson,
      TEST_API_KEY,
      false,
    );
    const afterJson = syncProviderDraftSettingsJson(
      "opencode",
      afterForm,
      {
        settingsJson: hidden.replace(
          "https://ark.example/v1",
          "https://ark.example/api/plan/v3",
        ),
      },
      "json",
    );
    expect(afterJson.apiKey).toBe(TEST_API_KEY);
    expect(afterJson.settingsJson).toContain(TEST_API_KEY);
    expect(afterJson.settingsJson).not.toContain(maskSecretMiddle(TEST_API_KEY));
    expect(afterJson.baseUrl).toBe("https://ark.example/api/plan/v3");
    expect(canonicalizeSettingsJsonApiKey(hidden, TEST_API_KEY)).toContain(TEST_API_KEY);
  });

  it("keeps a newly typed JSON key when it is not the current mask", () => {
    const afterForm = syncProviderDraftSettingsJson(
      "opencode",
      { ...ollamaDraft, settingsJson: "" },
      { apiKey: TEST_API_KEY },
      "form",
    );
    const hidden = displaySettingsJsonWithApiKeyVisibility(
      afterForm.settingsJson,
      TEST_API_KEY,
      false,
    );
    const nextKey = "sk-new-provider-key-000111";
    const edited = hidden.replace(JSON.stringify(maskSecretMiddle(TEST_API_KEY)), JSON.stringify(nextKey));
    const afterJson = syncProviderDraftSettingsJson(
      "opencode",
      afterForm,
      { settingsJson: edited },
      "json",
    );
    expect(afterJson.apiKey).toBe(nextKey);
    expect(afterJson.settingsJson).toContain(nextKey);
    expect(afterJson.settingsJson).not.toContain(TEST_API_KEY);
  });
});

describe("provider modal API key reveal wiring", () => {
  it("toggles the input and JSON from one revealed flag", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/local-agents/agent-management/agent-management-providers.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("apiKeyRevealed");
    expect(source).toContain("setApiKeyRevealed");
    expect(source).toContain('type={apiKeyRevealed ? "text" : "password"}');
    expect(source).toContain("displaySettingsJsonWithApiKeyVisibility(");
    expect(source).toContain("apiKeyRevealed,");
    expect(source).toContain("<Eye");
    expect(source).toContain("<EyeOff");
  });
});
