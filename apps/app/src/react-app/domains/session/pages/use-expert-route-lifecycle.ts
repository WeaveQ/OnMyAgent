import { useEffect } from "react";
import type { PendingAgentContext } from "../../agents";
import type { AgentConversationGroup } from "../sidebar/session-chrome";
import type { ExpertDirectoryIdentityIndex } from "./expert-conversation-model";
import { resolveColdOpenExpertSessionId } from "./order-conversation-groups";

export function useExpertRouteLifecycle(input: {
  expertDirectoryReady: boolean;
  activeSidebarView: string;
  draftSessionActive: boolean;
  draftAgentId: string | null;
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
    if (!input.expertDirectoryReady || input.activeSidebarView !== "chat") return;
    if (input.draftSessionActive || input.draftAgentId) return;
    if (
      input.pendingAgent?.operationId &&
      !input.pendingAgent.boundSessionId &&
      input.pendingAgent.draftSource === "agent-selection"
    ) {
      return;
    }

    const workspaceId = input.selectedWorkspaceId.trim();
    if (!workspaceId) return;
    const selectedId = input.selectedSessionId?.trim() ?? "";
    if (
      selectedId &&
      input.routeSessionLive &&
      input.expertDirectoryIdentity.sessionIds.has(selectedId)
    ) {
      return;
    }
    const resolved = resolveColdOpenExpertSessionId({
      workspaceId,
      conversationGroups: input.conversationGroups,
      sessionTabOrderIdsByScope: input.sessionTabOrderIdsByScope,
    });
    if (resolved) {
      input.onOpenSession(workspaceId, resolved);
      return;
    }
    if (selectedId && !input.routeSessionLive) {
      input.onOpenSession(workspaceId, "");
      return;
    }
    if (
      selectedId &&
      !input.expertDirectoryIdentity.sessionIds.has(selectedId)
    ) {
      input.onCreateTaskInWorkspace(workspaceId);
    }
  }, [
    input.activeSidebarView,
    input.conversationGroups,
    input.draftAgentId,
    input.draftSessionActive,
    input.expertDirectoryIdentity,
    input.expertDirectoryReady,
    input.onCreateTaskInWorkspace,
    input.onOpenSession,
    input.pendingAgent?.boundSessionId,
    input.pendingAgent?.draftSource,
    input.pendingAgent?.operationId,
    input.routeSessionLive,
    input.selectedSessionId,
    input.selectedWorkspaceId,
    input.sessionTabOrderIdsByScope,
  ]);
}
