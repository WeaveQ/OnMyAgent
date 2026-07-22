/**
 * Shared predicates for session-area background timers / React Query polls.
 *
 * Split "install interval" vs "fire this tick":
 * - Install ignores document visibility so a tab that mounts/setup while
 *   hidden still has a live timer that resumes when visible again.
 * - Tick/fire checks visibility (and feature enablement) so we skip work
 *   while backgrounded without tearing down the schedule.
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

/** Whether this tick should do work (enabled + tab visible). */
export function shouldRunActivePoll(input: {
  enabled: boolean;
  documentVisible?: boolean;
}): boolean {
  if (!input.enabled) return false;
  return isDocumentVisible(input.documentVisible);
}

/**
 * Terminal snapshot interval when the panel is mounted.
 * Visibility does NOT null the interval — skip ticks via shouldRunActivePoll.
 * Unmount (mounted=false) is the only way to stop scheduling.
 */
export function codeTerminalSnapshotIntervalMs(input: {
  mounted: boolean;
}): number | null {
  if (!input.mounted) return null;
  return CODE_TERMINAL_SNAPSHOT_INTERVAL_MS;
}

/**
 * Review panel poll interval when enabled+polling.
 * Visibility does not null the interval — skip ticks while hidden.
 */
export function codeReviewPollIntervalMs(input: {
  enabled: boolean;
  polling: boolean;
}): number | null {
  if (!input.enabled || !input.polling) return null;
  return CODE_REVIEW_POLL_INTERVAL_MS;
}

/**
 * Automation list refetch interval (always a number when the query is active).
 * Prefer React Query `refetchIntervalInBackground: false` so hidden tabs pause
 * without permanently disabling the interval callback.
 */
export function automationListRefetchIntervalMs(input: {
  anyRunning: boolean;
}): number {
  return input.anyRunning ? AUTOMATION_RUNNING_REFETCH_MS : AUTOMATION_IDLE_REFETCH_MS;
}

/**
 * Whether the goal elapsed clock should keep an interval installed
 * (status-driven only — not document visibility).
 */
export function shouldInstallGoalRuntimeClock(input: {
  status: string;
  waitingReason?: string | null;
}): boolean {
  if (input.status === "paused" || input.status === "completed") return false;
  if (input.waitingReason === "user") return false;
  return true;
}

/**
 * Whether this clock tick should advance "now".
 * Requires install-worthy status AND a visible document.
 */
export function shouldTickGoalRuntimeClock(input: {
  status: string;
  waitingReason?: string | null;
  documentVisible?: boolean;
}): boolean {
  if (!shouldInstallGoalRuntimeClock(input)) return false;
  return isDocumentVisible(input.documentVisible);
}
