import { describe, expect, test } from "bun:test";

import {
  DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID,
  isDesktopProviderBlocked,
} from "../src/app/cloud/desktop-app-restrictions";
import { isProviderModelFree, modelSupportsVision } from "../src/app/utils/providers";

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

describe("modelSupportsVision", () => {
  test("requires an explicit image/vision input modality", () => {
    expect(
      modelSupportsVision({
        attachment: true,
        modalities: { input: ["text", "image", "audio", "video"] },
      }),
    ).toBe(true);
    expect(
      modelSupportsVision({
        modalities: { input: ["text", "VISION"] },
      }),
    ).toBe(true);
    expect(
      modelSupportsVision({
        attachment: true,
        modalities: { input: ["text"] },
      }),
    ).toBe(false);
    expect(modelSupportsVision({ attachment: true })).toBe(false);
    expect(modelSupportsVision({ name: "MiMo V2.5 Free" } as never)).toBe(false);
    expect(modelSupportsVision(null)).toBe(false);
  });

  test("falls back to known vision model ids when modalities are omitted", () => {
    expect(modelSupportsVision({}, "mimo-v2.5-free")).toBe(true);
    expect(modelSupportsVision({ id: "opencode/kimi-k2.5" })).toBe(true);
    expect(modelSupportsVision({}, "qwen3.8-max")).toBe(true);
    expect(modelSupportsVision({}, "qwen3.8-max-preview")).toBe(true);
    expect(modelSupportsVision({}, "qwen3-8-max")).toBe(true);
    expect(modelSupportsVision({}, "qwen3.7-plus")).toBe(true);
    expect(modelSupportsVision({}, "qwen3.7-flash")).toBe(true);
    expect(modelSupportsVision({}, "qwen3.6-plus-free")).toBe(true);
    expect(modelSupportsVision({}, "doubao-seed-1.8")).toBe(true);
    expect(modelSupportsVision({}, "doubao-seed-1-8-251215")).toBe(true);
    expect(modelSupportsVision({}, "doubao-seed-evolving")).toBe(true);
    expect(modelSupportsVision({}, "doubao-seed-2.0-pro")).toBe(true);
    expect(modelSupportsVision({}, "kimi-k2.5-free")).toBe(true);
    expect(modelSupportsVision({}, "deepseek-v4-flash-free")).toBe(false);
    expect(modelSupportsVision({}, "big-pickle")).toBe(false);
    expect(modelSupportsVision({}, "qwen3.7-max")).toBe(false);
    expect(modelSupportsVision({}, "qwen3-max")).toBe(false);
    expect(modelSupportsVision({}, "qwen3.8-2.4t-a95b")).toBe(false);
    expect(modelSupportsVision({}, "seed-oss-36b-instruct")).toBe(false);
    expect(modelSupportsVision({}, "gpt-5-codex")).toBe(false);
    expect(modelSupportsVision({}, "kimi-k2.7-code")).toBe(false);
    expect(modelSupportsVision({}, "doubao-seed-2.0-code")).toBe(false);
  });
});
