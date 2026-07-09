import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

/**
 * Streaming caret — DESIGN.md § 4d.
 * Block 6×12, signal color, 320ms blink; pause glyph after idle threshold
 * is owned by the parent (swap children when stream stalls).
 */
function StreamingCursor({
  className,
  paused = false,
  ...props
}: ComponentProps<"span"> & { paused?: boolean }) {
  if (paused) {
    return (
      <span
        data-slot="streaming-cursor"
        data-paused="true"
        aria-hidden="true"
        className={cn("inline-block align-middle text-dls-secondary", className)}
        {...props}
      >
        …
      </span>
    )
  }
  return (
    <span
      data-slot="streaming-cursor"
      aria-hidden="true"
      className={cn(
        "inline-block h-3 w-1.5 shrink-0 align-middle bg-dls-signal motion-safe:animate-pulse",
        className,
      )}
      style={{ animationDuration: "320ms" }}
      {...props}
    />
  )
}

export { StreamingCursor }
