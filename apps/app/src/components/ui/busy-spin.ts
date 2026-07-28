import { cn } from "@/lib/utils";

/**
 * Shared class helper for icon refresh/busy affordances.
 * Prefer this over hand-rolling `busy ? "animate-spin" : ""` at call sites.
 */
export function busySpinClass(
  busy: boolean | null | undefined,
  className?: string,
): string {
  return cn(className, busy ? "animate-spin" : undefined);
}
