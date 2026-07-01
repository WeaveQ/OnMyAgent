import { useEffect } from "react";

import type { SidebarSessionItem } from "../../app/types";
import { publishInspectorSlice } from "./app-inspector";
import { readActiveWorkspaceId } from "./session-memory";
import type { RouteWorkspace } from "./session-route-model";
import { toInspectorSessionEntries } from "./session-route-sessions";

export function useSessionRouteInspector(input: {
  baseUrl: string;
  clientConnected: boolean;
  errorsByWorkspaceId: Record<string, string | null>;
  loading: boolean;
  retryingWorkspaceIds: string[];
  routeError: string | null;
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  token: string;
  workspaces: RouteWorkspace[];
}) {
  useEffect(() => {
    const dispose = publishInspectorSlice("route", () => ({
      loading: input.loading,
      retryingWorkspaceIds: input.retryingWorkspaceIds,
      baseUrl: input.baseUrl,
      tokenPresent: input.token.length > 0,
      connected: input.clientConnected,
      routeError: input.routeError,
      selectedSessionId: input.selectedSessionId,
      selectedWorkspaceId: input.selectedWorkspaceId,
      persistedActiveWorkspaceId: readActiveWorkspaceId(),
      workspaces: input.workspaces.map((workspace) => ({
        id: workspace.id,
        displayNameResolved: workspace.displayNameResolved,
        workspaceType: workspace.workspaceType,
        path: workspace.path,
        sessionCount: (input.sessionsByWorkspaceId[workspace.id] ?? []).length,
        loading: input.retryingWorkspaceIds.includes(workspace.id),
        error: input.errorsByWorkspaceId[workspace.id] ?? null,
      })),
      sessionsByWorkspaceId: toInspectorSessionEntries(input.sessionsByWorkspaceId),
    }));
    return dispose;
  }, [input]);
}
