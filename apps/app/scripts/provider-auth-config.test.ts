import { describe, expect, test } from "bun:test";

import {
  buildCloudProviderMethod,
  cloudProviderComment,
  describeProviderError,
  formatConfigWithCloudProvider,
  formatConfigWithProviderDisabledState,
  formatConfigWithoutCloudProvider,
  getCloudManagedProviderId,
  getProviderModelIds,
  getStringList,
  removeCloudProviderComment,
  sameStringList,
  sortStrings,
} from "../src/react-app/domains/connections/provider-auth/provider-auth-config";
import type {
  DenOrgLlmProvider,
  DenOrgLlmProviderConnection,
} from "../src/app/lib/den";

function cloudProvider(
  overrides: Partial<DenOrgLlmProvider> = {},
): DenOrgLlmProvider {
  return {
    id: "lpr_abc",
    providerId: "openai",
    name: "Org OpenAI",
    source: "custom",
    hasApiKey: true,
    createdAt: null,
    updatedAt: null,
    models: [
      { id: "gpt-4o", name: "GPT-4o", config: {}, createdAt: null },
    ],
    providerConfig: { env: ["OPENAI_API_KEY"] },
    ...overrides,
  };
}

describe("provider-auth-config (shipped)", () => {
  test("getStringList filters empty strings", () => {
    expect(getStringList(["a", "", " b ", 1, null])).toEqual(["a", " b "]);
    expect(getStringList(undefined)).toEqual([]);
  });

  test("sortStrings and sameStringList", () => {
    expect(sortStrings(["b", "a"])).toEqual(["a", "b"]);
    expect(sameStringList(["a"], ["a"])).toBe(true);
    expect(sameStringList(["a"], ["b"])).toBe(false);
  });

  test("getCloudManagedProviderId maps onmyagent source", () => {
    expect(
      getCloudManagedProviderId({
        id: "lpr_x",
        providerId: "openai",
        source: "onmyagent",
      }),
    ).toBe("onmyagent");
    expect(
      getCloudManagedProviderId({
        id: "lpr_x",
        providerId: "openai",
        source: "custom",
      }),
    ).toBe("lpr_x");
  });

  test("buildCloudProviderMethod labels org provider", () => {
    const method = buildCloudProviderMethod(cloudProvider());
    expect(method.type).toBe("cloud");
    expect(method.cloudProviderId).toBe("lpr_abc");
    expect(method.modelCount).toBe(1);
    expect(method.env).toEqual(["OPENAI_API_KEY"]);
  });

  test("getProviderModelIds sorts trimmed ids", () => {
    expect(
      getProviderModelIds({
        models: [
          { id: " b ", name: "B", config: {}, createdAt: null },
          { id: "a", name: "A", config: {}, createdAt: null },
          { id: "  ", name: "empty", config: {}, createdAt: null },
        ],
      }),
    ).toEqual(["a", "b"]);
  });

  test("formatConfigWithProviderDisabledState toggles disabled_providers", () => {
    const base = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
    const disabled = formatConfigWithProviderDisabledState(base, "openai", true);
    expect(disabled).toContain("disabled_providers");
    expect(disabled).toContain("openai");
    const reenabled = formatConfigWithProviderDisabledState(disabled, "openai", false);
    expect(reenabled).not.toContain('"openai"');
  });

  test("cloud comment helpers and format cloud provider config", () => {
    const provider: DenOrgLlmProviderConnection = {
      ...cloudProvider(),
      apiKey: "sk-test",
    };
    const comment = cloudProviderComment(provider);
    expect(comment).toContain("OnMyAgent Cloud import");
    expect(comment).toContain("lpr_abc");

    const withProvider = formatConfigWithCloudProvider(
      '{\n  "$schema": "https://opencode.ai/config.json",\n  "disabled_providers": ["lpr_abc", "other"]\n}\n',
      provider,
      "lpr_abc",
      null,
      ["lpr_abc", "other"],
    );
    expect(withProvider).toContain("lpr_abc");
    expect(withProvider).toContain("OnMyAgent Cloud import");
    // disabled list drops the cloud-managed id but keeps other entries
    expect(withProvider).toContain("other");
    expect(withProvider).not.toMatch(/"disabled_providers"\s*:\s*\[[^\]]*"lpr_abc"/);

    const stripped = formatConfigWithoutCloudProvider(withProvider, "lpr_abc", [
      "other",
    ]);
    expect(removeCloudProviderComment(stripped, "lpr_abc")).not.toContain(
      "OnMyAgent Cloud import: Org OpenAI",
    );
  });

  test("describeProviderError surfaces status and provider", () => {
    const message = describeProviderError(
      {
        statusCode: 401,
        providerID: "openai",
        message: "bad key",
      },
      "fallback",
    );
    expect(message.toLowerCase()).toMatch(/auth|fail|openai|bad key/);
    expect(message).toContain("openai");
  });
});
