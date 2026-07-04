import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

type InputProps = React.ComponentProps<"input"> & {
  variant?: "default" | "dls" | "dlsMono";
  controlSize?: "default" | "lg" | "xl";
  radius?: "default" | "xl" | "2xl";
  density?: "default" | "comfortable";
}

function Input({
  className,
  type,
  variant = "default",
  controlSize = "default",
  radius = "default",
  density = "default",
  ...props
}: InputProps) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-border px-3 py-1 text-base transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 relative inline-flex bg-background not-dark:bg-clip-padding text-foreground ring-ring/24 before:pointer-events-none before:absolute before:inset-0 before:rounded-lg has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-autofill:bg-foreground/4 has-disabled:opacity-64 has-focus-visible:ring-3 sm:text-sm dark:bg-background/40 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24 ",
        variant === "dls" && "border-dls-border bg-dls-surface text-sm text-dls-text placeholder:text-dls-secondary/70 focus-visible:border-dls-accent",
        variant === "dlsMono" && "rounded-xl border-dls-border bg-dls-surface font-mono text-xs text-dls-text placeholder:text-dls-secondary focus-visible:border-dls-accent",
        controlSize === "lg" && "h-10",
        controlSize === "xl" && "h-11",
        radius === "xl" && "rounded-xl before:rounded-xl",
        radius === "2xl" && "rounded-xl before:rounded-xl",
        density === "comfortable" && "px-4",
        className
      )}
      {...props}
    />
  )
}

export { Input }
