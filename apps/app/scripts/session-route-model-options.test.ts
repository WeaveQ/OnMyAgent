import { describe, expect, test } from "bun:test";

import {
  buildConnectedModelOptions,
  buildProviderModelCatalog,
  filterAllowedModelOptions,
  isSelectedModelUnavailable,
  readSeenProviderIds,
  resolveModelVariantState,
  resolveProviderDefaultModel,
} from "../src/react-app/shell/session-route-model-options";
import type { ModelOption } from "../src/app/types";

function providerListData() {
  return {
    all: [
      {
        id: "openai",
        name: "OpenAI",
        disabled: false,
        models: {
          "gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
          mini: { id: "mini", name: "" },
        },
      },
      {
        id: "lpr_org",
        name: "Org Provider",
        disabled: false,
        models: {
          org: { id: "org", name: "Org Model" },
        },
      },
      {
        id: "disabled",
        name: "Disabled",
        disabled: true,
        models: {
          off: { id: "off", name: "Off" },
        },
      },
    ],
    connected: ["openai", "lpr_org"],
    default: { openai: "gpt-4o" },
  };
}

function option(input: Partial<ModelOption> & { providerID: string; modelID: string }): ModelOption {
  return {
    providerID: input.providerID,
    modelID: input.modelID,
    title: input.title ?? input.modelID,
    description: input.description,
    behaviorTitle: input.behaviorTitle ?? "Reasoning",
    behaviorLabel: input.behaviorLabel ?? "Default",
    behaviorDescription: input.behaviorDescription ?? "",
    behaviorValue: input.behaviorValue ?? null,
    isFree: input.isFree ?? false,
    isConnected: input.isConnected ?? false,
    source: input.source,
  };
}

describe("session route model options", () => {
  test("builds provider model catalog from all providers", () => {
    expect(Object.keys(buildProviderModelCatalog(providerListData()))).toEqual(["openai", "lpr_org", "disabled"]);
    expect(buildProviderModelCatalog(providerListData()).openai?.["gpt-4o"]?.name).toBe("GPT-4o");
    expect(buildProviderModelCatalog(null)).toEqual({});
  });

  test("resolves model variant state for missing and known models", () => {
    const emptyOptions = [{ value: null, label: "Default", description: "" }];

    expect(
      resolveModelVariantState({
        ref: null,
        variant: null,
        providerCatalog: {},
        emptyOptions,
      }),
    ).toMatchObject({ modelBehaviorOptions: emptyOptions, modelVariantValue: null });
    expect(
      resolveModelVariantState({
        ref: { providerID: "missing", modelID: "model" },
        variant: "fast",
        providerCatalog: {},
        emptyOptions,
      }),
    ).toMatchObject({ modelBehaviorOptions: emptyOptions, modelVariantLabel: "fast", modelVariantValue: "fast" });
    expect(
      resolveModelVariantState({
        ref: { providerID: "openai", modelID: "gpt-4o" },
        variant: null,
        providerCatalog: buildProviderModelCatalog(providerListData()),
        emptyOptions,
      }).modelVariantLabel,
    ).toBeTruthy();
  });

  test("reads seen provider ids from storage defensively", () => {
    const storage = {
      getItem: () => JSON.stringify(["openai", 123, "anthropic"]),
    } as Storage;

    expect(Array.from(readSeenProviderIds(storage)).sort()).toEqual(["anthropic", "openai"]);
    expect(readSeenProviderIds({ getItem: () => "not-json" } as Storage)).toEqual(new Set());
  });

  test("builds connected model options with recommendation and cloud source markers", () => {
    const options = buildConnectedModelOptions({
      data: providerListData(),
      seenProviderIds: new Set(["openai"]),
      recentProviderIds: new Set(["openai"]),
    });

    expect(options.map((item) => `${item.providerID}:${item.modelID}:${item.isRecommended}:${item.source ?? "local"}`))
      .toEqual([
        "openai:gpt-4o:true:local",
        "openai:mini:true:local",
        "lpr_org:org:true:cloud",
      ]);
  });

  test("filters custom local model options when custom providers are restricted", () => {
    const options = [
      option({ providerID: "openai", modelID: "gpt-4o", isConnected: true }),
      option({ providerID: "local", modelID: "llama", isConnected: false }),
    ];

    expect(
      filterAllowedModelOptions({
        options,
        checkRestriction: ({ restriction }) => restriction === "allowCustomProviders",
      }).map((item) => item.providerID),
    ).toEqual(["openai"]);
    expect(
      filterAllowedModelOptions({
        options,
        checkRestriction: () => false,
      }).map((item) => item.providerID),
    ).toEqual(["openai", "local"]);
  });

  test("detects selected model unavailability from restrictions and provider list", () => {
    expect(
      isSelectedModelUnavailable({
        defaultModel: null,
        checkRestriction: () => false,
        connectedProviderIds: [],
        providerListData: providerListData(),
      }),
    ).toBe(false);
    expect(
      isSelectedModelUnavailable({
        defaultModel: { providerID: "openai", modelID: "missing" },
        checkRestriction: () => false,
        connectedProviderIds: ["openai"],
        providerListData: providerListData(),
      }),
    ).toBe(true);
    expect(
      isSelectedModelUnavailable({
        defaultModel: { providerID: "local", modelID: "llama" },
        checkRestriction: ({ restriction }) => restriction === "allowCustomProviders",
        connectedProviderIds: ["openai"],
        providerListData: null,
      }),
    ).toBe(true);
  });

  test("uses provider defaults only while current default is still the app default", () => {
    expect(resolveProviderDefaultModel({ defaults: { openai: "gpt-4o" }, currentDefault: null }))
      .toEqual({ providerID: "openai", modelID: "gpt-4o" });
    expect(
      resolveProviderDefaultModel({
        defaults: { openai: "gpt-4o" },
        currentDefault: { providerID: "anthropic", modelID: "claude" },
      }),
    ).toBeNull();
    expect(resolveProviderDefaultModel({ defaults: {}, currentDefault: null })).toBeNull();
  });
});
