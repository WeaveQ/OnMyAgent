import { useMemo } from "react";

import type { PersonalLocalAgent } from "../../../../app/lib/desktop";

export type AcpModeOption = {
  id: string;
  label: string;
};

export type AcpModeList = {
  optionId: string;
  options: AcpModeOption[];
  currentModeId: string;
  supportsModeOverride: boolean;
};

function textValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function optionsFromValue(value: unknown): AcpModeOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item && typeof item === "object") {
      const source = item as Record<string, unknown>;
      const id = textValue(source.value ?? source.id ?? source.name);
      if (!id) return [];
      return [{ id, label: textValue(source.label ?? source.name ?? id) || id }];
    }
    const id = textValue(item);
    return id ? [{ id, label: id }] : [];
  });
}

export function useModeModeList(agent: PersonalLocalAgent | null): AcpModeList {
  return useMemo(() => {
    const handshake = agent && "handshake" in agent ? agent.handshake as Record<string, unknown> | undefined : undefined;
    const rawConfigOptions = Array.isArray(handshake?.config_options) ? handshake.config_options : [];
    for (const item of rawConfigOptions) {
      if (!item || typeof item !== "object") continue;
      const source = item as Record<string, unknown>;
      const id = textValue(source.id ?? source.name ?? source.key);
      if (!/mode/i.test(id)) continue;
      return {
        optionId: id,
        options: optionsFromValue(source.options ?? source.values),
        currentModeId: textValue(source.value ?? source.currentValue ?? source.current_value ?? source.default ?? source.defaultValue ?? source.default_value),
        supportsModeOverride: true,
      };
    }
    const rawModes = Array.isArray(handshake?.modes)
      ? handshake?.modes
      : Array.isArray(handshake?.available_modes)
        ? handshake?.available_modes
        : Array.isArray(handshake?.availableModes)
          ? handshake?.availableModes
          : [];
    const options = optionsFromValue(rawModes);
    return {
      optionId: "mode",
      options,
      currentModeId: "",
      supportsModeOverride: options.length > 0,
    };
  }, [agent]);
}
