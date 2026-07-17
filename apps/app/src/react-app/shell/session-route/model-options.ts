import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import { isDesktopProviderBlocked } from "../../../app/cloud/desktop-app-restrictions";
import { DEFAULT_MODEL } from "../../../app/constants";
import { getModelBehaviorSummary } from "../../../app/lib/model-behavior";
import type {
  ModelBehaviorOption,
  ModelOption,
  ModelRef,
  ProviderListItem,
} from "../../../app/types";
import { t } from "../../../i18n";
import {
  getConnectedProviderItems,
  isModelAvailableInConnectedProviders,
} from "../../domains/connections";

export type ProviderModelCatalog = Record<
  string,
  Record<string, ProviderListItem["models"][string]>
>;

type ModelVariantState = {
  modelVariantLabel: string;
  modelBehaviorOptions: ModelBehaviorOption[];
  modelVariantValue: string | null;
};

export function buildProviderModelCatalog(
  data: ProviderListResponse | null | undefined,
): ProviderModelCatalog {
  const next: ProviderModelCatalog = {};
  if (!data?.all) return next;
  for (const provider of data.all) {
    next[provider.id] = { ...(provider.models ?? {}) };
  }
  return next;
}

export function resolveModelVariantState(input: {
  ref: ModelRef | null | undefined;
  variant: string | null | undefined;
  providerCatalog: ProviderModelCatalog;
  emptyOptions: ModelBehaviorOption[];
}): ModelVariantState {
  const variant = input.variant ?? null;
  if (!input.ref) {
    return {
      modelVariantLabel: t("settings.default_label"),
      modelBehaviorOptions: input.emptyOptions,
      modelVariantValue: null,
    };
  }
  const model = input.providerCatalog[input.ref.providerID]?.[input.ref.modelID];
  if (!model) {
    return {
      modelVariantLabel: variant ?? t("settings.default_label"),
      modelBehaviorOptions: input.emptyOptions,
      modelVariantValue: variant,
    };
  }
  const summary = getModelBehaviorSummary(input.ref.providerID, model, variant);
  return {
    modelVariantLabel: summary.label,
    modelBehaviorOptions: summary.options,
    modelVariantValue: summary.value,
  };
}

export function readSeenProviderIds(storage: Storage): Set<string> {
  try {
    const raw = storage.getItem("onmyagent.seenProviderIds");
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? new Set(value.filter((item): item is string => typeof item === "string")) : new Set();
  } catch {
    return new Set();
  }
}

export function buildConnectedModelOptions(input: {
  data: ProviderListResponse | null | undefined;
  seenProviderIds: Set<string>;
  recentProviderIds: Set<string>;
}): ModelOption[] {
  const options: ModelOption[] = [];
  for (const provider of getConnectedProviderItems(input.data)) {
    const modelIds = Object.keys(provider.models);
    const isNew =
      !input.seenProviderIds.has(provider.id) ||
      input.recentProviderIds.has(provider.id);
    for (const id of modelIds) {
      const model = provider.models[id];
      options.push({
        providerID: provider.id,
        modelID: id,
        title: model.name || id,
        description: provider.name,
        behaviorTitle: t("settings.model_reasoning"),
        behaviorLabel: t("settings.default_label"),
        behaviorDescription: "",
        behaviorValue: null,
        isFree: false,
        isConnected: true,
        isRecommended: isNew,
        source: /^lpr_/i.test(provider.id) ? "cloud" : undefined,
      });
    }
  }
  return options;
}

export function filterAllowedModelOptions(input: {
  options: ModelOption[];
  checkRestriction: DesktopAppRestrictionChecker;
}) {
  const restrictToCloud = input.checkRestriction({
    restriction: "allowCustomProviders",
  });
  return input.options.filter((option) => {
    if (
      isDesktopProviderBlocked({
        providerId: option.providerID,
        checkRestriction: input.checkRestriction,
      })
    ) {
      return false;
    }
    if (restrictToCloud && !option.isConnected) {
      return false;
    }
    return true;
  });
}

export function isSelectedModelUnavailable(input: {
  /** The model the composer is actually using (session override / agent / default). */
  model: ModelRef | null | undefined;
  checkRestriction: DesktopAppRestrictionChecker;
  connectedProviderIds: string[];
  providerListData: ProviderListResponse | null | undefined;
  /** When true, do not mark unavailable — list is still loading. */
  providerListLoading?: boolean;
}) {
  const model = input.model;
  if (!model?.providerID || !model.modelID) return false;
  if (input.providerListLoading) return false;
  if (
    isDesktopProviderBlocked({
      providerId: model.providerID,
      checkRestriction: input.checkRestriction,
    })
  ) {
    return true;
  }
  const providerId = model.providerID.trim();
  if (input.checkRestriction({ restriction: "allowCustomProviders" })) {
    const knownConnected = new Set(
      [
        ...input.connectedProviderIds,
        ...(input.providerListData?.connected ?? []).map((id) => String(id)),
      ]
        .map((id) => id.trim())
        .filter(Boolean),
    );
    // Only enforce once we know at least one connected provider; otherwise we
    // would flag every model unavailable before provider discovery finishes.
    if (knownConnected.size > 0 && !knownConnected.has(providerId)) {
      return true;
    }
  }
  // No list yet: don't flash "unavailable" before the first successful fetch.
  if (!input.providerListData) return false;
  return !isModelAvailableInConnectedProviders(input.providerListData, model);
}

