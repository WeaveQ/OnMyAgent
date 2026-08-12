"use client";

import { useMemo } from "react";
import { t } from "@/i18n";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ModelBehaviorOption = {
  value: string | null;
  label: string;
};

type ModelBehaviorSelectProps = {
  value: string | null;
  label: string;
  options?: ModelBehaviorOption[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
};

/** Base UI Select only accepts string item values — map provider-default null. */
const DEFAULT_BEHAVIOR_VALUE = "__provider_default__";

function toSelectItems(options: ModelBehaviorOption[] | undefined) {
  if (!options?.length) return [] as Array<{ value: string; label: string }>;
  return options.map((option) => ({
    value: option.value ?? DEFAULT_BEHAVIOR_VALUE,
    label: option.label,
  }));
}

export function ModelBehaviorSelect({
  value,
  label,
  options,
  onChange,
  disabled = false,
}: ModelBehaviorSelectProps) {
  // Stabilize item identity by content so Base UI Select does not re-init
  // when the parent rebuilds options with the same values each render.
  const optionsKey = useMemo(
    () =>
      (options ?? [])
        .map((o) => `${o.value ?? ""}:${o.label}`)
        .join("|"),
    [options],
  );
  const items = useMemo(
    () => toSelectItems(options),
    // optionsKey captures content; options ref itself is intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optionsKey],
  );

  // Need at least one real variant (not only provider-default).
  const hasVariants = items.some((item) => item.value !== DEFAULT_BEHAVIOR_VALUE);
  if (items.length === 0 || !hasVariants) {
    return null;
  }

  const rawKey = value ?? DEFAULT_BEHAVIOR_VALUE;
  const selectValue = items.some((item) => item.value === rawKey)
    ? rawKey
    : items[0]!.value;

  return (
    <Select
      value={selectValue}
      items={items}
      onValueChange={(nextValue) => {
        if (typeof nextValue !== "string" || !nextValue) return;
        if (!items.some((item) => item.value === nextValue)) return;
        const next = nextValue === DEFAULT_BEHAVIOR_VALUE ? null : nextValue;
        // Skip no-ops so a forced display fallback never re-enters parent state.
        if (next === value) return;
        onChange(next);
      }}
      disabled={disabled}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SelectTrigger
              size="sm"
              disabled={disabled}
              aria-label={t("composer.behavior_label")}
              className="h-8 max-w-28 shrink-0 rounded-lg border-0 bg-transparent px-2 text-sm font-normal leading-none text-dls-secondary hover:bg-dls-hover hover:text-dls-text data-[size=sm]:h-8 [&_[data-slot=select-value]]:truncate"
            />
          }
        >
          <SelectValue placeholder={label || t("settings.default_label")} />
        </TooltipTrigger>
        <TooltipContent>{t("composer.behavior_label")}</TooltipContent>
      </Tooltip>
      <SelectContent side="top" sideOffset={8} align="start" className="min-w-48">
        <SelectGroup>
          <SelectLabel>{t("session.assistant_thinking")}</SelectLabel>
          {items.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
