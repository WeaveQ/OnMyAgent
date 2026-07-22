/**
 * Pure wake-density policy for the automation scheduler.
 * Avoids a fixed 30s full scan when nothing is due.
 */

export const AUTOMATION_SCHEDULER_MIN_MS = 5_000;
export const AUTOMATION_SCHEDULER_MAX_MS = 5 * 60_000;
export const AUTOMATION_SCHEDULER_DEFAULT_MS = 30_000;

export type AutomationWakeInput = {
  now: number;
  nextRunAts: ReadonlyArray<number | null | undefined>;
  hasRunning: boolean;
  hasExpiringLease?: boolean;
};

/**
 * Milliseconds until the next scheduler wake.
 * - Running / expiring → dense (min)
 * - Due now or overdue → min
 * - Future nextRun → clamp(delta, min, max)
 * - Nothing scheduled → max (sparse idle)
 */
export function nextAutomationWakeMs(input: AutomationWakeInput): number {
  if (input.hasRunning || input.hasExpiringLease) {
    return AUTOMATION_SCHEDULER_MIN_MS;
  }
  const future: number[] = [];
  let dueNow = false;
  for (const value of input.nextRunAts) {
    if (value == null || !Number.isFinite(value)) continue;
    if (value <= input.now) {
      dueNow = true;
      continue;
    }
    future.push(value);
  }
  if (dueNow) return AUTOMATION_SCHEDULER_MIN_MS;
  if (!future.length) return AUTOMATION_SCHEDULER_MAX_MS;
  const soonest = Math.min(...future);
  const delta = soonest - input.now;
  return Math.min(
    AUTOMATION_SCHEDULER_MAX_MS,
    Math.max(AUTOMATION_SCHEDULER_MIN_MS, delta),
  );
}

/** Whether an incremental archive sync should discover/reparse files. */
export function shouldRunIncrementalSessionArchiveSync(input: {
  mode: "incremental" | "resync";
  changedPathCount: number;
}): boolean {
  if (input.mode === "resync") return true;
  return input.changedPathCount > 0;
}
