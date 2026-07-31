/**
 * Shared list-lane chrome for full-width primary create CTAs.
 * DESIGN.md components.contracts.sidebar-primary-cta.
 *
 * Geometry lives on Button `size="sidebar-cta"` (h-10 + rounded-lg).
 * These classes only own surface/border/hover + the h-14 header strip.
 */

/** Surface/border for full-width list-lane create CTA. */
export const SIDEBAR_PRIMARY_CTA_CLASS =
  "border border-dls-border bg-dls-surface-solid text-dls-text shadow-none hover:bg-dls-hover hover:border-dls-border before:rounded-lg";

/**
 * Top strip for sidebar primary CTA — same h-14 as SessionSurfaceHeader
 * so list-lane create and main title row share one baseline.
 */
export const SIDEBAR_PRIMARY_HEADER_CLASS =
  // pt bias so the h-10 CTA sits slightly below vertical center (less titlebar-tight).
  "flex h-14 shrink-0 items-center pt-1.5";
