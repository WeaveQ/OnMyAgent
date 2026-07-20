import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import type { ComponentProps } from "react";
import { ArrowUp } from "lucide-react";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";

type SendButtonProps = Omit<
  ComponentProps<typeof Button>,
  "size" | "variant"
> & {
  loading?: boolean;
  label?: string;
};

/**
 * Circular send control (DESIGN.md §11):
 * - Ready (has draft): solid decision blue, primary CTA
 * - Idle/empty: muted ghost disk — clearly not the active action
 */
export function SendButton({
  className,
  disabled,
  label,
  loading = false,
  title,
  ...props
}: SendButtonProps) {
  const accessibleLabel = label ?? t("session.send_message");
  const ready = !disabled && !loading;

  return (
    <Button
      variant={ready ? "default" : "ghost"}
      size="icon-lg"
      disabled={disabled}
      title={title ?? accessibleLabel}
      aria-label={accessibleLabel}
      className={cn(
        "rounded-full",
        ready
          ? "border-0 bg-dls-decision text-white shadow-sm hover:bg-dls-decision-hover hover:text-white"
          : "border border-dls-border/70 bg-dls-surface-muted text-dls-secondary/70 shadow-none hover:bg-dls-surface-muted hover:text-dls-secondary/70",
        // Keep idle disk fully opaque (base Button uses disabled:opacity-50).
        "disabled:pointer-events-none disabled:opacity-100",
        className,
      )}
      {...props}
    >
      {loading ? (
        <LoadingSpinner size="default" className={ready ? "text-white" : "text-dls-secondary"} />
      ) : (
        <ArrowUp
          className="size-5"
          strokeWidth={ready ? 2.5 : 2}
          aria-hidden
        />
      )}
      <span className="sr-only">{accessibleLabel}</span>
    </Button>
  );
}
