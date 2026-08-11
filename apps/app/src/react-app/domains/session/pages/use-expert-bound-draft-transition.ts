import { useEffect, useReducer } from "react";

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
import {
  createExpertSurfaceInitialState,
  reduceExpertSurface,
  selectExpertSurfaceNavigation,
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
  selectedSessionAgentId: string | null;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  setDraftAgentContexts: (contexts: Record<string, PendingAgentContext>) => void;
  setDraftAgentId: (agentId: string | null) => void;
  setDraftSessionActive: (active: boolean) => void;
  setPendingTabSessionId: (sessionId: string | null) => void;
}) {
  const [machine, dispatchMachine] = useReducer(
    reduceExpertSurface,
    input.selectedWorkspaceId,
    createExpertSurfaceInitialState,
  );
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
    dispatchMachine({ type: "RESET", workspaceId: selectedWorkspaceId });
  }, [selectedWorkspaceId]);

  useEffect(() => {
    const operationId = pendingAgent?.operationId?.trim() ?? "";
    const agentId = draftAgentId?.trim() ?? "";
    if (
      !draftSessionActive ||
      !operationId ||
      !agentId ||
      pendingAgent?.id !== agentId ||
      draftAgentContexts[agentId]?.operationId !== operationId
    ) return;
    const sameOperation =
      (machine.kind === "idle_draft" || machine.kind === "creating") &&
      machine.operationId === operationId &&
      machine.agentId === agentId;
    if (sameOperation) return;
    dispatchMachine({
      type: "OPEN_DRAFT",
      workspaceId: selectedWorkspaceId,
      agentId,
      operationId,
    });
  }, [
    draftAgentId,
    draftAgentContexts,
    draftSessionActive,
    machine,
    pendingAgent?.operationId,
    selectedWorkspaceId,
  ]);

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
      setDraftSessionActive(false);
      setDraftAgentId(null);
      setPendingTabSessionId(null);
      if (selectedSessionId) {
        dispatchMachine({
          type: "OPEN_REAL_SESSION",
          workspaceId: selectedWorkspaceId,
          agentId: selectedSessionAgentId,
          sessionId: selectedSessionId,
        });
      }
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

    if (
      machine.kind === "idle_draft" &&
      machine.operationId === pendingAgent.operationId
    ) {
      dispatchMachine({
        type: "CREATE_BOUND",
        operationId: pendingAgent.operationId ?? "",
        sessionId: createdSessionId,
      });
      return;
    }
    if (
      machine.kind !== "creating" ||
      machine.operationId !== pendingAgent.operationId ||
      machine.sessionId !== createdSessionId
    ) return;

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
        const navigation = selectExpertSurfaceNavigation(machine);
        if (!navigation || navigation.sessionId !== navigationSessionId) return;
        dispatchMachine({
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
    setDraftSessionActive(false);
    setDraftAgentId(null);
    setPendingTabSessionId(null);
    dispatchMachine({
      type: "OPEN_REAL_SESSION",
      workspaceId: selectedWorkspaceId,
      agentId: pendingAgent.id,
      sessionId: readySessionId,
    });
  }, [
    activeDraftSessionId,
    draftAgentContexts,
    draftAgentId,
    draftSessionActive,
    machine,
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
