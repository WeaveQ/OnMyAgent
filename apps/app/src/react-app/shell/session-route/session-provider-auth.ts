/**
 * Session-route provider-auth store wiring.
 * Pure bag helpers + thin factory so render.tsx stays under the file-size baseline.
 */
import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import type { ResolvedWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import type {
  Client,
  ProviderListItem,
  WorkspaceDisplay,
} from "../../../app/types";
import { createProviderAuthStore } from "../../domains/connections";
import {
  emptyWorkspaceDisplay,
  workspaceLabel,
  type RouteWorkspace,
} from "./model";

export type SessionProviderAuthStateBag = {
  opencodeClient: Client | null;
  providers: ProviderListItem[];
  providerDefaults: Record<string, string>;
  providerConnectedIds: string[];
  disabledProviderIds: string[];
  selectedWorkspace: RouteWorkspace | null;
  selectedWorkspaceEndpoint: ResolvedWorkspaceEndpoint | null;
  selectedWorkspaceRoot: string;
};

export function createEmptySessionProviderAuthState(): SessionProviderAuthStateBag {
  return {
    opencodeClient: null,
    providers: [],
    providerDefaults: {},
    providerConnectedIds: [],
    disabledProviderIds: [],
    selectedWorkspace: null,
    selectedWorkspaceEndpoint: null,
    selectedWorkspaceRoot: "",
  };
}

/** Map the selected route workspace into the display shape provider-auth expects. */
export function sessionProviderAuthWorkspaceDisplay(
  workspace: RouteWorkspace | null | undefined,
): WorkspaceDisplay {
  if (!workspace) return emptyWorkspaceDisplay;
  return {
    ...workspace,
    name: workspaceLabel(workspace),
  } as WorkspaceDisplay;
}

const DISCONNECTED_ONMYAGENT_SNAPSHOT = Object.freeze({
  onmyagentServerStatus: "disconnected" as const,
  onmyagentServerClient: null,
  onmyagentServerCapabilities: null,
});

const CONNECTED_ONMYAGENT_CAPABILITIES = Object.freeze({
  config: Object.freeze({ read: true, write: true }),
});

let cachedConnectedSnapshot: {
  onmyagentServerStatus: "connected";
  onmyagentServerClient: ResolvedWorkspaceEndpoint["client"] | null;
  onmyagentServerCapabilities: typeof CONNECTED_ONMYAGENT_CAPABILITIES;
} | null = null;

/** Snapshot of the workspace OnMyAgent endpoint for provider-auth config IO. */
export function sessionProviderAuthOnMyAgentSnapshot(
  endpoint: ResolvedWorkspaceEndpoint | null | undefined,
) {
  if (!endpoint) return DISCONNECTED_ONMYAGENT_SNAPSHOT;
  const client = endpoint.client ?? null;
  if (
    cachedConnectedSnapshot &&
    cachedConnectedSnapshot.onmyagentServerClient === client
  ) {
    return cachedConnectedSnapshot;
  }
  cachedConnectedSnapshot = {
    onmyagentServerStatus: "connected",
    onmyagentServerClient: client,
    onmyagentServerCapabilities: CONNECTED_ONMYAGENT_CAPABILITIES,
  };
  return cachedConnectedSnapshot;
}

export function createSessionRouteProviderAuthStore(input: {
  stateRef: { current: SessionProviderAuthStateBag };
  checkDesktopRestriction: DesktopAppRestrictionChecker;
  setProviders: (value: ProviderListItem[]) => void;
  setProviderDefaults: (value: Record<string, string>) => void;
  setProviderConnectedIds: (value: string[]) => void;
  setDisabledProviderIds: (value: string[]) => void;
  markOpencodeConfigReloadRequired: () => void;
}) {
  const bag = () => input.stateRef.current;
  return createProviderAuthStore({
    client: () => bag().opencodeClient,
    providers: () => bag().providers,
    providerDefaults: () => bag().providerDefaults,
    providerConnectedIds: () => bag().providerConnectedIds,
    disabledProviders: () => bag().disabledProviderIds,
    checkDesktopAppRestriction: input.checkDesktopRestriction,
    selectedWorkspaceDisplay: () =>
      sessionProviderAuthWorkspaceDisplay(bag().selectedWorkspace),
    selectedWorkspaceRoot: () => bag().selectedWorkspaceRoot,
    opencodeBaseUrl: () => bag().selectedWorkspaceEndpoint?.opencodeBaseUrl ?? "",
    runtimeWorkspaceId: () => bag().selectedWorkspaceEndpoint?.workspaceId ?? null,
    onmyagentServer: {
      getSnapshot: () =>
        sessionProviderAuthOnMyAgentSnapshot(bag().selectedWorkspaceEndpoint),
    } as never,
    setProviders: input.setProviders,
    setProviderDefaults: input.setProviderDefaults,
    setProviderConnectedIds: input.setProviderConnectedIds,
    setDisabledProviders: input.setDisabledProviderIds,
    markOpencodeConfigReloadRequired: input.markOpencodeConfigReloadRequired,
  });
}
