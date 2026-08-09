import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { SidebarSessionItem } from "../../../app/types";
import {
  applyRuntimeSidebarUpdates,
  type SidebarRuntimeUpdate,
} from "./runtime-session-state";
import { createSidebarRuntimeUpdateCoordinator } from "./sidebar-runtime-update-coordinator";

export function useBufferedSidebarRuntimeUpdates(input: {
  sessionsByWorkspaceIdRef: MutableRefObject<Record<string, SidebarSessionItem[]>>;
  setSessionsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, SidebarSessionItem[]>>
  >;
}) {
  const coordinatorRef = useRef<ReturnType<
    typeof createSidebarRuntimeUpdateCoordinator
  > | null>(null);

  useEffect(() => {
    const coordinator = createSidebarRuntimeUpdateCoordinator({
      flush: (buckets) => {
        const updates = buckets.flatMap((bucket) => bucket.updates);
        input.setSessionsByWorkspaceId((current) => {
          const next = applyRuntimeSidebarUpdates(current, updates);
          if (next !== current) input.sessionsByWorkspaceIdRef.current = next;
          return next;
        });
      },
      scheduler: {
        schedule: (callback) => window.requestAnimationFrame(callback),
        cancel: (handle) => window.cancelAnimationFrame(handle),
      },
    });
    coordinatorRef.current = coordinator;
    return () => {
      coordinator.dispose();
      if (coordinatorRef.current === coordinator) {
        coordinatorRef.current = null;
      }
    };
  }, [input.sessionsByWorkspaceIdRef, input.setSessionsByWorkspaceId]);

  return useCallback((event: SidebarRuntimeUpdate) => {
    coordinatorRef.current?.enqueue(event);
  }, []);
}
