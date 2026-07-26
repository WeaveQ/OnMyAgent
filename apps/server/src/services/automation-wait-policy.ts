/**
 * Pure settle rules for automation session completion.
 * Used by waitForAutomationSession so unit tests can pin the policy.
 */

export const AUTOMATION_SETTLE_IDLE_MS = 3_000;
export const AUTOMATION_EMPTY_OUTPUT_GRACE_MS = 30_000;

export type AutomationWaitTick = {
  statusType: "busy" | "retry" | "idle" | "missing" | string;
  observedActive: boolean;
  inactiveSince: number | null;
  now: number;
  startedAt: number;
  hasSavedOutput: boolean;
  hasSessionError: boolean;
  settleIdleMs?: number;
  emptyOutputGraceMs?: number;
};

export type AutomationWaitDecision =
  | { action: "continue"; observedActive: boolean; inactiveSince: number | null }
  | { action: "complete"; observedActive: boolean; inactiveSince: number | null }
  | { action: "fail_error"; observedActive: boolean; inactiveSince: number | null }
  | { action: "fail_empty"; observedActive: boolean; inactiveSince: number | null };

export function decideAutomationWaitTick(input: AutomationWaitTick): AutomationWaitDecision {
  const settleIdleMs = input.settleIdleMs ?? AUTOMATION_SETTLE_IDLE_MS;
  const emptyOutputGraceMs = input.emptyOutputGraceMs ?? AUTOMATION_EMPTY_OUTPUT_GRACE_MS;
  let observedActive = input.observedActive;
  let inactiveSince = input.inactiveSince;

  if (input.statusType === "busy" || input.statusType === "retry") {
    return {
      action: "continue",
      observedActive: true,
      inactiveSince: null,
    };
  }

  if (input.statusType === "idle" || input.statusType === "missing") {
    inactiveSince ??= input.now;
    const idleForMs = input.now - inactiveSince;

    if (observedActive && idleForMs >= settleIdleMs) {
      if (input.hasSavedOutput) {
        return { action: "complete", observedActive, inactiveSince };
      }
      if (input.hasSessionError) {
        return { action: "fail_error", observedActive, inactiveSince };
      }
    }

    if (
      (observedActive || input.now - input.startedAt >= 5_000) &&
      idleForMs >= emptyOutputGraceMs
    ) {
      if (input.hasSavedOutput && observedActive) {
        return { action: "complete", observedActive, inactiveSince };
      }
      if (input.hasSessionError) {
        return { action: "fail_error", observedActive, inactiveSince };
      }
      return { action: "fail_empty", observedActive, inactiveSince };
    }

    return { action: "continue", observedActive, inactiveSince };
  }

  return { action: "continue", observedActive, inactiveSince };
}
