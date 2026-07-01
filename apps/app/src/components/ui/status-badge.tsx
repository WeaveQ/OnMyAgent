import type { ComponentProps } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const statusBadgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold leading-none",
  {
    variants: {
      tone: {
        neutral: "bg-dls-icon-muted-bg text-dls-secondary ring-1 ring-dls-border",
        surface: "bg-dls-surface text-dls-secondary ring-1 ring-dls-border",
        accent: "bg-dls-accent/10 text-dls-accent ring-1 ring-dls-accent/20",
        success: "bg-dls-status-success-soft text-dls-status-success-fg ring-1 ring-dls-status-success-border",
        warning: "bg-dls-status-warning/12 text-dls-status-warning ring-1 ring-dls-status-warning/25",
        danger: "bg-dls-status-danger-soft text-dls-status-danger-fg ring-1 ring-dls-status-danger/30",
      },
      shape: {
        pill: "rounded-full",
        soft: "rounded-md",
      },
      size: {
        tiny: "px-1.5 py-0.5 text-2xs",
        fileType: "h-3.5 min-w-3.5 rounded-xs px-0.5 text-2xs font-bold",
        sm: "px-2 py-0.5 text-xs",
        default: "px-2 py-1 text-xs",
        notice: "px-2 py-1.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      tone: "neutral",
      shape: "pill",
      size: "sm",
    },
  }
)

const countBadgeVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full bg-dls-surface-muted font-medium leading-none text-dls-secondary",
  {
    variants: {
      size: {
        default: "h-7 min-w-7 px-2 text-xs",
        compact: "h-6 min-w-6 px-2 text-xs",
        dot: "min-h-3.5 min-w-3.5 px-1 text-2xs font-semibold",
        label: "min-h-5 rounded-md px-2 py-0.5 text-xs",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const stepMarkerVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full bg-dls-active font-semibold leading-none text-dls-secondary",
  {
    variants: {
      size: {
        sm: "size-4 text-2xs",
        default: "size-6 text-xs",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

const badgeDotVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full font-medium leading-none",
  {
    variants: {
      tone: {
        accent: "bg-dls-accent text-white",
        currentOutline: "border border-current text-current",
        surfaceOutline: "border border-dls-border-strong bg-dls-surface text-dls-secondary",
      },
      size: {
        xs: "size-4 text-xs",
        sm: "size-4.5 text-xs",
        default: "size-5 text-xs",
        logo: "size-9 text-2xl",
      },
    },
    defaultVariants: {
      tone: "accent",
      size: "default",
    },
  }
)

function StatusBadge({
  className,
  tone = "neutral",
  shape = "pill",
  size = "sm",
  ...props
}: ComponentProps<"span"> & VariantProps<typeof statusBadgeVariants>) {
  return <span className={cn(statusBadgeVariants({ tone, shape, size }), className)} {...props} />
}

function CountBadge({
  className,
  size = "default",
  ...props
}: ComponentProps<"span"> & VariantProps<typeof countBadgeVariants>) {
  return <span className={cn(countBadgeVariants({ size }), className)} {...props} />
}

function StepMarker({
  className,
  size = "default",
  ...props
}: ComponentProps<"span"> & VariantProps<typeof stepMarkerVariants>) {
  return <span className={cn(stepMarkerVariants({ size }), className)} {...props} />
}

function BadgeDot({
  className,
  tone = "accent",
  size = "default",
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeDotVariants>) {
  return <span className={cn(badgeDotVariants({ tone, size }), className)} {...props} />
}

type StatusBadgeTone = NonNullable<VariantProps<typeof statusBadgeVariants>["tone"]>

export { BadgeDot, CountBadge, StatusBadge, StepMarker, badgeDotVariants, countBadgeVariants, statusBadgeVariants, stepMarkerVariants, type StatusBadgeTone }
