/**
 * Shared list-lane chrome for full-width primary create CTAs and residual
 * main-shell h-14 headers.
 * DESIGN.md components.contracts.sidebar-primary-cta.
 *
 * Geometry for the CTA button lives on Button `size="sidebar-cta"` (h-10 + rounded-lg).
 * These classes own surface/border/hover + the fixed h-14 header strip family.
 */

/**
 * Shared fixed h-14 strip geometry for list-lane + residual main headers
 * (home CTA strip, expert list search band, automation content header,
 * SessionSurfaceHeader baseline). Consumers add padding / justify as needed.
 */
export const LIST_LANE_HEADER_CLASS = "flex h-14 shrink-0 items-center";

/** Surface/border for full-width list-lane create CTA. */
export const SIDEBAR_PRIMARY_CTA_CLASS =
  "border border-dls-border bg-dls-surface-solid text-dls-text shadow-none hover:bg-dls-hover hover:border-dls-border before:rounded-lg";

/**
 * Top strip for sidebar primary CTA — same h-14 as SessionSurfaceHeader
 * so list-lane create and main title row share one baseline.
 * Slight pt bias so the h-10 CTA sits slightly below vertical center
 * (less titlebar-tight).
 */
export const SIDEBAR_PRIMARY_HEADER_CLASS = `${LIST_LANE_HEADER_CLASS} pt-1.5`;

/**
 * Row hover actions — plain button chrome (not Button primitive) so icon
 * size/padding never fights the fixed flex center box. Single source for
 * home task rows + automation nav rows.
 */
export const TASK_ROW_ACTION_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 leading-none text-dls-secondary outline-none transition-colors hover:text-dls-text focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:pointer-events-none [&_svg]:block [&_svg]:size-3.5 [&_svg]:shrink-0";
