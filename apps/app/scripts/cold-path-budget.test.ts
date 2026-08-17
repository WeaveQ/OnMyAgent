import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  COLD_PATH_BUDGET,
  beginSessionRouteColdEnter,
  getColdPathCounters,
  isColdPathWithinBudget,
  isSyncPrewarmAllowedOnColdEnter,
  isTitleSnapshotAllowedOnColdEnter,
  recordColdPathEvent,
  resetColdPathCounters,
  shouldPrefetchSessionSnapshotOnColdPath,
  tryRecordColdListSessions,
  tryRecordColdTitleSnapshot,
} from "../src/react-app/shell/session-route/cold-path-budget";
import {
  SESSION_PREWARM_FALLBACK_DELAY_MS,
  SESSION_PREWARM_IDLE_TIMEOUT_MS,
  scheduleIdleWork,
} from "../src/react-app/shell/session-route/prewarm-schedule";

const appRoot = path.join(import.meta.dir, "..");

describe("cold-path budget (shipped helpers)", () => {
  beforeEach(() => {
    resetColdPathCounters();
  });

  test("budget numbers match prewarm schedule SoT", () => {
    expect(SESSION_PREWARM_IDLE_TIMEOUT_MS).toBe(
      COLD_PATH_BUDGET.prewarmIdleTimeoutMs,
    );
    expect(SESSION_PREWARM_FALLBACK_DELAY_MS).toBe(
      COLD_PATH_BUDGET.prewarmFallbackDelayMs,
    );
    expect(COLD_PATH_BUDGET.maxSyncPrewarmOnColdEnter).toBe(0);
    expect(isSyncPrewarmAllowedOnColdEnter()).toBe(false);
  });

  test("title snapshot thrash ban on cold enter for empty selected chips", () => {
    expect(
      isTitleSnapshotAllowedOnColdEnter({
        isSelectedSession: true,
        titleEmpty: true,
        alreadySnapshotted: false,
      }),
    ).toBe(false);
    expect(
      isTitleSnapshotAllowedOnColdEnter({
        isSelectedSession: false,
        titleEmpty: true,
        alreadySnapshotted: false,
      }),
    ).toBe(true);
    expect(
      isTitleSnapshotAllowedOnColdEnter({
        isSelectedSession: true,
        titleEmpty: false,
        alreadySnapshotted: true,
      }),
    ).toBe(false);
  });

  test("counters enforce budget after one listSessions and zero sync prewarm", () => {
    recordColdPathEvent("listSessions");
    expect(getColdPathCounters().listSessions).toBe(1);
    expect(isColdPathWithinBudget()).toBe(true);

    // Recording a title snapshot on cold enter exceeds thrash budget (max 0).
    recordColdPathEvent("titleSnapshot");
    expect(isColdPathWithinBudget()).toBe(false);
  });

  test("scheduleIdleWork never runs sync and never records syncPrewarm when banned", () => {
    let ran = false;
    scheduleIdleWork({
      run: () => {
        ran = true;
      },
      host: {
        requestIdleCallback: () => 1,
        cancelIdleCallback: () => undefined,
        setTimeout: () => {
          throw new Error("must not fall back when idle exists");
        },
        clearTimeout: () => undefined,
      },
    });
    expect(ran).toBe(false);
    expect(getColdPathCounters().syncPrewarm).toBe(0);
    expect(isColdPathWithinBudget()).toBe(true);
  });

  test("production paths record listSessions and gate empty-selected prefetch", () => {
    const sessions = readFileSync(
      path.join(appRoot, "src/react-app/shell/session-route/sessions.ts"),
      "utf8",
    );
    expect(sessions).toContain("tryRecordColdListSessions");
    // Create-path snapshot must not use empty-title thrash ban (post-create needs pull).
    expect(sessions).not.toContain("coldEnterEmptyTitle");

    const pageView = readFileSync(
      path.join(appRoot, "src/react-app/shell/session-route/page-view.tsx"),
      "utf8",
    );
    expect(pageView).toContain("tryRecordColdTitleSnapshot");
    expect(pageView).toContain("onPrefetchSession");

    // Empty selected chip: ban (product thrash rule).
    expect(
      shouldPrefetchSessionSnapshotOnColdPath({
        isSelectedSession: true,
        titleEmpty: true,
      }),
    ).toBe(false);
    // Non-empty title may prefetch (does not burn thrash counter).
    expect(
      shouldPrefetchSessionSnapshotOnColdPath({
        isSelectedSession: true,
        titleEmpty: false,
      }),
    ).toBe(true);
    expect(getColdPathCounters().titleSnapshot).toBe(0);
  });

  test("empty selected chip never records a title snapshot; non-empty selected may", () => {
    expect(
      tryRecordColdTitleSnapshot({
        isSelectedSession: true,
        titleEmpty: true,
        alreadySnapshotted: false,
      }),
    ).toBe(false);
    expect(getColdPathCounters().titleSnapshot).toBe(0);

    expect(
      tryRecordColdTitleSnapshot({
        isSelectedSession: true,
        titleEmpty: false,
        alreadySnapshotted: false,
      }),
    ).toBe(true);
    expect(getColdPathCounters().titleSnapshot).toBe(1);
    expect(isColdPathWithinBudget()).toBe(false);
  });

  test("beginSessionRouteColdEnter resets counters once per enter key", () => {
    beginSessionRouteColdEnter("ws-a|ws-b");
    recordColdPathEvent("listSessions");
    expect(getColdPathCounters().listSessions).toBe(1);

    beginSessionRouteColdEnter("ws-a|ws-b");
    expect(getColdPathCounters().listSessions).toBe(1);

    beginSessionRouteColdEnter("ws-c");
    expect(getColdPathCounters().listSessions).toBe(0);
    expect(getColdPathCounters().titleSnapshot).toBe(0);
  });

  test("session loader resets cold-enter counters on background load", () => {
    const loader = readFileSync(
      path.join(appRoot, "src/react-app/shell/session-route/session-loader-hook.ts"),
      "utf8",
    );
    expect(loader).toContain("beginSessionRouteColdEnter");
    expect(loader).toContain("skippedByColdPathBudget");
  });

  test("session route remount resets cold-path so settings return can list again", () => {
    const loader = readFileSync(
      path.join(appRoot, "src/react-app/shell/session-route/session-loader-hook.ts"),
      "utf8",
    );
    const cacheHook = readFileSync(
      path.join(appRoot, "src/react-app/shell/session-route/sidebar-session-cache-hook.ts"),
      "utf8",
    );
    expect(loader).toContain("useSidebarSessionCacheSync");
    expect(cacheHook).toContain("resetColdPathCounters");
    expect(cacheHook).toContain("writeCachedSidebarSessionsForWorkspace");
  });

  test("live enter fail-closes extra listSessions after the first", () => {
    beginSessionRouteColdEnter("ws-live");
    expect(tryRecordColdListSessions()).toBe(true);
    expect(tryRecordColdListSessions()).toBe(false);
    expect(getColdPathCounters().listSessions).toBe(1);
  });

  test("live enter fail-closes a second title snapshot", () => {
    beginSessionRouteColdEnter("ws-live-title");
    expect(
      tryRecordColdTitleSnapshot({
        isSelectedSession: true,
        titleEmpty: false,
        alreadySnapshotted: false,
      }),
    ).toBe(true);
    expect(
      tryRecordColdTitleSnapshot({
        isSelectedSession: false,
        titleEmpty: true,
        alreadySnapshotted: false,
      }),
    ).toBe(false);
    expect(getColdPathCounters().titleSnapshot).toBe(1);
  });
});
