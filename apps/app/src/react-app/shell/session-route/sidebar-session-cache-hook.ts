import { useEffect } from "react";

import type { SidebarSessionItem } from "../../../app/types";
import { writeCachedSidebarSessionsForWorkspace } from "../session-memory";
import { resetColdPathCounters } from "./cold-path-budget";

/** Persist sidebar rows and reset the cold-path budget when SessionRoute unmounts. */
export function useSidebarSessionCacheSync(
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>,
): void {
  useEffect(() => {
    return () => {
      resetColdPathCounters();
    };
  }, []);

  useEffect(() => {
    for (const [workspaceId, sessions] of Object.entries(sessionsByWorkspaceId)) {
      writeCachedSidebarSessionsForWorkspace(workspaceId, sessions);
    }
  }, [sessionsByWorkspaceId]);
}
