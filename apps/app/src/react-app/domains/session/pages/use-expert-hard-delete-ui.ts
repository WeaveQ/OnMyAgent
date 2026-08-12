/**
 * Expert hard-delete UI helpers for ExpertPage (keeps expert.tsx under size baseline).
 */
import { useCallback, useMemo } from "react";
import {
  canHardDeleteExpert,
  type AgentRegistry,
} from "../../agents";
import type { AgentConversationGroup } from "../sidebar/conversation-model";

export function useExpertHardDeleteUi(input: {
  registry: AgentRegistry | null;
  conversationGroups: AgentConversationGroup[];
  openDeleteGroupModal: (target: {
    kind: "expert";
    agentId: string;
    name: string;
    sessionIds: string[];
    packageName?: string;
    operationId: string;
  }) => void;
}) {
  const openDeleteExpertModal = useCallback(
    (target: { agentId: string; name: string; sessionIds: string[] }) => {
      const agentId = target.agentId.trim();
      if (!canHardDeleteExpert(agentId, input.registry)) return;
      const fromRegistry = input.registry?.agents.find((agent) => agent.id === agentId)?.marketplacePackageName?.trim();
      // Prefer registry package name; else short form of agentId ("pkg:pkg" → "pkg").
      const packageName =
        fromRegistry ||
        (agentId.includes(":")
          ? (() => {
              const parts = agentId.split(":").filter(Boolean);
              return parts.length >= 2 && parts[0] === parts[parts.length - 1]
                ? parts[0]
                : parts[parts.length - 1];
            })()
          : agentId);
      if (!globalThis.crypto?.randomUUID) return;
      const operationId = globalThis.crypto.randomUUID();
      input.openDeleteGroupModal({
        kind: "expert",
        agentId,
        name: target.name.trim(),
        sessionIds: target.sessionIds,
        ...(packageName ? { packageName } : {}),
        operationId,
      });
    },
    [input],
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

  return { openDeleteExpertModal, deletableExpertIds };
}
