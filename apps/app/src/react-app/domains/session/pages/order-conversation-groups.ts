import type { AgentConversationGroup } from "../sidebar/session-chrome";
import { readExpertSidebarOrderIds } from "../sidebar/expert-list-order";
import {
  readExpertSessionSelection,
  resolveExpertSessionSelection,
} from "../sidebar/expert-session-selection-memory";

/**
 * Prefer stable left-rail order over conversationGroups insertion/recency order.
 * Prevents cold-open focus from jumping to the last-chatted expert.
 */
export function orderConversationGroupsBySidebarLedger(
  workspaceId: string,
  conversationGroups: readonly AgentConversationGroup[],
): AgentConversationGroup[] {
  const ledger = readExpertSidebarOrderIds(workspaceId);
  if (ledger.length === 0) return [...conversationGroups];
  const byId = new Map(
    conversationGroups.map((group) => [group.agentId, group] as const),
  );
  const ordered: AgentConversationGroup[] = [];
  for (const id of ledger) {
    const group = byId.get(id);
    if (group) ordered.push(group);
  }
  for (const group of conversationGroups) {
    if (!ordered.some((item) => item.agentId === group.agentId)) {
      ordered.push(group);
    }
  }
  return ordered.length > 0 ? ordered : [...conversationGroups];
}

/** Session to open when expert chat has no selection (cold open). */
export function resolveColdOpenExpertSessionId(input: {
  workspaceId: string;
  conversationGroups: readonly AgentConversationGroup[];
  sessionTabOrderIdsByScope: Record<string, readonly string[]>;
}): string | null {
  const firstGroup = orderConversationGroupsBySidebarLedger(
    input.workspaceId,
    input.conversationGroups,
  )[0];
  if (!firstGroup) return null;
  const agentId = firstGroup.agentId?.trim() ?? "";
  const sessionIds = firstGroup.sessions.map((session) => session.id);
  return (
    (agentId
      ? resolveExpertSessionSelection({
          rememberedSessionId: readExpertSessionSelection(
            input.workspaceId,
            agentId,
          ),
          sessionIds,
          orderIds:
            input.sessionTabOrderIdsByScope[`${input.workspaceId}:${agentId}`]
            ?? [],
        })
      : null) ?? firstGroup.latestSession.id
  );
}
