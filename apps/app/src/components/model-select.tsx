"use client";

import * as React from "react";
import { ChevronDown, Check, Settings2 } from "lucide-react";

import type { ModelOption, ModelRef } from "@/app/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandCollection,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { t } from "@/i18n";
import { MenuRowButton } from "@/components/ui/action-row";

function getProviderDisplayName(providerId: string) {
  return providerId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function groupByProvider(modelOptions: ModelOption[]) {
  const groups = new Map<string, ModelOption[]>();

  for (const option of modelOptions) {
    const providerLabel = option.description ?? getProviderDisplayName(option.providerID);
    const existing = groups.get(providerLabel);

    if (existing) {
      existing.push(option);
      continue;
    }

    groups.set(providerLabel, [option]);
  }

  return [...groups.entries()].map(([providerLabel, options]) => ({
    value: providerLabel,
    items: options,
  }));
}

function isSameModel(a: ModelRef, b: ModelRef) {
  return a.providerID === b.providerID && a.modelID === b.modelID;
}

export interface ModelSelectViewProps {
  open: boolean;
  value: ModelRef;
  onOpenChange: (open: boolean) => void;
  onChange: (model: ModelRef) => void;
  disabled?: boolean;
  options: ModelOption[];
  renderProviderIcon?: (option: ModelOption) => React.ReactNode;
  onOpenModelPicker?: () => void;
}

export function ModelSelectView({
  open,
  value,
  onOpenChange,
  onChange,
  disabled = false,
  options,
  renderProviderIcon,
  onOpenModelPicker,
}: ModelSelectViewProps) {
  const [search, setSearch] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const focusSearchInput = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      const input = searchInputRef.current;

      if (!input) {
        return;
      }

      input.focus();
      input.select();
    });
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    focusSearchInput();
  }, [focusSearchInput, open]);

  const selectedOption = options.find((option) =>
    isSameModel(value, {
      providerID: option.providerID,
      modelID: option.modelID,
    }),
  );

  const groups = React.useMemo(() => groupByProvider(options), [options]);

  const handleSelect = (option: ModelOption) => {
    onChange({ providerID: option.providerID, modelID: option.modelID });
    setSearch("");
    onOpenChange(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);

        if (!nextOpen) {
          setSearch("");
        }
      }}
    >
      {/* No Tooltip here: nesting Tooltip + Popover often leaves an empty
          speech bubble above the model chip; the visible label is enough. */}
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={t("settings.model_change")}
        aria-keyshortcuts="Meta+Alt+/"
        title={selectedOption?.title ?? value.modelID ?? t("session.default_model")}
        className="flex h-7 max-w-36 shrink min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text disabled:pointer-events-none disabled:opacity-60"
      >
        <span className="min-w-0 truncate">
          {selectedOption?.title ?? value.modelID ?? t("session.default_model")}
        </span>
        <ChevronDown className="size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent
        className="h-80 max-h-(--available-height) w-72 gap-0 overflow-hidden border border-dls-mist bg-dls-surface p-px ring-0 **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-0.5"
        align="start"
        initialFocus={false}
      >
        <Command
          autoHighlight={false}
          items={groups}
          keepHighlight={false}
          value={search}
          onValueChange={setSearch}
        >
          <CommandHeader>
            <CommandInput
              ref={searchInputRef}
              placeholder={t("settings.search_models")}
            />
          </CommandHeader>
          <CommandEmpty>{t("settings.no_models_found")}</CommandEmpty>
          <CommandList>
            {(group) => (
              <CommandGroup
                key={group.value}
                items={group.items}
              >
                <CommandGroupLabel>{group.value}</CommandGroupLabel>
                <CommandCollection>
                  {(option: ModelOption) => {
                    const selected = isSameModel(value, option);
                    return (
                      <CommandItem
                        className={selected
                          ? "gap-2 bg-dls-list-selected data-highlighted:bg-dls-list-selected"
                          : "gap-2 data-highlighted:bg-dls-list-hover"}
                        key={`${option.providerID}:${option.modelID}`}
                        value={`${option.providerID}:${option.modelID}`}
                        onClick={() => handleSelect(option)}
                        data-checked={selected}
                      >
                        {renderProviderIcon?.(option)}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-dls-text">
                            {option.title}
                          </span>
                          <span className="block truncate text-xs text-dls-secondary">
                            {option.description ??
                              getProviderDisplayName(option.providerID)}
                          </span>
                        </span>
                        {selected ? (
                          <Check className="size-4 shrink-0 text-dls-accent" />
                        ) : null}
                      </CommandItem>
                    );
                  }}
                </CommandCollection>
              </CommandGroup>
            )}
          </CommandList>
          {/* Link to full model picker */}
          <div className="border-t border-dls-border px-2 py-1.5">
            <MenuRowButton
              type="button"
              align="center"
              density="compact"
              className="text-dls-secondary hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                onOpenChange(false);
                setSearch("");
                onOpenModelPicker?.();
              }}
            >
              <Settings2 className="size-3.5" />
              {t("settings.model_all_models")}
            </MenuRowButton>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
