import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import type { ComponentProps } from "react";
import { Navigation } from "lucide-react";

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
 * Circular send control: muted disk when idle/disabled, solid disk when ready.
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
          ? "bg-dls-text text-white hover:bg-dls-text/90 hover:text-white"
          : "bg-dls-surface-muted text-dls-secondary hover:bg-dls-surface-muted hover:text-dls-secondary",
        className,
      )}
      {...props}
    >
      {loading ? (
        <LoadingSpinner size="default" />
      ) : (
        <Navigation
          className="size-4 -translate-y-px rotate-45 fill-current"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      <span className="sr-only">{accessibleLabel}</span>
    </Button>
  );
}
