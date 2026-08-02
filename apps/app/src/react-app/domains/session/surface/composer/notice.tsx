/** @jsxImportSource react */

import { createPortal } from "react-dom";

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

/**
 * Attach success/failure toast. Portaled to document.body so CSS `contain`
 * on the composer cannot trap fixed positioning inside the input card.
 * Top-center of the main content (right of primary rail), slide in from above.
 */
export function ReactComposerNotice(props: { notice: ReactComposerNotice | null }) {
  const tone = props.notice?.tone ?? "info";
  if (!props.notice) return null;
  if (typeof document === "undefined") return null;

  const toneClass = composerNoticeToneClass[tone];

  const hasDescription = Boolean(props.notice.description?.trim());
  const hasAction = Boolean(props.notice.actionLabel && props.notice.onAction);

  return createPortal(
    <div
      className="pointer-events-none fixed right-0 top-4 z-[200] flex justify-center px-4 left-[var(--dls-rail-width,3.5rem)] sm:top-5 mac:top-10"
      data-composer-notice-viewport="true"
    >
      <div
        className={`pointer-events-auto w-full max-w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid shadow-lg animate-in fade-in slide-in-from-top-4 duration-300 ${
          hasDescription || hasAction ? "px-3.5 py-2.5" : "px-3 py-2"
        }`}
        role="status"
        aria-live="polite"
        data-composer-notice="true"
        data-composer-notice-tone={tone}
      >
        <div
          className={`flex ${hasDescription || hasAction ? "items-start" : "items-center"} gap-2.5`}
        >
          <div
            className={`flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold leading-none ${toneClass} ${
              hasDescription || hasAction ? "mt-0.5" : ""
            }`}
          >
            {tone === "success"
              ? "✓"
              : tone === "warning"
                ? "!"
                : tone === "error"
                  ? "×"
                  : "i"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-5 text-dls-text">
              {props.notice.title}
            </div>
            {hasDescription ? (
              <p className="mt-0.5 line-clamp-3 break-all text-xs leading-5 text-dls-secondary">
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
    </div>,
    document.body,
  );
}
