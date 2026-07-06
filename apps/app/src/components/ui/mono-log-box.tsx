import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// DESIGN.md § 4g Code & Diff. Mono readout for URLs, IDs, poll traces,
// webhook targets — a stack of read-only debug/telemetry lines that
// shouldn't be a `CodeToken` (multi-line, sometimes multi-block) but
// also shouldn't inherit rich markdown/pre styling. Consolidates the
// repeated `rounded-md bg-dls-surface-muted p-2 font-mono text-xs
// text-dls-secondary` pattern used in channel panels.
const monoLogBoxVariants = cva(
  "rounded-md bg-dls-surface-muted font-mono text-xs text-dls-secondary",
  {
    variants: {
      size: {
        default: "p-2",
        inline: "px-2 py-1.5",
      },
      wrap: {
        break: "break-all",
        wrap: "whitespace-pre-wrap break-words",
        none: "",
      },
      density: {
        default: "",
        stacked: "space-y-1 leading-4",
      },
    },
    defaultVariants: {
      size: "default",
      wrap: "break",
      density: "default",
    },
  },
);

type MonoLogBoxProps = ComponentProps<"div"> & VariantProps<typeof monoLogBoxVariants>;

function MonoLogBox({ className, size, wrap, density, ...props }: MonoLogBoxProps) {
  return <div className={cn(monoLogBoxVariants({ size, wrap, density }), className)} {...props} />;
}

export { MonoLogBox, monoLogBoxVariants };
export type { MonoLogBoxProps };
