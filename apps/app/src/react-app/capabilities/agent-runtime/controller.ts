import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentRuntimeHomeMode,
  AgentRuntimeKind,
  GrokBuildRuntimeSelection,
} from "@onmyagent/types/agent-runtime";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { selectGrokFeatureStates } from "./grok-feature-states";

export function agentRuntimeSelectionQueryKey(workspaceId: string) {
  return ["agent-runtime-selection", workspaceId] as const;
}

export function useAgentRuntimeController(input: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = agentRuntimeSelectionQueryKey(input.workspaceId);
  const query = useQuery({
    queryKey,
    queryFn: () => input.client!.getAgentRuntimeSelection(input.workspaceId),
    enabled: Boolean(input.client && input.workspaceId),
    staleTime: 10_000,
  });
  const selectedRuntimeKind = query.data?.config?.workspaceOverrides[input.workspaceId]
    ?? query.data?.config?.defaultRuntimeKind;
  const selectedProfileId = selectedRuntimeKind === "grok-build"
    ? selectedGrokProfileId(query.data?.config?.grokBuild)
    : "primary-opencode";
  const catalogQuery = useQuery({
    queryKey: [
      "agent-runtime-model-catalog",
      selectedRuntimeKind ?? "unknown",
      selectedProfileId,
      input.workspaceId,
    ] as const,
    queryFn: () => input.client!.getAgentRuntimeModelCatalog(
      input.workspaceId,
      selectedRuntimeKind,
    ),
    enabled: Boolean(input.client && input.workspaceId && selectedRuntimeKind),
    staleTime: 30_000,
  });
  const connectorToolsQuery = useQuery({
    queryKey: [
      "agent-runtime-connector-tools",
      selectedRuntimeKind ?? "unknown",
      input.workspaceId,
    ] as const,
    queryFn: () => input.client!.getAgentRuntimeConnectorTools(
      input.workspaceId,
      selectedRuntimeKind,
    ),
    enabled: Boolean(input.client && input.workspaceId && selectedRuntimeKind),
    staleTime: 10_000,
  });
  const mutation = useMutation({
    mutationFn: async (change:
      | { type: "default"; runtimeKind: AgentRuntimeKind }
      | { type: "workspace"; runtimeKind: AgentRuntimeKind | null }
      | { type: "grok-profile"; homeMode: AgentRuntimeHomeMode }
      | { type: "grok-binary"; binaryMode: "system" | "bundled" }) => {
      if (!input.client || !input.workspaceId || !query.data?.config) {
        throw new Error("agent_runtime_selection_unavailable");
      }
      const expectedRevision = query.data.config.revision;
      if (change.type === "default") {
        return input.client.setDefaultAgentRuntime(change.runtimeKind, { expectedRevision });
      }
      if (change.type === "grok-profile") {
        return input.client.setGrokBuildRuntimeSelection(
          grokProfileSelection(
            change.homeMode,
            query.data.config.grokBuild?.binaryMode ?? "system",
          ),
          { expectedRevision },
        );
      }
      if (change.type === "grok-binary") {
        return input.client.setGrokBuildRuntimeSelection({
          ...grokProfileSelection(
            selectedGrokProfileId(query.data.config.grokBuild),
            change.binaryMode,
          ),
        }, { expectedRevision });
      }
      return input.client.setWorkspaceAgentRuntime(
            input.workspaceId,
            change.runtimeKind,
            { expectedRevision },
          );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const authenticationMutation = useMutation({
    mutationFn: async (methodId: string) => {
      if (!input.client || !input.workspaceId || !selectedRuntimeKind) {
        throw new Error("agent_runtime_auth_unavailable");
      }
      return input.client.authenticateAgentRuntime(
        input.workspaceId,
        selectedRuntimeKind,
        methodId,
      );
    },
    onSuccess: async (catalog) => {
      queryClient.setQueryData([
        "agent-runtime-model-catalog",
        selectedRuntimeKind ?? "unknown",
        selectedProfileId,
        input.workspaceId,
      ], catalog);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  return {
    query,
    catalogQuery,
    connectorToolsQuery,
    mutation,
    authenticationMutation,
    grokFeatureStates: selectGrokFeatureStates(query.data),
  };
}

export function selectedGrokProfileId(
  selection?: GrokBuildRuntimeSelection,
): "system" | "managed" {
  return selection?.profileId === "managed" || selection?.homeMode === "managed"
    ? "managed"
    : "system";
}

export function grokProfileSelection(
  homeMode: AgentRuntimeHomeMode,
  binaryMode: "system" | "bundled" = "system",
): GrokBuildRuntimeSelection {
  return { profileId: homeMode, homeMode, binaryMode };
}
