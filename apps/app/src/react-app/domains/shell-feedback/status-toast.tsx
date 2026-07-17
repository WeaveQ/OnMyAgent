/** @jsxImportSource react */
import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from "lucide-react";

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
};

const statusToastToneClass = {
  success: "border-dls-status-success-border bg-dls-status-success-soft text-dls-status-success-fg",
  warning: "border-dls-status-warning-border bg-dls-status-warning-soft text-dls-status-warning-fg",
  error: "border-dls-status-danger-border bg-dls-status-danger-soft text-dls-status-danger-fg",
  info: "border-dls-accent/30 bg-dls-accent/10 text-dls-accent",
};

const statusToastLayoutClass = {
  shell: "w-full max-w-[24rem] overflow-hidden rounded-xl border border-dls-border bg-dls-surface backdrop-blur-xl animate-in fade-in slide-in-from-top-4 duration-300",
  body: "flex items-start gap-3 p-4",
  iconTile: "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border",
  content: "min-w-0 flex-1",
  header: "flex items-start justify-between gap-3",
  title: "text-sm font-medium text-dls-text",
  description: "mt-1 text-sm leading-relaxed text-dls-secondary",
  dismissButton: "rounded-lg text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
  actionRow: "mt-3 flex items-center gap-2",
  primaryAction: "rounded-lg bg-dls-accent text-dls-accent-fg hover:bg-dls-accent-hover",
  secondaryAction: "rounded-lg text-dls-text hover:bg-dls-hover",
};

export function StatusToast(props: StatusToastProps) {
  if (!props.open) return null;
  const tone = props.tone ?? "info";

  const tileClass = statusToastToneClass[tone];

  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "warning"
        ? AlertTriangle
        : tone === "error"
          ? CircleAlert
          : Info;

  return (
    <div className={statusToastLayoutClass.shell}>
      <div className={statusToastLayoutClass.body}>
        <div
          className={`${statusToastLayoutClass.iconTile} ${tileClass}`.trim()}
        >
          <Icon size={16} />
        </div>

        <div className={statusToastLayoutClass.content}>
          <div className={statusToastLayoutClass.header}>
            <div>
              <div className={statusToastLayoutClass.title}>
                {props.title}
              </div>
              {props.description?.trim() ? (
                <p className={statusToastLayoutClass.description}>
                  {props.description}
                </p>
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

          {props.actionLabel && props.onAction ? (
            <div className={statusToastLayoutClass.actionRow}>
              <Button
                type="button"
                size="xs"
                className={statusToastLayoutClass.primaryAction}
                onClick={() => props.onAction?.()}
              >
                {props.actionLabel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
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
