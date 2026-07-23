/**
 * Pure conversation derivation for ExpertPage (sessions, groups, active agent).
 */
import { t } from "../../../../i18n";
import type { SidebarSessionItem, WorkspaceSessionGroup } from "../../../../app/types";
import type { PendingAgentContext, AgentRegistry } from "../../agents";
import {
  buildPendingAgentFromRecord,
  isExpertSession,
  readCustomAgentIdForSession,
  readCustomAgentSessionEntries,
} from "../../agents";
import {
  buildAgentConversationGroups,
  ensureAgentSessionGroupVisible,
  ensureAgentSessionsVisible,
  ensureSelectedAgentSessionGroupVisible,
  ensureSelectedAgentSessionVisible,
  type AgentConversationGroup,
} from "../sidebar/session-chrome";
import { findBuiltinMarketplaceExpertById } from "../expert-marketplace/data";

export { buildAgentConversationGroups };

export function selectRawWorkspaceSessions(
  groups: WorkspaceSessionGroup[],
  selectedWorkspaceId: string,
): SidebarSessionItem[] {
  const group = groups.find(
    (item) => item.workspace.id === selectedWorkspaceId,
  );
  return group?.sessions ?? [];
}

export function listVisibleExpertAgentSessions() {
  return readCustomAgentSessionEntries().filter((entry) =>
    isExpertSession(entry.sessionId),
  );
}

export function buildExpertWorkspaceSessions(input: {
  rawWorkspaceSessions: SidebarSessionItem[];
  selectedSessionId: string | null;
  currentConversationAgentId: string | null;
  visibleAgentSessions: ReturnType<typeof listVisibleExpertAgentSessions>;
}): SidebarSessionItem[] {
  return ensureAgentSessionsVisible({
    sessions: ensureSelectedAgentSessionVisible({
      sessions: input.rawWorkspaceSessions,
      selectedSessionId: input.selectedSessionId,
      selectedAgentId: input.currentConversationAgentId,
    }),
    agentSessions: input.visibleAgentSessions,
  });
}

export function buildExpertSidebarSessionGroups(input: {
  groups: WorkspaceSessionGroup[];
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  currentConversationAgentId: string | null;
  visibleAgentSessions: ReturnType<typeof listVisibleExpertAgentSessions>;
}) {
  return ensureAgentSessionGroupVisible({
    groups: ensureSelectedAgentSessionGroupVisible({
      groups: input.groups,
      selectedWorkspaceId: input.selectedWorkspaceId,
      selectedSessionId: input.selectedSessionId,
      selectedAgentId: input.currentConversationAgentId,
    }),
    selectedWorkspaceId: input.selectedWorkspaceId,
    agentSessions: input.visibleAgentSessions,
  });
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
      time: agent.conversationStartId
        ? {
            created: agent.conversationStartId,
            updated: agent.conversationStartId,
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
}): SidebarSessionItem[] {
  let sessions: SidebarSessionItem[];
  if (!input.activeConversationAgentId) {
    sessions = input.workspaceSessions.filter(
      (session) =>
        session.id === input.selectedSessionId && isExpertSession(session.id),
    );
  } else {
    sessions = input.workspaceSessions.filter(
      (session) =>
        readCustomAgentIdForSession(session.id) ===
          input.activeConversationAgentId && isExpertSession(session.id),
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
): boolean {
  return workspaceSessions.some(
    (session) =>
      isExpertSession(session.id) &&
      Boolean(readCustomAgentIdForSession(session.id)),
  );
}
