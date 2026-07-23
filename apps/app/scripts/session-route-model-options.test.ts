import { describe, expect, test } from "bun:test";

import {
  buildConnectedModelOptions,
  buildProviderModelCatalog,
  filterAllowedModelOptions,
  isSelectedModelUnavailable,
  readSeenProviderIds,
  resolveModelVariantState,
  resolveProviderDefaultModel,
  resolveUsableDefaultModel,
  shouldPromptProviderDefaultModel,
} from "../src/react-app/shell/session-route/model-options";
import type { ModelOption } from "../src/app/types";
import { DEFAULT_MODEL } from "../src/app/constants";

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
    // After discovery, missing selection is unavailable (must pick a model).
    expect(
      isSelectedModelUnavailable({
        model: null,
        checkRestriction: () => false,
        connectedProviderIds: [],
        providerListData: providerListData(),
      }),
    ).toBe(true);
    expect(
      isSelectedModelUnavailable({
        model: { providerID: "openai", modelID: "missing" },
        checkRestriction: () => false,
        connectedProviderIds: ["openai"],
        providerListData: providerListData(),
      }),
    ).toBe(true);
    // No connected discovery yet → do not flash unavailable.
    expect(
      isSelectedModelUnavailable({
        model: { providerID: "local", modelID: "llama" },
        checkRestriction: ({ restriction }) => restriction === "allowCustomProviders",
        connectedProviderIds: [],
        providerListData: null,
      }),
    ).toBe(false);
    // Restriction knows connected providers and selection is outside them.
    expect(
      isSelectedModelUnavailable({
        model: { providerID: "local", modelID: "llama" },
        checkRestriction: ({ restriction }) => restriction === "allowCustomProviders",
        connectedProviderIds: ["openai"],
        providerListData: providerListData(),
      }),
    ).toBe(true);
    // Connected custom with empty models map is NOT pickable — matches the
    // composer menu ("未找到模型") so ghost defaults show "模型已不可用" on load.
    expect(
      isSelectedModelUnavailable({
        model: { providerID: "ark", modelID: "ark-code-latest" },
        checkRestriction: () => false,
        connectedProviderIds: ["ark"],
        providerListData: {
          all: [
            {
              id: "ark",
              name: "Ark",
              source: "custom",
              models: {},
            } as never,
          ],
          connected: ["ark"],
          default: {},
        } as never,
      }),
    ).toBe(true);
    // Default ghost (opencode/big-pickle) with no connected catalog → unavailable.
    expect(
      isSelectedModelUnavailable({
        model: { providerID: "opencode", modelID: "big-pickle" },
        checkRestriction: () => false,
        connectedProviderIds: [],
        providerListData: {
          all: [],
          connected: [],
          default: {},
        } as never,
      }),
    ).toBe(true);
    // Loading list should not mark unavailable.
    expect(
      isSelectedModelUnavailable({
        model: { providerID: "openai", modelID: "missing" },
        checkRestriction: () => false,
        connectedProviderIds: ["openai"],
        providerListData: providerListData(),
        providerListLoading: true,
      }),
    ).toBe(false);
  });

  test("resolves OpenCode suggested default without mutating prefs", () => {
    expect(resolveProviderDefaultModel({ defaults: { openai: "gpt-4o" } })).toEqual({
      providerID: "openai",
      modelID: "gpt-4o",
    });
    // Suggestion is independent of current prefs (callers decide whether to prompt).
    expect(
      resolveProviderDefaultModel({
        defaults: { openai: "gpt-4o" },
        currentDefault: { providerID: "anthropic", modelID: "claude" },
      }),
    ).toEqual({ providerID: "openai", modelID: "gpt-4o" });
    expect(resolveProviderDefaultModel({ defaults: {} })).toBeNull();
  });

  test("keeps last-used when in catalog; heals to first catalog model not OpenCode ghosts", () => {
    const data = providerListData();
    // Still loading → do not rewrite.
    expect(
      resolveUsableDefaultModel({
        currentDefault: { providerID: "google", modelID: "gemini-3-pro-preview" },
        checkRestriction: () => false,
        connectedProviderIds: [],
        providerListData: null,
      }),
    ).toEqual({
      model: { providerID: "google", modelID: "gemini-3-pro-preview" },
      changed: false,
    });
    // Loaded empty catalog → drop ghost defaults (e.g. big-pickle) so the
    // composer does not claim a model when the menu is empty.
    expect(
      resolveUsableDefaultModel({
        currentDefault: DEFAULT_MODEL,
        checkRestriction: () => false,
        connectedProviderIds: [],
        providerListData: {
          all: [],
          connected: [],
          default: {},
        } as never,
      }),
    ).toEqual({ model: null, changed: true });
    expect(
      resolveUsableDefaultModel({
        currentDefault: null,
        checkRestriction: () => false,
        connectedProviderIds: [],
        providerListData: {
          all: [],
          connected: [],
          default: {},
        } as never,
      }),
    ).toEqual({ model: null, changed: false });
    // Last used still in connected catalog → keep.
    expect(
      resolveUsableDefaultModel({
        currentDefault: { providerID: "openai", modelID: "gpt-4o" },
        checkRestriction: () => false,
        connectedProviderIds: ["openai"],
        providerListData: data,
      }),
    ).toEqual({
      model: { providerID: "openai", modelID: "gpt-4o" },
      changed: false,
    });
    // Stale / empty → first connected catalog model (openai/gpt-4o), not a
    // ghost OpenCode suggestion outside the picker.
    expect(
      resolveUsableDefaultModel({
        currentDefault: { providerID: "google", modelID: "gemini-3-pro-preview" },
        checkRestriction: () => false,
        connectedProviderIds: ["openai", "lpr_org"],
        providerListData: data,
      }),
    ).toEqual({
      model: { providerID: "openai", modelID: "gpt-4o" },
      changed: true,
    });
    expect(
      resolveUsableDefaultModel({
        currentDefault: null,
        checkRestriction: () => false,
        connectedProviderIds: ["openai"],
        providerListData: data,
      }),
    ).toEqual({
      model: { providerID: "openai", modelID: "gpt-4o" },
      changed: true,
    });

    // Only ark connected → always ark, never OpenCode default outside catalog.
    const arkOnly = {
      all: [
        {
          id: "ark",
          name: "Volcano Engine Code Plan",
          source: "custom",
          models: {
            "ark-code-latest": { id: "ark-code-latest", name: "ark-code-latest" },
          },
        },
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "gpt-5-nano": { id: "gpt-5-nano", name: "gpt-5-nano" },
          },
        },
      ],
      connected: ["ark"],
      default: { opencode: "gpt-5-nano" },
    } as never;
    expect(
      resolveUsableDefaultModel({
        currentDefault: { providerID: "opencode", modelID: "gpt-5-nano" },
        checkRestriction: () => false,
        connectedProviderIds: ["ark"],
        providerListData: arkOnly,
      }),
    ).toEqual({
      model: { providerID: "ark", modelID: "ark-code-latest" },
      changed: true,
    });
    expect(
      resolveUsableDefaultModel({
        currentDefault: null,
        checkRestriction: () => false,
        connectedProviderIds: ["ark"],
        providerListData: arkOnly,
      }),
    ).toEqual({
      model: { providerID: "ark", modelID: "ark-code-latest" },
      changed: true,
    });
  });

  test("only prompts for provider default while still on app placeholder", () => {
    const suggested = { providerID: "google", modelID: "gemini-2.5-flash" };
    expect(
      shouldPromptProviderDefaultModel({
        suggested,
        currentDefault: null,
      }),
    ).toBe(true);
    expect(
      shouldPromptProviderDefaultModel({
        suggested,
        currentDefault: DEFAULT_MODEL,
      }),
    ).toBe(true);
    expect(
      shouldPromptProviderDefaultModel({
        suggested,
        currentDefault: { providerID: "anthropic", modelID: "claude" },
      }),
    ).toBe(false);
    expect(
      shouldPromptProviderDefaultModel({
        suggested,
        currentDefault: suggested,
      }),
    ).toBe(false);
    expect(
      shouldPromptProviderDefaultModel({
        suggested: null,
        currentDefault: DEFAULT_MODEL,
      }),
    ).toBe(false);
  });
});
