import { describe, expect, test } from "bun:test";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import {
  getConnectedProviderItems,
  getConnectedProviderSnapshot,
  isModelAvailableInConnectedProviders,
  providerListQueryKey,
} from "../src/react-app/domains/shared/provider-list-query";

describe("shared provider list query contract", () => {
  const providerList = {
    connected: ["opencode", "anthropic", "custom-empty", "custom-ready"],
    default: {},
    all: [
      {
        id: "anthropic",
        name: "Anthropic",
        source: "system",
        models: {
          "claude-sonnet": { id: "claude-sonnet", name: "Claude Sonnet" },
        },
      },
      {
        id: "custom-empty",
        name: "Custom Empty",
        source: "custom",
        models: {},
      },
      {
        id: "custom-ready",
        name: "Custom Ready",
        source: "custom",
        models: {
          "ready-model": { id: "ready-model", name: "Ready Model" },
        },
      },
      {
        id: "opencode",
        name: "OpenCode",
        source: "custom",
        models: {},
      },
      {
        id: "unconnected",
        name: "Unconnected",
        source: "system",
        models: {
          unused: { id: "unused", name: "Unused" },
        },
      },
    ],
  } satisfies ProviderListResponse;

  test("builds stable query keys from connection scope", () => {
    expect(providerListQueryKey({ baseUrl: " https://api.example.test ", directory: " /tmp/work " })).toEqual([
      "opencode-provider-list",
      "https://api.example.test",
      "/tmp/work",
    ]);
    expect(providerListQueryKey({ baseUrl: null, directory: undefined })).toEqual([
      "opencode-provider-list",
      "",
      "",
    ]);
  });

  test("filters connected providers while preserving usable custom providers", () => {
    expect(getConnectedProviderItems(providerList).map((provider) => provider.id)).toEqual([
      "anthropic",
      "custom-ready",
      "opencode",
    ]);
  });

  test("creates sorted snapshots and validates model availability", () => {
    expect(getConnectedProviderSnapshot(providerList).map((provider) => provider.id)).toEqual([
      "anthropic",
      "custom-ready",
      "opencode",
    ]);
    expect(
      isModelAvailableInConnectedProviders(providerList, {
        providerID: "anthropic",
        modelID: "claude-sonnet",
      }),
    ).toBe(true);
    expect(
      isModelAvailableInConnectedProviders(providerList, {
        providerID: "anthropic",
        modelID: "missing",
      }),
    ).toBe(false);
    expect(isModelAvailableInConnectedProviders(providerList, null)).toBe(true);
  });
});
