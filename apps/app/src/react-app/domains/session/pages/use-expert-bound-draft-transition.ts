import { useEffect } from "react";

import type { PendingAgentContext } from "../../agents";
import { useComposerStateStore } from "../surface/composer-state-store";
import {
  consumeBoundExpertDraftContext,
  matchesExpertDraftTransaction,
  resolveBoundExpertDraftSession,
  resolveReadyBoundExpertDraftSession,
} from "./expert-draft-session";

export function useExpertBoundDraftTransition(input: {
  activeDraftSessionId: string | null;
  draftAgentContexts: Record<string, PendingAgentContext>;
  draftAgentId: string | null;
  draftSessionActive: boolean;
  pendingAgent: PendingAgentContext | null;
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  sidebarSelectedWorkspaceId: string;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  setDraftAgentContexts: (contexts: Record<string, PendingAgentContext>) => void;
  setDraftAgentId: (agentId: string | null) => void;
  setDraftSessionActive: (active: boolean) => void;
  setPendingTabSessionId: (sessionId: string | null) => void;
}) {
  useEffect(() => {
    const createdSessionId = resolveBoundExpertDraftSession({
      draftSessionActive: input.draftSessionActive,
      draftAgentId: input.draftAgentId,
      pendingAgent: input.pendingAgent,
    });
    if (!createdSessionId || !input.pendingAgent) return;
    if (!matchesExpertDraftTransaction({
      contexts: input.draftAgentContexts,
      agentId: input.pendingAgent.id,
      conversationStartId: input.pendingAgent.conversationStartId,
    })) return;
    input.setPendingTabSessionId(createdSessionId);
    if (input.selectedSessionId !== createdSessionId) {
      input.onOpenSession(input.sidebarSelectedWorkspaceId, createdSessionId);
      return;
    }
    const readySessionId = resolveReadyBoundExpertDraftSession({
      draftSessionActive: input.draftSessionActive,
      draftAgentId: input.draftAgentId,
      pendingAgent: input.pendingAgent,
      selectedSessionId: input.selectedSessionId,
    });
    if (!readySessionId) return;
    const remainingDrafts = consumeBoundExpertDraftContext({
      contexts: input.draftAgentContexts,
      agentId: input.pendingAgent.id,
      conversationStartId: input.pendingAgent.conversationStartId,
    });
    if (remainingDrafts === input.draftAgentContexts) return;
    useComposerStateStore
      .getState()
      .clearSession(input.activeDraftSessionId ?? `draft:${input.selectedWorkspaceId}`);
    input.setDraftAgentContexts(remainingDrafts);
    input.setDraftSessionActive(false);
    input.setDraftAgentId(null);
    input.setPendingTabSessionId(null);
  }, [input]);
}
