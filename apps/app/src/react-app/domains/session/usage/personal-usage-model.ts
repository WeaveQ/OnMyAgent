export type PersonalUsageTokenBreakdown = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

export type PersonalUsageDailyEntry = PersonalUsageTokenBreakdown & {
  date: string;
};

export type PersonalUsageWorkspaceSnapshot = {
  workspaceId: string;
  workspaceName: string;
  daily: PersonalUsageDailyEntry[];
  peakSessionTokens: number;
  longestSessionMinutes: number;
};

export type PersonalUsageScope = "all" | string;
export type TokenActivityMode = "daily" | "weekly" | "cumulative";

export type PersonalUsageDailyTotal = {
  date: string;
  tokens: number;
};

export type PersonalUsageSummary = {
  totalTokens: number;
  peakSessionTokens: number;
  longestSessionMinutes: number;
  currentStreakDays: number;
  longestStreakDays: number;
  daily: PersonalUsageDailyTotal[];
};

export type TokenActivityPoint = {
  date: string;
  value: number;
  level: number;
};

export type TokenActivityCell = {
  date: string;
  value: number;
  level: number;
};

export type TokenActivityColumn = {
  weekStart: string;
  cells: TokenActivityCell[];
  weeklyValue: number;
  cumulativeValue: number;
};

export type PersonalUsageWorkspace = {
  id: string;
  name: string;
};

type PersonalUsageSummaryResponse = {
  daily: PersonalUsageDailyEntry[];
};

type PersonalUsageTopSession = {
  totalTokens: number;
};

type PersonalUsageLongestSessionResponse = {
  sessions: Array<{ duration_min: number }>;
};

export type PersonalUsageClient = {
  getSessionArchiveUsageSummary: (
    workspaceId: string,
    options: { from: string; to: string },
  ) => Promise<PersonalUsageSummaryResponse>;
  getSessionArchiveTopUsageSessions: (
    workspaceId: string,
    options: { from: string; to: string; limit: number },
  ) => Promise<PersonalUsageTopSession[]>;
  getSessionArchiveAnalyticsTopSessions: (
    workspaceId: string,
    options: { metric: string; limit: number },
  ) => Promise<PersonalUsageLongestSessionResponse>;
};

export type PersonalUsageLoadResult = {
  snapshots: PersonalUsageWorkspaceSnapshot[];
  failures: Array<{ workspaceId: string; workspaceName: string }>;
};

const DAY_MS = 86_400_000;

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number) {
  return dateOnly(new Date(parseDateOnly(value).getTime() + days * DAY_MS));
}

function dateDistance(left: string, right: string) {
  return Math.round(
    (parseDateOnly(right).getTime() - parseDateOnly(left).getTime()) / DAY_MS,
  );
}

/** All reported token buckets (includes prompt cache). Prefer for diagnostics only. */
export function workspaceUsageTotal(usage: PersonalUsageTokenBreakdown) {
  return usage.inputTokens
    + usage.outputTokens
    + usage.cacheCreationTokens
    + usage.cacheReadTokens;
}

/** User-facing usage: model input + output only (excludes cache). */
export function workspaceUsageGeneratedTokens(usage: PersonalUsageTokenBreakdown) {
  return Math.max(0, usage.inputTokens) + Math.max(0, usage.outputTokens);
}

export async function loadPersonalUsageSnapshots(input: {
  client: PersonalUsageClient;
  workspaces: PersonalUsageWorkspace[];
  today: string;
}): Promise<PersonalUsageLoadResult> {
  const results = await Promise.allSettled(input.workspaces.map(async (workspace) => {
    const [summary, topSessions, longestSessions] = await Promise.all([
      input.client.getSessionArchiveUsageSummary(workspace.id, {
        from: "1970-01-01",
        to: input.today,
      }),
      input.client.getSessionArchiveTopUsageSessions(workspace.id, {
        from: "1970-01-01",
        to: input.today,
        limit: 100,
      }),
      input.client.getSessionArchiveAnalyticsTopSessions(workspace.id, {
        metric: "duration",
        limit: 1,
      }),
    ]);

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      daily: summary.daily,
      peakSessionTokens: topSessions.reduce(
        (peak, session) => Math.max(peak, session.totalTokens),
        0,
      ),
      longestSessionMinutes: longestSessions.sessions[0]?.duration_min ?? 0,
    };
  }));
  const snapshots: PersonalUsageWorkspaceSnapshot[] = [];
  const failures: PersonalUsageLoadResult["failures"] = [];

  results.forEach((result, index) => {
    const workspace = input.workspaces[index];
    if (!workspace) return;
    if (result.status === "fulfilled") {
      snapshots.push(result.value);
      return;
    }
    failures.push({ workspaceId: workspace.id, workspaceName: workspace.name });
  });

  return { snapshots, failures };
}

