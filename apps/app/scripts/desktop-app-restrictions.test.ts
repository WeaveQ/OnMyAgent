import { describe, expect, test } from "bun:test";

import {
  DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID,
  isDesktopProviderBlocked,
} from "../src/app/cloud/desktop-app-restrictions";
import { isProviderModelFree } from "../src/app/utils/providers";

describe("isDesktopProviderBlocked", () => {
  test("allows OpenCode Zen when allowZenModel is not restricted", () => {
    expect(
      isDesktopProviderBlocked({
        providerId: DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID,
        checkRestriction: () => false,
      }),
    ).toBe(false);
    expect(
      isDesktopProviderBlocked({
        providerId: "opencode",
        checkRestriction: ({ restriction }) => restriction === "allowCustomProviders",
      }),
    ).toBe(false);
  });

  test("blocks OpenCode Zen when allowZenModel is restricted", () => {
    expect(
      isDesktopProviderBlocked({
        providerId: "opencode",
        checkRestriction: ({ restriction }) => restriction === "allowZenModel",
      }),
    ).toBe(true);
  });

  test("still blocks catalog noise providers regardless of Zen policy", () => {
    expect(
      isDesktopProviderBlocked({
        providerId: "anthropic",
        checkRestriction: () => false,
      }),
    ).toBe(true);
    expect(
      isDesktopProviderBlocked({
        providerId: "google",
        checkRestriction: () => false,
      }),
    ).toBe(true);
  });
});

describe("isProviderModelFree", () => {
  test("marks name/id with free as free", () => {
    expect(
      isProviderModelFree({
        providerId: "opencode",
        modelId: "deepseek-v4-flash-free",
        model: { name: "DeepSeek V4 Flash Free", cost: { input: 0, output: 0 } },
      }),
    ).toBe(true);
    expect(
      isProviderModelFree({
        providerId: "any",
        modelId: "foo-free",
        model: { name: "Foo Free" },
      }),
    ).toBe(true);
  });

  test("marks zero-cost OpenCode Zen models as free", () => {
    expect(
      isProviderModelFree({
        providerId: "opencode",
        modelId: "big-pickle",
        model: { name: "Big Pickle", cost: { input: 0, output: 0 } },
      }),
    ).toBe(true);
  });

  test("does not mark paid or unknown cost non-Zen models as free", () => {
    expect(
      isProviderModelFree({
        providerId: "opencode",
        modelId: "paid",
        model: { name: "Paid", cost: { input: 1, output: 2 } },
      }),
    ).toBe(false);
    expect(
      isProviderModelFree({
        providerId: "qwen",
        modelId: "qwen3.7-max",
        model: { name: "qwen3.7-max", cost: { input: 0, output: 0 } },
      }),
    ).toBe(false);
  });
});
