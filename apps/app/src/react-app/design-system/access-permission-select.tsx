/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Shield, ShieldAlert, ShieldCheck } from "lucide-react";

import type { ComposerAccessMode } from "../../app/types";
import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";

type AccessPermissionSelectProps = {
  value: ComposerAccessMode;
  onChange: (value: ComposerAccessMode) => void;
  disabled?: boolean;
  /** Compact chrome for composer bottom accessory row. */
  density?: "default" | "compact";
};

type AccessPermissionOption = {
  value: ComposerAccessMode;
  label: string;
  description: string;
  risk?: string;
};

const ACCESS_PERMISSION_OPTIONS: AccessPermissionOption[] = [
  {
    value: "default",
    get label() { return t("composer.access_default"); },
    get description() { return t("composer.access_default_desc"); },
  },
  {
    value: "delegate",
    get label() { return t("composer.access_delegate"); },
    get description() { return t("composer.access_delegate_desc"); },
  },
  {
    value: "full",
    get label() { return t("composer.access_full"); },
    get description() { return t("composer.access_full_desc"); },
    get risk() { return t("composer.access_high_risk"); },
  },
];

function optionFor(value: ComposerAccessMode) {
  return (
    ACCESS_PERMISSION_OPTIONS.find((option) => option.value === value) ??
    ACCESS_PERMISSION_OPTIONS[0]
  );
}

export function AccessPermissionSelect(props: AccessPermissionSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = optionFor(props.value);
  const compact = props.density === "compact";
  // Match composer bottom chrome chips: text-xs / icon size-3.5 / chevron size-3.5.
  const triggerClass = compact
    ? props.value === "full"
      ? "h-8 max-w-44 shrink min-w-0 gap-1.5 rounded-lg px-2 text-xs font-normal leading-none text-dls-danger hover:bg-dls-hover hover:text-dls-danger disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-3.5"
      : "h-8 max-w-44 shrink min-w-0 gap-1.5 rounded-lg px-2 text-xs font-normal leading-none text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-3.5"
    : props.value === "full"
      ? "max-h-9 max-w-44 shrink min-w-0 gap-1.5 px-2 text-sm font-normal text-dls-danger hover:bg-dls-hover hover:text-dls-danger disabled:cursor-not-allowed disabled:opacity-60"
      : "max-h-9 max-w-44 shrink min-w-0 gap-1.5 px-2 text-sm font-normal text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:cursor-not-allowed disabled:opacity-60";

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={triggerClass}
        onClick={() => setOpen((value) => !value)}
        disabled={props.disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        title={selected.label}
      >
        {props.value === "full" ? (
          <ShieldAlert className="size-3.5 shrink-0 text-dls-danger" />
        ) : (
          <Shield className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 truncate">{selected.label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-40 mb-3 w-[min(calc(100vw-2.5rem),320px)] overflow-hidden rounded-xl border border-dls-border bg-dls-surface p-1.5"
        >
          {ACCESS_PERMISSION_OPTIONS.map((option) => {
            const active = option.value === props.value;
            const Icon =
              option.value === "full"
                ? ShieldAlert
                : option.value === "delegate"
                  ? ShieldCheck
                  : Shield;
            return (
              <MenuRowButton
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                active={active}
                className="gap-3 py-3"
                onClick={() => {
                  props.onChange(option.value);
                  setOpen(false);
                }}
              >
                <Icon
                  size={16}
                  className={
                    option.value === "full"
                      ? "mt-0.5 shrink-0 text-dls-danger"
                      : "mt-0.5 shrink-0 text-dls-secondary"
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span>{option.label}</span>
                    {option.risk ? (
                      <StatusBadge size="tiny" tone="warning">
                        {option.risk}
                      </StatusBadge>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-dls-secondary">
                    {option.description}
                  </span>
                </span>
                {active ? (
                  <Check size={16} className="mt-0.5 shrink-0 text-dls-secondary" />
                ) : null}
              </MenuRowButton>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
