import { useEffect } from "react";
import type { PendingAgentContext } from "../../agents";
import type { AgentConversationGroup } from "../sidebar/session-chrome";
import type { ExpertDirectoryIdentityIndex } from "./expert-conversation-model";
import {
  normalizeExpertSessionId,
  resolveColdOpenExpertSessionId,
  resolveExpertColdOpenNavigation,
  shouldSuppressExpertColdOpen,
} from "./order-conversation-groups";

/**
 * Expert cold-open / ghost-route lifecycle once the directory is ready.
 *
 * Does nothing while a create/draft transaction is in flight so cold-open
 * cannot steal focus mid "new session".
 */
export function useExpertRouteLifecycle(input: {
  expertDirectoryReady: boolean;
  activeSidebarView: string;
  draftSessionActive: boolean;
  draftAgentId: string | null;
  /** @see ExpertSurfaceMode.creatingSessionId */
  creatingSessionId?: string | null;
  /**
   * Tab highlight after CREATE_BOUND (not the create operation itself).
   * @see ExpertSurfaceState.pendingTabSessionId
   */
  tabHighlightSessionId?: string | null;
  pendingAgent: PendingAgentContext | null;
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  routeSessionLive: boolean;
  expertDirectoryIdentity: ExpertDirectoryIdentityIndex;
  conversationGroups: AgentConversationGroup[];
  sessionTabOrderIdsByScope: Record<string, string[]>;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
}) {
  useEffect(() => {
    if (!input.expertDirectoryReady || input.activeSidebarView !== "chat") {
      return;
    }

    const suppress = shouldSuppressExpertColdOpen({
      draftSessionActive: input.draftSessionActive,
      draftAgentId: input.draftAgentId,
      creatingSessionId: input.creatingSessionId,
      tabHighlightSessionId: input.tabHighlightSessionId,
      pendingAgent: input.pendingAgent,
    });

    const workspaceId = input.selectedWorkspaceId.trim();
    if (!workspaceId) return;

    const selectedId = normalizeExpertSessionId(input.selectedSessionId);
    const coldOpenSessionId = resolveColdOpenExpertSessionId({
      workspaceId,
      conversationGroups: input.conversationGroups,
      sessionTabOrderIdsByScope: input.sessionTabOrderIdsByScope,
    });
    const decision = resolveExpertColdOpenNavigation({
      selectedSessionId: selectedId,
      routeSessionLive: input.routeSessionLive,
      isExpertSession: (sessionId) =>
        input.expertDirectoryIdentity.sessionIds.has(sessionId),
      coldOpenSessionId,
      suppress,
    });
    if (decision.action === "keep") return;
    if (decision.action === "open") {
      input.onOpenSession(workspaceId, decision.sessionId);
      return;
    }
    if (decision.action === "clear-route") {
      // Empty id = clear selection (normalized to null by open handlers).
      input.onOpenSession(workspaceId, "");
      return;
    }
    if (decision.action === "create-task") {
      input.onCreateTaskInWorkspace(workspaceId);
    }
  }, [
    input.activeSidebarView,
    input.conversationGroups,
    input.creatingSessionId,
    input.draftAgentId,
    input.draftSessionActive,
    input.expertDirectoryIdentity,
    input.expertDirectoryReady,
    input.onCreateTaskInWorkspace,
    input.onOpenSession,
    input.pendingAgent,
    input.routeSessionLive,
    input.selectedSessionId,
    input.selectedWorkspaceId,
    input.sessionTabOrderIdsByScope,
    input.tabHighlightSessionId,
  ]);
}
