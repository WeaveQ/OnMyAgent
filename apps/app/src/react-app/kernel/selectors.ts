import type { OnMyAgentStore } from "./store";

export const selectActiveWorkspace = (state: OnMyAgentStore) =>
  state.workspaces.find(
    (workspace) => workspace.id === state.activeWorkspaceId,
  ) ?? null;

export const selectServerStatus = (state: OnMyAgentStore) => state.server.status;

export const selectServerUrl = (state: OnMyAgentStore) => state.server.url;

export const selectErrorBanner = (state: OnMyAgentStore) => state.errorBanner;
