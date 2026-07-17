/** @jsxImportSource react */
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";

export type SelectMenuOption = {
  value: string;
  label: string;
};

type SelectMenuProps = {
  options: SelectMenuOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  size?: "default" | "compact";
  placement?: "bottom" | "top";
  onOpen?: () => void;
};

const triggerClasses = {
  default:
    "flex w-full items-center justify-between gap-2 rounded-xl border border-dls-border bg-dls-surface px-3.5 py-2.5 text-left text-sm text-dls-text transition-colors hover:border-dls-border focus:outline-none focus:ring-2 focus:ring-dls-accent/30 disabled:cursor-not-allowed disabled:opacity-60",
  compact:
    "flex w-full items-center justify-between gap-2 rounded-lg border border-dls-border bg-dls-surface px-2 py-1.5 text-left text-xs text-dls-text transition-colors hover:border-dls-border focus:outline-none focus:ring-2 focus:ring-dls-accent/30 disabled:cursor-not-allowed disabled:opacity-60",
};

const panelClass =
  "absolute left-auto right-0 z-[200] min-w-full max-h-72 w-max max-w-[min(18rem,calc(100vw-2rem))] overflow-y-auto overflow-x-hidden rounded-xl border border-dls-border bg-dls-surface py-1 shadow-lg";

const panelPlacementClasses = {
  bottom: "top-[calc(100%+6px)]",
  top: "bottom-[calc(100%+6px)]",
};

const optionRowClasses = {
  default:
    "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-dls-text transition-colors hover:bg-dls-hover",
  compact:
    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-dls-text transition-colors hover:bg-dls-hover",
};

export function SelectMenu(props: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const size = props.size ?? "default";
  const placement = props.placement ?? "bottom";

  const displayLabel = useMemo(() => {
    const match = props.options.find((o) => o.value === props.value);
    if (match) return match.label;
    return props.placeholder?.trim() || "";
  }, [props.options, props.placeholder, props.value]);

  const close = useEffectEvent(() => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        close();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex w-full min-w-0">
      <Button
        type="button"
        id={props.id}
        variant="outline"
        size="default"
        className={triggerClasses[size]}
        disabled={props.disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={props.ariaLabelledBy}
        aria-label={props.ariaLabel}
        onClick={() => {
          if (props.disabled) return;
          setOpen((o) => {
            const nextOpen = !o;
            if (nextOpen) props.onOpen?.();
            return nextOpen;
          });
        }}
      >
        <span className="min-w-0 flex-1 truncate text-left">{displayLabel}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-dls-secondary transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </Button>

      {open && !props.disabled ? (
        <div className={`${panelClass} ${panelPlacementClasses[placement]}`} role="listbox">
          {props.options.map((opt) => (
            <MenuRowButton
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === props.value}
              active={opt.value === props.value}
              align="center"
              className={optionRowClasses[size]}
              onClick={() => {
                props.onChange(opt.value);
                close();
              }}
            >
              <span className="min-w-0 flex-1 truncate">{opt.label}</span>
              {opt.value === props.value ? (
                <Check
                  size={16}
                  className="shrink-0 text-dls-accent"
                  aria-hidden
                />
              ) : null}
            </MenuRowButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}
