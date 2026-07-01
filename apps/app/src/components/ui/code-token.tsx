import type { ComponentProps } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const codeTokenVariants = cva("font-mono leading-none", {
  variants: {
    tone: {
      neutral: "bg-dls-hover text-dls-text",
      muted: "bg-dls-surface-muted/50 text-dls-secondary",
      soft: "bg-dls-hover text-dls-secondary",
      surface: "border border-dls-border bg-dls-surface-muted/50 text-dls-secondary",
      info: "border border-dls-accent/20 bg-dls-decision-soft text-dls-accent",
      infoSoft: "bg-dls-accent/10 text-dls-accent",
    },
    size: {
      tiny: "rounded px-1 py-0.5 text-2xs",
      xs: "rounded px-1 py-0.5 text-xs",
      sm: "rounded-md px-2 py-1 text-xs",
      md: "rounded-md px-3 py-2 text-sm",
      lg: "rounded-lg px-3 py-2 text-xs",
    },
    display: {
      inline: "inline-flex items-center",
      block: "block",
    },
  },
  defaultVariants: {
    tone: "neutral",
    size: "xs",
    display: "inline",
  },
})

function CodeToken({
  className,
  tone = "neutral",
  size = "xs",
  display = "inline",
  ...props
}: ComponentProps<"code"> & VariantProps<typeof codeTokenVariants>) {
  return <code className={cn(codeTokenVariants({ tone, size, display }), className)} {...props} />
}

export { CodeToken, codeTokenVariants }
