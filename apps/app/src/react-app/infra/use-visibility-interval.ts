/**
 * Visibility-aware setInterval for React.
 * Pauses while the document is hidden (default) and resumes on focus.
 */
import { useEffect, useRef, type DependencyList } from "react";

import {
  isDocumentHidden,
  nextPollDelayMs,
  shouldRunPollTick,
  type VisibilityPollPolicy,
} from "./visibility-poll";

export function useVisibilityInterval(
  callback: () => void,
  focusedIntervalMs: number,
  deps: DependencyList,
  hiddenIntervalMs: number = 0,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (typeof window === "undefined" || focusedIntervalMs <= 0) return;

    let intervalId: number | undefined;
    let cancelled = false;
    const policy: VisibilityPollPolicy = {
      focusedIntervalMs,
      hiddenIntervalMs,
    };

    const run = () => {
      if (cancelled) return;
      if (!shouldRunPollTick(isDocumentHidden(), hiddenIntervalMs <= 0)) return;
      callbackRef.current();
    };

    const clearPollInterval = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const schedulePoll = () => {
      clearPollInterval();
      const delayMs = nextPollDelayMs(policy, isDocumentHidden());
      if (delayMs == null) return;
      intervalId = window.setInterval(run, delayMs);
    };

    const onVisibilityChange = () => {
      if (cancelled) return;
      if (isDocumentHidden()) {
        clearPollInterval();
        return;
      }
      run();
      schedulePoll();
    };

    schedulePoll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearPollInterval();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller owns deps list
  }, deps);
}
