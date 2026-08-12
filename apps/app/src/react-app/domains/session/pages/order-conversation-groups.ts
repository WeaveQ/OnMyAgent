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

/**
 * Decide cold-open navigation once origin inventory is ready.
 *
 * While sessions are still catching up (or the user just switched experts),
 * a selected id can briefly be missing from `liveSessionIds`. Stealing focus
 * back to the first conversation group or clearing the route mid-switch
 * blanks the surface and feels like a desktop crash during startup.
 *
 * Keep any selection that is still marked as an expert session in local
 * identity. Only clear ghosts after hard-delete (`isExpertSession` false).
 */
export type ExpertColdOpenNavigation =
  | { action: "keep" }
  | { action: "open"; sessionId: string }
  | { action: "clear-route" }
  | { action: "create-task" };

/**
 * Normalize route/open session ids. Empty / whitespace means "no selection"
 * (never pass "" into snapshot or directory lookups).
 */
export function normalizeExpertSessionId(
  sessionId: string | null | undefined,
): string | null {
  const id = sessionId?.trim() ?? "";
  return id.length > 0 ? id : null;
}

/**
 * While the user is mid expert create / draft bind, cold-open must not steal
 * focus (open first expert, clear-route, or create-task).
 */
export function shouldSuppressExpertColdOpen(input: {
  draftSessionActive?: boolean;
  draftAgentId?: string | null;
  /** Surface-mode creating session (bound but not yet the painted route). */
  creatingSessionId?: string | null;
  /**
   * Tab-strip highlight after CREATE_BOUND — distinct from create operation.
   * @see ExpertSurfaceState.pendingTabSessionId
   */
  tabHighlightSessionId?: string | null;
  pendingAgent?: {
    operationId?: string | null;
    boundSessionId?: string | null;
    draftSource?: string | null;
  } | null;
}): boolean {
  if (input.draftSessionActive) return true;
  if (input.draftAgentId?.trim()) return true;
  if (input.creatingSessionId?.trim()) return true;
  if (input.tabHighlightSessionId?.trim()) return true;
  const pending = input.pendingAgent;
  if (!pending?.operationId?.trim()) return false;
  // Unbound create transaction (any source): wait for CREATE_BOUND.
  if (!pending.boundSessionId?.trim()) return true;
  // Bound: settling is covered by creatingSessionId / tabHighlight / draft flags.
  return false;
}

export function resolveExpertColdOpenNavigation(input: {
  selectedSessionId: string | null | undefined;
  routeSessionLive: boolean;
  isExpertSession: (sessionId: string) => boolean;
  coldOpenSessionId: string | null;
  /** When true, never open/clear/create-task (caller holds a create transaction). */
  suppress?: boolean;
}): ExpertColdOpenNavigation {
  if (input.suppress) {
    return { action: "keep" };
  }
  const selectedId = normalizeExpertSessionId(input.selectedSessionId) ?? "";
  if (selectedId && input.isExpertSession(selectedId)) {
    // Live in inventory, or still indexed as expert while list lags: never
    // cold-open/clear over the user's choice.
    return { action: "keep" };
  }
  if (!selectedId) {
    const cold = normalizeExpertSessionId(input.coldOpenSessionId);
    if (cold) {
      return { action: "open", sessionId: cold };
    }
    return { action: "keep" };
  }
  // Non-expert residual route (assistant id / hard-deleted ghost).
  if (!input.routeSessionLive) {
    return { action: "clear-route" };
  }
  return { action: "create-task" };
}
