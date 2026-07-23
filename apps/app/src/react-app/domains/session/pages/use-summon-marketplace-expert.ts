/**
 * Summon marketplace expert → install package, open new task, switch to expert mode.
 */
import { useCallback } from "react";

import { usePendingAgentStore } from "../../agents";
import { installSummonedMarketplaceExpert } from "../expert-marketplace/install";
import { buildPendingAgentFromMarketplaceExpert } from "../expert-marketplace/pending-agent";
import type { ExpertMarketplaceEntry } from "../expert-marketplace/types";

export function useSummonMarketplaceExpert(options: {
  selectedWorkspaceId: string;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onNavigateToMode: (mode: "assistant" | "expert") => void;
}) {
  const { selectedWorkspaceId, onCreateTaskInWorkspace, onNavigateToMode } =
    options;

  return useCallback(
    (expert: ExpertMarketplaceEntry) => {
      void installSummonedMarketplaceExpert(expert).catch((error) => {
        console.warn(
          "[expert-marketplace] failed to install expert package",
          error,
        );
      });
      onCreateTaskInWorkspace(selectedWorkspaceId);
      usePendingAgentStore
        .getState()
        .setAgent(buildPendingAgentFromMarketplaceExpert(expert));
      onNavigateToMode("expert");
    },
    [onCreateTaskInWorkspace, onNavigateToMode, selectedWorkspaceId],
  );
}
