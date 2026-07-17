import { useEffect, useRef } from "react";

import type { RouteWorkspace } from "./model";

export function useSettingsWorkspaceRefs(workspaces: RouteWorkspace[]) {
  const workspacesRef = useRef<RouteWorkspace[]>(workspaces);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  return { workspacesRef };
}
