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

/** Surface/border for full-width list-lane create CTA (legacy top-strip style). */
export const SIDEBAR_PRIMARY_CTA_CLASS =
  "border border-dls-border bg-dls-surface-solid text-dls-text shadow-none hover:bg-dls-hover hover:border-dls-border before:rounded-lg";

/**
 * Footer create CTA shared by home (New task), experts (Create expert), and
 * automation (Add) — filled soft surface, no outline border.
 * Pair with Button variant="ghost" size="sidebar-cta".
 */
export const SIDEBAR_FOOTER_CTA_CLASS =
  "mac:titlebar-no-drag border-0 bg-dls-active dark:bg-dls-surface-muted text-dls-text shadow-none hover:bg-dls-hover hover:text-dls-text before:rounded-lg";

/**
 * Top strip for residual list-lane headers (search band, content headers).
 * Slight pt bias so h-10 controls sit slightly below vertical center.
 */
export const SIDEBAR_PRIMARY_HEADER_CLASS = `${LIST_LANE_HEADER_CLASS} pt-1.5`;

/**
 * Row hover actions — plain button chrome (not Button primitive) so icon
 * size/padding never fights the fixed flex center box. Single source for
 * home task rows + automation nav rows.
 */
export const TASK_ROW_ACTION_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 leading-none text-dls-secondary outline-none transition-colors hover:text-dls-text focus-visible:ring-1 focus-visible:ring-dls-focus focus-visible:ring-offset-0 [&_svg]:pointer-events-none [&_svg]:block [&_svg]:size-3.5 [&_svg]:shrink-0";

/**
 * WorkBuddy-style task/session context menu chrome — home, experts, automation.
 * surface-solid: opaque on macOS Electron glass (bg-dls-surface is translucent).
 * Icons must stay size-4; bare Lucide defaults are 24px and blow up the menu.
 */
export const TASK_CONTEXT_MENU_CLASS =
  "fixed z-[100] min-w-[11.5rem] overflow-hidden rounded-2xl border border-dls-border/70 bg-dls-surface-solid p-1.5 text-sm text-dls-text shadow-[0_10px_30px_rgba(15,23,42,0.12)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.45)]";

export const TASK_CONTEXT_MENU_SEPARATOR_CLASS = "my-1 h-px bg-dls-border/80";

/** Matches `min-w-[11.5rem]` on TASK_CONTEXT_MENU_CLASS. */
export const TASK_CONTEXT_MENU_WIDTH = 184;

/** Quiet outline row — icon + label, soft hover wash. */
export const TASK_CONTEXT_MENU_ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-normal text-dls-text outline-none transition-colors hover:bg-dls-surface-muted focus-visible:bg-dls-surface-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-dls-secondary";

/**
 * Place a fixed context menu relative to an anchor.
 * Prefer below; flip above when remaining space under the anchor is short.
 */
export function positionTaskContextMenu(
  anchor: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  options?: {
    width?: number;
    /** Approximate menu height before measure; default covers ~5 rows. */
    estimatedHeight?: number;
    gap?: number;
    margin?: number;
  },
): { left: number; top: number } {
  const width = options?.width ?? TASK_CONTEXT_MENU_WIDTH;
  const height = options?.estimatedHeight ?? 220;
  const gap = options?.gap ?? 4;
  const margin = options?.margin ?? 8;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;

  let left = anchor.right - width;
  left = Math.min(Math.max(margin, left), Math.max(margin, viewportWidth - width - margin));

  const spaceBelow = viewportHeight - anchor.bottom - margin;
  const spaceAbove = anchor.top - margin;
  const openBelow = spaceBelow >= height || (spaceBelow >= spaceAbove && spaceBelow >= 96);

  let top = openBelow ? anchor.bottom + gap : anchor.top - gap - height;

  top = Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - height - margin));

  return { left, top };
}
