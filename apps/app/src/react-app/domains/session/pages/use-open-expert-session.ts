/** @jsxImportSource react */
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PendingAgentContext } from "../../agents";
import { usePendingAgentStore } from "../../agents";
import type { ExpertDirectoryIdentityIndex } from "../../../capabilities/session-identity/expert-directory-store";
import type { SessionPageSidebarProps } from "./session-page-types";
import { consumeActiveExpertDraftForSession } from "./expert-draft-session";
import { normalizeExpertSessionId } from "./order-conversation-groups";
import { writeExpertSessionSelection } from "../sidebar/session-chrome";

export function useOpenExpertSession(input: {
  sidebar: SessionPageSidebarProps;
  draftAgentContexts: Record<string, PendingAgentContext>;
  pendingAgent: PendingAgentContext | null;
  draftAgentId: string | null;
  draftSessionActive: boolean;
  setDraftAgentContexts: Dispatch<SetStateAction<Record<string, PendingAgentContext>>>;
  clearSurfaceDraft: () => void;
  onOpenRealSession: (
    workspaceId: string,
    agentId: string,
    sessionId: string,
  ) => void;
  openRailView: (view: "chat") => void;
  expertDirectoryIdentity: ExpertDirectoryIdentityIndex;
}) {
  const {
    sidebar,
    draftAgentContexts,
    pendingAgent,
    draftAgentId,
    draftSessionActive,
    setDraftAgentContexts,
    clearSurfaceDraft,
    onOpenRealSession,
    openRailView,
    expertDirectoryIdentity,
  } = input;
  return useCallback(
    (workspaceId: string, sessionId: string) => {
      // "" / whitespace → null (clear-route). Never treat empty as a real id.
      const trimmed = normalizeExpertSessionId(sessionId);
      const targetAgentId =
        trimmed &&
        !trimmed.startsWith("draft:") &&
        expertDirectoryIdentity.sessionIds.has(trimmed)
          ? expertDirectoryIdentity.agentIdBySessionId.get(trimmed) ?? null
          : null;
      const transition = consumeActiveExpertDraftForSession({
        contexts: draftAgentContexts,
        pendingAgent,
        draftAgentId,
        draftSessionActive,
        targetAgentId,
      });
      if (transition.consumed) {
        setDraftAgentContexts((contexts) =>
          consumeActiveExpertDraftForSession({
            contexts,
            pendingAgent: null,
            draftAgentId,
            draftSessionActive,
            targetAgentId,
          }).contexts,
        );
        if (usePendingAgentStore.getState().getAgent()?.id === draftAgentId) {
          usePendingAgentStore.getState().setAgent(null);
        }
      }
      clearSurfaceDraft();
      openRailView("chat");
      if (targetAgentId && trimmed) {
        onOpenRealSession(workspaceId, targetAgentId, trimmed);
        writeExpertSessionSelection(workspaceId, targetAgentId, trimmed);
      }
      // Pass through empty string for clear-route; sidebar normalizes to no selection.
      sidebar.onOpenSession(workspaceId, trimmed ?? "");
    },
    [
      clearSurfaceDraft,
      draftAgentContexts,
      draftAgentId,
      draftSessionActive,
      expertDirectoryIdentity,
      onOpenRealSession,
      openRailView,
      pendingAgent,
      setDraftAgentContexts,
      sidebar,
    ],
  );
}