/**
 * Resolve OpenCode's suggested default model from provider.list().default.
 * Does not mutate prefs — callers may prompt the user to adopt it.
 */
export function resolveProviderDefaultModel(input: {
  defaults: ProviderListResponse["default"] | null | undefined;
  /** @deprecated ignored; kept for call-site compatibility */
  currentDefault?: ModelRef | null | undefined;
}): ModelRef | null {
  void input.currentDefault;
  const defaults = input.defaults ?? {};
  // Prefer the first *connected* default when connected ids are provided via
  // a later overload path; for now take Object key order from OpenCode.
  const firstProviderId = Object.keys(defaults)[0];
  const firstModelId = firstProviderId ? defaults[firstProviderId] : null;
  if (!firstProviderId || !firstModelId) return null;
  return {
    providerID: firstProviderId,
    modelID: firstModelId,
  };
}

/**
 * True when the model appears in the same connected catalog the composer
 * picker builds from (getConnectedProviderItems + model keys).
 * Stricter than isSelectedModelUnavailable — ignores OpenCode "suggested"
 * models that are not actually listed for the user.
 */
export function isModelInConnectedCatalog(
  data: ProviderListResponse | null | undefined,
  model: ModelRef | null | undefined,
): boolean {
  if (!model?.providerID || !model.modelID) return false;
  const providerId = model.providerID.trim();
  const modelId = model.modelID.trim();
  if (!providerId || !modelId) return false;

  for (const provider of getConnectedProviderItems(data)) {
    if (provider.id !== providerId) continue;
    const models = provider.models ?? {};
    const keys = Object.keys(models);
    // Connected custom with empty map: accept any model id for that provider.
    if (keys.length === 0) return true;
    if (models[modelId]) return true;
    const want = modelId.toLowerCase();
    return keys.some((id) => id.toLowerCase() === want);
  }
  return false;
}

function firstConnectedCatalogModel(
  data: ProviderListResponse | null | undefined,
): ModelRef | null {
  for (const provider of getConnectedProviderItems(data)) {
    const modelId = Object.keys(provider.models ?? {})[0];
    if (!modelId) continue;
    return { providerID: provider.id, modelID: modelId };
  }
  return null;
}

function sameModelRef(
  a: ModelRef | null | undefined,
  b: ModelRef | null | undefined,
): boolean {
  if (!a?.providerID || !a.modelID || !b?.providerID || !b.modelID) return false;
  return a.providerID === b.providerID && a.modelID === b.modelID;
}

/**
 * Keep last-used default when it is still in the connected catalog the user
 * can pick from; otherwise fall back to a catalog model so the composer is
 * never empty and never lands on a ghost like OpenCode's suggested gpt-5-nano
 * when the only connected model is e.g. ark-code-latest.
 *
 * Priority when current is missing/not in catalog:
 * 1) First model on the first connected provider with a real catalog
 * 2) OpenCode provider.list().default — only if that model is in the catalog
 * 3) App DEFAULT_MODEL — only if in the catalog
 *
 * No-op until discovery has connected catalog entries (avoids wipe on blips).
 */
export function resolveUsableDefaultModel(input: {
  currentDefault: ModelRef | null | undefined;
  checkRestriction: DesktopAppRestrictionChecker;
  connectedProviderIds: string[];
  providerListData: ProviderListResponse | null | undefined;
  providerListLoading?: boolean;
}): { model: ModelRef | null; changed: boolean } {
  const current = input.currentDefault ?? null;
  if (input.providerListLoading || !input.providerListData) {
    return { model: current, changed: false };
  }

  const catalogFirst = firstConnectedCatalogModel(input.providerListData);
  // No models in the picker yet — do not invent a default.
  if (!catalogFirst) {
    return { model: current, changed: false };
  }

  if (isModelInConnectedCatalog(input.providerListData, current) && current) {
    return { model: current, changed: false };
  }

  const suggested = resolveProviderDefaultModel({
    defaults: input.providerListData.default,
  });
  const candidates: Array<ModelRef | null> = [
    catalogFirst,
    suggested && isModelInConnectedCatalog(input.providerListData, suggested)
      ? suggested
      : null,
    isModelInConnectedCatalog(input.providerListData, DEFAULT_MODEL)
      ? DEFAULT_MODEL
      : null,
  ];

  for (const candidate of candidates) {
    if (!candidate?.providerID || !candidate.modelID) continue;
    return {
      model: candidate,
      changed: !sameModelRef(current, candidate),
    };
  }

  return { model: current, changed: false };
}

/** Whether we should surface a non-blocking hint to adopt the provider default. */
export function shouldPromptProviderDefaultModel(input: {
  suggested: ModelRef | null | undefined;
  currentDefault: ModelRef | null | undefined;
}): boolean {
  const suggested = input.suggested;
  if (!suggested?.providerID || !suggested.modelID) return false;
  const current = input.currentDefault;
  if (!current?.providerID || !current.modelID) return true;
  if (
    current.providerID === suggested.providerID &&
    current.modelID === suggested.modelID
  ) {
    return false;
  }
  // Only nudge while the user is still on the app placeholder default.
  return (
    current.providerID === DEFAULT_MODEL.providerID &&
    current.modelID === DEFAULT_MODEL.modelID
  );
}
