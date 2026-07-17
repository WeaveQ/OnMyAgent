import * as React from "react";

import { cn } from "@/lib/utils"

type TextareaProps = React.ComponentProps<"textarea"> & {
  variant?: "default" | "dlsMono";
  controlSize?: "default" | "editor" | "largeEditor";
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, variant = "default", controlSize = "default", ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "field-sizing-content flex min-h-16 w-full min-w-0 resize-none rounded-lg border border-dls-border bg-dls-background px-3 py-3 text-base not-dark:bg-clip-padding text-dls-text ring-ring/24 transition-colors outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-lg placeholder:text-dls-secondary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 has-focus-visible:has-aria-invalid:border-dls-status-danger-border has-focus-visible:has-aria-invalid:ring-dls-danger/15 has-aria-invalid:border-dls-status-danger-border has-focus-visible:border-ring has-autofill:bg-foreground/4 has-disabled:opacity-64 has-focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-dls-status-danger-border aria-invalid:ring-3 aria-invalid:ring-dls-danger/20 md:text-sm sm:text-sm dark:bg-dls-background/40 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-dls-danger/25 dark:aria-invalid:border-dls-status-danger-border dark:aria-invalid:ring-dls-danger/40  relative",
        variant === "dlsMono" && "border-dls-border bg-dls-surface font-mono text-sm text-dls-text placeholder:text-dls-secondary focus-visible:ring-dls-accent/30",
        controlSize === "editor" && "min-h-[220px] px-3 py-2.5",
        controlSize === "largeEditor" && "min-h-[420px] rounded-xl bg-dls-hover px-4 py-3 text-xs",
        className
      )}
      {...props}
    />
  )
})

export { Textarea }
