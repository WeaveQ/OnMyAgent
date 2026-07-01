/** @jsxImportSource react */
import type { ComponentProps } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

type SendButtonProps = Omit<ComponentProps<typeof Button>, "size" | "variant"> & {
  loading?: boolean;
  label?: string;
};

export function SendButton({ className, disabled, label, loading = false, ...props }: SendButtonProps) {
  const accessibleLabel = label ?? t("session.send_message");
  const tooltipLabel = t("session.send_message");

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          variant="default"
          size="icon-lg"
          disabled={disabled}
          className={cn(
            "rounded-full",
            disabled ? "bg-dls-active text-dls-secondary" : "bg-dls-accent text-white hover:bg-dls-decision-hover",
            className,
          )}
          {...props}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          <span className="sr-only">{accessibleLabel}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}
