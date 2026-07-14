import { useMemo } from "react";

import type { PersonalLocalAgent } from "../../../../app/lib/desktop";

export type AcpModelOption = {
  id: string;
  label: string;
};

export type AcpModelInfo = {
  options: AcpModelOption[];
  currentModelId: string;
  modelOptionId: string;
  supportsModelOverride: boolean;
};

function textValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function modelOptionsFromHandshake(agent: PersonalLocalAgent | null): AcpModelOption[] {
  const raw = agent && "handshake" in agent && Array.isArray(agent.handshake?.available_models)
    ? agent.handshake.available_models
    : [];
  return raw.flatMap((item) => {
    if (item && typeof item === "object") {
      const source = item as Record<string, unknown>;
      const id = textValue(source.id ?? source.modelId ?? source.model_id ?? source.name);
      if (!id) return [];
      return [{ id, label: textValue(source.label ?? source.name ?? source.displayName) || id }];
    }
    const id = textValue(item);
    return id ? [{ id, label: id }] : [];
  });
}

function findModelConfigOption(agent: PersonalLocalAgent | null): Record<string, unknown> | null {
  const raw = agent && "handshake" in agent && Array.isArray(agent.handshake?.config_options)
    ? agent.handshake.config_options
    : [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const category = textValue(source.category);
    const id = textValue(source.id ?? source.name ?? source.key);
    if (category === "model" || /model/i.test(id)) return source;
  }
  return null;
}

function modelOptionIdFromHandshake(agent: PersonalLocalAgent | null): string {
  const option = findModelConfigOption(agent);
  if (!option) return "model";
  const id = textValue(option.id ?? option.name ?? option.key);
  return id || "model";
}

function modelOptionsFromConfigOption(agent: PersonalLocalAgent | null): AcpModelOption[] {
  const option = findModelConfigOption(agent);
  if (!option) return [];
  const opts = Array.isArray(option.options) ? option.options : [];
  return opts.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const id = textValue(source.value ?? source.id ?? source.name);
    if (!id) return [];
    return [{ id, label: textValue(source.name ?? source.label ?? source.value) || id }];
  });
}

function currentModelIdFromHandshake(agent: PersonalLocalAgent | null): string {
  if (!agent || !("handshake" in agent)) return "";
  const handshake = agent.handshake as Record<string, unknown> | undefined;
  const models = handshake?.models && typeof handshake.models === "object" ? handshake.models as Record<string, unknown> : null;
  const modelOption = findModelConfigOption(agent);
  const optionCurrent = modelOption ? textValue((modelOption as Record<string, unknown>).current_value ?? (modelOption as Record<string, unknown>).selected_value) : "";
  return optionCurrent || textValue(handshake?.currentModelId ?? handshake?.current_model_id ?? models?.currentModelId ?? models?.current_model_id ?? agent.defaultModel ?? agent.model);
}

export function useAcpModelInfo(agent: PersonalLocalAgent | null): AcpModelInfo {
  return useMemo(() => {
    // Aligned with Upstream: the ACP handshake is the single source of truth
    // for whether a session exposes model selection. Prefer the `model`
    // config option (session/set_config_options) because it lets us both
    // enumerate choices and observe the currently-selected id; fall back to
    // handshake.available_models, and finally to the agent's static
    // modelOptions the management panel captured.
    const fromConfigOption = modelOptionsFromConfigOption(agent);
    const fromHandshakeModels = modelOptionsFromHandshake(agent);
    const fallbackOptions = agent?.modelOptions ?? [];
    const merged = fromConfigOption.length
      ? fromConfigOption
      : fromHandshakeModels.length
        ? fromHandshakeModels
        : fallbackOptions;
    const supportsModelOverride = merged.length > 0;
    return {
      options: merged,
      currentModelId: currentModelIdFromHandshake(agent),
      modelOptionId: modelOptionIdFromHandshake(agent),
      supportsModelOverride,
    };
  }, [agent]);
}
