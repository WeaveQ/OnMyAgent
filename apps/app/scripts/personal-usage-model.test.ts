import { describe, expect, test } from "bun:test";

import {
  buildTokenActivitySeries,
  formatPersonalTokenCount,
  formatTaskDuration,
  loadPersonalUsageSnapshots,
  summarizePersonalUsage,
  trimLeadingEmptyActivityColumns,
  workspaceUsageGeneratedTokens,
  workspaceUsageTotal,
  type PersonalUsageWorkspaceSnapshot,
  type TokenActivityColumn,
} from "../src/react-app/domains/session/usage/personal-usage-model";

function snapshot(
  workspaceId: string,
  input: Partial<PersonalUsageWorkspaceSnapshot> = {},
): PersonalUsageWorkspaceSnapshot {
  return {
    workspaceId,
    workspaceName: workspaceId,
    daily: [],
    peakSessionTokens: 0,
    longestSessionMinutes: 0,
    ...input,
  };
}

describe("personal usage model", () => {
  test("counts all buckets vs generated (input+output) tokens", () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 30,
      cacheReadTokens: 40,
    };
    expect(workspaceUsageTotal(usage)).toBe(100);
    expect(workspaceUsageGeneratedTokens(usage)).toBe(30);
  });

  test("merges personal usage across workspaces and supports one workspace scope", () => {
    const workspaces = [
      snapshot("alpha", {
        daily: [
          { date: "2026-07-14", inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 5 },
          { date: "2026-07-15", inputTokens: 20, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 5 },
          { date: "2026-07-16", inputTokens: 30, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 5 },
        ],
        peakSessionTokens: 80,
        longestSessionMinutes: 118,
      }),
      snapshot("beta", {
        daily: [
          { date: "2026-07-10", inputTokens: 90, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0 },
          { date: "2026-07-15", inputTokens: 40, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0 },
        ],
        peakSessionTokens: 120,
        longestSessionMinutes: 30,
      }),
    ];

    // Profile totals use input+output only (cache excluded).
    const personal = summarizePersonalUsage(workspaces, "all", "2026-07-16");
    expect(personal.totalTokens).toBe(225);
    expect(personal.peakSessionTokens).toBe(120);
    expect(personal.longestSessionMinutes).toBe(118);
    expect(personal.currentStreakDays).toBe(3);
    expect(personal.longestStreakDays).toBe(3);
    expect(personal.daily).toContainEqual({ date: "2026-07-15", tokens: 75 });

    const alpha = summarizePersonalUsage(workspaces, "alpha", "2026-07-16");
    expect(alpha.totalTokens).toBe(75);
    expect(alpha.peakSessionTokens).toBe(80);
    expect(alpha.daily).toContainEqual({ date: "2026-07-15", tokens: 25 });
  });

  test("trims leading empty weeks without padding a ghost window", () => {
    const emptyWeek = (weekStart: string): TokenActivityColumn => ({
      weekStart,
      weeklyValue: 0,
      cumulativeValue: 0,
      cells: Array.from({ length: 7 }, (_, index) => ({
        date: `${weekStart}+${index}`,
        value: 0,
        level: 0,
      })),
    });
    const activeWeek: TokenActivityColumn = {
      weekStart: "2026-07-06",
      weeklyValue: 10,
      cumulativeValue: 10,
      cells: [
        { date: "2026-07-06", value: 10, level: 2 },
        ...Array.from({ length: 6 }, (_, index) => ({
          date: `2026-07-0${7 + index}`,
          value: 0,
          level: 0,
        })),
      ],
    };
    const columns = [
      ...Array.from({ length: 40 }, (_, index) => emptyWeek(`2025-w${index}`)),
      activeWeek,
    ];
    // One empty context week + the active week — not a long empty pad.
    const trimmed = trimLeadingEmptyActivityColumns(columns, 13);
    expect(trimmed).toHaveLength(2);
    expect(trimmed.at(-1)?.weekStart).toBe("2026-07-06");
    expect(trimmed.some((column) => column.weeklyValue > 0)).toBe(true);

    const allEmpty = Array.from({ length: 40 }, (_, index) => emptyWeek(`2025-w${index}`));
    const emptyTrimmed = trimLeadingEmptyActivityColumns(allEmpty, 8);
    expect(emptyTrimmed).toHaveLength(8);
  });

  test("returns zero metrics when providers reported no usage", () => {
    expect(summarizePersonalUsage([snapshot("empty")], "all", "2026-07-16")).toEqual({
      totalTokens: 0,
      peakSessionTokens: 0,
      longestSessionMinutes: 0,
      currentStreakDays: 0,
      longestStreakDays: 0,
      daily: [],
    });
  });

  test("builds daily, weekly, and running cumulative activity", () => {
    const daily = [
      { date: "2026-07-14", tokens: 10 },
      { date: "2026-07-15", tokens: 20 },
      { date: "2026-07-16", tokens: 30 },
    ];

    const dailySeries = buildTokenActivitySeries(daily, "daily", "2026-07-16");
    expect(dailySeries.length).toBeGreaterThan(0);
    // ~6 months → about 26–28 week columns (not a full year of 53).
    expect(dailySeries.length).toBeGreaterThanOrEqual(24);
    expect(dailySeries.length).toBeLessThanOrEqual(30);
    const totalCells = dailySeries.reduce((sum, column) => sum + column.cells.length, 0);
    expect(totalCells).toBe(dailySeries.length * 7);
    const lastColumn = dailySeries.at(-1);
    expect(lastColumn?.cells.at(4)).toMatchObject({ date: "2026-07-16", value: 30, level: 4 });

    const weeklySeries = buildTokenActivitySeries(daily, "weekly", "2026-07-16");
    expect(weeklySeries.at(-1)).toMatchObject({ weekStart: "2026-07-12", weeklyValue: 60 });

    const cumulativeSeries = buildTokenActivitySeries(daily, "cumulative", "2026-07-16");
    expect(cumulativeSeries.at(-1)).toMatchObject({ weekStart: "2026-07-12", cumulativeValue: 60 });
  });

  test("formats compact totals and human task duration", () => {
    expect(formatPersonalTokenCount(999)).toBe("999");
    expect(formatPersonalTokenCount(1_000)).toBe("1k");
    expect(formatPersonalTokenCount(1_500)).toBe("1.5k");
    expect(formatPersonalTokenCount(999_999)).toBe("1000k");
    expect(formatPersonalTokenCount(1_000_000)).toBe("1m");
    expect(formatPersonalTokenCount(1_500_000_000)).toBe("1.5b");
    expect(formatTaskDuration(0)).toEqual({ hours: 0, minutes: 0 });
    expect(formatTaskDuration(118)).toEqual({ hours: 1, minutes: 58 });
  });

  test("loads accessible workspaces while preserving partial failures", async () => {
    let requestedTopSessionLimit = 0;
    const client = {
      async getSessionArchiveUsageSummary(workspaceId: string) {
        if (workspaceId === "beta") throw new Error("offline");
        return {
          totals: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
          daily: [
            { date: "2026-07-16", inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40 },
          ],
        };
      },
      async getSessionArchiveTopUsageSessions(_workspaceId: string, options: { limit: number }) {
        requestedTopSessionLimit = options.limit;
        return [{ totalTokens: 80 }, { totalTokens: 120 }];
      },
      async getSessionArchiveAnalyticsTopSessions() {
        return { sessions: [{ duration_min: 118 }] };
      },
    };

    const result = await loadPersonalUsageSnapshots({
      client,
      workspaces: [
        { id: "alpha", name: "Alpha" },
        { id: "beta", name: "Beta" },
      ],
      today: "2026-07-16",
    });

    expect(result.snapshots).toEqual([
      snapshot("alpha", {
        workspaceName: "Alpha",
        daily: [
          { date: "2026-07-16", inputTokens: 10, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40 },
        ],
        peakSessionTokens: 120,
        longestSessionMinutes: 118,
      }),
    ]);
    expect(requestedTopSessionLimit).toBe(100);
    expect(result.failures).toEqual([{ workspaceId: "beta", workspaceName: "Beta" }]);
  });
});
