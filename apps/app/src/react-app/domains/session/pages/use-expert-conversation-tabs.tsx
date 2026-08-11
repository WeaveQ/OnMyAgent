/** @jsxImportSource react */
import { useCallback } from "react";

import { t } from "../../../../i18n";
import type { SidebarSessionItem } from "../../../../app/types";
import { archiveAssistantTask } from "../../shared";
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
  pendingTabSessionId: string | null;
  setPendingTabSessionId: (sessionId: string | null) => void;
  activeConversationAgentId: string | null;
  handleOpenExpertSession: (workspaceId: string, sessionId: string) => void;
  handleOpenDraftSession: (sessionId: string) => void;
  handleCreateCurrentAgentSession: () => void;
  openRenameModal: (sessionId: string, title: string) => void;
  openDeleteModal: (sessionId: string) => void;
  showToast: (input: { tone: "success"; title: string }) => void;
}) {
  const { props } = input;
  const handleArchiveExpertSession = useCallback((sessionId: string, title: string) => {
    const workspaceId = props.selectedWorkspaceId.trim();
    const id = sessionId.trim();
    if (!workspaceId || !id) return;
    const match = input.currentAgentSessions.find((session) => session.id === id);
    archiveAssistantTask(workspaceId, {
      sessionId: id,
      title: title.trim() || match?.title || id,
      directory: match?.directory ?? null,
      archivedAt: Date.now(),
      category: "expert",
    });
    input.showToast({ tone: "success", title: t("session.archive_task_done") });
  }, [input, props.selectedWorkspaceId]);
  const commitExpertSessionTitle = useCallback((sessionId: string, title: string) => {
    void props.onRenameSession?.(sessionId, title);
  }, [props.onRenameSession]);

  return input.activeSidebarView === "chat" ? (
    <AgentSessionTabs
      client={props.onmyagentServerClient}
      workspaceId={props.selectedWorkspaceId}
      selectedSessionId={input.surfaceMode.sessionId}
      sessions={input.currentAgentSessions}
      orderIds={input.sessionTabOrderIds}
      pendingSessionId={
        input.pendingTabSessionId ?? input.surfaceMode.creatingSessionId
      }
      onPendingSessionIdChange={input.setPendingTabSessionId}
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
  ) : null;
}
