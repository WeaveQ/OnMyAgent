/**
 * Automation page list partitioning + loading gates (shipped helpers).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  addArchivedRunKey,
  automationRunArchiveKey,
  filterOutArchivedRuns,
  groupCompletedRunsByDay,
  localDayKey,
  partitionAutomationTasks,
  resolvePostRunStatusTab,
  resolveRunDayLabel,
  shouldShowAutomationListLoading,
  shouldShowAutomationTemplates,
  type AutomationListTask,
} from "../src/react-app/domains/messaging/automation-list-model";

const appRoot = join(import.meta.dir, "..");

function task(
  partial: Partial<AutomationListTask> & Pick<AutomationListTask, "id" | "title">,
): AutomationListTask {
  return {
    scene: "office",
    enabled: true,
    schedule: { mode: "weekly" },
    runs: [],
    ...partial,
  };
}

describe("shouldShowAutomationTemplates", () => {
  test("never shows templates before list is ready", () => {
    expect(
      shouldShowAutomationTemplates({
        listReady: false,
        hasAutomations: false,
        templateViewOpen: false,
      }),
    ).toBe(false);
    expect(
      shouldShowAutomationTemplates({
        listReady: false,
        hasAutomations: false,
        templateViewOpen: true,
      }),
    ).toBe(false);
  });

  test("shows templates when empty after load, or when user opens template gallery", () => {
    expect(
      shouldShowAutomationTemplates({
        listReady: true,
        hasAutomations: false,
        templateViewOpen: false,
      }),
    ).toBe(true);
    expect(
      shouldShowAutomationTemplates({
        listReady: true,
        hasAutomations: true,
        templateViewOpen: false,
      }),
    ).toBe(false);
    expect(
      shouldShowAutomationTemplates({
        listReady: true,
        hasAutomations: true,
        templateViewOpen: true,
      }),
    ).toBe(true);
  });
});

describe("shouldShowAutomationListLoading", () => {
  test("only while first load and still empty", () => {
    expect(
      shouldShowAutomationListLoading({
        listReady: false,
        loading: true,
        hasAutomations: false,
      }),
    ).toBe(true);
    expect(
      shouldShowAutomationListLoading({
        listReady: true,
        loading: true,
        hasAutomations: false,
      }),
    ).toBe(false);
    expect(
      shouldShowAutomationListLoading({
        listReady: false,
        loading: true,
        hasAutomations: true,
      }),
    ).toBe(false);
  });
});

describe("partitionAutomationTasks", () => {
  test("splits scheduled / running / completed and respects scene", () => {
    const officeRunning = task({
      id: "a",
      title: "A",
      running: { sessionId: "s1" },
      runs: [{ status: "success", ranAt: 10, source: "scheduled" }],
    });
    const officeScheduled = task({
      id: "b",
      title: "B",
      schedule: { mode: "once" },
      enabled: true,
      runs: [],
    });
    const onceDone = task({
      id: "c",
      title: "C",
      schedule: { mode: "once" },
      enabled: false,
      runs: [{ status: "failed", ranAt: 20, source: "scheduled", error: "x" }],
    });
    const codeTask = task({
      id: "d",
      title: "D",
      scene: "code",
      runs: [{ status: "success", ranAt: 30, source: "manual" }],
    });

    const part = partitionAutomationTasks(
      [officeRunning, officeScheduled, onceDone, codeTask],
      "office",
    );
    expect(part.visible.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(part.running.map((item) => item.id)).toEqual(["a"]);
    expect(part.scheduled.map((item) => item.id)).toEqual(["b"]);
    // once finished + disabled with scheduled run leaves scheduled list
    expect(part.scheduled.some((item) => item.id === "c")).toBe(false);
    expect(part.completed.map((entry) => entry.task.id)).toEqual(["c", "a"]);
  });
});

describe("groupCompletedRunsByDay", () => {
  test("buckets by local day and sorts newest first", () => {
    // Use noon local times so day keys are stable across TZ offsets.
    const day1 = new Date(2026, 6, 26, 12, 0, 0).getTime();
    const day1later = new Date(2026, 6, 26, 18, 0, 0).getTime();
    const day0 = new Date(2026, 6, 25, 12, 0, 0).getTime();
    const t = task({ id: "t", title: "T" });
    const groups = groupCompletedRunsByDay([
      { task: t, run: { status: "success", ranAt: day1 } },
      { task: t, run: { status: "failed", ranAt: day0 } },
      { task: t, run: { status: "success", ranAt: day1later } },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.dayKey).toBe(localDayKey(day1));
    expect(groups[0]!.entries.map((e) => e.run.ranAt)).toEqual([day1later, day1]);
    expect(groups[1]!.dayKey).toBe(localDayKey(day0));
  });
});

describe("resolveRunDayLabel / resolvePostRunStatusTab", () => {
  test("today and yesterday labels", () => {
    const now = new Date(2026, 6, 26, 15, 0, 0).getTime();
    expect(
      resolveRunDayLabel({
        dayKey: localDayKey(now, now),
        dayLabel: "7/26",
        now,
        todayLabel: "今天",
        yesterdayLabel: "昨天",
      }),
    ).toBe("今天");
    expect(
      resolveRunDayLabel({
        dayKey: localDayKey(now - 24 * 60 * 60 * 1000, now),
        dayLabel: "7/25",
        now,
        todayLabel: "今天",
        yesterdayLabel: "昨天",
      }),
    ).toBe("昨天");
  });

  test("post-run tab keeps running while lease held", () => {
    expect(resolvePostRunStatusTab({ running: { sessionId: "s" } })).toBe(
      "running",
    );
    expect(resolvePostRunStatusTab({ lastRun: { status: "success" } })).toBe(
      "completed",
    );
  });
});

describe("archive run helpers", () => {
  test("prefers session id in archive key and filters archived rows", () => {
    const t = task({ id: "task-1", title: "T" });
    const withSession = {
      task: t,
      run: { status: "success" as const, ranAt: 100, sessionId: "ses_a" },
    };
    const withoutSession = {
      task: t,
      run: { status: "failed" as const, ranAt: 200 },
    };
    expect(automationRunArchiveKey("task-1", withSession.run)).toBe(
      "task-1::ses_a",
    );
    expect(automationRunArchiveKey("task-1", withoutSession.run)).toBe(
      "task-1::200",
    );
    const keys = addArchivedRunKey(
      [],
      automationRunArchiveKey("task-1", withSession.run),
    );
    const filtered = filterOutArchivedRuns(
      [withSession, withoutSession],
      keys,
    );
    expect(filtered).toEqual([withoutSession]);
  });
});

describe("automation page contracts", () => {
  test("uses dual tabs and list model helpers", () => {
    const page = readFileSync(
      join(appRoot, "src/react-app/domains/messaging/automation-page.tsx"),
      "utf8",
    );
    expect(page).toContain("shouldShowAutomationTemplates");
    expect(page).toContain("partitionAutomationTasks");
    expect(page).toContain("groupCompletedRunsByDay");
    expect(page).toContain("automation.tab_tasks");
    expect(page).toContain("automation.tab_runs");
    expect(page).toContain('type AutomationStatusTab = "tasks" | "runs"');
    // Loading must not flash templates before listReady.
    expect(page).toContain("listReady");
    expect(page).toContain("showListLoading");
    expect(page).toContain("onArchive");
    expect(page).toContain("automation.archive_run");
    expect(page).toContain("archiveAutomationRunKey");
    expect(page).toContain("automation.archive_success");
    expect(page).toContain("showToast");
  });
});
