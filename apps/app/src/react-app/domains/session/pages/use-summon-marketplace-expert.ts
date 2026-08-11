/**
 * Summon marketplace expert → install package, open new task, switch to expert mode.
 */
import { useCallback } from "react";

import {
  createExpertOperationId,
  refreshExpertPackageQuery,
  usePendingAgentStore,
} from "../../agents";
import { installSummonedMarketplaceExpert } from "@/react-app/domains/plugins";
import { buildPendingAgentFromMarketplaceExpert } from "@/react-app/domains/agents";
import { resolveMarketplaceExpertStartPrompt } from "@/react-app/domains/plugins";
import type { ExpertMarketplaceEntry } from "@/react-app/domains/plugins";
import {
  setExpertComposerDraftAfterNewTask,
  setExpertComposerTemplateAfterNewTask,
} from "./shared-page-utils";

export function useSummonMarketplaceExpert(options: {
  selectedWorkspaceId: string;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onNavigateToMode: (mode: "assistant" | "expert") => void;
}) {
  const { selectedWorkspaceId, onCreateTaskInWorkspace, onNavigateToMode } =
    options;

  return useCallback(
    (expert: ExpertMarketplaceEntry, initialPrompt?: string) => {
      const startPrompt = resolveMarketplaceExpertStartPrompt(
        expert,
        initialPrompt,
      );
      void installSummonedMarketplaceExpert(expert)
        .then(() => refreshExpertPackageQuery())
        .catch((error) => {
          console.warn(
            "[expert-marketplace] failed to install expert package",
            error,
          );
        });
      // Bind pending agent BEFORE create-task: that path clears pendingAgent
      // synchronously, which used to drop the expert id on race.
      const pending = buildPendingAgentFromMarketplaceExpert(expert);
      usePendingAgentStore.getState().setAgent(pending);
      onCreateTaskInWorkspace(selectedWorkspaceId);
      // Re-assert after create-task's setAgent(null).
      usePendingAgentStore.getState().setAgent({
        ...pending,
        boundSessionId: undefined,
        operationId: createExpertOperationId(),
        draftCreatedAt: Date.now(),
        draftSource: "agent-selection",
      });
      // Prefill only explicit quick-prompt or logistics templates (not default intro).
      if (startPrompt?.template) {
        setExpertComposerTemplateAfterNewTask(
          selectedWorkspaceId,
          expert.id,
          startPrompt.prompt,
        );
      } else if (startPrompt && initialPrompt?.trim()) {
        setExpertComposerDraftAfterNewTask(
          selectedWorkspaceId,
          expert.id,
          startPrompt.prompt,
        );
      }
      onNavigateToMode("expert");
    },
    [onCreateTaskInWorkspace, onNavigateToMode, selectedWorkspaceId],
  );
}
