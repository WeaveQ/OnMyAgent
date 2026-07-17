import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import type { DesktopAppRestrictionChecker } from "../../app/cloud/desktop-app-restrictions";
import { isDesktopProviderBlocked } from "../../app/cloud/desktop-app-restrictions";
import { DEFAULT_MODEL } from "../../app/constants";
import { getModelBehaviorSummary } from "../../app/lib/model-behavior";
import type {
  ModelBehaviorOption,
  ModelOption,
  ModelRef,
  ProviderListItem,
} from "../../app/types";
import { t } from "../../i18n";
import {
  getConnectedProviderItems,
  isModelAvailableInConnectedProviders,
} from "../domains/connections";

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
