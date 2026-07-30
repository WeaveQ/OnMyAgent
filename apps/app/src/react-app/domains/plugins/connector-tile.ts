import { cn } from "@/lib/utils";

/**
 * Shared tile chrome for built-in extensions, file tools, and recommend cards.
 *
 * Fixed height (not min-h): grid only equalizes *within* a row.
 * Compact budget (9.25rem ≈ 148px).
 *
 * Hover matches 我的技能 InstalledSkillCard: list-selected lift + cursor-pointer
 * (bg-dls-hover is nearly invisible on dark canvas).
 *
 * Cross-source “enabled first” uses CSS order on each tile.
 */
export const connectorTileClassName = cn(
  "group flex h-[9.25rem] flex-col overflow-hidden rounded-2xl border border-transparent bg-dls-surface px-3 py-2.5 text-left",
  "cursor-pointer transition-[background-color,border-color,box-shadow]",
  // Light + dark: list-selected reads clearly; list-hover / plain hover is too soft.
  "hover:border-dls-border-strong hover:bg-dls-list-selected hover:shadow-sm",
  "dark:hover:border-dls-border-strong dark:hover:bg-dls-list-selected dark:hover:shadow-none",
  "focus-within:border-dls-border-strong focus-within:bg-dls-list-selected",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
  "mac:titlebar-no-drag",
);

/** Enabled tiles before disabled across the continuous 内置 grid. */
export function connectorTileOrderClass(enabled: boolean): string {
  return enabled ? "order-1" : "order-2";
}

/** Soften disabled cards (same idea as skill cards). */
export function connectorTileEnabledClass(enabled: boolean): string {
  return enabled
    ? "bg-dls-surface"
    : "bg-dls-surface-muted/40 opacity-90 hover:bg-dls-list-selected/80 dark:hover:bg-dls-list-selected/70";
}

/** Icon (size-9) + title + switch/badge — fixed so rows don't drift. */
export const connectorTileHeaderClassName =
  "flex h-9 shrink-0 items-center gap-2.5";

/** Exactly two description lines (2 × 1.125rem leading ≈ 2.25rem). */
export const connectorTileDescClassName =
  "mt-1.5 line-clamp-2 h-9 shrink-0 overflow-hidden text-xs leading-[1.125rem] text-dls-secondary";

/** Footer under description — “查看详情” / spacer, aligned across cards. */
export const connectorTileFooterClassName =
  "mt-auto flex h-6 shrink-0 items-center";
