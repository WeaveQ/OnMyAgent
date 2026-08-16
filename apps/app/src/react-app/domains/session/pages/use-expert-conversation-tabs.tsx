/** @jsxImportSource react */
import { useCallback, useMemo } from "react";

import { t } from "../../../../i18n";
import type { SidebarSessionItem } from "../../../../app/types";
import {
  archiveAssistantTask,
  archiveAssistantTasks,
  collectSessionDescendantIds,
} from "../../shared";
import { AgentSessionTabs } from "../sidebar/session-chrome";
import type { ExpertSurfaceMode } from "./expert-surface-mode";
import type { ExpertPageProps } from "./use-expert-page";

/** Owns Expert tab rendering and tab-local archive/rename commands. */
export function useExpertConversationTabs(input: {
  props: ExpertPageProps;
  activeSidebarView: string;
  surfaceMode: ExpertSurfaceMode;
  currentAgentSessions: SidebarSessionItem[];
  sessionTabOrderIds: string[];
  /**
   * Tab-strip highlight after CREATE_BOUND (surface `pendingTabSessionId`).
   * Not create operationId / not composer pending.
   */
  pendingTabSessionId: string | null;
  setPendingTabSessionId: (sessionId: string | null) => void;
  /** When false, show a light strip instead of empty tabs (inventory still loading). */
  expertDirectoryReady?: boolean;
  activeConversationAgentId: string | null;
  handleOpenExpertSession: (workspaceId: string, sessionId: string) => void;
  handleOpenDraftSession: (sessionId: string) => void;
  handleCreateCurrentAgentSession: () => void;
  openRenameModal: (sessionId: string, title: string) => void;
  openDeleteModal: (sessionId: string) => void;
  showToast: (input: { tone: "success"; title: string }) => void;
}) {
  const { props } = input;
  // Local alias so call sites don't confuse tab highlight with create txn.
  const tabHighlightSessionId = input.pendingTabSessionId;
  const handleArchiveExpertSession = useCallback(
    (sessionId: string, title: string) => {
      const workspaceId = props.selectedWorkspaceId.trim();
      const id = sessionId.trim();
      if (!workspaceId || !id) return;
      const match = input.currentAgentSessions.find((session) => session.id === id);
      const childIds = collectSessionDescendantIds(
        input.currentAgentSessions,
        id,
      );
      if (childIds.length > 0) {
        const now = Date.now();
        const byId = new Map(
          input.currentAgentSessions.map((session) => [session.id, session]),
        );
        archiveAssistantTasks(
          workspaceId,
          childIds.map((childId) => {
            const child = byId.get(childId);
            return {
              sessionId: childId,
              title: child?.title?.trim() || childId,
              directory: child?.directory ?? null,
              archivedAt: now,
              category: "expert",
              parentID: child?.parentID ?? id,
            };
          }),
        );
      }
      archiveAssistantTask(workspaceId, {
        sessionId: id,
        title: title.trim() || match?.title || id,
        directory: match?.directory ?? null,
        archivedAt: Date.now(),
        category: "expert",
      });
      input.showToast({ tone: "success", title: t("session.archive_task_done") });
    },
    [
      input.currentAgentSessions,
      input.showToast,
      props.selectedWorkspaceId,
    ],
  );
  const commitExpertSessionTitle = useCallback((sessionId: string, title: string) => {
    void props.onRenameSession?.(sessionId, title);
  }, [props.onRenameSession]);

  // Stable element identity so SessionSurfaceView does not cloneElement +
  // onExpandedChange every parent paint (was part of max-update-depth white screen).
  return useMemo(() => {
    if (input.activeSidebarView !== "chat") return null;
    return (
      <AgentSessionTabs
        client={props.onmyagentServerClient}
        workspaceId={props.selectedWorkspaceId}
        snapshotWorkspaceId={
          props.runtimeWorkspaceId ?? props.selectedWorkspaceId
        }
        selectedSessionId={input.surfaceMode.sessionId}
        sessions={input.currentAgentSessions}
        orderIds={input.sessionTabOrderIds}
        // Only surface pendingTabSessionId (tab highlight) — never creatingSessionId.
        // Deriving from creatingSessionId cannot be cleared by onPendingSessionIdChange
        // and re-fired AgentSessionTabs into Maximum update depth (white screen).
        pendingSessionId={tabHighlightSessionId}
        onPendingSessionIdChange={input.setPendingTabSessionId}
        inventoryReady={input.expertDirectoryReady !== false}
        agentId={input.activeConversationAgentId}
        sessionStatusById={props.sidebar.sessionStatusById}
        onOpenSession={input.handleOpenExpertSession}
        onOpenDraftSession={input.handleOpenDraftSession}
        onPrefetchSession={props.sidebar.onPrefetchSession}
        onCreateSession={input.handleCreateCurrentAgentSession}
        onRenameSession={commitExpertSessionTitle}
        onRequestRename={input.openRenameModal}
        onArchiveSession={handleArchiveExpertSession}
        onDeleteSession={input.openDeleteModal}
      />
    );
  }, [
    commitExpertSessionTitle,
    handleArchiveExpertSession,
    input.activeConversationAgentId,
    input.activeSidebarView,
    input.currentAgentSessions,
    input.expertDirectoryReady,
    input.handleCreateCurrentAgentSession,
    input.handleOpenDraftSession,
    input.handleOpenExpertSession,
    input.openDeleteModal,
    input.openRenameModal,
    input.sessionTabOrderIds,
    input.setPendingTabSessionId,
    input.surfaceMode.sessionId,
    props.onmyagentServerClient,
    props.runtimeWorkspaceId,
    props.selectedWorkspaceId,
    props.sidebar.onPrefetchSession,
    props.sidebar.sessionStatusById,
    tabHighlightSessionId,
  ]);
}