function streaks(activeDates: string[], today: string) {
  if (activeDates.length === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0 };
  }

  const sortedDates = Array.from(new Set(activeDates)).sort();
  let longestStreakDays = 1;
  let streak = 1;
  for (let index = 1; index < sortedDates.length; index += 1) {
    const previous = sortedDates[index - 1];
    const current = sortedDates[index];
    if (!previous || !current) continue;
    streak = dateDistance(previous, current) === 1 ? streak + 1 : 1;
    longestStreakDays = Math.max(longestStreakDays, streak);
  }

  const active = new Set(sortedDates);
  let currentStreakDays = 0;
  let cursor = today;
  while (active.has(cursor)) {
    currentStreakDays += 1;
    cursor = shiftDate(cursor, -1);
  }

  return { currentStreakDays, longestStreakDays };
}

export function summarizePersonalUsage(
  snapshots: PersonalUsageWorkspaceSnapshot[],
  scopeId: PersonalUsageScope,
  today: string,
): PersonalUsageSummary {
  const scoped = scopeId === "all"
    ? snapshots
    : snapshots.filter((snapshot) => snapshot.workspaceId === scopeId);
  const dailyTotals = new Map<string, number>();

  for (const snapshot of scoped) {
    for (const entry of snapshot.daily) {
      // Profile metrics and heatmap use generated tokens only so cache hits
      // do not inflate "usage" into multi-billion figures.
      const tokens = workspaceUsageGeneratedTokens(entry);
      if (tokens <= 0) continue;
      dailyTotals.set(entry.date, (dailyTotals.get(entry.date) ?? 0) + tokens);
    }
  }

  const daily = Array.from(dailyTotals.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, tokens]) => ({ date, tokens }));
  const activeDates = daily.map((entry) => entry.date);
  const { currentStreakDays, longestStreakDays } = streaks(activeDates, today);

  return {
    totalTokens: daily.reduce((sum, entry) => sum + entry.tokens, 0),
    peakSessionTokens: scoped.reduce(
      (peak, snapshot) => Math.max(peak, snapshot.peakSessionTokens),
      0,
    ),
    longestSessionMinutes: scoped.reduce(
      (longest, snapshot) => Math.max(longest, snapshot.longestSessionMinutes),
      0,
    ),
    currentStreakDays,
    longestStreakDays,
    daily,
  };
}

function activityLevel(value: number, maximum: number) {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((value / maximum) * 4)));
}

function withActivityLevels(values: number[]): { value: number; level: number }[] {
  const maximum = Math.max(0, ...values);
  return values.map((value) => ({ value, level: activityLevel(value, maximum) }));
}

function startOfWeek(value: string) {
  const date = parseDateOnly(value);
  const day = date.getUTCDay();
  return dateOnly(new Date(date.getTime() - day * DAY_MS));
}

function buildWeeklyColumns(
  daily: PersonalUsageDailyTotal[],
  today: string,
): Array<{ weekStart: string; weeklyValue: number; cells: TokenActivityCell[] }> {
  const valueByDate = new Map(daily.map((entry) => [entry.date, entry.tokens]));
  const firstDate = shiftDate(today, -364);
  const startSunday = startOfWeek(firstDate);
  const endSunday = startOfWeek(today);
  const weeks: string[] = [];
  let cursor = startSunday;
  while (cursor <= endSunday) {
    weeks.push(cursor);
    cursor = shiftDate(cursor, 7);
  }

  return weeks.map((weekStart) => {
    let weeklyValue = 0;
    const cells: TokenActivityCell[] = [];
    for (let index = 0; index < 7; index += 1) {
      const date = shiftDate(weekStart, index);
      const value = valueByDate.get(date) ?? 0;
      weeklyValue += value;
      cells.push({ date, value, level: 0 });
    }
    return { weekStart, weeklyValue, cells };
  });
}

