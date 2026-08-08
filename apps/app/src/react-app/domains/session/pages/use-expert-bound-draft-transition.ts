import { useEffect, useRef } from "react";

import type { PendingAgentContext } from "../../agents";
import { useComposerStateStore } from "../surface/composer-state-store";
import {
  consumeBoundExpertDraftContext,
  matchesExpertDraftTransaction,
  resolveBoundExpertDraftSession,
  resolveBoundExpertDraftNavigation,
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
  const openedSessionIdRef = useRef<string | null>(null);
  const {
    activeDraftSessionId,
    draftAgentContexts,
    draftAgentId,
    draftSessionActive,
    pendingAgent,
    selectedSessionId,
    selectedWorkspaceId,
    sidebarSelectedWorkspaceId,
    onOpenSession,
    setDraftAgentContexts,
    setDraftAgentId,
    setDraftSessionActive,
    setPendingTabSessionId,
  } = input;
  useEffect(() => {
    const navigationSessionId = resolveBoundExpertDraftNavigation({
      contexts: draftAgentContexts,
      draftSessionActive,
      draftAgentId,
      pendingAgent,
      selectedSessionId,
    });
    const createdSessionId = resolveBoundExpertDraftSession({
      draftSessionActive,
      draftAgentId,
      pendingAgent,
    });
    if (!createdSessionId || !pendingAgent) return;
    if (!matchesExpertDraftTransaction({
      contexts: draftAgentContexts,
      agentId: pendingAgent.id,
      conversationStartId: pendingAgent.conversationStartId,
    })) return;
    setPendingTabSessionId(createdSessionId);
    if (navigationSessionId) {
      if (openedSessionIdRef.current === navigationSessionId) return;
      openedSessionIdRef.current = navigationSessionId;
      onOpenSession(sidebarSelectedWorkspaceId, navigationSessionId);
      return;
    }
    const readySessionId = resolveReadyBoundExpertDraftSession({
      draftSessionActive,
      draftAgentId,
      pendingAgent,
      selectedSessionId,
    });
    if (!readySessionId) return;
    const remainingDrafts = consumeBoundExpertDraftContext({
      contexts: draftAgentContexts,
      agentId: pendingAgent.id,
      conversationStartId: pendingAgent.conversationStartId,
    });
    if (remainingDrafts === draftAgentContexts) return;
    useComposerStateStore
      .getState()
      .clearSession(activeDraftSessionId ?? `draft:${selectedWorkspaceId}`);
    setDraftAgentContexts(remainingDrafts);
    setDraftSessionActive(false);
    setDraftAgentId(null);
    setPendingTabSessionId(null);
    openedSessionIdRef.current = null;
  }, [
    activeDraftSessionId,
    draftAgentContexts,
    draftAgentId,
    draftSessionActive,
    onOpenSession,
    pendingAgent,
    selectedSessionId,
    selectedWorkspaceId,
    setDraftAgentContexts,
    setDraftAgentId,
    setDraftSessionActive,
    setPendingTabSessionId,
    sidebarSelectedWorkspaceId,
  ]);
}
