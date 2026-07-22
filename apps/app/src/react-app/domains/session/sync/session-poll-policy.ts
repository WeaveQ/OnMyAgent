/**
 * Shared predicates for session-area background timers / React Query polls.
 * Intervals must clear when the surface is unmounted, inactive, or the
 * document is hidden.
 */

export const CODE_TERMINAL_SNAPSHOT_INTERVAL_MS = 250;
export const CODE_REVIEW_POLL_INTERVAL_MS = 2500;
export const AUTOMATION_RUNNING_REFETCH_MS = 2_000;
export const AUTOMATION_IDLE_REFETCH_MS = 15_000;

export function isDocumentVisible(documentVisible?: boolean): boolean {
  if (documentVisible === false) return false;
  if (documentVisible === true) return true;
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

/** Whether an interval-based poll should be scheduled. */
export function shouldRunActivePoll(input: {
  enabled: boolean;
  documentVisible?: boolean;
}): boolean {
  if (!input.enabled) return false;
  return isDocumentVisible(input.documentVisible);
}

/**
 * Code-workspace terminal snapshot interval, or null when polling must stop.
 * Panel unmount (mounted=false) always stops the 250ms loop.
 */
export function codeTerminalSnapshotIntervalMs(input: {
  mounted: boolean;
  documentVisible?: boolean;
}): number | null {
  if (!shouldRunActivePoll({ enabled: input.mounted, documentVisible: input.documentVisible })) {
    return null;
  }
  return CODE_TERMINAL_SNAPSHOT_INTERVAL_MS;
}

/** Git/env review panel poll interval, or null when idle. */
export function codeReviewPollIntervalMs(input: {
  enabled: boolean;
  polling: boolean;
  documentVisible?: boolean;
}): number | null {
  if (!input.enabled || !input.polling) return null;
  if (!isDocumentVisible(input.documentVisible)) return null;
  return CODE_REVIEW_POLL_INTERVAL_MS;
}

/**
 * Automation list refetch for React Query.
 * Returns false to disable interval when the tab is hidden.
 */
export function automationListRefetchIntervalMs(input: {
  anyRunning: boolean;
  documentVisible?: boolean;
}): number | false {
  if (!isDocumentVisible(input.documentVisible)) return false;
  return input.anyRunning ? AUTOMATION_RUNNING_REFETCH_MS : AUTOMATION_IDLE_REFETCH_MS;
}

/** Goal elapsed clock ticks only while the goal is actively running. */
export function shouldTickGoalRuntimeClock(input: {
  status: string;
  waitingReason?: string | null;
  documentVisible?: boolean;
}): boolean {
  if (!isDocumentVisible(input.documentVisible)) return false;
  if (input.status === "paused" || input.status === "completed") return false;
  if (input.waitingReason === "user") return false;
  return true;
}