export function monthLabelColumns(
  columns: TokenActivityColumn[],
  today: string,
  locale: string,
): Array<{ label: string; columnIndex: number }> {
  const formatter = new Intl.DateTimeFormat(locale, { month: "short" });
  const end = parseDateOnly(today);
  const labels: Array<{ label: string; columnIndex: number }> = [];
  for (let offset = -11; offset <= 0; offset += 1) {
    const firstDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + offset, 1));
    const dateStr = dateOnly(firstDay);
    const columnIndex = columns.findIndex((column) => {
      const start = parseDateOnly(column.weekStart).getTime();
      const endWeek = start + 6 * DAY_MS;
      const dateTime = parseDateOnly(dateStr).getTime();
      return dateTime >= start && dateTime <= endWeek;
    });
    if (columnIndex !== -1) {
      labels.push({ label: formatter.format(firstDay), columnIndex });
    }
  }
  return labels;
}

export function buildTokenActivitySeries(
  daily: PersonalUsageDailyTotal[],
  mode: TokenActivityMode,
  today: string,
): TokenActivityColumn[] {
  const columns = buildWeeklyColumns(daily, today);

  if (mode === "weekly") {
    const levels = withActivityLevels(columns.map((column) => column.weeklyValue));
    return columns.map((column, index) => ({
      weekStart: column.weekStart,
      weeklyValue: column.weeklyValue,
      cumulativeValue: 0,
      cells: column.cells.map((cell) => ({
        date: column.weekStart,
        value: column.weeklyValue,
        level: levels[index]?.level ?? 0,
      })),
    }));
  }

  if (mode === "cumulative") {
    let runningTotal = 0;
    const cumulativeValues = columns.map((column) => {
      runningTotal += column.weeklyValue;
      return runningTotal;
    });
    const levels = withActivityLevels(cumulativeValues);
    return columns.map((column, index) => ({
      weekStart: column.weekStart,
      weeklyValue: column.weeklyValue,
      cumulativeValue: cumulativeValues[index] ?? 0,
      cells: column.cells.map((cell) => ({
        date: column.weekStart,
        value: cumulativeValues[index] ?? 0,
        level: levels[index]?.level ?? 0,
      })),
    }));
  }

  const dailyValues = columns.flatMap((column) => column.cells.map((cell) => cell.value));
  const levels = withActivityLevels(dailyValues);
  let levelIndex = 0;
  return columns.map((column) => ({
    weekStart: column.weekStart,
    weeklyValue: 0,
    cumulativeValue: 0,
    cells: column.cells.map((cell) => {
      const cellLevel = levels[levelIndex]?.level ?? 0;
      levelIndex += 1;
      return {
        date: cell.date,
        value: cell.value,
        level: cellLevel,
      };
    }),
  }));
}

export function formatPersonalTokenCount(tokens: number) {
  const roundedTokens = Math.max(0, Math.round(tokens));
  if (roundedTokens < 1_000) return String(roundedTokens);

  const units = ["k", "m", "b", "t"];
  const unitIndex = Math.min(
    Math.floor(Math.log(roundedTokens) / Math.log(1_000)),
    units.length,
  );
  const value = roundedTokens / (1_000 ** unitIndex);
  return `${Number(value.toFixed(1))}${units[unitIndex - 1]}`;
}

export function formatTaskDuration(minutes: number) {
  const roundedMinutes = Math.max(0, Math.round(minutes));
  return {
    hours: Math.floor(roundedMinutes / 60),
    minutes: roundedMinutes % 60,
  };
}

/**
 * Drop leading all-zero weeks so a sparse heatmap is not mostly empty grey.
 *
 * When there is real activity, start one week before the first active column —
 * do **not** pad with earlier empty weeks just to hit a minimum width (that
 * produced a long ghost grid on the left).
 *
 * When everything is empty, keep only a short recent window.
 */
export function trimLeadingEmptyActivityColumns(
  columns: TokenActivityColumn[],
  emptyFallbackWeeks = 16,
): TokenActivityColumn[] {
  if (columns.length === 0) return columns;
  const firstActive = columns.findIndex((column) =>
    column.cells.some((cell) => cell.value > 0)
    || column.weeklyValue > 0
    || column.cumulativeValue > 0,
  );
  if (firstActive < 0) {
    return columns.slice(-Math.max(1, emptyFallbackWeeks));
  }
  // One empty week of context before first activity.
  return columns.slice(Math.max(0, firstActive - 1));
}
