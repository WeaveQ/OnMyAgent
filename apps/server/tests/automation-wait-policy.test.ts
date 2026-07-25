import { describe, expect, test } from "bun:test";

import {
  AUTOMATION_EMPTY_OUTPUT_GRACE_MS,
  AUTOMATION_SETTLE_IDLE_MS,
  decideAutomationWaitTick,
} from "../src/services/automation-wait-policy.ts";

describe("decideAutomationWaitTick", () => {
  test("stays running while busy", () => {
    const decision = decideAutomationWaitTick({
      statusType: "busy",
      observedActive: false,
      inactiveSince: 100,
      now: 1_000,
      startedAt: 0,
      hasSavedOutput: true,
      hasSessionError: false,
    });
    expect(decision).toEqual({
      action: "continue",
      observedActive: true,
      inactiveSince: null,
    });
  });

  test("does not complete on idle before busy was observed", () => {
    const decision = decideAutomationWaitTick({
      statusType: "idle",
      observedActive: false,
      inactiveSince: null,
      now: 2_000,
      startedAt: 0,
      hasSavedOutput: true,
      hasSessionError: false,
    });
    expect(decision.action).toBe("continue");
    expect(decision.observedActive).toBe(false);
  });

  test("completes after busy then sustained idle with output", () => {
    const idleStart = 10_000;
    const decision = decideAutomationWaitTick({
      statusType: "idle",
      observedActive: true,
      inactiveSince: idleStart,
      now: idleStart + AUTOMATION_SETTLE_IDLE_MS,
      startedAt: 0,
      hasSavedOutput: true,
      hasSessionError: false,
    });
    expect(decision.action).toBe("complete");
  });

  test("fails empty after grace without output", () => {
    const idleStart = 10_000;
    const decision = decideAutomationWaitTick({
      statusType: "idle",
      observedActive: true,
      inactiveSince: idleStart,
      now: idleStart + AUTOMATION_EMPTY_OUTPUT_GRACE_MS,
      startedAt: 0,
      hasSavedOutput: false,
      hasSessionError: false,
    });
    expect(decision.action).toBe("fail_empty");
  });
});
