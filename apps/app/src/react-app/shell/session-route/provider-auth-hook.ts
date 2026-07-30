/**
 * Session-route provider-auth store lifecycle.
 * Host owns option state; this hook wires bag → store → sync effects.
 */
import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";

import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import type { ResolvedWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import type { Client, ProviderListItem } from "../../../app/types";
import { useProviderAuthStoreSnapshot } from "../../domains/connections";
import type { RouteWorkspace } from "./model";
import {
  createEmptySessionProviderAuthState,
  createSessionRouteProviderAuthStore,
} from "./session-provider-auth";

type Input = {
  checkDesktopRestriction: DesktopAppRestrictionChecker;
  disabledProviderIds: string[];
  markOpencodeConfigReloadRequired: () => void;
  opencodeClient: Client | null;
  providerConnectedIds: string[];
  providerDefaults: Record<string, string>;
  providers: ProviderListItem[];
  selectedWorkspace: RouteWorkspace | null;
  selectedWorkspaceEndpoint: ResolvedWorkspaceEndpoint | null;
  selectedWorkspaceId: string;
  sessionWorkspaceRoot: string;
  setDisabledProviderIds: Dispatch<SetStateAction<string[]>>;
  setProviderConnectedIds: Dispatch<SetStateAction<string[]>>;
  setProviderDefaults: Dispatch<SetStateAction<Record<string, string>>>;
  setProviders: Dispatch<SetStateAction<ProviderListItem[]>>;
};

export function useSessionRouteProviderAuth(input: Input) {
  const {
    checkDesktopRestriction,
    disabledProviderIds,
    markOpencodeConfigReloadRequired,
    opencodeClient,
    providerConnectedIds,
    providerDefaults,
    providers,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
    sessionWorkspaceRoot,
    setDisabledProviderIds,
    setProviderConnectedIds,
    setProviderDefaults,
    setProviders,
  } = input;

  const stateRef = useRef(createEmptySessionProviderAuthState());
  stateRef.current = {
    opencodeClient,
    providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviderIds,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    selectedWorkspaceRoot: sessionWorkspaceRoot,
  };

  const store = useMemo(
    () =>
      createSessionRouteProviderAuthStore({
        stateRef,
        checkDesktopRestriction,
        setProviders,
        setProviderDefaults,
        setProviderConnectedIds,
        setDisabledProviderIds,
        markOpencodeConfigReloadRequired,
      }),
    [
      checkDesktopRestriction,
      markOpencodeConfigReloadRequired,
      setDisabledProviderIds,
      setProviderConnectedIds,
      setProviderDefaults,
      setProviders,
    ],
  );

  useEffect(() => {
    store.start();
    return () => {
      store.dispose();
    };
  }, [store]);

  useEffect(() => {
    if (!opencodeClient || !selectedWorkspaceId) return;

    void store
      .ensureProjectProviderDisabledState(
        "opencode",
        checkDesktopRestriction({ restriction: "allowZenModel" }),
      )
      .catch((error) => {
        console.warn(
          "[desktop-app-restrictions] failed to sync Zen restriction",
          error,
        );
      });
  }, [
    checkDesktopRestriction,
    disabledProviderIds,
    opencodeClient,
    selectedWorkspaceId,
    sessionWorkspaceRoot,
    store,
  ]);

  useEffect(() => {
    store.syncFromOptions();
  }, [
    opencodeClient,
    selectedWorkspace?.id,
    selectedWorkspace?.workspaceType,
    selectedWorkspaceEndpoint?.workspaceId,
    sessionWorkspaceRoot,
    store,
  ]);

  const snapshot = useProviderAuthStoreSnapshot(store);

  return {
    sessionProviderAuthStore: store,
    sessionProviderAuthSnapshot: snapshot,
  };
}
