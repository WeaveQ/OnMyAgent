import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTOMATION_SCHEDULER_MAX_MS,
  AUTOMATION_SCHEDULER_MIN_MS,
  nextAutomationWakeMs,
  shouldRunIncrementalSessionArchiveSync,
} from "../src/services/automation-schedule-policy.js";
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
