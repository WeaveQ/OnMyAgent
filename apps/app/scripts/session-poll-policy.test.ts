/**
 * P2: session timer/poll policy — imports shipped helpers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AUTOMATION_IDLE_REFETCH_MS,
  AUTOMATION_RUNNING_REFETCH_MS,
  CODE_REVIEW_POLL_INTERVAL_MS,
  CODE_TERMINAL_SNAPSHOT_INTERVAL_MS,
  automationListRefetchIntervalMs,
  codeReviewPollIntervalMs,
  codeTerminalSnapshotIntervalMs,
  shouldRunActivePoll,
  shouldTickGoalRuntimeClock,
} from "../src/react-app/domains/session/sync/session-poll-policy";

const appRoot = join(import.meta.dir, "..");

describe("shouldRunActivePoll (shipped)", () => {
  test("stops when disabled or document hidden", () => {
    expect(shouldRunActivePoll({ enabled: false })).toBe(false);
    expect(shouldRunActivePoll({ enabled: true, documentVisible: false })).toBe(false);
    expect(shouldRunActivePoll({ enabled: true, documentVisible: true })).toBe(true);
  });
});

describe("codeTerminalSnapshotIntervalMs (shipped)", () => {
  test("null when unmounted or hidden; 250ms only when mounted and visible", () => {
    expect(codeTerminalSnapshotIntervalMs({ mounted: false })).toBeNull();
    expect(
      codeTerminalSnapshotIntervalMs({ mounted: true, documentVisible: false }),
    ).toBeNull();
    expect(
      codeTerminalSnapshotIntervalMs({ mounted: true, documentVisible: true }),
    ).toBe(CODE_TERMINAL_SNAPSHOT_INTERVAL_MS);
    expect(CODE_TERMINAL_SNAPSHOT_INTERVAL_MS).toBe(250);
  });
});

describe("codeReviewPollIntervalMs (shipped)", () => {
  test("requires enabled+polling and visibility", () => {
    expect(
      codeReviewPollIntervalMs({ enabled: true, polling: true, documentVisible: true }),
    ).toBe(CODE_REVIEW_POLL_INTERVAL_MS);
    expect(
      codeReviewPollIntervalMs({ enabled: true, polling: false, documentVisible: true }),
    ).toBeNull();
    expect(
      codeReviewPollIntervalMs({ enabled: true, polling: true, documentVisible: false }),
    ).toBeNull();
  });
});

describe("automationListRefetchIntervalMs (shipped)", () => {
  test("running vs idle intervals; false when hidden", () => {
    expect(
      automationListRefetchIntervalMs({ anyRunning: true, documentVisible: true }),
    ).toBe(AUTOMATION_RUNNING_REFETCH_MS);
    expect(
      automationListRefetchIntervalMs({ anyRunning: false, documentVisible: true }),
    ).toBe(AUTOMATION_IDLE_REFETCH_MS);
    expect(
      automationListRefetchIntervalMs({ anyRunning: true, documentVisible: false }),
    ).toBe(false);
  });
});

describe("shouldTickGoalRuntimeClock (shipped)", () => {
  test("ticks only while actively running and visible", () => {
    expect(
      shouldTickGoalRuntimeClock({ status: "running", documentVisible: true }),
    ).toBe(true);
    expect(
      shouldTickGoalRuntimeClock({ status: "paused", documentVisible: true }),
    ).toBe(false);
    expect(
      shouldTickGoalRuntimeClock({ status: "completed", documentVisible: true }),
    ).toBe(false);
    expect(
      shouldTickGoalRuntimeClock({
        status: "running",
        waitingReason: "user",
        documentVisible: true,
      }),
    ).toBe(false);
    expect(
      shouldTickGoalRuntimeClock({ status: "running", documentVisible: false }),
    ).toBe(false);
  });
});

describe("poll policy wiring (structural)", () => {
  test("terminal, review, automation, and goal clocks import session-poll-policy", () => {
    const terminal = readFileSync(
      join(appRoot, "src/react-app/domains/session/surface/code-workspace-side-panel.tsx"),
      "utf8",
    );
    const review = readFileSync(
      join(appRoot, "src/react-app/domains/session/surface/code-workspace-review.tsx"),
      "utf8",
    );
    const automation = readFileSync(
      join(appRoot, "src/react-app/domains/session/sidebar/agent-conversation-panel.tsx"),
      "utf8",
    );
    const goalPanel = readFileSync(
      join(appRoot, "src/react-app/domains/session/surface/session-surface-components.tsx"),
      "utf8",
    );
    const goalRuntime = readFileSync(
      join(appRoot, "src/react-app/domains/session/surface/plan-goal/goal-runtime.tsx"),
      "utf8",
    );

    expect(terminal).toContain("codeTerminalSnapshotIntervalMs");
    expect(terminal).toContain("shouldRunActivePoll");
    // No bare unconditional 250 without policy.
    expect(terminal).not.toMatch(/setInterval\(\(\) => void refresh\(\), 250\)/);

    expect(review).toContain("codeReviewPollIntervalMs");
    expect(automation).toContain("automationListRefetchIntervalMs");
    expect(goalPanel).toContain("shouldTickGoalRuntimeClock");
    expect(goalRuntime).toContain("shouldTickGoalRuntimeClock");
  });
});
