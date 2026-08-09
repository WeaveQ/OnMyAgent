import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  COLD_PATH_BUDGET,
  getColdPathCounters,
  isColdPathWithinBudget,
  isSyncPrewarmAllowedOnColdEnter,
  isTitleSnapshotAllowedOnColdEnter,
  recordColdPathEvent,
  resetColdPathCounters,
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

  test("production sessions.ts records listSessions and gates title snapshots", () => {
    const sessions = readFileSync(
      path.join(appRoot, "src/react-app/shell/session-route/sessions.ts"),
      "utf8",
    );
    expect(sessions).toContain('recordColdPathEvent("listSessions")');
    expect(sessions).toContain("tryRecordColdTitleSnapshot");

    // First empty selected snapshot is banned by budget (max 0) after any prior record,
    // and first attempt with alreadySnapshotted=false still banned when title empty selected.
    expect(
      tryRecordColdTitleSnapshot({
        isSelectedSession: true,
        titleEmpty: true,
        alreadySnapshotted: false,
      }),
    ).toBe(false);
  });
});
