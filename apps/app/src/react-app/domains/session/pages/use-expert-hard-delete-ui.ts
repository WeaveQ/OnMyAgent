/**
 * Expert hard-delete UI helpers for ExpertPage (keeps expert.tsx under size baseline).
 */
import { useCallback, useMemo } from "react";
import {
  canHardDeleteExpert,
  type AgentRegistry,
} from "../../agents";
import type { ExpertMarketplaceEntry } from "../../plugins";
import type { AgentConversationGroup } from "../sidebar/conversation-model";

export type ExpertHardDeleteTarget = {
  agentId: string;
  name: string;
  sessionIds: string[];
  packageName?: string;
  source?: "mine" | "installed";
  sessionDirectories?: Record<string, string>;
};

function shortPackageNameFromAgentId(agentId: string): string {
  if (!agentId.includes(":")) return agentId;
  const parts = agentId.split(":").filter(Boolean);
  return parts.length >= 2 && parts[0] === parts[parts.length - 1]
    ? parts[0]!
    : parts[parts.length - 1] || agentId;
}

/** Exact id / packageName / last `:` segment. No substring includes(). */
export function expertDeleteIdentityEquals(
  expert: Pick<ExpertMarketplaceEntry, "id" | "packageName">,
  agentId: string | null | undefined,
): boolean {
  const normalized = agentId?.trim();
  if (!normalized) return false;
  const id = expert.id.trim();
  const pkg = expert.packageName.trim();
  if (normalized === id || (pkg && normalized === pkg)) return true;
  if (!pkg) return false;
  const parts = normalized.split(":").filter(Boolean);
  return (parts[parts.length - 1] ?? "") === pkg;
}

function collectDeleteSessionState(groups: readonly AgentConversationGroup[]): {
  sessionIds: string[];
  sessionDirectories: Record<string, string>;
} {
  const sessionIds: string[] = [];
  const sessionDirectories: Record<string, string> = {};
  for (const group of groups) {
    for (const session of group.sessions) {
      const id = session.id.trim();
      if (!id || id.startsWith("draft:")) continue;
      sessionIds.push(id);
      const directory = session.directory?.trim();
      if (directory) sessionDirectories[id] = directory;
    }
  }
  return { sessionIds, sessionDirectories };
}

/** Mine shelf: self-created and summoned installs. Catalog cards stay undeletable. */
export function resolveMarketplaceExpertHardDeleteTarget(input: {
  expert: ExpertMarketplaceEntry;
  conversationGroups: readonly AgentConversationGroup[];
  registry: AgentRegistry | null;
}): ExpertHardDeleteTarget | null {
  if (input.expert.source !== "mine" && input.expert.source !== "installed") return null;
  const packageName = input.expert.packageName.trim();
  const matchedGroups = input.conversationGroups.filter((group) =>
    expertDeleteIdentityEquals(input.expert, group.agentId),
  );
  const registryAgent = input.registry?.agents.find((agent) => {
    const id = agent.id.trim();
    const marketplaceName = agent.marketplacePackageName?.trim();
    return (
      expertDeleteIdentityEquals(input.expert, id) ||
      Boolean(packageName && marketplaceName === packageName)
    );
  });
  const agentId = (
    matchedGroups[0]?.agentId?.trim() ||
    registryAgent?.id.trim() ||
    input.expert.id.trim()
  );
  if (!canHardDeleteExpert(agentId, input.registry)) return null;
  const { sessionIds, sessionDirectories } = collectDeleteSessionState(matchedGroups);
  return {
    agentId,
    name: input.expert.displayName.trim() || packageName || agentId,
    sessionIds,
    source: input.expert.source,
    ...(packageName ? { packageName } : {}),
    ...(Object.keys(sessionDirectories).length > 0 ? { sessionDirectories } : {}),
  };
}

export function useExpertHardDeleteUi(input: {
  registry: AgentRegistry | null;
  conversationGroups: AgentConversationGroup[];
  openDeleteGroupModal: (target: {
    kind: "expert";
    agentId: string;
    name: string;
    sessionIds: string[];
    packageName?: string;
    source?: "mine" | "installed";
    sessionDirectories?: Record<string, string>;
    operationId: string;
  }) => void;
}) {
  const openDeleteExpertModal = useCallback(
    (target: ExpertHardDeleteTarget) => {
      const agentId = target.agentId.trim();
      if (!canHardDeleteExpert(agentId, input.registry)) return;
      const fromRegistry = input.registry?.agents.find((agent) => agent.id === agentId)?.marketplacePackageName?.trim();
      const packageName =
        fromRegistry ||
        target.packageName?.trim() ||
        shortPackageNameFromAgentId(agentId);
      if (!globalThis.crypto?.randomUUID) return;
      const operationId = globalThis.crypto.randomUUID();
      input.openDeleteGroupModal({
        kind: "expert",
        agentId,
        name: target.name.trim(),
        sessionIds: target.sessionIds,
        ...(packageName ? { packageName } : {}),
        ...(target.source ? { source: target.source } : {}),
        ...(target.sessionDirectories ? { sessionDirectories: target.sessionDirectories } : {}),
        operationId,
      });
    },
    [input],
  );

  const handleDeleteMarketplaceExpert = useCallback(
    (expert: ExpertMarketplaceEntry) => {
      const resolved = resolveMarketplaceExpertHardDeleteTarget({
        expert,
        conversationGroups: input.conversationGroups,
        registry: input.registry,
      });
      if (!resolved) return;
      openDeleteExpertModal(resolved);
    },
    [input.conversationGroups, input.registry, openDeleteExpertModal],
  );

  const deletableExpertIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of input.conversationGroups) {
      const agentId = group.agentId?.trim() ?? "";
      if (agentId && canHardDeleteExpert(agentId, input.registry)) {
        ids.add(agentId);
      }
    }
    return ids;
  }, [input.conversationGroups, input.registry]);

  return { openDeleteExpertModal, handleDeleteMarketplaceExpert, deletableExpertIds };
}
