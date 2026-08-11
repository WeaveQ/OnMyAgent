/** @jsxImportSource react */
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PendingAgentContext } from "../../agents";
import { usePendingAgentStore } from "../../agents";
import type { ExpertDirectoryIdentityIndex } from "../../../capabilities/session-identity/expert-directory-store";
import type { SessionPageSidebarProps } from "./session-page-types";
import { consumeActiveExpertDraftForSession } from "./expert-draft-session";
import { writeExpertSessionSelection } from "../sidebar/session-chrome";

export function useOpenExpertSession(input: {
  sidebar: SessionPageSidebarProps;
  draftAgentContexts: Record<string, PendingAgentContext>;
  pendingAgent: PendingAgentContext | null;
  draftAgentId: string | null;
  draftSessionActive: boolean;
  setDraftAgentContexts: Dispatch<SetStateAction<Record<string, PendingAgentContext>>>;
  setDraftAgentId: Dispatch<SetStateAction<string | null>>;
  setDraftSessionActive: Dispatch<SetStateAction<boolean>>;
  openRailView: (view: "chat") => void;
  expertDirectoryIdentity: ExpertDirectoryIdentityIndex;
}) {
  return useCallback(
    (workspaceId: string, sessionId: string) => {
      const trimmed = sessionId.trim();
      const targetAgentId =
        trimmed &&
        !trimmed.startsWith("draft:") &&
        input.expertDirectoryIdentity.sessionIds.has(trimmed)
          ? input.expertDirectoryIdentity.agentIdBySessionId.get(trimmed) ?? null
          : null;
      const transition = consumeActiveExpertDraftForSession({
        contexts: input.draftAgentContexts,
        pendingAgent: input.pendingAgent,
        draftAgentId: input.draftAgentId,
        draftSessionActive: input.draftSessionActive,
        targetAgentId,
      });
      if (transition.consumed) {
        input.setDraftAgentContexts((contexts) =>
          consumeActiveExpertDraftForSession({
            contexts,
            pendingAgent: null,
            draftAgentId: input.draftAgentId,
            draftSessionActive: input.draftSessionActive,
            targetAgentId,
          }).contexts,
        );
        if (usePendingAgentStore.getState().getAgent()?.id === input.draftAgentId) {
          usePendingAgentStore.getState().setAgent(null);
        }
      }
      input.setDraftSessionActive(false);
      input.setDraftAgentId(null);
      input.openRailView("chat");
      if (targetAgentId) writeExpertSessionSelection(workspaceId, targetAgentId, trimmed);
      input.sidebar.onOpenSession(workspaceId, sessionId);
    },
    [input],
  );
}
