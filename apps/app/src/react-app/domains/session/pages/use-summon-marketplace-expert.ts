/**
 * Summon marketplace expert → install package, open new task, switch to expert mode.
 */
import { useCallback } from "react";

import { usePendingAgentStore } from "../../agents";
import { installSummonedMarketplaceExpert } from "../expert-marketplace/install";
import { buildPendingAgentFromMarketplaceExpert } from "../expert-marketplace/pending-agent";
import type { ExpertMarketplaceEntry } from "../expert-marketplace/types";
import { setComposerDraftAfterNewTask } from "./shared-page-utils";

export function useSummonMarketplaceExpert(options: {
  selectedWorkspaceId: string;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onNavigateToMode: (mode: "assistant" | "expert") => void;
}) {
  const { selectedWorkspaceId, onCreateTaskInWorkspace, onNavigateToMode } =
    options;

  return useCallback(
    (expert: ExpertMarketplaceEntry, initialPrompt?: string) => {
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
      if (initialPrompt) {
        setComposerDraftAfterNewTask(selectedWorkspaceId, initialPrompt);
      }
      onNavigateToMode("expert");
    },
    [onCreateTaskInWorkspace, onNavigateToMode, selectedWorkspaceId],
  );
}
