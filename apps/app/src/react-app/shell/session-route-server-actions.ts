import type { OnMyAgentServerInfo } from "../../app/lib/desktop";
import {
  createOnMyAgentServerClient,
  type OnMyAgentServerClient,
  type OnMyAgentWorkspaceInfo,
} from "../../app/lib/onmyagent-server";
import { resolveOnMyAgentConnection } from "./onmyagent-connection";

export type SessionOnMyAgentConnectionState = {
  hostInfo: OnMyAgentServerInfo | null;
  normalizedBaseUrl: string;
  onmyagentClient: OnMyAgentServerClient | null;
  resolvedToken: string;
  serverActiveId: string | null;
  serverWorkspaces: OnMyAgentWorkspaceInfo[];
};

export async function loadSessionOnMyAgentConnectionState(): Promise<SessionOnMyAgentConnectionState> {
  const { normalizedBaseUrl, resolvedToken, resolvedHostToken, hostInfo } =
    await resolveOnMyAgentConnection();
  if (!normalizedBaseUrl || !resolvedToken) {
    return {
      hostInfo,
      normalizedBaseUrl: "",
      onmyagentClient: null,
      resolvedToken: "",
      serverActiveId: null,
      serverWorkspaces: [],
    };
  }
  const onmyagentClient = createOnMyAgentServerClient({
    baseUrl: normalizedBaseUrl,
    token: resolvedToken,
    hostToken: resolvedHostToken || undefined,
  });
  const list = await onmyagentClient.listWorkspaces();
  return {
    hostInfo,
    normalizedBaseUrl,
    onmyagentClient,
    resolvedToken,
    serverActiveId: list.activeId ?? null,
    serverWorkspaces: list.items,
  };
}
