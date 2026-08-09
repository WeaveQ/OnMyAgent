/**
 * Cold-path performance budget for session route enter.
 * Prewarm MUST stay idle-only (see prewarm-schedule.ts).
 *
 * SoT numbers also summarized in apps/app/src/react-app/ARCHITECTURE.md
 * Shell load / boot and docs/Architecture.md Session / Expert / cold-path pointers.
 */

export const COLD_PATH_BUDGET = {
  /** Max synchronous listSessions invocations counted on cold enter. */
  maxListSessionsOnColdEnter: 1,
  /**
   * Max title-snapshot pulls for empty/selected-only chips on cold enter.
   * 0 = thrash ban (no tight title poll on first enter for empty titles).
   */
  maxTitleSnapshotsOnColdEnter: 0,
  /**
   * Max synchronous (non-idle) inventory prewarm runs on cold enter.
   * 0 = prewarm only via scheduleIdleWork.
   */
  maxSyncPrewarmOnColdEnter: 0,
  /** Idle callback max wait before forcing prewarm (ms). */
  prewarmIdleTimeoutMs: 8_000,
  /** setTimeout fallback when requestIdleCallback is missing (ms). */
  prewarmFallbackDelayMs: 4_000,
} as const;

export type ColdPathEvent = "listSessions" | "titleSnapshot" | "syncPrewarm";

type Counters = Record<ColdPathEvent, number>;

let counters: Counters = {
  listSessions: 0,
  titleSnapshot: 0,
  syncPrewarm: 0,
};

export function resetColdPathCounters(): void {
  counters = { listSessions: 0, titleSnapshot: 0, syncPrewarm: 0 };
}

export function recordColdPathEvent(event: ColdPathEvent): void {
  counters[event] += 1;
}

export function getColdPathCounters(): Readonly<Counters> {
  return { ...counters };
}

/**
 * Thrash ban: do not title-snapshot on cold enter when the chip is selected
 * and still empty, or when a snapshot already ran for this enter.
 */
export function isTitleSnapshotAllowedOnColdEnter(input: {
  isSelectedSession: boolean;
  titleEmpty: boolean;
  alreadySnapshotted: boolean;
}): boolean {
  if (input.alreadySnapshotted) return false;
  if (input.isSelectedSession && input.titleEmpty) return false;
  return true;
}

/** True when counters stay within {@link COLD_PATH_BUDGET}. */
export function isColdPathWithinBudget(
  observed: Readonly<Counters> = getColdPathCounters(),
): boolean {
  return (
    observed.listSessions <= COLD_PATH_BUDGET.maxListSessionsOnColdEnter &&
    observed.titleSnapshot <= COLD_PATH_BUDGET.maxTitleSnapshotsOnColdEnter &&
    observed.syncPrewarm <= COLD_PATH_BUDGET.maxSyncPrewarmOnColdEnter
  );
}

/** Sync prewarm is never allowed on cold enter (must use idle schedule). */
export function isSyncPrewarmAllowedOnColdEnter(): boolean {
  return COLD_PATH_BUDGET.maxSyncPrewarmOnColdEnter > 0;
}

/**
 * Gate + count a cold-enter title/snapshot pull. Returns false when thrash-banned
 * (callers must skip the network pull). Empty selected chips never pull on cold path.
 */
export function tryRecordColdTitleSnapshot(input: {
  isSelectedSession: boolean;
  titleEmpty: boolean;
  alreadySnapshotted: boolean;
}): boolean {
  if (!isTitleSnapshotAllowedOnColdEnter(input)) return false;
  recordColdPathEvent("titleSnapshot");
  return true;
}

/**
 * Sidebar/session snapshot prefetch on cold path. Empty selected chips are banned
 * (title thrash). Other prefetches are allowed without burning thrash budget counters.
 */
export function shouldPrefetchSessionSnapshotOnColdPath(input: {
  isSelectedSession: boolean;
  titleEmpty: boolean;
}): boolean {
  return isTitleSnapshotAllowedOnColdEnter({
    isSelectedSession: input.isSelectedSession,
    titleEmpty: input.titleEmpty,
    alreadySnapshotted: false,
  });
}
