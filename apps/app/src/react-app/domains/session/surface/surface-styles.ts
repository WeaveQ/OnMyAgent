/** Shared class maps for SessionSurface chrome panels. */

/**
 * Shared content column for transcript + composer so fullscreen layout stays aligned.
 * Keep in sync with ReactSessionComposer non-home max-width.
 */
export const SESSION_CONTENT_MAX_WIDTH_CLASS = "max-w-[1120px]";
export const SESSION_CONTENT_X_PADDING_CLASS = "px-4 md:px-8";

export const sessionSurfaceTextClass = {
  assistantHeroTitle: "mt-4 text-lg font-medium text-dls-text",
  agentEmptyTitle: "mt-3 text-base font-medium text-dls-text",
  // Wider + multi-line so expert capability copy is fully readable above prompt cards.
  agentEmptyDescription:
    "mt-1.5 max-w-xl text-balance text-center text-xs leading-5 text-dls-secondary sm:text-sm sm:leading-6",
  // Home empty: brand-scale hero title; subtitle one step softer so title leads.
  draftHomeTitle:
    "inline-flex items-center justify-center gap-3 text-3xl font-semibold tracking-tight text-dls-text sm:text-4xl",
  // text-composer = 15px design token for long-form UI copy under the hero.
  draftHomeSubtitle: "mt-2.5 max-w-lg text-composer leading-6 text-dls-secondary/80",
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
