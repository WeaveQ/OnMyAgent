import type { ComponentProps } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const noticeBoxVariants = cva("rounded-xl border px-3 py-2 text-xs", {
  variants: {
    tone: {
      neutral: "border-dls-border bg-dls-hover text-dls-secondary",
      error: "border-dls-status-danger/30 bg-dls-status-danger-soft text-dls-status-danger-fg",
      warning: "border-dls-status-warning/25 bg-dls-status-warning/12 text-dls-status-warning",
      info: "border-dls-accent/30 bg-dls-accent/10 text-dls-accent",
    },
    size: {
      default: "px-3 py-2 text-xs",
      content: "px-4 py-3 text-xs",
      comfortable: "px-5 py-4 text-sm",
    },
  },
  defaultVariants: {
    tone: "neutral",
    size: "default",
  },
})

const emptyStateBoxVariants = cva(
  "rounded-lg border border-dashed border-dls-border text-center text-dls-secondary",
  {
    variants: {
      size: {
        default: "px-4 py-10 text-sm",
        compact: "px-3 py-2 text-xs",
        comfortable: "px-4 py-7 text-sm",
        spacious: "px-6 py-14 text-sm",
      },
      tone: {
        muted: "bg-dls-surface-muted",
        surface: "bg-dls-surface",
      },
    },
    defaultVariants: {
      size: "default",
      tone: "muted",
    },
  }
)

function NoticeBox({
  className,
  tone = "neutral",
  size = "default",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof noticeBoxVariants>) {
  return <div className={cn(noticeBoxVariants({ tone, size }), className)} {...props} />
}

function EmptyStateBox({
  className,
  size = "default",
  tone = "muted",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof emptyStateBoxVariants>) {
  return <div className={cn(emptyStateBoxVariants({ size, tone }), className)} {...props} />
}

type NoticeBoxTone = NonNullable<VariantProps<typeof noticeBoxVariants>["tone"]>
type NoticeBoxSize = NonNullable<VariantProps<typeof noticeBoxVariants>["size"]>
type EmptyStateBoxSize = NonNullable<VariantProps<typeof emptyStateBoxVariants>["size"]>
type EmptyStateBoxTone = NonNullable<VariantProps<typeof emptyStateBoxVariants>["tone"]>

export {
  EmptyStateBox,
  NoticeBox,
  emptyStateBoxVariants,
  noticeBoxVariants,
  type EmptyStateBoxSize,
  type EmptyStateBoxTone,
  type NoticeBoxSize,
  type NoticeBoxTone,
}
