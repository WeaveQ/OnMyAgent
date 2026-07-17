import type { OnMyAgentServerClient } from "../../app/lib/onmyagent-server";
import type { WorkspaceConnectionState } from "../../app/types";
import { normalizeDirectoryPath } from "../../app/utils";
import {
  buildSettingsFailedWorkspaceSessionEntry,
  buildSettingsLoadedWorkspaceSessionEntry,
  buildSettingsSkippedWorkspaceSessionEntry,
  type RouteWorkspace,
  type SettingsWorkspaceSessionEntry,
  mergeRouteWorkspaces,
} from "./settings-route-model";

export type SettingsWorkspaceSessionState = {
  serverList: Awaited<ReturnType<OnMyAgentServerClient["listWorkspaces"]>>;
  sessionEntries: SettingsWorkspaceSessionEntry[];
  workspaces: RouteWorkspace[];
};

export async function loadSettingsWorkspaceSessionState(input: {
  client: Pick<OnMyAgentServerClient, "listWorkspaces" | "listSessions">;
  desktopWorkspaces: RouteWorkspace[];
  diagnoseRemoteWorkspaceTaskLoadFailure: (
    workspace: RouteWorkspace,
    fallbackMessage: string,
  ) => Promise<WorkspaceConnectionState>;
  fallbackUnknownError: string;
  remoteConnectionFailedError: string;
}): Promise<SettingsWorkspaceSessionState> {
  const serverList = await input.client.listWorkspaces();
  const serverWorkspaceIds = new Set(serverList.items.map((workspace) => workspace.id));
  const workspaces = mergeRouteWorkspaces(serverList.items, input.desktopWorkspaces);
  const sessionEntries = await Promise.all(
    workspaces.map((workspace) =>
      loadSettingsWorkspaceSessionEntry({
        client: input.client,
        diagnoseRemoteWorkspaceTaskLoadFailure: input.diagnoseRemoteWorkspaceTaskLoadFailure,
        fallbackUnknownError: input.fallbackUnknownError,
        remoteConnectionFailedError: input.remoteConnectionFailedError,
        serverWorkspaceIds,
        workspace,
      }),
    ),
  );
  return { serverList, sessionEntries, workspaces };
}

export async function loadSettingsWorkspaceSessionEntry(input: {
  client: Pick<OnMyAgentServerClient, "listSessions">;
  diagnoseRemoteWorkspaceTaskLoadFailure: (
    workspace: RouteWorkspace,
    fallbackMessage: string,
  ) => Promise<WorkspaceConnectionState>;
  fallbackUnknownError: string;
  remoteConnectionFailedError: string;
  serverWorkspaceIds: Set<string>;
  workspace: RouteWorkspace;
}): Promise<SettingsWorkspaceSessionEntry> {
  if (!input.serverWorkspaceIds.has(input.workspace.id)) {
    return buildSettingsSkippedWorkspaceSessionEntry({ workspaceId: input.workspace.id });
  }

  try {
    const response = await input.client.listSessions(input.workspace.id, { limit: 200 });
    const workspaceRoot = normalizeDirectoryPath(input.workspace.path ?? "");
    const sessions = workspaceRoot
      ? (response.items ?? []).filter(
          (session) => normalizeDirectoryPath(session?.directory ?? "") === workspaceRoot,
        )
      : (response.items ?? []);
    return buildSettingsLoadedWorkspaceSessionEntry({
      workspaceId: input.workspace.id,
      sessions,
    });
  } catch (error) {
    const fallback = error instanceof Error ? error.message : input.fallbackUnknownError;
    if (input.workspace.workspaceType === "remote") {
      const connectionState = await input.diagnoseRemoteWorkspaceTaskLoadFailure(
        input.workspace,
        fallback,
      );
      return buildSettingsFailedWorkspaceSessionEntry({
        workspaceId: input.workspace.id,
        error: input.remoteConnectionFailedError,
        connectionState,
      });
    }
    return buildSettingsFailedWorkspaceSessionEntry({
      workspaceId: input.workspace.id,
      error: fallback,
    });
  }
}
