import type { ComponentProps, ReactNode } from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * Tool approval surface — DESIGN.md § 4f risk tiers.
 * safe: no left border; careful: 2px warning; destructive: 4px danger.
 */
const toolApprovalCardVariants = cva(
  "rounded-xl border border-dls-border bg-dls-surface text-dls-text",
  {
    variants: {
      risk: {
        safe: "border-l-0",
        careful: "border-l-[2px] border-l-dls-status-warning",
        destructive: "border-l-[4px] border-l-dls-status-danger",
      },
    },
    defaultVariants: {
      risk: "safe",
    },
  },
)

export type ToolApprovalRisk = NonNullable<VariantProps<typeof toolApprovalCardVariants>["risk"]>

function ToolApprovalCard({
  className,
  risk = "safe",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof toolApprovalCardVariants>) {
  return (
    <div
      data-slot="tool-approval-card"
      data-risk={risk}
      className={cn(toolApprovalCardVariants({ risk }), className)}
      {...props}
    />
  )
}

function ToolApprovalCardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="tool-approval-header"
      className={cn("flex items-start gap-3 px-4 pt-4", className)}
      {...props}
    />
  )
}

function ToolApprovalCardBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="tool-approval-body" className={cn("space-y-3 px-4 py-3", className)} {...props} />
  )
}

function ToolApprovalCardFooter({
  className,
  risk = "safe",
  denyLabel,
  allowOnceLabel,
  allowAlwaysLabel,
  busy,
  onDeny,
  onAllowOnce,
  onAllowAlways,
  ...props
}: ComponentProps<"div"> & {
  risk?: ToolApprovalRisk
  denyLabel: ReactNode
  allowOnceLabel: ReactNode
  allowAlwaysLabel?: ReactNode
  busy?: boolean
  onDeny: () => void
  onAllowOnce: () => void
  onAllowAlways?: () => void
}) {
  const primaryVariant = risk === "destructive" ? "destructive" : "default"
  return (
    <div
      data-slot="tool-approval-footer"
      className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-dls-border px-4 py-3", className)}
      {...props}
    >
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onDeny} autoFocus={risk === "destructive"}>
        {denyLabel}
      </Button>
      {allowAlwaysLabel && onAllowAlways ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onAllowAlways}>
          {allowAlwaysLabel}
        </Button>
      ) : null}
      <Button
        type="button"
        variant={primaryVariant}
        size="sm"
        disabled={busy}
        onClick={onAllowOnce}
        autoFocus={risk !== "destructive"}
      >
        {allowOnceLabel}
      </Button>
    </div>
  )
}

export {
  ToolApprovalCard,
  ToolApprovalCardHeader,
  ToolApprovalCardBody,
  ToolApprovalCardFooter,
  toolApprovalCardVariants,
}
