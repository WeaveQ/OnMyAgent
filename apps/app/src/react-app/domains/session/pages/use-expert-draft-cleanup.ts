import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useComposerStateStore } from "../surface/composer-state-store";
import { usePendingAgentStore } from "../../agents";
import type { PendingAgentContext } from "../../agents";

type DraftContexts = Record<string, PendingAgentContext>;

export function useExpertDraftCleanup(input: {
  activeSidebarView: string;
  activeDraftSessionId: string | null;
  draftSessionActive: boolean;
  pendingAgentDraftSource: PendingAgentContext["draftSource"] | undefined;
  workspaceId: string;
  setDraftAgentContexts: Dispatch<SetStateAction<DraftContexts>>;
  setDraftSessionActive: Dispatch<SetStateAction<boolean>>;
  setDraftAgentId: Dispatch<SetStateAction<string | null>>;
}) {
  const cleanupRef = useRef({
    active: false,
    workspaceId: input.workspaceId,
    sessionId: `draft:${input.workspaceId}`,
  });

  useEffect(() => {
    if (input.activeSidebarView === "chat") return;
    if (
      !input.draftSessionActive ||
      input.pendingAgentDraftSource !== "new-session"
    ) {
      return;
    }
    useComposerStateStore
      .getState()
      .clearSession(input.activeDraftSessionId ?? `draft:${input.workspaceId}`);
    const currentAgent = usePendingAgentStore.getState().getAgent();
    if (
      currentAgent?.draftSource === "new-session" &&
      !currentAgent.boundSessionId
    ) {
      usePendingAgentStore.getState().setAgent(null);
      input.setDraftAgentContexts((current) => {
        const next = { ...current };
        delete next[currentAgent.id];
        return next;
      });
    }
    input.setDraftSessionActive(false);
    input.setDraftAgentId(null);
  }, [
    input.activeDraftSessionId,
    input.activeSidebarView,
    input.draftSessionActive,
    input.pendingAgentDraftSource,
    input.setDraftAgentContexts,
    input.setDraftAgentId,
    input.setDraftSessionActive,
    input.workspaceId,
  ]);

  useEffect(() => {
    cleanupRef.current = {
      active:
        input.draftSessionActive &&
        input.pendingAgentDraftSource === "new-session",
      workspaceId: input.workspaceId,
      sessionId:
        input.activeDraftSessionId ?? `draft:${input.workspaceId}`,
    };
  }, [
    input.activeDraftSessionId,
    input.draftSessionActive,
    input.pendingAgentDraftSource,
    input.workspaceId,
  ]);

  useEffect(
    () => () => {
      const cleanup = cleanupRef.current;
      if (!cleanup.active) return;
      useComposerStateStore.getState().clearSession(cleanup.sessionId);
      const currentAgent = usePendingAgentStore.getState().getAgent();
      if (
        currentAgent?.draftSource === "new-session" &&
        !currentAgent.boundSessionId
      ) {
        usePendingAgentStore.getState().setAgent(null);
        input.setDraftAgentContexts((current) => {
          const next = { ...current };
          delete next[currentAgent.id];
          return next;
        });
      }
    },
    [input.setDraftAgentContexts],
  );
}
