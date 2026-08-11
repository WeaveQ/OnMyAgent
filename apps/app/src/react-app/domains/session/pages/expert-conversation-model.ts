/**
 * Pure conversation derivation for ExpertPage (sessions, groups, active agent).
 */
import { t } from "../../../../i18n";
import type { SidebarSessionItem, WorkspaceSessionGroup } from "../../../../app/types";
import type { PendingAgentContext, AgentRegistry } from "../../agents";
import {
  buildPendingAgentFromRecord,
} from "../../agents";
import {
  buildAgentConversationGroups,
  type AgentConversationGroup,
} from "../sidebar/session-chrome";
import { findBuiltinMarketplaceExpertById } from "@/react-app/domains/plugins";
import { resolveExpertSessionSelection } from "../sidebar/expert-session-selection-memory";

export { buildAgentConversationGroups };

export type ExpertDirectoryIdentityIndex = {
  sessionIds: ReadonlySet<string>;
  agentIdBySessionId: ReadonlyMap<string, string>;
};

export function selectRawWorkspaceSessions(
  groups: WorkspaceSessionGroup[],
  selectedWorkspaceId: string,
): SidebarSessionItem[] {
  const group = groups.find(
    (item) => item.workspace.id === selectedWorkspaceId,
  );
  return group?.sessions ?? [];
}

export function listVisibleExpertAgentSessions(
  rawWorkspaceSessions: SidebarSessionItem[],
  identity: ExpertDirectoryIdentityIndex,
) {
  return rawWorkspaceSessions.flatMap((session) => {
    if (!identity.sessionIds.has(session.id)) return [];
    const agentId = identity.agentIdBySessionId.get(session.id);
    return agentId ? [{ sessionId: session.id, agentId }] : [];
  });
}

export function buildExpertWorkspaceSessions(input: {
  rawWorkspaceSessions: SidebarSessionItem[];
}): SidebarSessionItem[] {
  return input.rawWorkspaceSessions;
}

export function buildExpertSidebarSessionGroups(input: {
  groups: WorkspaceSessionGroup[];
}) {
  return input.groups;
}

export function buildDraftAgentGroups(
  draftAgentContexts: Record<string, PendingAgentContext>,
  selectedWorkspaceId: string,
): AgentConversationGroup[] {
  return Object.values(draftAgentContexts).flatMap((agent) => {
    if (agent.boundSessionId) return [];
    const draftSession: SidebarSessionItem = {
      id: `draft:${selectedWorkspaceId}:${agent.id}`,
      title: agent.name,
      time: agent.draftCreatedAt
        ? {
            created: agent.draftCreatedAt,
            updated: agent.draftCreatedAt,
          }
        : undefined,
    };
    return [
      {
        key: `draft-agent:${agent.id}`,
        agentId: agent.id,
        name: agent.name,
        description:
          agent.description.trim() || t("session.cmd_new_session_title"),
        avatarUrl: agent.avatar.avatarUrl,
        avatarBackground:
          agent.avatar.avatarBackground ?? "var(--ow-primary-light)",
        sessions: [draftSession],
        latestSession: draftSession,
      },
    ];
  });
}

export function buildCurrentAgentSessions(input: {
  workspaceSessions: SidebarSessionItem[];
  activeConversationAgentId: string | null;
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  draftSessionActive: boolean;
  activeDraftSessionId: string | null;
  identity: ExpertDirectoryIdentityIndex;
}): SidebarSessionItem[] {
  const isExpert = (sessionId: string) => input.identity.sessionIds.has(sessionId);
  const agentIdForSession = (sessionId: string) =>
    input.identity.agentIdBySessionId.get(sessionId);
  let sessions: SidebarSessionItem[];
  if (!input.activeConversationAgentId) {
    sessions = input.workspaceSessions.filter(
      (session) =>
        session.id === input.selectedSessionId && isExpert(session.id),
    );
  } else {
    sessions = input.workspaceSessions.filter(
      (session) =>
        agentIdForSession(session.id) ===
          input.activeConversationAgentId && isExpert(session.id),
    );
  }
  if (input.draftSessionActive) {
    return [
      {
        id:
          input.activeDraftSessionId ?? `draft:${input.selectedWorkspaceId}`,
        title: t("session.cmd_new_session_title"),
      } as SidebarSessionItem,
      ...sessions,
    ];
  }
  return sessions;
}

export function resolveActiveConversationGroup(input: {
  activeConversationAgentId: string | null;
  draftAgentGroups: AgentConversationGroup[];
  conversationGroups: AgentConversationGroup[];
}): AgentConversationGroup | null {
  if (!input.activeConversationAgentId) return null;
  const activeDraftGroup = input.draftAgentGroups.find(
    (group) => group.agentId === input.activeConversationAgentId,
  );
  if (activeDraftGroup) return activeDraftGroup;
  return (
    input.conversationGroups.find(
      (group) => group.agentId === input.activeConversationAgentId,
    ) ?? null
  );
}

