import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTOMATION_DUE_GRACE_MS,
  AUTOMATION_SCHEDULER_MAX_MS,
  AUTOMATION_SCHEDULER_MIN_MS,
  DEFAULT_SESSION_ARCHIVE_PERIODIC_MS,
  isAutomationDueForClaim,
  isAutomationNextRunStale,
  nextAutomationWakeMs,
  selectClaimableAutomation,
  shouldRunIncrementalSessionArchiveSync,
  shouldRunPeriodicArchiveSync,
} from "../src/services/automation-schedule-policy.js";
import type { AutomationTaskItem } from "@onmyagent/types/server";
import {
  ARCHIVE_SSE_DEFAULT_POLL_MS,
  ARCHIVE_SSE_MIN_POLL_MS,
  resolveArchiveSsePollMs,
} from "../src/services/archive-sse-policy.js";

const serverRoot = join(import.meta.dir, "..");

describe("nextAutomationWakeMs (shipped)", () => {
  test("sparse wake when nothing is due or running", () => {
    expect(
      nextAutomationWakeMs({
        now: 1_000_000,
        nextRunAts: [],
        hasRunning: false,
      }),
    ).toBe(AUTOMATION_SCHEDULER_MAX_MS);
  });

  test("dense wake when running or due now", () => {
    expect(
      nextAutomationWakeMs({
        now: 1_000_000,
        nextRunAts: [999_000],
        hasRunning: false,
      }),
    ).toBe(AUTOMATION_SCHEDULER_MIN_MS);
    expect(
      nextAutomationWakeMs({
        now: 1_000_000,
        nextRunAts: [2_000_000],
        hasRunning: true,
      }),
    ).toBe(AUTOMATION_SCHEDULER_MIN_MS);
  });

  test("clamps future nextRun into [min, max]", () => {
    const wake = nextAutomationWakeMs({
      now: 1_000_000,
      nextRunAts: [1_000_000 + 12_000],
      hasRunning: false,
    });
    expect(wake).toBe(12_000);
    expect(wake).toBeGreaterThanOrEqual(AUTOMATION_SCHEDULER_MIN_MS);
    expect(wake).toBeLessThanOrEqual(AUTOMATION_SCHEDULER_MAX_MS);
  });
});

describe("shouldRunIncrementalSessionArchiveSync (shipped)", () => {
  test("resync always; incremental needs changed paths", () => {
    expect(
      shouldRunIncrementalSessionArchiveSync({ mode: "resync", changedPathCount: 0 }),
    ).toBe(true);
    expect(
      shouldRunIncrementalSessionArchiveSync({ mode: "incremental", changedPathCount: 0 }),
    ).toBe(false);
    expect(
      shouldRunIncrementalSessionArchiveSync({ mode: "incremental", changedPathCount: 2 }),
    ).toBe(true);
  });
});

describe("shouldRunPeriodicArchiveSync (shipped)", () => {
  test("never-run is due; respects interval and invalid interval", () => {
    expect(shouldRunPeriodicArchiveSync(0, 1_000_000, DEFAULT_SESSION_ARCHIVE_PERIODIC_MS)).toBe(true);
    expect(shouldRunPeriodicArchiveSync(1_000_000, 1_000_000 + 10_000, DEFAULT_SESSION_ARCHIVE_PERIODIC_MS)).toBe(false);
    expect(shouldRunPeriodicArchiveSync(1_000_000, 1_000_000 + DEFAULT_SESSION_ARCHIVE_PERIODIC_MS, DEFAULT_SESSION_ARCHIVE_PERIODIC_MS)).toBe(true);
    expect(shouldRunPeriodicArchiveSync(1_000_000, 2_000_000, 0)).toBe(false);
    expect(shouldRunPeriodicArchiveSync(1_000_000, 2_000_000, -1)).toBe(false);
  });
});

describe("selectClaimableAutomation / due helpers (shipped)", () => {
  const base = {
    id: "automation-1",
    scene: "office" as const,
    title: "t",
    prompt: "p",
    schedule: { mode: "weekly" as const, day: "daily" as const, time: "09:00" },
    effectiveRange: {},
    createdAt: 0,
    updatedAt: 0,
    lastRun: null,
    runs: [],
  };

  test("stale and due predicates honor grace window", () => {
    const now = 1_000_000;
    expect(isAutomationNextRunStale(now - AUTOMATION_DUE_GRACE_MS - 1, now)).toBe(true);
    expect(isAutomationNextRunStale(now - 1_000, now)).toBe(false);
    const due: AutomationTaskItem = {
      ...base,
      enabled: true,
      nextRunAt: now - 1_000,
      running: null,
    };
    expect(isAutomationDueForClaim(due, now)).toBe(true);
    expect(isAutomationDueForClaim({ ...due, nextRunAt: now - AUTOMATION_DUE_GRACE_MS - 1 }, now)).toBe(false);
  });

  test("selects earliest claimable among due and expired leases", () => {
    const now = 1_000_000;
    const later: AutomationTaskItem = {
      ...base,
      id: "later",
      enabled: true,
      nextRunAt: now - 100,
      running: null,
    };
    const earlier: AutomationTaskItem = {
      ...base,
      id: "earlier",
      enabled: true,
      nextRunAt: now - 500,
      running: null,
    };
    const expiredLease: AutomationTaskItem = {
      ...base,
      id: "expired",
      enabled: true,
      nextRunAt: now + 60_000,
      running: {
        leaseId: "l1",
        startedAt: now - 10_000,
        expiresAt: now - 1,
        attempt: 1,
        scheduledForAt: now - 9_000,
      },
    };
    expect(selectClaimableAutomation([later, earlier], now)?.id).toBe("earlier");
    expect(selectClaimableAutomation([later, expiredLease], now)?.id).toBe("expired");
  });
});

describe("resolveArchiveSsePollMs (shipped)", () => {
  test("defaults to long heartbeat; honors explicit short poll_ms", () => {
    expect(resolveArchiveSsePollMs(undefined)).toBe(ARCHIVE_SSE_DEFAULT_POLL_MS);
    expect(resolveArchiveSsePollMs(null)).toBeGreaterThanOrEqual(ARCHIVE_SSE_MIN_POLL_MS);
    expect(resolveArchiveSsePollMs(1500)).toBe(1500);
    expect(resolveArchiveSsePollMs(30_000)).toBe(30_000);
  });
});

describe("automation scheduler wiring (structural)", () => {
  test("runner uses nextAutomationWakeMs instead of fixed 30s interval", () => {
    const source = readFileSync(
      join(serverRoot, "src/services/automation-runner.ts"),
      "utf8",
    );
    expect(source).toContain("nextAutomationWakeMs");
    expect(source).not.toMatch(/setInterval\(\(\) => \{\s*void run\(\);\s*\}, 30_000\)/);
  });
});
