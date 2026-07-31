/**
 * Pure list/partition helpers for the automation page.
 * Kept free of React so unit tests can exercise real branching.
 */

export type AutomationListScene = "office" | "code";

export type AutomationListRun = {
  status: "success" | "failed" | "skipped";
  source?: "manual" | "scheduled";
  ranAt: number;
  sessionId?: string;
  error?: string;
  groupName?: string;
  outputDirectory?: string;
};

export type AutomationListTask = {
  id: string;
  title: string;
  scene: AutomationListScene;
  enabled: boolean;
  schedule: { mode: "once" | "interval" | "weekly" | string };
  running?: {
    sessionId?: string;
    startedAt?: number;
    expiresAt?: number;
  } | null;
  runs: AutomationListRun[];
};

/** True while a run lease is held and not past expiresAt. */
export function isAutomationLeaseActive(
  running: AutomationListTask["running"] | null | undefined,
  now = Date.now(),
): boolean {
  if (!running) return false;
  if (typeof running.expiresAt === "number" && Number.isFinite(running.expiresAt)) {
    return running.expiresAt > now;
  }
  // Missing expiresAt: treat as active (legacy rows).
  return true;
}

/** Elapsed run time for display (startedAt → now), or null if unknown. */
export function automationRunElapsedMs(
  running: AutomationListTask["running"] | null | undefined,
  now = Date.now(),
): number | null {
  if (!running || typeof running.startedAt !== "number") return null;
  if (!Number.isFinite(running.startedAt)) return null;
  return Math.max(0, now - running.startedAt);
}

export type CompletedRunEntry<T extends AutomationListTask = AutomationListTask> = {
  task: T;
  run: T["runs"][number];
};

export type DayGroupedRuns<T extends AutomationListTask = AutomationListTask> = {
  /** Stable key for React lists (YYYY-MM-DD local). */
  dayKey: string;
  /** Display label resolved by the UI (caller may re-label today/yesterday). */
  dayLabel: string;
  entries: CompletedRunEntry<T>[];
};

/** First paint: only show templates after list has settled empty. */
export function shouldShowAutomationTemplates(input: {
  listReady: boolean;
  hasAutomations: boolean;
  templateViewOpen: boolean;
}): boolean {
  if (!input.listReady) return false;
  return !input.hasAutomations || input.templateViewOpen;
}

/** Full-page loading chrome only when we have nothing to show yet. */
export function shouldShowAutomationListLoading(input: {
  listReady: boolean;
  loading: boolean;
  hasAutomations: boolean;
}): boolean {
  if (input.hasAutomations) return false;
  if (input.listReady) return false;
  return input.loading;
}

export function partitionAutomationTasks<T extends AutomationListTask>(
  tasks: readonly T[],
  scene: AutomationListScene,
  now = Date.now(),
): {
  visible: T[];
  scheduled: T[];
  running: T[];
  completed: CompletedRunEntry<T>[];
} {
  const visible = tasks.filter((item) => item.scene === scene);
  const running = visible.filter((item) => isAutomationLeaseActive(item.running, now));
  const scheduled = visible.filter(
    (item) =>
      !isAutomationLeaseActive(item.running, now) &&
      (item.schedule.mode !== "once" ||
        item.enabled ||
        !item.runs.some((run) => run.source === "scheduled")),
  );
  const completed = visible
    .flatMap((task) => task.runs.map((run) => ({ task, run })))
    .sort((left, right) => right.run.ranAt - left.run.ranAt);
  return { visible, scheduled, running, completed };
}

/** Local calendar day key YYYY-MM-DD for grouping run history. */
export function localDayKey(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    const fallback = new Date(now);
    return formatDayKey(fallback);
  }
  return formatDayKey(date);
}

function formatDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Group completed runs by local calendar day (newest day first).
 * dayLabel is a simple locale date string — UI can map today/yesterday via dayKey.
 */
export function groupCompletedRunsByDay<T extends AutomationListTask>(
  entries: readonly CompletedRunEntry<T>[],
  now = Date.now(),
  locale?: string,
): DayGroupedRuns<T>[] {
  const buckets = new Map<string, CompletedRunEntry<T>[]>();
  for (const entry of entries) {
    const key = localDayKey(entry.run.ranAt, now);
    const list = buckets.get(key);
    if (list) list.push(entry);
    else buckets.set(key, [entry]);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([dayKey, dayEntries]) => {
      const sample = dayEntries[0]?.run.ranAt ?? now;
      const dayLabel = new Date(sample).toLocaleDateString(locale, {
        month: "numeric",
        day: "numeric",
        weekday: "short",
      });
      return {
        dayKey,
        dayLabel,
        entries: dayEntries.sort((l, r) => r.run.ranAt - l.run.ranAt),
      };
    });
}

/** Prefer relative labels for today / yesterday when rendering. */
export function resolveRunDayLabel(input: {
  dayKey: string;
  dayLabel: string;
  now?: number;
  todayLabel: string;
  yesterdayLabel: string;
}): string {
  const now = input.now ?? Date.now();
  const today = localDayKey(now, now);
  const yesterday = localDayKey(now - 24 * 60 * 60 * 1000, now);
  if (input.dayKey === today) return input.todayLabel;
  if (input.dayKey === yesterday) return input.yesterdayLabel;
  return input.dayLabel;
}

/**
 * After runAutomation returns, which status tab should the UI land on?
 * Keep "running" while an active (non-expired) lease is still held.
 */
export function resolvePostRunStatusTab(
  item: {
    running?: AutomationListTask["running"] | null;
    lastRun?: { status?: string } | null;
  },
  now = Date.now(),
): "running" | "completed" {
  if (isAutomationLeaseActive(item.running, now)) return "running";
  return "completed";
}

/** Stable id for a single run row (task + occurrence). */
export function automationRunArchiveKey(
  taskId: string,
  run: { ranAt: number; sessionId?: string },
): string {
  const id = taskId.trim();
  const session = run.sessionId?.trim() || "";
  if (session) return `${id}::${session}`;
  return `${id}::${run.ranAt}`;
}

export function filterOutArchivedRuns<T extends AutomationListTask>(
  entries: readonly CompletedRunEntry<T>[],
  archivedKeys: ReadonlySet<string> | ReadonlyArray<string>,
): CompletedRunEntry<T>[] {
  const set =
    archivedKeys instanceof Set
      ? archivedKeys
      : new Set(
          (archivedKeys as ReadonlyArray<string>)
            .map((key) => key.trim())
            .filter(Boolean),
        );
  if (set.size === 0) return [...entries];
  return entries.filter(
    (entry) => !set.has(automationRunArchiveKey(entry.task.id, entry.run)),
  );
}

export function addArchivedRunKey(
  keys: ReadonlyArray<string>,
  key: string,
): string[] {
  const next = key.trim();
  if (!next) return [...keys];
  if (keys.includes(next)) return [...keys];
  return [next, ...keys];
}
