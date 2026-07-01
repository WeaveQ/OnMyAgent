import type { OpenworkServerInfo } from "../../app/lib/desktop";
import {
  createOpenworkServerClient,
  type OpenworkServerClient,
  type OpenworkWorkspaceInfo,
} from "../../app/lib/onmyagent-server";
import { resolveOpenworkConnection } from "./onmyagent-connection";

export type SessionOpenworkConnectionState = {
  hostInfo: OpenworkServerInfo | null;
  normalizedBaseUrl: string;
  onmyagentClient: OpenworkServerClient | null;
  resolvedToken: string;
  serverActiveId: string | null;
  serverWorkspaces: OpenworkWorkspaceInfo[];
};

export async function loadSessionOpenworkConnectionState(): Promise<SessionOpenworkConnectionState> {
  const { normalizedBaseUrl, resolvedToken, resolvedHostToken, hostInfo } =
    await resolveOpenworkConnection();
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
  const onmyagentClient = createOpenworkServerClient({
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
