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
 * Circular send control (DESIGN.md §11): brand-blue solid disk when ready,
 * muted disk when idle/disabled. Arrow points up and is sized larger than
 * default button svg so it stays readable on the 40px disk.
 * No Tooltip — nested TooltipTrigger wrappers were producing empty white bubbles.
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
      variant="ghost"
      size="icon-lg"
      disabled={disabled}
      title={title ?? accessibleLabel}
      aria-label={accessibleLabel}
      className={cn(
        "rounded-full border-0 shadow-none",
        ready
          ? "bg-dls-decision text-white hover:bg-dls-decision-hover hover:text-white"
          : "bg-dls-surface-muted text-dls-secondary hover:bg-dls-surface-muted hover:text-dls-secondary disabled:opacity-100",
        className,
      )}
      {...props}
    >
      {loading ? (
        <LoadingSpinner size="default" className={ready ? "text-white" : "text-dls-secondary"} />
      ) : (
        <ArrowUp
          className="size-5"
          strokeWidth={2.5}
          aria-hidden
        />
      )}
      <span className="sr-only">{accessibleLabel}</span>
    </Button>
  );
}
