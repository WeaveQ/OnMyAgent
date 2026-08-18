import { useQuery } from "@tanstack/react-query";
import type {
  AgentRuntimeModelCatalog,
  AgentRuntimeSession,
} from "@onmyagent/types/agent-runtime";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type { Client } from "../../../app/types";
import { useQueryCacheState } from "./state";
import { OnMyAgentServerError } from "../../../app/lib/onmyagent-server";
import type { AgentRuntimeSelectionResponse } from "@onmyagent/types/agent-runtime";

function selectionRuntime(
  selection: AgentRuntimeSelectionResponse,
  workspaceId: string,
): { runtimeKind: "opencode" | "grok-build"; profileId: string } {
  const runtimeKind = selection.config?.workspaceOverrides[workspaceId]
    ?? selection.config?.defaultRuntimeKind
    ?? "opencode";
  return {
    runtimeKind,
    profileId: runtimeKind === "grok-build"
      ? selection.config?.grokBuild?.profileId ?? "system"
      : "primary-opencode",
  };
}

export function useRuntimeRoute(input: {
  client: OnMyAgentServerClient | null;
  opencodeClient: Client | null;
  workspaceId: string;
  sessionId: string | null;
}) {
  // Keep the settings/delete-policy selection cache warm on the session
  // route. Existing-session routing uses getRuntimeSession and would
  // otherwise leave Grok featureStates empty, fail-closing native delete.
  useQuery({
    queryKey: ["agent-runtime-selection", input.workspaceId] as const,
    enabled: Boolean(input.client && input.workspaceId),
    queryFn: () => input.client!.getAgentRuntimeSelection(input.workspaceId),
    staleTime: 10_000,
  });
  const route = useQuery({
    queryKey: ["agent-runtime-route", input.workspaceId, input.sessionId ?? "draft"] as const,
    enabled: Boolean(input.client && input.workspaceId),
    queryFn: async () => {
      if (!input.client) throw new Error("agent_runtime_client_unavailable");
      if (input.sessionId) {
        try {
          const session = (await input.client.getRuntimeSession(
            input.workspaceId,
            input.sessionId,
          )).session;
          return { runtimeKind: session.runtimeKind, profileId: session.profileId };
        } catch (error) {
          if (
            error instanceof OnMyAgentServerError
            && error.code === "runtime_session_binding_not_found"
          ) {
            return selectionRuntime(await input.client.getAgentRuntimeSelection(input.workspaceId), input.workspaceId);
          }
          throw error;
        }
      }
      return selectionRuntime(
        await input.client.getAgentRuntimeSelection(input.workspaceId),
        input.workspaceId,
      );
    },
    retry: false,
    staleTime: 30_000,
  });
  const runtimeKind = route.data?.runtimeKind ?? null;
  const modelCatalog = useQuery<AgentRuntimeModelCatalog>({
    queryKey: [
      "agent-runtime-model-catalog",
      runtimeKind ?? "unknown",
      route.data?.profileId ?? "unknown",
      input.workspaceId,
    ] as const,
    enabled: Boolean(input.client && input.workspaceId && runtimeKind === "grok-build"),
    queryFn: async () => {
      if (!input.client || !runtimeKind) throw new Error("agent_runtime_catalog_unavailable");
      return input.client.getAgentRuntimeModelCatalog(input.workspaceId, runtimeKind);
    },
    staleTime: 30_000,
  });
  const activeSession = useQueryCacheState<AgentRuntimeSession | null>(
    input.workspaceId && input.sessionId
      ? ["agent-runtime-session", input.workspaceId, input.sessionId]
      : null,
    null,
  );
  return {
    routeRuntimeKind: runtimeKind,
    runtimeModelCatalog: modelCatalog.data ?? null,
    opencodeCatalogClient: runtimeKind === "opencode" ? input.opencodeClient : null,
    activeRuntimeSession: activeSession,
  };
}
