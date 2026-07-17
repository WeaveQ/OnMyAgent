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

export function workspaceUsageTotal(usage: PersonalUsageTokenBreakdown) {
  return usage.inputTokens
    + usage.outputTokens
    + usage.cacheCreationTokens
    + usage.cacheReadTokens;
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
      const tokens = workspaceUsageTotal(entry);
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

function withActivityLevels(
  points: Array<Omit<TokenActivityPoint, "level">>,
): TokenActivityPoint[] {
  const maximum = points.reduce((highest, point) => Math.max(highest, point.value), 0);
  return points.map((point) => ({
    ...point,
    level: activityLevel(point.value, maximum),
  }));
}

function dailyWindow(daily: PersonalUsageDailyTotal[], today: string) {
  const valueByDate = new Map(daily.map((entry) => [entry.date, entry.tokens]));
  const firstDate = shiftDate(today, -364);
  return Array.from({ length: 365 }, (_, index) => {
    const date = shiftDate(firstDate, index);
    return { date, value: valueByDate.get(date) ?? 0 };
  });
}

export function buildTokenActivitySeries(
  daily: PersonalUsageDailyTotal[],
  mode: TokenActivityMode,
  today: string,
): TokenActivityPoint[] {
  const window = dailyWindow(daily, today);

  if (mode === "weekly") {
    const weeks = new Map<string, number>();
    for (const point of window) {
      const date = parseDateOnly(point.date);
      const weekStart = dateOnly(new Date(date.getTime() - date.getUTCDay() * DAY_MS));
      weeks.set(weekStart, (weeks.get(weekStart) ?? 0) + point.value);
    }
    return withActivityLevels(
      Array.from(weeks.entries()).map(([date, value]) => ({ date, value })),
    );
  }

  if (mode === "cumulative") {
    let total = 0;
    return withActivityLevels(window.map((point) => {
      total += point.value;
      return { date: point.date, value: total };
    }));
  }

  return withActivityLevels(window);
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
