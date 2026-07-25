import { describe, expect, test } from "bun:test";

import {
  connectedProviderIdSet,
  countOpenCodeProviderModels,
  mergeConnectedProviders,
  normalizeMergedProviderSource,
} from "../src/react-app/domains/connections/merge-connected-providers";

describe("normalizeMergedProviderSource", () => {
  test("keeps known sources only", () => {
    expect(normalizeMergedProviderSource("env")).toBe("env");
    expect(normalizeMergedProviderSource("api")).toBe("api");
    expect(normalizeMergedProviderSource("config")).toBe("config");
    expect(normalizeMergedProviderSource("custom")).toBe("custom");
    expect(normalizeMergedProviderSource("other" as never)).toBeUndefined();
    expect(normalizeMergedProviderSource(undefined)).toBeUndefined();
  });
});

describe("countOpenCodeProviderModels", () => {
  test("uses models array when present", () => {
    expect(
      countOpenCodeProviderModels({
        models: [{ id: "a" }, { id: "b" }],
        settingsConfig: { models: { a: {}, only: {} } },
      }),
    ).toBe(2);
  });

  test("falls back to settingsConfig.models object keys", () => {
    expect(
      countOpenCodeProviderModels({
        models: [],
        settingsConfig: {
          models: {
            "qwen3.8-max-preview": { name: "qwen3.8-max-preview" },
            "glm-5.2": { name: "glm-5.2" },
          },
        },
      }),
    ).toBe(2);
  });

  test("returns 0 when empty", () => {
    expect(countOpenCodeProviderModels({})).toBe(0);
    expect(
      countOpenCodeProviderModels({ models: [], settingsConfig: {} }),
    ).toBe(0);
  });
});

describe("mergeConnectedProviders", () => {
  test("sdk-only connected rows", () => {
    const merged = mergeConnectedProviders({
      sdkProviders: [
        {
          id: "anthropic",
          name: "Anthropic",
          source: "api",
          models: { "claude-sonnet": { name: "Sonnet" } as never },
        },
        {
          id: "ignored",
          name: "Ignored",
          source: "api",
          models: { m: { name: "m" } as never },
        },
      ],
      connectedIds: ["anthropic"],
    });
    expect(merged).toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        source: "api",
        modelCount: 1,
      },
    ]);
  });

  test("managed-only livePresent rows", () => {
    const merged = mergeConnectedProviders({
      sdkProviders: [],
      connectedIds: [],
      managedProviders: [
        {
          id: "my-proxy",
          name: "My Proxy",
          livePresent: true,
          models: [{ id: "m1" }, { id: "m2" }],
          settingsConfig: {},
        },
        {
          id: "stale",
          name: "Stale",
          livePresent: false,
          models: [{ id: "x" }],
          settingsConfig: {},
        },
      ],
    });
    expect(merged).toEqual([
      {
        id: "my-proxy",
        name: "My Proxy",
        source: "custom",
        managedBy: "opencode",
        modelCount: 2,
      },
    ]);
  });

  test("same id: managed overwrites with managedBy opencode", () => {
    const merged = mergeConnectedProviders({
      sdkProviders: [
        {
          id: "my-proxy",
          name: "From SDK",
          source: "config",
          models: { a: { name: "a" } as never },
        },
      ],
      connectedIds: ["my-proxy"],
      managedProviders: [
        {
          id: "my-proxy",
          name: "From Inventory",
          livePresent: true,
          models: [],
          settingsConfig: { models: { a: {}, b: {} } },
        },
      ],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      id: "my-proxy",
      name: "From Inventory",
      source: "custom",
      managedBy: "opencode",
      modelCount: 2,
    });
  });

  test("isBlocked drops both sdk and managed", () => {
    const merged = mergeConnectedProviders({
      sdkProviders: [
        {
          id: "opencode",
          name: "Zen",
          source: "api",
          models: { free: { name: "free" } as never },
        },
      ],
      connectedIds: ["opencode"],
      managedProviders: [
        {
          id: "blocked-custom",
          name: "Blocked",
          livePresent: true,
          models: [{ id: "m" }],
          settingsConfig: {},
        },
      ],
      isBlocked: (id) => id === "opencode" || id === "blocked-custom",
    });
    expect(merged).toEqual([]);
  });

  test("omits modelCount when zero / unknown", () => {
    const merged = mergeConnectedProviders({
      sdkProviders: [
        {
          id: "empty",
          name: "Empty",
          source: "api",
          models: {},
        },
      ],
      connectedIds: ["empty"],
    });
    expect(merged[0]?.modelCount).toBeUndefined();
    expect(merged[0]).toEqual({
      id: "empty",
      name: "Empty",
      source: "api",
    });
  });

  test("connectedProviderIdSet is stable for dual-path checks", () => {
    const settingsSide = mergeConnectedProviders({
      sdkProviders: [
        {
          id: "a",
          name: "A",
          source: "api",
          models: { m: { name: "m" } as never },
        },
      ],
      connectedIds: ["a"],
      managedProviders: [
        {
          id: "b",
          name: "B",
          livePresent: true,
          models: [{ id: "x" }],
          settingsConfig: {},
        },
      ],
    });
    const sessionIds = connectedProviderIdSet(settingsSide);
    expect([...sessionIds].sort()).toEqual(["a", "b"]);
  });
});
