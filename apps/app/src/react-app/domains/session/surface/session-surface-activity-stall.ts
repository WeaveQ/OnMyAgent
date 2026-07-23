/**
 * Stall notice + recovery timers for the assistant activity footer.
 * One-shot timeouts (not a 1s interval) so SessionSurface does not re-render
 * every second while the user is scrolling.
 */
import { useEffect, useState } from "react";

import type { SessionActivityStatus } from "../status/session-activity-store";
import {
  ASSISTANT_RECOVERY_HINT_MS,
  ASSISTANT_STALL_NOTICE_MS,
} from "./session-surface-constants";

export type UseSessionSurfaceActivityStallInput = {
  sessionId: string;
  activityFingerprint: string;
  effectiveActivityStatus: SessionActivityStatus;
  liveStatusType: string;
  activityVisible: boolean;
};

export function useSessionSurfaceActivityStall(
  input: UseSessionSurfaceActivityStallInput,
) {
  const [activityPulseAt, setActivityPulseAt] = useState(Date.now());
  const [showStalledActivityNotice, setShowStalledActivityNotice] =
    useState(false);
  const [shouldInjectStallRecovery, setShouldInjectStallRecovery] =
    useState(false);

  useEffect(() => {
    setActivityPulseAt(Date.now());
    setShowStalledActivityNotice(false);
    setShouldInjectStallRecovery(false);
  }, [
    input.activityFingerprint,
    input.effectiveActivityStatus,
    input.liveStatusType,
    input.sessionId,
  ]);

  useEffect(() => {
    if (!input.activityVisible || input.effectiveActivityStatus === "compacting") {
      setShowStalledActivityNotice(false);
      setShouldInjectStallRecovery(false);
      return;
    }
    const elapsed = Date.now() - activityPulseAt;
    const stallDelay = Math.max(0, ASSISTANT_STALL_NOTICE_MS - elapsed);
    const recoveryDelay = Math.max(0, ASSISTANT_RECOVERY_HINT_MS - elapsed);
    let stallTimer: number | undefined;
    let recoveryTimer: number | undefined;
    if (stallDelay === 0) {
      setShowStalledActivityNotice(true);
    } else {
      stallTimer = window.setTimeout(
        () => setShowStalledActivityNotice(true),
        stallDelay,
      );
    }
    if (recoveryDelay === 0) {
      setShouldInjectStallRecovery(true);
    } else {
      recoveryTimer = window.setTimeout(
        () => setShouldInjectStallRecovery(true),
        recoveryDelay,
      );
    }
    return () => {
      if (stallTimer !== undefined) window.clearTimeout(stallTimer);
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
    };
  }, [
    activityPulseAt,
    input.activityVisible,
    input.effectiveActivityStatus,
  ]);

  return {
    activityPulseAt,
    showStalledActivityNotice,
    shouldInjectStallRecovery,
  };
}
