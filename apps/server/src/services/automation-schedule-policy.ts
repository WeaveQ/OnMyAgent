/**
 * Pure wake-density / due-claim policy for the automation scheduler and
 * archive periodic sync. Avoids fixed full scans when nothing is due.
 */

import type { AutomationTaskItem } from "@onmyagent/types/server";

export const AUTOMATION_SCHEDULER_MIN_MS = 5_000;
export const AUTOMATION_SCHEDULER_MAX_MS = 5 * 60_000;
export const AUTOMATION_SCHEDULER_DEFAULT_MS = 30_000;

/** Grace window for claiming a scheduled run after nextRunAt (ms). */
export const AUTOMATION_DUE_GRACE_MS = 2 * 60 * 1000;

/**
 * Default idle interval for session-archive periodic rescan (ms).
 * Lengthened from aggressive 5s polling to reduce idle IO.
 */
export const DEFAULT_SESSION_ARCHIVE_PERIODIC_MS = 60_000;

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

/**
 * Whether a periodic archive scan is due based on last successful/attempted run.
 * `lastRunMs <= 0` means never run → due immediately when interval is positive.
 */
export function shouldRunPeriodicArchiveSync(
  lastRunMs: number,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return false;
  if (!Number.isFinite(lastRunMs) || lastRunMs <= 0) return true;
  if (!Number.isFinite(nowMs)) return false;
  return nowMs - lastRunMs >= intervalMs;
}

/** True when nextRunAt is older than the grace window (stale schedule pointer). */
export function isAutomationNextRunStale(
  nextRunAt: number | null | undefined,
  now: number,
  graceMs: number = AUTOMATION_DUE_GRACE_MS,
): boolean {
  return nextRunAt != null && nextRunAt < now - graceMs;
}

/** True when a scheduled (non-running) task is due for claim. */
export function isAutomationDueForClaim(
  entry: Pick<AutomationTaskItem, "enabled" | "nextRunAt" | "running" | "effectiveRange">,
  now: number,
  graceMs: number = AUTOMATION_DUE_GRACE_MS,
): boolean {
  return (
    entry.enabled &&
    entry.nextRunAt != null &&
    entry.nextRunAt <= now &&
    (entry.nextRunAt >= now - graceMs || Boolean(entry.effectiveRange.endDate)) &&
    !entry.running
  );
}

/** True when an existing lease has expired and may be reclaimed. */
export function isAutomationLeaseExpired(
  entry: Pick<AutomationTaskItem, "running">,
  now: number,
): boolean {
  return entry.running?.expiresAt != null && entry.running.expiresAt <= now;
}

/**
 * Select the earliest claimable automation (expired lease or due schedule).
 * Pure: does not mutate items.
 */
export function selectClaimableAutomation(
  items: readonly AutomationTaskItem[],
  now: number,
  graceMs: number = AUTOMATION_DUE_GRACE_MS,
): AutomationTaskItem | undefined {
  return items
    .filter((entry) => isAutomationLeaseExpired(entry, now) || isAutomationDueForClaim(entry, now, graceMs))
    .sort((a, b) => (
      (a.running?.scheduledForAt ?? a.nextRunAt ?? 0) -
      (b.running?.scheduledForAt ?? b.nextRunAt ?? 0)
    ))[0];
}
