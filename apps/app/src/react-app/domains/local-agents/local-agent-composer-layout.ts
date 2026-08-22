import { cn } from "@/lib/utils";

/** Pure class model for Local Agent composer chrome. Copied visually from
 *  in-session ReactSessionComposer; no session imports (domain boundary). */
export const localAgentComposerClass = {
  toolButton: "text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
  activeToolButton: "bg-dls-surface-muted text-dls-text",
  toolsCluster: "flex min-w-0 flex-nowrap items-center overflow-visible gap-0.5",
  trailingCluster: "ml-auto flex min-w-0 shrink-0 items-center gap-0.5",
  actionRow: "mt-2 flex items-end justify-between gap-2",
  menuAnchor: "absolute bottom-full left-[-1px] right-[-1px] z-30 mb-1.5",
  menuPanel: "overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid",
  menuScroll: "max-h-72 overflow-y-auto px-1.5 py-2",
  itemIcon: "mt-0.5 shrink-0 text-dls-secondary",
  itemTitle: "truncate text-sm font-medium leading-5 text-dls-text",
  itemMeta: "truncate text-sm leading-5 text-dls-secondary",
  toolMenuPanel:
    "absolute bottom-full left-0 z-50 mb-1.5 w-56 overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid p-1.5",
  dropOverlay:
    "pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-dls-accent bg-dls-accent-mix-10",
  attachmentRail: "flex flex-wrap gap-2 px-4 pt-3",
  attachmentChip: "group/att flex max-w-full items-center gap-2 rounded-lg bg-dls-surface-muted px-2 py-1.5 text-xs",
  modelChip:
    "w-auto min-w-0 max-w-40 @max-[32rem]/local-composer:max-w-20 [&>button]:!h-8 [&>button]:!min-h-8 [&>button]:!w-auto [&>button]:!max-w-40 @max-[32rem]/local-composer:[&>button]:!max-w-20 [&>button]:!min-w-0 [&>button]:!rounded-lg [&>button]:!border-0 [&>button]:!bg-transparent [&>button]:!px-2 [&>button]:!py-0 [&>button]:!text-sm [&>button]:!font-normal [&>button]:!leading-none [&>button]:!text-dls-secondary [&>button]:!shadow-none [&>button]:hover:!border-transparent [&>button]:hover:!bg-dls-hover [&>button]:hover:!text-dls-text",
  stopButton: "rounded-xl bg-dls-status-danger text-white hover:bg-dls-status-danger-fg",
};

export function resolveLocalAgentComposerLayout(input: {
  hasAttachments: boolean;
  dragActive: boolean;
}) {
  // Menus sit `absolute bottom-full` above the card. Keep all four corners
  // rounded so focus-within ring matches the idle silhouette (no square feet).
  const panelRoundedClass = "rounded-xl";
  const panelChromeClass = cn(
    "relative min-w-0 max-w-full overflow-visible bg-dls-surface-solid focus-within:ring-1 focus-within:ring-dls-focus focus-within:ring-offset-0",
    input.dragActive
      ? "border border-dls-accent/60"
      : "border border-dls-border",
    panelRoundedClass,
  );
  const editorPadClass = input.hasAttachments ? "px-4 pb-2 pt-2" : "px-4 pb-2 pt-3";
  return {
    panelRoundedClass,
    panelChromeClass,
    editorPadClass,
  };
}
