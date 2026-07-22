/**
 * P2: session timer/poll policy — imports shipped helpers + resume wiring.
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
  shouldInstallGoalRuntimeClock,
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
  test("null only when unmounted — visibility does not suppress install", () => {
    expect(codeTerminalSnapshotIntervalMs({ mounted: false })).toBeNull();
    // Hidden tab must still get an interval so ticks resume when visible.
    expect(codeTerminalSnapshotIntervalMs({ mounted: true })).toBe(
      CODE_TERMINAL_SNAPSHOT_INTERVAL_MS,
    );
    expect(CODE_TERMINAL_SNAPSHOT_INTERVAL_MS).toBe(250);
  });
});

describe("codeReviewPollIntervalMs (shipped)", () => {
  test("requires enabled+polling only — not document visibility", () => {
    expect(
      codeReviewPollIntervalMs({ enabled: true, polling: true }),
    ).toBe(CODE_REVIEW_POLL_INTERVAL_MS);
    expect(
      codeReviewPollIntervalMs({ enabled: true, polling: false }),
    ).toBeNull();
    expect(
      codeReviewPollIntervalMs({ enabled: false, polling: true }),
    ).toBeNull();
  });
});

describe("automationListRefetchIntervalMs (shipped)", () => {
  test("running vs idle intervals always return a number", () => {
    expect(automationListRefetchIntervalMs({ anyRunning: true })).toBe(
      AUTOMATION_RUNNING_REFETCH_MS,
    );
    expect(automationListRefetchIntervalMs({ anyRunning: false })).toBe(
      AUTOMATION_IDLE_REFETCH_MS,
    );
  });
});

describe("goal runtime clock install vs tick (shipped)", () => {
  test("install is status-only; tick also requires visibility", () => {
    expect(
      shouldInstallGoalRuntimeClock({ status: "running" }),
    ).toBe(true);
    expect(
      shouldInstallGoalRuntimeClock({ status: "paused" }),
    ).toBe(false);
    expect(
      shouldInstallGoalRuntimeClock({ status: "completed" }),
    ).toBe(false);
    expect(
      shouldInstallGoalRuntimeClock({
        status: "running",
        waitingReason: "user",
      }),
    ).toBe(false);

    // Running + hidden: still install-worthy, but tick must not fire.
    expect(
      shouldInstallGoalRuntimeClock({ status: "running" }),
    ).toBe(true);
    expect(
      shouldTickGoalRuntimeClock({ status: "running", documentVisible: false }),
    ).toBe(false);
    expect(
      shouldTickGoalRuntimeClock({ status: "running", documentVisible: true }),
    ).toBe(true);
  });
});

/**
 * Resume-on-visible contract: callers must not early-return out of effect
 * setup solely because the document is hidden. Prove with pure helpers
 * (install ignores visibility) + structural source checks (interval +
 * visibilitychange always registered when feature is on).
 */
describe("poll resume-on-visible wiring", () => {
  test("install helpers return intervals while document would be hidden", () => {
    // Simulates "setup while tab is in background":
    // interval ms still defined; only shouldRunActivePoll/tick gates work.
    expect(codeTerminalSnapshotIntervalMs({ mounted: true })).not.toBeNull();
    expect(
      codeReviewPollIntervalMs({ enabled: true, polling: true }),
    ).not.toBeNull();
    expect(shouldInstallGoalRuntimeClock({ status: "running" })).toBe(true);
    // Tick path stays off while hidden:
    expect(shouldRunActivePoll({ enabled: true, documentVisible: false })).toBe(false);
    expect(
      shouldTickGoalRuntimeClock({ status: "running", documentVisible: false }),
    ).toBe(false);
    // And turns on when visible again without re-running install logic:
    expect(shouldRunActivePoll({ enabled: true, documentVisible: true })).toBe(true);
    expect(
      shouldTickGoalRuntimeClock({ status: "running", documentVisible: true }),
    ).toBe(true);
  });

  test("terminal/review/goal effects register interval + visibilitychange; no hidden early-return on install", () => {
    const terminal = readFileSync(
      join(appRoot, "src/react-app/domains/session/surface/code-workspace-side-panel.tsx"),
      "utf8",
    );
    const review = readFileSync(
      join(appRoot, "src/react-app/domains/session/surface/code-workspace-review.tsx"),
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
    const automation = readFileSync(
      join(appRoot, "src/react-app/domains/session/sidebar/agent-conversation-panel.tsx"),
      "utf8",
    );

    // Terminal: install from mounted-only helper; tick gated; resume via visibility.
    expect(terminal).toContain("codeTerminalSnapshotIntervalMs({ mounted: true })");
    expect(terminal).toContain("shouldRunActivePoll({ enabled: true })");
    expect(terminal).toContain('addEventListener("visibilitychange"');
    expect(terminal).not.toMatch(/setInterval\(\(\) => void refresh\(\), 250\)/);
    // Must not pass documentVisible into the *install* helper.
    expect(terminal).not.toMatch(
      /codeTerminalSnapshotIntervalMs\(\{[^}]*documentVisible/,
    );

    // Review: same install-vs-tick split + visibility listener.
    expect(review).toContain("codeReviewPollIntervalMs");
    expect(review).toContain("shouldRunActivePoll");
    expect(review).toContain('addEventListener("visibilitychange"');
    expect(review).not.toMatch(
      /codeReviewPollIntervalMs\(\{[^}]*documentVisible/,
    );

    // Goal: install helper for setup; tick helper inside interval; visibility listener.
    for (const source of [goalPanel, goalRuntime]) {
      expect(source).toContain("shouldInstallGoalRuntimeClock");
      expect(source).toContain("shouldTickGoalRuntimeClock");
      expect(source).toContain('addEventListener("visibilitychange"');
      // Setup must not early-return solely via shouldTick (would drop resume).
      expect(source).toMatch(
        /if\s*\(\s*!\s*shouldInstallGoalRuntimeClock/,
      );
    }

    // Automation: keep interval numeric; pause via RQ background flag.
    expect(automation).toContain("automationListRefetchIntervalMs");
    expect(automation).toContain("refetchIntervalInBackground: false");
  });
});
