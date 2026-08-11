import { useEffect } from "react";

import type { PendingAgentContext } from "../../agents";
import { useComposerStateStore } from "../surface/composer-state-store";
import {
  consumeBoundExpertDraftContext,
  matchesExpertDraftTransaction,
  resolveBoundExpertDraftSession,
  resolveBoundExpertDraftNavigation,
  resolveReadyBoundExpertDraftSession,
} from "./expert-draft-session";
import { selectExpertSurfaceMode } from "./expert-surface-mode";
import {
  selectExpertSurfaceNavigation,
  shouldDropExpertSurfaceDraft,
  type ExpertSurfaceEvent,
  type ExpertSurfaceState,
} from "./expert-surface-machine";

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
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  surfaceState: ExpertSurfaceState;
  dispatchSurface: (event: ExpertSurfaceEvent) => void;
  clearSurfaceDraft: () => void;
  setDraftAgentContexts: (contexts: Record<string, PendingAgentContext>) => void;
}) {
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
    surfaceState,
    dispatchSurface,
    clearSurfaceDraft,
    setDraftAgentContexts,
  } = input;

  useEffect(() => {
    const draftIntent = draftSessionActive;
    const mode = selectExpertSurfaceMode(surfaceState);

    // User is on a different real tab than the in-flight create: drop draft
    // chrome and never force-nav back (mode.mayForceNavToBound is false).
    if (
      shouldDropExpertSurfaceDraft(surfaceState)
    ) {
      if (
        pendingAgent &&
        !matchesExpertDraftTransaction({
          contexts: draftAgentContexts,
          agentId: pendingAgent.id,
          operationId: pendingAgent.operationId,
        })
      ) return;
      if (pendingAgent) {
        const remainingDrafts = consumeBoundExpertDraftContext({
          contexts: draftAgentContexts,
          agentId: pendingAgent.id,
          operationId: pendingAgent.operationId,
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
      clearSurfaceDraft();
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
      operationId: pendingAgent.operationId,
    })) return;

    const surfaceDraft = surfaceState.draft;
    if (
      surfaceDraft &&
      surfaceDraft.operationId === pendingAgent.operationId &&
      !surfaceDraft.boundSessionId
    ) {
      dispatchSurface({
        type: "CREATE_BOUND",
        operationId: pendingAgent.operationId ?? "",
        sessionId: createdSessionId,
      });
      return;
    }
    if (
      !surfaceDraft ||
      surfaceDraft.operationId !== pendingAgent.operationId ||
      surfaceDraft.boundSessionId !== createdSessionId
    ) return;

    if (mode.mayForceNavToBound) {
      const navigationSessionId = resolveBoundExpertDraftNavigation({
        contexts: draftAgentContexts,
        draftSessionActive: draftIntent,
        draftAgentId,
        pendingAgent,
        selectedSessionId,
      });
      if (navigationSessionId) {
        const navigation = selectExpertSurfaceNavigation(surfaceState);
        if (!navigation || navigation.sessionId !== navigationSessionId) return;
        dispatchSurface({
          type: "REQUEST_NAVIGATION",
          operationId: navigation.operationId,
        });
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
      operationId: pendingAgent.operationId,
    });
    if (remainingDrafts === draftAgentContexts) return;
    useComposerStateStore
      .getState()
      .clearSession(activeDraftSessionId ?? `draft:${selectedWorkspaceId}`);
    setDraftAgentContexts(remainingDrafts);
    clearSurfaceDraft();
  }, [
    activeDraftSessionId,
    draftAgentContexts,
    draftAgentId,
    draftSessionActive,
    clearSurfaceDraft,
    dispatchSurface,
    onOpenSession,
    pendingAgent,
    selectedSessionId,
    selectedWorkspaceId,
    setDraftAgentContexts,
    sidebarSelectedWorkspaceId,
    surfaceState,
  ]);
}
