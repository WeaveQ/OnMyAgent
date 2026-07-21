/** @jsxImportSource react */

import { Button } from "@/components/ui/button";

export type ReactComposerNotice = {
  title: string;
  description?: string | null;
  tone?: "info" | "success" | "warning" | "error";
  actionLabel?: string;
  onAction?: () => void;
};

const composerNoticeToneClass = {
  success: "border-dls-status-success-border bg-dls-status-success-soft text-dls-status-success-fg",
  warning: "border-dls-status-warning-border bg-dls-status-warning-soft text-dls-status-warning-fg",
  error: "border-dls-status-danger-border bg-dls-status-danger-soft text-dls-status-danger-fg",
  info: "border-dls-accent/30 bg-dls-accent/10 text-dls-accent",
};

export function ReactComposerNotice(props: { notice: ReactComposerNotice | null }) {
  const tone = props.notice?.tone ?? "info";
  if (!props.notice) return null;

  const toneClass = composerNoticeToneClass[tone];

  const hasDescription = Boolean(props.notice.description?.trim());
  const hasAction = Boolean(props.notice.actionLabel && props.notice.onAction);

  return (
    <div
      className={`absolute bottom-full right-0 z-30 mb-2 max-w-[min(16rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-dls-border bg-dls-surface-solid shadow-sm ${
        hasDescription || hasAction ? "px-3 py-2" : "px-2.5 py-1.5"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className={`flex ${hasDescription || hasAction ? "items-start" : "items-center"} gap-2`}>
        <div
          className={`flex size-5 shrink-0 items-center justify-center rounded-md border text-2xs font-semibold leading-none ${toneClass} ${
            hasDescription || hasAction ? "mt-0.5" : ""
          }`}
        >
          {tone === "success" ? "✓" : tone === "warning" ? "!" : tone === "error" ? "×" : "i"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium leading-4 text-dls-text">
            {props.notice.title}
          </div>
          {hasDescription ? (
            <p className="mt-0.5 line-clamp-2 break-all text-2xs leading-4 text-dls-secondary">
              {props.notice.description}
            </p>
          ) : null}
          {hasAction ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="mt-1.5 text-dls-text hover:bg-dls-hover"
              onClick={() => props.notice?.onAction?.()}
            >
              {props.notice.actionLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
