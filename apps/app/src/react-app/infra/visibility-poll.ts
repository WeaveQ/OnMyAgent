/**
 * Pure helpers for visibility-aware background polling.
 *
 * Default policy pauses while the document is hidden (hiddenIntervalMs = 0)
 * so cold tabs and backgrounded windows do not keep firing network ticks.
 * Callers reschedule on `visibilitychange` using `nextPollDelayMs`.
 */

export type VisibilityPollPolicy = {
  /** Interval while the document is focused/visible. */
  focusedIntervalMs: number;
  /**
   * Interval while the document is hidden.
   * `0` means pause (do not schedule the next tick) while hidden.
   */
  hiddenIntervalMs: number;
};

/** Default: 10s while visible; pause while hidden. */
export const DEFAULT_VISIBILITY_POLL_POLICY: VisibilityPollPolicy = {
  focusedIntervalMs: 10_000,
  hiddenIntervalMs: 0,
};

/**
 * Delay until the next poll tick for the current document visibility.
 * Returns `null` when the next tick should not be scheduled (pause).
 */
export function nextPollDelayMs(
  policy: VisibilityPollPolicy,
  documentHidden: boolean,
): number | null {
  if (documentHidden) {
    if (policy.hiddenIntervalMs <= 0) return null;
    return policy.hiddenIntervalMs;
  }
  if (policy.focusedIntervalMs <= 0) return null;
  return policy.focusedIntervalMs;
}

/**
 * Whether a poll tick should run work right now.
 * When `pauseWhenHidden` is true (default), hidden documents skip the tick.
 */
export function shouldRunPollTick(
  documentHidden: boolean,
  pauseWhenHidden: boolean = true,
): boolean {
  if (pauseWhenHidden && documentHidden) return false;
  return true;
}

/** Read `document.hidden` safely for non-DOM / SSR contexts. */
export function isDocumentHidden(
  documentHidden?: boolean,
): boolean {
  if (typeof documentHidden === "boolean") return documentHidden;
  if (typeof document === "undefined") return false;
  return document.hidden === true || document.visibilityState === "hidden";
}
