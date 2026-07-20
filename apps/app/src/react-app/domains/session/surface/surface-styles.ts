/** Shared class maps for SessionSurface chrome panels. */

export const sessionSurfaceTextClass = {
  assistantHeroTitle: "mt-4 text-lg font-medium text-dls-text",
  agentEmptyTitle: "mt-4 text-base font-medium text-dls-text",
  agentEmptyDescription: "mt-1.5 max-w-md text-center text-sm leading-6 text-dls-secondary",
  draftHomeTitle: "inline-flex items-center justify-center gap-2 text-xl font-medium tracking-tight text-dls-text",
  draftHomeSubtitle: "mt-1.5 max-w-md text-xs leading-5 text-dls-secondary",
  noVisibleOutput: "font-mono text-sm leading-6 text-dls-secondary whitespace-pre-wrap",
  headerAgentName: "min-w-0 truncate text-sm font-medium text-dls-text",
  openingSession: "text-sm text-dls-secondary",
};

export const sessionSurfaceStateClass = {
  todoDone: "border-dls-status-success bg-dls-status-success-soft text-dls-status-success-fg",
  todoActive: "border-dls-status-warning-border bg-dls-status-warning-soft text-dls-status-warning-fg",
  todoActiveDot: "size-1.5 rounded-full bg-dls-status-warning",
  errorDismiss: "shrink-0 text-dls-status-danger hover:bg-dls-status-danger/10 hover:text-dls-status-danger",
  snapshotError: "mx-auto max-w-xl rounded-xl border border-dls-status-danger-border bg-dls-status-danger-soft px-6 py-5 text-sm text-dls-status-danger",
};
