import type { ComponentProps } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const statusDotVariants = cva("shrink-0 rounded-full", {
  variants: {
    size: {
      xs: "size-1.5",
      md: "size-2",
      sm: "size-2.5",
    },
    tone: {
      active: "bg-dls-accent",
      success: "bg-dls-status-success",
      muted: "bg-dls-secondary",
      current: "bg-current",
      warning: "bg-dls-status-warning",
      danger: "bg-dls-status-danger",
    },
    pulse: {
      true: "animate-pulse",
      false: "",
    },
  },
  defaultVariants: {
    size: "xs",
    tone: "muted",
    pulse: false,
  },
})

const statusPingVariants = cva("relative inline-flex shrink-0", {
  variants: {
    size: {
      xs: "size-2",
      sm: "size-2",
      status: "size-2.5",
      md: "size-3",
    },
    tone: {
      blue: "text-dls-accent",
      warning: "text-dls-status-warning",
    },
    glow: {
      soft: "[&_[data-slot=ping-glow]]:opacity-35",
      default: "[&_[data-slot=ping-glow]]:opacity-70",
    },
  },
  defaultVariants: {
    size: "sm",
    tone: "blue",
    glow: "default",
  },
})

const statusPingCoreVariants = cva("relative inline-flex rounded-full bg-current", {
  variants: {
    inset: {
      true: "size-2 border border-dls-surface",
      false: "size-full",
    },
  },
  defaultVariants: {
    inset: false,
  },
})

function StatusDot({
  className,
  size = "xs",
  tone = "muted",
  pulse = false,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof statusDotVariants>) {
  return <span aria-hidden="true" className={cn(statusDotVariants({ size, tone, pulse }), className)} {...props} />
}

function StatusPing({
  className,
  inset = false,
  glow = "default",
  size = "sm",
  tone = "blue",
  ...props
}: ComponentProps<"span"> & VariantProps<typeof statusPingVariants> & VariantProps<typeof statusPingCoreVariants>) {
  return (
    <span className={cn(statusPingVariants({ size, tone, glow }), className)} {...props}>
      <span data-slot="ping-glow" className="absolute inline-flex size-full animate-ping rounded-full bg-current" />
      <span className={cn(statusPingCoreVariants({ inset }))} />
    </span>
  )
}

export { StatusDot, StatusPing, statusDotVariants, statusPingVariants }
