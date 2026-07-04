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

function modelOptionIdFromHandshake(agent: PersonalLocalAgent | null): string {
  const raw = agent && "handshake" in agent && Array.isArray(agent.handshake?.config_options)
    ? agent.handshake.config_options
    : [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const id = textValue(source.id ?? source.name ?? source.key);
    if (/model/i.test(id)) return id;
  }
  return "model";
}

function currentModelIdFromHandshake(agent: PersonalLocalAgent | null): string {
  if (!agent || !("handshake" in agent)) return "";
  const handshake = agent.handshake as Record<string, unknown> | undefined;
  const models = handshake?.models && typeof handshake.models === "object" ? handshake.models as Record<string, unknown> : null;
  return textValue(handshake?.currentModelId ?? handshake?.current_model_id ?? models?.currentModelId ?? models?.current_model_id ?? agent.defaultModel ?? agent.model);
}

export function useAcpModelInfo(agent: PersonalLocalAgent | null): AcpModelInfo {
  return useMemo(() => {
    const options = modelOptionsFromHandshake(agent);
    const fallbackOptions = agent?.modelOptions ?? [];
    const merged = options.length ? options : fallbackOptions;
    const supportsModelOverride = Boolean(agent?.capability?.supportsModelOverride || merged.length);
    return {
      options: merged,
      currentModelId: currentModelIdFromHandshake(agent),
      modelOptionId: modelOptionIdFromHandshake(agent),
      supportsModelOverride,
    };
  }, [agent]);
}
