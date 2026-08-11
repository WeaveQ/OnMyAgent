import type { PendingAgentContext, AgentRegistry } from "../../agents";
import type { AgentConversationGroup } from "../sidebar/session-chrome";
import {
  buildDraftAgentGroups,
  resolveActiveAgentContext,
  resolveActiveConversationGroup,
} from "./expert-conversation-model";

export type ExpertPageNavigationModel = {
  draftAgentGroups: AgentConversationGroup[];
  draftAgentGroup: AgentConversationGroup | null;
  activeAgentContext: PendingAgentContext | null;
};

export function buildExpertPageNavigationModel(input: {
  draftAgentContexts: Record<string, PendingAgentContext>;
  selectedWorkspaceId: string;
  draftAgentId: string | null;
  activeConversationAgentId: string | null;
  conversationGroups: AgentConversationGroup[];
  pendingAgent: PendingAgentContext | null;
  registry: AgentRegistry | null;
}): ExpertPageNavigationModel {
  const draftAgentGroups = buildDraftAgentGroups(
    input.draftAgentContexts,
    input.selectedWorkspaceId,
  );
  const activeConversationGroup = resolveActiveConversationGroup({
    activeConversationAgentId: input.activeConversationAgentId,
    draftAgentGroups,
    conversationGroups: input.conversationGroups,
  });
  return {
    draftAgentGroups,
    draftAgentGroup:
      draftAgentGroups.find((group) => group.agentId === input.draftAgentId) ?? null,
    activeAgentContext: resolveActiveAgentContext({
      activeConversationAgentId: input.activeConversationAgentId,
      draftAgentContexts: input.draftAgentContexts,
      pendingAgent: input.pendingAgent,
      registry: input.registry,
      activeConversationGroup,
    }),
  };
}
