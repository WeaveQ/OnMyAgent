/** @jsxImportSource react */
import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export type StatusToastProps = {
  open: boolean;
  title: string;
  description?: string | null;
  tone?: "success" | "info" | "warning" | "error";
  actionLabel?: string;
  onAction?: () => void;
  dismissLabel?: string;
  onDismiss: () => void;
  icon?: LucideIcon;
  spinIcon?: boolean;
};

const statusToastToneClass = {
  success: "border-dls-status-success-border bg-dls-status-success-soft text-dls-status-success-fg",
  warning: "border-dls-status-warning-border bg-dls-status-warning-soft text-dls-status-warning-fg",
  error: "border-dls-status-danger-border bg-dls-status-danger-soft text-dls-status-danger-fg",
  info: "border-dls-accent/30 bg-dls-accent/10 text-dls-accent",
};

const statusToastLayoutClass = {
  shell:
    "w-full max-w-[24rem] overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid animate-in fade-in slide-in-from-bottom-4 duration-300",
  /** Compact Hope-style pill when only title + optional inline action. */
  shellCompact:
    "w-auto max-w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-full border border-dls-border bg-dls-surface-solid px-3.5 py-2.5 animate-in fade-in slide-in-from-bottom-4 duration-300",
  body: "flex items-start gap-3 p-4",
  bodyCompact: "flex items-center gap-2.5",
  iconTile: "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border",
  iconCompact: "flex size-5 shrink-0 items-center justify-center text-dls-status-success-fg",
  content: "min-w-0 flex-1",
  header: "flex items-start justify-between gap-3",
  title: "text-sm font-medium text-dls-text",
  titleCompact: "text-sm font-medium text-dls-text",
  description: "mt-1 text-sm leading-relaxed text-dls-secondary",
  dismissButton: "rounded-lg text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
  actionRow: "mt-3 flex items-center gap-2",
  primaryAction: "bg-dls-decision text-white hover:bg-dls-decision-hover",
  secondaryAction: "rounded-lg text-dls-text hover:bg-dls-hover",
  /** Inline text action next to title (Hope "View" link). */
  inlineAction:
    "shrink-0 text-sm font-medium text-dls-secondary underline-offset-2 transition-colors hover:text-dls-text hover:underline",
};

export function StatusToast(props: StatusToastProps) {
  if (!props.open) return null;
  const tone = props.tone ?? "info";
  const hasDescription = Boolean(props.description?.trim());
  const hasAction = Boolean(props.actionLabel && props.onAction);
  // Compact capsule when success/info has no description (Hope move toast).
  const compact = !hasDescription && (tone === "success" || tone === "info");

  const tileClass = statusToastToneClass[tone];

  const DefaultIcon =
    tone === "success"
      ? CheckCircle2
      : tone === "warning"
        ? AlertTriangle
        : tone === "error"
          ? CircleAlert
          : Info;
  const Icon: LucideIcon = props.icon ?? DefaultIcon;

  if (compact) {
    const runAction = () => {
      if (!hasAction) return;
      props.onAction?.();
      props.onDismiss();
    };
    return (
      <div
        className={`${statusToastLayoutClass.shellCompact}${hasAction ? " cursor-pointer" : ""}`}
        data-status-toast="compact"
        role={hasAction ? "button" : undefined}
        tabIndex={hasAction ? 0 : undefined}
        onClick={hasAction ? runAction : undefined}
        onKeyDown={
          hasAction
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  runAction();
                }
              }
            : undefined
        }
      >
        <div className={statusToastLayoutClass.bodyCompact}>
          <div
            className={`${statusToastLayoutClass.iconCompact} ${
              tone === "success" ? "text-dls-status-success-fg" : ""
            }`.trim()}
          >
            <Icon size={16} strokeWidth={2.25} />
          </div>
          <span className={statusToastLayoutClass.titleCompact}>{props.title}</span>
          {hasAction ? (
            <span className={statusToastLayoutClass.inlineAction}>{props.actionLabel}</span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={statusToastLayoutClass.shell}>
      <div className={statusToastLayoutClass.body}>
        <div className={`${statusToastLayoutClass.iconTile} ${tileClass}`.trim()}>
          <Icon size={16} className={props.spinIcon ? "animate-spin" : undefined} />
        </div>

        <div className={statusToastLayoutClass.content}>
          <div className={statusToastLayoutClass.header}>
            <div>
              <div className={statusToastLayoutClass.title}>{props.title}</div>
              {hasDescription ? (
                <p className={statusToastLayoutClass.description}>{props.description}</p>
              ) : null}
            </div>

            <Button
              type="button"
              onClick={props.onDismiss}
              variant="ghost"
              size="icon-xs"
              className={statusToastLayoutClass.dismissButton}
              aria-label={props.dismissLabel ?? "Dismiss"}
            >
              <X size={16} />
            </Button>
          </div>

          {hasAction ? (
            <div className={statusToastLayoutClass.actionRow}>
              <Button
                type="button"
                size="sm"
                className={statusToastLayoutClass.primaryAction}
                onClick={() => props.onAction?.()}
              >
                {props.actionLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={statusToastLayoutClass.secondaryAction}
                onClick={props.onDismiss}
              >
                {props.dismissLabel ?? "Dismiss"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
