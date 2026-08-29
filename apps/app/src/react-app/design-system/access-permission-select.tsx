/** @jsxImportSource react */
import { useState } from "react";
import { ChevronDown, ChevronUp, Shield, ShieldAlert } from "lucide-react";

import type { ComposerAccessMode } from "../../app/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

type AccessPermissionSelectProps = {
  value: ComposerAccessMode;
  onChange: (value: ComposerAccessMode) => void;
  disabled?: boolean;
  /** Compact chrome for composer bottom accessory row. */
  density?: "default" | "compact";
};

function isFullAccess(mode: ComposerAccessMode) {
  return mode === "full";
}

export function AccessPermissionSelect(props: AccessPermissionSelectProps) {
  const [open, setOpen] = useState(false);
  const full = isFullAccess(props.value);
  const compact = props.density === "compact";
  const triggerLabel = full ? t("composer.access_full") : t("composer.access_default");
  const Chevron = open ? ChevronUp : ChevronDown;
  // Same text-sm as default composer chrome so draft-home chips match (+ / 默认权限).
  const triggerClass = compact
    ? full
      ? "h-8 max-w-44 shrink min-w-0 gap-1.5 rounded-lg px-2 text-sm font-normal leading-none text-dls-danger hover:bg-dls-hover hover:text-dls-danger disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-3.5"
      : "h-8 max-w-44 shrink min-w-0 gap-1.5 rounded-lg px-2 text-sm font-normal leading-none text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-3.5"
    : full
      ? "max-h-9 max-w-44 shrink min-w-0 gap-1.5 px-2 text-sm font-normal text-dls-danger hover:bg-dls-hover hover:text-dls-danger disabled:cursor-not-allowed disabled:opacity-60"
      : "max-h-9 max-w-44 shrink min-w-0 gap-1.5 px-2 text-sm font-normal text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={triggerClass}
            disabled={props.disabled}
            aria-expanded={open}
            aria-haspopup="dialog"
            title={triggerLabel}
            data-testid="access-permission-trigger"
          >
            {full ? (
              <ShieldAlert className="size-3.5 shrink-0 text-dls-danger" />
            ) : (
              <Shield className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 truncate">{triggerLabel}</span>
            <Chevron className="size-3.5 shrink-0 opacity-70" />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className={cn(
          "z-[120] w-44 max-w-[calc(100vw-2.5rem)] gap-0 overflow-hidden rounded-xl p-0",
          "border border-dls-border bg-dls-surface-solid text-dls-text",
        )}
        style={{
          backgroundColor: "var(--dls-surface-solid, var(--dls-surface))",
        }}
      >
        <div className="px-3 py-2.5">
          <PopoverDescription className="text-xs leading-5 text-dls-secondary">
            {full ? t("composer.access_full_warning") : t("composer.access_full_enable_hint")}
          </PopoverDescription>
        </div>
        <div className="border-t border-dls-border px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-sm font-medium leading-5 text-dls-text">
              {t("composer.access_full_allow")}
            </span>
            <Switch
              checked={full}
              disabled={props.disabled}
              onCheckedChange={(next) => {
                props.onChange(next ? "full" : "default");
              }}
              aria-label={t("composer.access_full_allow")}
              data-testid="access-permission-switch"
              className="shrink-0 data-checked:border-dls-danger data-checked:bg-dls-danger"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
