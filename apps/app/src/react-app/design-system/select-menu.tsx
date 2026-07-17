/** @jsxImportSource react */
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  placement?: "bottom" | "top" | "auto";
  onOpen?: () => void;
};

type PanelRect = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "bottom" | "top";
};

const triggerClasses = {
  default:
    "flex w-full items-center justify-between gap-2 rounded-xl border border-dls-border bg-dls-surface px-3.5 py-2.5 text-left text-sm text-dls-text transition-colors hover:border-dls-border focus:outline-none focus:ring-2 focus:ring-dls-accent/30 disabled:cursor-not-allowed disabled:opacity-60",
  compact:
    "flex w-full items-center justify-between gap-2 rounded-lg border border-dls-border bg-dls-surface px-2 py-1.5 text-left text-xs text-dls-text transition-colors hover:border-dls-border focus:outline-none focus:ring-2 focus:ring-dls-accent/30 disabled:cursor-not-allowed disabled:opacity-60",
};

const optionRowClasses = {
  default:
    "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-dls-text transition-colors hover:bg-dls-hover",
  compact:
    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-dls-text transition-colors hover:bg-dls-hover",
};

const PANEL_GAP = 6;
const PANEL_MAX_HEIGHT = 288; // 18rem
const VIEWPORT_PAD = 8;

function computePanelRect(
  trigger: DOMRect,
  preferred: "bottom" | "top" | "auto",
): PanelRect {
  const width = Math.max(trigger.width, 140);
  const spaceBelow = window.innerHeight - trigger.bottom - VIEWPORT_PAD;
  const spaceAbove = trigger.top - VIEWPORT_PAD;

  let placement: "bottom" | "top" = preferred === "top" ? "top" : "bottom";
  if (preferred === "auto") {
    placement =
      spaceBelow < 160 && spaceAbove > spaceBelow ? "top" : "bottom";
  } else if (preferred === "bottom" && spaceBelow < 120 && spaceAbove > spaceBelow) {
    placement = "top";
  } else if (preferred === "top" && spaceAbove < 120 && spaceBelow > spaceAbove) {
    placement = "bottom";
  }

  const available =
    placement === "bottom" ? spaceBelow - PANEL_GAP : spaceAbove - PANEL_GAP;
  const maxHeight = Math.max(120, Math.min(PANEL_MAX_HEIGHT, available));

  let left = trigger.right - width;
  left = Math.min(left, window.innerWidth - width - VIEWPORT_PAD);
  left = Math.max(VIEWPORT_PAD, left);

  const top =
    placement === "bottom"
      ? trigger.bottom + PANEL_GAP
      : Math.max(VIEWPORT_PAD, trigger.top - PANEL_GAP - maxHeight);

  return { top, left, width, maxHeight, placement };
}

export function SelectMenu(props: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [panelRect, setPanelRect] = useState<PanelRect | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const size = props.size ?? "default";
  const placement = props.placement ?? "auto";

  const displayLabel = useMemo(() => {
    const match = props.options.find((o) => o.value === props.value);
    if (match) return match.label;
    return props.placeholder?.trim() || "";
  }, [props.options, props.placeholder, props.value]);

  const close = useEffectEvent(() => setOpen(false));

  const updatePanelPosition = useEffectEvent(() => {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    setPanelRect(computePanelRect(trigger, placement));
  });

  useLayoutEffect(() => {
    if (!open) {
      setPanelRect(null);
      return;
    }
    updatePanelPosition();
  }, [open, props.options.length, placement]);

  useEffect(() => {
    if (!open) return;
    const onReposition = () => updatePanelPosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
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

  const panel =
    open && !props.disabled && panelRect && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            role="listbox"
            // Solid opaque surface + isolation so glass/backdrop parents never
            // show through option rows (avoids "穿透" of underlying controls).
            className="fixed z-[1000] isolate overflow-y-auto overflow-x-hidden rounded-xl border border-dls-border py-1"
            style={{
              top: panelRect.top,
              left: panelRect.left,
              width: Math.max(panelRect.width, 160),
              maxHeight: panelRect.maxHeight,
              backgroundColor: "var(--dls-surface-solid, var(--dls-surface))",
              color: "var(--dls-text-primary)",
            }}
          >
            {props.options.map((opt) => {
              const selected = opt.value === props.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    optionRowClasses[size],
                    "w-full border-0 outline-none focus-visible:bg-dls-hover",
                    selected
                      ? "bg-dls-list-selected text-dls-text"
                      : "bg-transparent text-dls-text hover:bg-dls-hover",
                  )}
                  style={
                    selected
                      ? { backgroundColor: "var(--dls-list-selected)" }
                      : undefined
                  }
                  onClick={() => {
                    props.onChange(opt.value);
                    close();
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {opt.label}
                  </span>
                  {selected ? (
                    <Check
                      size={16}
                      className="shrink-0 text-dls-accent"
                      aria-hidden
                    />
                  ) : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

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
      {panel}
    </div>
  );
}
