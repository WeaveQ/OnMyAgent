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
import {
  resolveExpertSurfaceMode,
  shouldDropDraftIntentForRoute,
} from "./expert-surface-mode";

export function useExpertBoundDraftTransition(input: {
  activeDraftSessionId: string | null;
  draftAgentContexts: Record<string, PendingAgentContext>;
  draftAgentId: string | null;
  /** User intent flag (new session / open chat). Surface mode is derived, not this alone. */
  draftSessionActive: boolean;
  pendingAgent: PendingAgentContext | null;
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  sidebarSelectedWorkspaceId: string;
  selectedSessionAgentId: string | null;
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
    selectedSessionAgentId,
    onOpenSession,
    setDraftAgentContexts,
    setDraftAgentId,
    setDraftSessionActive,
    setPendingTabSessionId,
  } = input;

  useEffect(() => {
    const draftIntent = draftSessionActive;
    const mode = resolveExpertSurfaceMode({
      selectedSessionId,
      workspaceId: selectedWorkspaceId,
      draftIntent,
      draftAgentId,
      pendingAgentId: pendingAgent?.id ?? null,
      pendingBoundSessionId: pendingAgent?.boundSessionId,
      selectedSessionAgentId,
    });

    // User is on a different real tab than the in-flight create: drop draft
    // chrome and never force-nav back (mode.mayForceNavToBound is false).
    if (
      shouldDropDraftIntentForRoute({
        draftIntent,
        selectedSessionId,
        pendingBoundSessionId: pendingAgent?.boundSessionId,
      })
    ) {
      if (pendingAgent) {
        const remainingDrafts = consumeBoundExpertDraftContext({
          contexts: draftAgentContexts,
          agentId: pendingAgent.id,
          conversationStartId: pendingAgent.conversationStartId,
        });
        if (remainingDrafts !== draftAgentContexts) {
          useComposerStateStore
            .getState()
            .clearSession(
              activeDraftSessionId ?? `draft:${selectedWorkspaceId}`,
            );
          setDraftAgentContexts(remainingDrafts);
        }
      }
      setDraftSessionActive(false);
      setDraftAgentId(null);
      setPendingTabSessionId(null);
      openedSessionIdRef.current = null;
      return;
    }

    const createdSessionId = resolveBoundExpertDraftSession({
      draftSessionActive: draftIntent,
      draftAgentId,
      pendingAgent,
    });
    if (!createdSessionId || !pendingAgent) return;
    if (!matchesExpertDraftTransaction({
      contexts: draftAgentContexts,
      agentId: pendingAgent.id,
      conversationStartId: pendingAgent.conversationStartId,
    })) return;

    setPendingTabSessionId(mode.creatingSessionId ?? createdSessionId);

    if (mode.mayForceNavToBound) {
      const navigationSessionId = resolveBoundExpertDraftNavigation({
        contexts: draftAgentContexts,
        draftSessionActive: draftIntent,
        draftAgentId,
        pendingAgent,
        selectedSessionId,
      });
      if (navigationSessionId) {
        if (openedSessionIdRef.current === navigationSessionId) return;
        openedSessionIdRef.current = navigationSessionId;
        onOpenSession(sidebarSelectedWorkspaceId, navigationSessionId);
        return;
      }
    }

    const readySessionId = resolveReadyBoundExpertDraftSession({
      draftSessionActive: draftIntent,
      draftAgentId,
      pendingAgent,
      selectedSessionId,
    });
    if (!readySessionId) return;
    // Route landed on bound create → consume draft intent (mode is real_session).
    if (mode.kind !== "real_session") return;
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
    selectedSessionAgentId,
    selectedSessionId,
    selectedWorkspaceId,
    setDraftAgentContexts,
    setDraftAgentId,
    setDraftSessionActive,
    setPendingTabSessionId,
    sidebarSelectedWorkspaceId,
  ]);
}
