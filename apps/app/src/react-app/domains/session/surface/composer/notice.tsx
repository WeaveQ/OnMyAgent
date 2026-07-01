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
  warning: "border-dls-status-warning/25 bg-dls-status-warning/12 text-dls-status-warning",
  error: "border-dls-status-danger/30 bg-dls-status-danger-soft text-dls-status-danger-fg",
  info: "border-dls-accent/25 bg-dls-accent/10 text-dls-accent",
};

export function ReactComposerNotice(props: { notice: ReactComposerNotice | null }) {
  const tone = props.notice?.tone ?? "info";
  if (!props.notice) return null;

  const toneClass = composerNoticeToneClass[tone];

  return (
    <div className="absolute bottom-full right-0 z-30 mb-3 w-[min(26rem,calc(100vw-2rem))] max-w-full overflow-hidden rounded-xl border border-dls-border bg-dls-surface px-4 py-3 backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-xs font-medium ${toneClass}`}>
          {tone === "success" ? "✓" : tone === "warning" ? "!" : tone === "error" ? "×" : "i"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-relaxed text-dls-text">{props.notice.title}</div>
          {props.notice.description?.trim() ? (
            <p className="mt-1 text-xs leading-relaxed text-dls-secondary">{props.notice.description}</p>
          ) : null}
          {props.notice.actionLabel && props.notice.onAction ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="mt-3 rounded-full text-dls-text hover:bg-dls-hover"
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
