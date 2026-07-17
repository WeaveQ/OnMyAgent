import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { WorkspaceInfo } from "@/app/lib/desktop";
import {
  loadPersonalUsageSnapshots,
  summarizePersonalUsage,
  type PersonalUsageClient,
  type PersonalUsageScope,
} from "./personal-usage-model";

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function workspaceDisplayName(workspace: WorkspaceInfo) {
  return workspace.displayName?.trim() || workspace.name;
}

export function usePersonalUsage(input: {
  client: PersonalUsageClient | null;
  workspaces: WorkspaceInfo[];
  scopeId: PersonalUsageScope;
}) {
  const workspaceKey = input.workspaces
    .map((workspace) => workspace.id)
    .sort()
    .join(":");
  const today = todayDateOnly();
  const query = useQuery({
    queryKey: ["session", "personal-usage", workspaceKey, today],
    queryFn: () => {
      if (!input.client) {
        return { snapshots: [], failures: [] };
      }
      return loadPersonalUsageSnapshots({
        client: input.client,
        workspaces: input.workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspaceDisplayName(workspace),
        })),
        today,
      });
    },
    enabled: input.client !== null && input.workspaces.length > 0,
    refetchOnWindowFocus: false,
  });
  const summary = useMemo(
    () => summarizePersonalUsage(
      query.data?.snapshots ?? [],
      input.scopeId,
      today,
    ),
    [input.scopeId, query.data?.snapshots, today],
  );
  const loaded = query.data;

  return {
    ...query,
    summary,
    failures: loaded?.failures ?? [],
    availableWorkspaceIds: loaded?.snapshots.map((snapshot) => snapshot.workspaceId) ?? [],
    allWorkspacesFailed:
      loaded !== undefined
      && loaded.snapshots.length === 0
      && loaded.failures.length > 0,
  };
}
