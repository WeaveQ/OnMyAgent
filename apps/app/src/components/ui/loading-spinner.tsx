import type { ComponentProps } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const loadingSpinnerVariants = cva("shrink-0 animate-spin rounded-full border-2", {
  variants: {
    size: {
      sm: "size-3.5",
      default: "size-4",
    },
    tone: {
      inverse: "border-dls-surface/30 border-t-white",
      muted: "border-dls-border border-t-dls-secondary",
    },
  },
  defaultVariants: {
    size: "default",
    tone: "muted",
  },
})

function LoadingSpinner({
  className,
  size = "default",
  tone = "muted",
  ...props
}: ComponentProps<"span"> & VariantProps<typeof loadingSpinnerVariants>) {
  return <span aria-hidden="true" className={cn(loadingSpinnerVariants({ size, tone }), className)} {...props} />
}

export { LoadingSpinner, loadingSpinnerVariants }
