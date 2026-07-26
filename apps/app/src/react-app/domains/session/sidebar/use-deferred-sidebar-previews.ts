/** @jsxImportSource react */
import { useEffect, useState } from "react";

import {
  SIDEBAR_PREVIEW_SNAPSHOT_DEFER_MS,
  selectSidebarPreviewSessionIds,
} from "../sync/sidebar-load-policy";

/**
 * Gates non-critical sidebar preview snapshot queries until after cold start.
 * Selected session transcript is loaded by the main session surface, not here.
 */
export function useDeferredSidebarPreviews(input: {
  enabled: boolean;
  sessions: Array<{ id: string }>;
  selectedSessionId?: string | null;
  deferMs?: number;
  maxPreviews?: number;
  includeSelected?: boolean;
  prioritizeSelected?: boolean;
}): {
  deferred: boolean;
  previewSessionIds: Set<string>;
} {
  const [deferred, setDeferred] = useState(false);

  useEffect(() => {
    if (!input.enabled) {
      setDeferred(false);
      return;
    }
    let cancelled = false;
    let idleHandle: number | null = null;
    const delay = input.deferMs ?? SIDEBAR_PREVIEW_SNAPSHOT_DEFER_MS;

    const arm = () => {
      if (!cancelled) setDeferred(true);
    };

    const timer = window.setTimeout(() => {
      const ric = (
        window as Window & {
          requestIdleCallback?: (
            cb: () => void,
            opts?: { timeout: number },
          ) => number;
        }
      ).requestIdleCallback;
      if (typeof ric === "function") {
        idleHandle = ric(arm, { timeout: 1_000 });
      } else {
        arm();
      }
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      const cic = (
        window as Window & {
          cancelIdleCallback?: (id: number) => void;
        }
      ).cancelIdleCallback;
      if (idleHandle != null && typeof cic === "function") {
        cic(idleHandle);
      }
    };
  }, [input.deferMs, input.enabled]);

  const previewSessionIds = selectSidebarPreviewSessionIds({
    sessions: input.enabled ? input.sessions : [],
    selectedSessionId: input.selectedSessionId,
    deferred: deferred && input.enabled,
    maxPreviews: input.maxPreviews,
    includeSelected: input.includeSelected,
    prioritizeSelected: input.enabled && input.prioritizeSelected,
  });

  return { deferred, previewSessionIds };
}