export function resolveActiveAgentContext(input: {
  activeConversationAgentId: string | null;
  draftAgentContexts: Record<string, PendingAgentContext>;
  pendingAgent: PendingAgentContext | null;
  registry: AgentRegistry | null | undefined;
  activeConversationGroup: AgentConversationGroup | null;
}): PendingAgentContext | null {
  const agentId = input.activeConversationAgentId;
  if (!agentId) return null;
  const draftContext = input.draftAgentContexts[agentId];
  if (draftContext) return draftContext;
  if (input.pendingAgent?.id === agentId) return input.pendingAgent;
  const registry = input.registry;
  const registryAgent = registry
    ? (registry.agents.find((item) => item.id === agentId) ??
      registry.templates.find((item) => item.id === agentId))
    : null;
  const restoredAgent =
    registryAgent && registry
      ? buildPendingAgentFromRecord(registryAgent, registry)
      : null;
  if (restoredAgent) return restoredAgent;
  const marketplaceExpert = findBuiltinMarketplaceExpertById(agentId);
  if (marketplaceExpert) {
    return {
      id: marketplaceExpert.id,
      name: marketplaceExpert.displayName,
      description: marketplaceExpert.description,
      avatar: {
        avatarStyle: "robot",
        avatarOptionId: "marketplace-expert",
        customAvatarDataUrl: null,
        avatarUrl: marketplaceExpert.avatarUrl,
        avatarBackground: "var(--ow-primary-light)",
      },
      systemPrompt: marketplaceExpert.systemPrompt,
      quickPrompts: marketplaceExpert.quickPrompts.slice(0, 3),
      promptTemplates: marketplaceExpert.promptTemplates.slice(0, 3),
      skillIds: [...marketplaceExpert.skills],
      introStyle: marketplaceExpert.introStyle,
      approvedAgentIds: [...marketplaceExpert.approvedAgentIds],
      marketplaceExpert: {
        source: "builtin",
        packageName: marketplaceExpert.packageName,
        packagePath: marketplaceExpert.packagePath,
      },
    };
  }
  if (!input.activeConversationGroup) return null;
  return {
    id: agentId,
    name: input.activeConversationGroup.name,
    description: input.activeConversationGroup.description,
    avatar: {
      avatarStyle: "robot",
      avatarOptionId: "marketplace-expert",
      customAvatarDataUrl: null,
      avatarUrl: input.activeConversationGroup.avatarUrl,
      avatarBackground: input.activeConversationGroup.avatarBackground,
    },
    systemPrompt: input.activeConversationGroup.description,
  };
}

export function computeHasAnyExpertConversation(
  workspaceSessions: SidebarSessionItem[],
  identity: ExpertDirectoryIdentityIndex,
): boolean {
  return workspaceSessions.some(
    (session) => {
      const isExpert = identity.sessionIds.has(session.id);
      const agentId = identity.agentIdBySessionId.get(session.id);
      return isExpert && Boolean(agentId);
    },
  );
}

/**
 * Resolve an expert-list click against sessions that are currently ready in
 * its group. A stale selected id is deliberately not treated as a no-op: the
 * caller still needs to issue the open so route state can recover.
 */
export function resolveExpertSidebarOpen(input: {
  hintSessionId: string;
  rememberedSessionId: string | null;
  orderIds: readonly string[];
  readySessionIds: readonly string[];
  selectedSessionId: string | null;
}): { sessionId: string | null; shouldOpen: boolean } {
  const sessionId =
    resolveExpertSessionSelection({
      rememberedSessionId: input.rememberedSessionId,
      sessionIds: input.readySessionIds,
      orderIds: input.orderIds,
    }) ?? (input.hintSessionId.trim() || null);
  const isReady = sessionId
    ? input.readySessionIds.some((id) => id.trim() === sessionId)
    : false;
  return {
    sessionId,
    shouldOpen: !(
      isReady && sessionId === (input.selectedSessionId?.trim() ?? "")
    ),
  };
}

/**
 * A draft can be layered over an already selected real session. In that case a
 * same-expert sidebar click must resolve the real tab, not be swallowed as an
 * apparent no-op just because the route still points at that tab.
 */
export function shouldExitDraftForExpertSidebarTarget(input: {
  draftAgentId: string | null;
  draftSessionActive: boolean;
  targetAgentId: string;
}): boolean {
  return (
    input.draftSessionActive &&
    input.draftAgentId === input.targetAgentId
  );
}
