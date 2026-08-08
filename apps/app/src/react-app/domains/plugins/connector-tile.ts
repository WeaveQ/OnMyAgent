import { cn } from "@/lib/utils";

/**
 * Shared tile chrome for built-in extensions, file tools, and recommend cards.
 *
 * Fixed height (not min-h): grid only equalizes *within* a row.
 * Compact budget (h-32 ≈ 8rem) — logo + title/action + up to 3-line desc.
 *
 * Hover matches InstalledSkillCard: list-selected lift + cursor-pointer.
 * Cross-source “enabled first” uses CSS order on each tile.
 */
export const connectorTileClassName = cn(
  "group flex h-32 flex-col overflow-hidden rounded-2xl border border-transparent bg-dls-surface px-3 py-2 text-left",
  "cursor-pointer transition-[background-color,border-color,box-shadow]",
  // Light + dark: list-selected reads clearly; list-hover / plain hover is too soft.
  "hover:border-dls-border-strong hover:bg-dls-list-selected hover:shadow-sm",
  "dark:hover:border-dls-border-strong dark:hover:bg-dls-list-selected dark:hover:shadow-none",
  "focus-within:border-dls-border-strong focus-within:bg-dls-list-selected",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
  "mac:titlebar-no-drag",
);

/** Enabled tiles before disabled across the continuous built-in grid. */
export function connectorTileOrderClass(enabled: boolean): string {
  return enabled ? "order-1" : "order-2";
}

/** Soften disabled cards (same idea as skill cards). */
export function connectorTileEnabledClass(enabled: boolean): string {
  return enabled
    ? "bg-dls-surface"
    : "bg-dls-surface-muted/40 opacity-90 hover:bg-dls-list-selected/80 dark:hover:bg-dls-list-selected/70";
}

/** Icon (size-9) + title + switch/action — fixed so rows don't drift. */
export const connectorTileHeaderClassName =
  "flex h-9 shrink-0 items-center gap-2.5";

/** Up to three description lines (3 × 1.125rem leading ≈ 3.375rem). */
export const connectorTileDescClassName =
  "mt-1 line-clamp-3 min-h-0 flex-1 overflow-hidden text-xs leading-[1.125rem] text-dls-secondary";

/** Shared + / chat / busy action chip on connector tiles. */
export const connectorTileActionClassName = cn(
  "inline-flex size-8 items-center justify-center rounded-xl",
  "bg-dls-surface-muted text-dls-text",
  "transition-colors hover:bg-dls-hover hover:text-dls-text",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
);

/** Emphasized “add” chip (idle recommend connectors). */
export const connectorTileActionPlusClassName = cn(
  connectorTileActionClassName,
  "shadow-sm ring-1 ring-dls-border/60 hover:ring-dls-border",
);

/** @deprecated Prefer no footer label — recommend-style cards use mt-auto spacer only. */
export const connectorTileFooterClassName =
  "mt-auto flex h-0 shrink-0 items-center";
