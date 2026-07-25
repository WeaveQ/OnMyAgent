/** Shared layout/text class tokens for agents page + create wizard. */

export const agentsTextClass = {
  cardTitle: "text-base font-medium leading-6 text-dls-text",
  cardDescription: "mt-1.5 line-clamp-3 text-sm leading-6 text-dls-secondary",
  emptyTitle: "mt-5 text-base font-medium leading-6 text-dls-text",
  emptyDescription: "mt-2 text-sm leading-6 text-dls-secondary",
  eyebrow: "flex items-center gap-2 text-sm font-medium text-dls-secondary",
  previewTitle: "mt-3 text-base font-medium leading-6 text-dls-text",
  previewDescription: "mt-5 text-sm leading-6 text-dls-secondary",
  metricLabel: "text-xs text-dls-secondary",
  metricValue: "mt-1.5 text-base font-medium text-dls-text",
  rowTitle: "text-sm font-medium leading-5 text-dls-text",
  rowDescription: "mt-1 text-xs leading-5 text-dls-secondary",
  stepMeta: "mt-0.5 text-xs leading-5 text-dls-secondary",
  fieldLabel: "text-sm font-medium text-dls-text",
  fieldHelp: "text-xs leading-5 text-dls-secondary",
  pageTitle: "text-lg font-medium text-dls-text",
  pageDescription: "text-xs leading-5 text-dls-secondary",
};

export const agentsLayoutClass = {
  wizardPanel: "min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-7",
  fieldStack: "space-y-3",
  compactFieldStack: "space-y-2.5",
  promptTextarea: "min-h-[140px] rounded-xl px-4 py-3 text-sm",
  deleteButton: "absolute right-3 top-3 text-dls-secondary hover:bg-dls-status-danger/10 hover:text-dls-status-danger",
  card: "relative flex min-h-[276px] flex-col rounded-xl border border-dls-border bg-dls-surface p-5",
  cardInteractive: "cursor-pointer transition-colors hover:bg-dls-hover",
  primaryCardAction: "w-full gap-1.5 bg-dls-decision-soft text-dls-accent hover:bg-dls-accent hover:text-white",
  secondaryCardAction: "w-full gap-1.5 text-xs text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
  emptyHint: "flex min-h-[280px] flex-col items-center justify-center rounded-xl bg-dls-surface-muted/40 px-6 text-center",
  wizardOverlay: "fixed inset-0 z-[60] bg-black/32 supports-backdrop-filter:backdrop-blur-[10px]",
  wizardDialog: "flex max-h-[78vh] w-[calc(100vw-120px)] max-w-[840px] flex-col gap-0 overflow-hidden rounded-xl p-0 !z-[70] sm:max-w-[840px]",
  editGrid: "min-h-0 flex-1 grid-cols-[160px_1fr] overflow-hidden md:grid",
  editNavButton: "h-auto rounded-none px-4 py-2.5 text-sm data-[active=true]:bg-dls-decision-soft data-[active=true]:text-dls-accent",
  pageContainer: "mx-auto flex w-full max-w-[1520px] flex-col",
  loadingState: "flex min-h-[420px] items-center justify-center",
  cardGrid: "mt-7 grid gap-6 md:grid-cols-2 xl:grid-cols-3",
};

