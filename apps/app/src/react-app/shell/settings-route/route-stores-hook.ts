/**
 * Settings-route domain stores + routeStateRef bridge.
 * Extracted from settings-route/render.tsx (mechanical split).
 */
import {
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { DesktopAppRestrictionChecker } from "../../../app/cloud/desktop-app-restrictions";
import type {
  OnMyAgentServerCapabilities,
  OnMyAgentServerClient,
} from "../../../app/lib/onmyagent-server";
import type {
  Client,
  ProviderListItem,
  ReloadReason,
  ReloadTrigger,
  WorkspaceDisplay,
} from "../../../app/types";
import { t } from "../../../i18n";
import {
  createConnectionsStore,
  createProviderAuthStore,
  useConnectionsStoreSnapshot,
  useProviderAuthStoreSnapshot,
} from "../../domains/connections";
import {
  createExtensionsStore,
  useExtensionsStoreSnapshot,
} from "../../domains/settings";
import {
  createOnMyAgentServerStore,
  useOnMyAgentServerStoreSnapshot,
} from "../../domains/shared";
import type { UserErrorScenario } from "../../kernel/user-error";
import {
  resolveOnMyAgentServerStartupPreference,
  restartLocalOnMyAgentServer,
} from "./server-actions";

export const ROUTE_ONMYAGENT_CAPABILITIES: OnMyAgentServerCapabilities = {
  skills: { read: true, write: true, source: "onmyagent" },
  plugins: { read: true, write: true },
  mcp: { read: true, write: true },
  commands: { read: true, write: true },
  config: { read: true, write: true },
};

export type SettingsRouteStateRef = {
  activeClient: Client | null;
  selectedWorkspaceId: string;
  selectedWorkspaceRoot: string;
  selectedWorkspaceType: "local" | "remote";
  runtimeWorkspaceId: string | null;
  onmyagentServerClient: OnMyAgentServerClient | null;
  onmyagentServerStatus: "connected" | "disconnected";
  onmyagentServerCapabilities: OnMyAgentServerCapabilities | null;
  selectedWorkspaceDisplay: WorkspaceDisplay;
  providerItems: ProviderListItem[];
  providerDefaults: Record<string, string>;
  providerConnectedIds: string[];
  disabledProviders: string[];
  developerMode: boolean;
};

export type SettingsRouteStoresInput = {
  emptyWorkspaceDisplay: WorkspaceDisplay;
  activeClient: Client | null;
  selectedWorkspaceId: string;
  selectedWorkspaceRoot: string;
  selectedWorkspaceType: "local" | "remote";
  /** Initial runtime id from selected workspace; host may overwrite with endpoint id. */
  runtimeWorkspaceId: string | null;
  selectedWorkspaceDisplay: WorkspaceDisplay;
  onmyagentClient: OnMyAgentServerClient | null;
  providers: ProviderListItem[];
  providerDefaults: Record<string, string>;
  providerConnectedIds: string[];
  disabledProviders: string[];
  developerMode: boolean;
  setActiveClient: Dispatch<SetStateAction<Client | null>>;
  setProviders: Dispatch<SetStateAction<ProviderListItem[]>>;
  setProviderDefaults: Dispatch<SetStateAction<Record<string, string>>>;
  setProviderConnectedIds: Dispatch<SetStateAction<string[]>>;
  setDisabledProviders: Dispatch<SetStateAction<string[]>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setBusyLabel: Dispatch<SetStateAction<string | null>>;
  setConfigActionStatus: Dispatch<SetStateAction<string | null>>;
  setFacingRouteError: (
    raw: string | null,
    forcedScenario?: UserErrorScenario,
  ) => void;
  checkDesktopRestriction: DesktopAppRestrictionChecker;
  markReloadRequired: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
};

/** Mechanical extract of settings-route store construction + lifecycle. */
export function useSettingsRouteStores(input: SettingsRouteStoresInput) {
  const {
    emptyWorkspaceDisplay,
    activeClient,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedWorkspaceType,
    runtimeWorkspaceId,
    selectedWorkspaceDisplay,
    onmyagentClient,
    providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviders,
    developerMode,
    setActiveClient,
    setProviders,
    setProviderDefaults,
    setProviderConnectedIds,
    setDisabledProviders,
    setBusy,
    setBusyLabel,
    setConfigActionStatus,
    setFacingRouteError,
    checkDesktopRestriction,
    markReloadRequired,
  } = input;

  const routeStateRef = useRef<SettingsRouteStateRef>({
    activeClient: null,
    selectedWorkspaceId: "",
    selectedWorkspaceRoot: "",
    selectedWorkspaceType: "local",
    runtimeWorkspaceId: null,
    onmyagentServerClient: null,
    onmyagentServerStatus: "disconnected",
    onmyagentServerCapabilities: null,
    selectedWorkspaceDisplay: emptyWorkspaceDisplay,
    providerItems: [],
    providerDefaults: {},
    providerConnectedIds: [],
    disabledProviders: [],
    developerMode: false,
  });

  routeStateRef.current = {
    activeClient,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedWorkspaceType,
    runtimeWorkspaceId,
    onmyagentServerClient: onmyagentClient,
    onmyagentServerStatus: onmyagentClient ? "connected" : "disconnected",
    onmyagentServerCapabilities: onmyagentClient ? ROUTE_ONMYAGENT_CAPABILITIES : null,
    selectedWorkspaceDisplay,
    providerItems: providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviders,
    developerMode,
  };

  const onmyagentServerStore = useMemo(
    () =>
      createOnMyAgentServerStore({
        startupPreference: resolveOnMyAgentServerStartupPreference,
        documentVisible: () =>
          typeof document === "undefined" || document.visibilityState === "visible",
        developerMode: () => routeStateRef.current.developerMode,
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        activeClient: () => routeStateRef.current.activeClient,
        selectedWorkspaceDisplay: () => routeStateRef.current.selectedWorkspaceDisplay,
        restartLocalServer: async () => {
          try {
            return await restartLocalOnMyAgentServer();
          } catch {
            return false;
          }
        },
        createRemoteWorkspaceFlow: async () => false,
      }),
    [],
  );

  const connectionsStore = useMemo(
    () =>
      createConnectionsStore({
        client: () => routeStateRef.current.activeClient,
        setClient: setActiveClient,
        projectDir: () => routeStateRef.current.selectedWorkspaceRoot,
        selectedWorkspaceId: () => routeStateRef.current.selectedWorkspaceId,
        selectedWorkspaceRoot: () => routeStateRef.current.selectedWorkspaceRoot,
        workspaceType: () => routeStateRef.current.selectedWorkspaceType,
        onmyagentServer: onmyagentServerStore,
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        developerMode: () => routeStateRef.current.developerMode,
        markReloadRequired,
      }),
    [markReloadRequired, onmyagentServerStore, setActiveClient],
  );

  const refreshMcpServersRef = useRef<(() => void | Promise<void>) | null>(null);
  const notifyMcpReloadingRef = useRef<(() => void) | null>(null);
  const pollMcpServersAfterReloadRef = useRef<(() => void | Promise<void>) | null>(null);
  refreshMcpServersRef.current = connectionsStore.refreshMcpServers;
  notifyMcpReloadingRef.current = connectionsStore.notifyMcpReloading;
  pollMcpServersAfterReloadRef.current = connectionsStore.pollMcpServersAfterReload;

  const providerAuthStore = useMemo(
    () =>
      createProviderAuthStore({
        client: () => routeStateRef.current.activeClient,
        providers: () => routeStateRef.current.providerItems,
        providerDefaults: () => routeStateRef.current.providerDefaults,
        providerConnectedIds: () => routeStateRef.current.providerConnectedIds,
        disabledProviders: () => routeStateRef.current.disabledProviders,
        checkDesktopAppRestriction: checkDesktopRestriction,
        selectedWorkspaceDisplay: () => routeStateRef.current.selectedWorkspaceDisplay,
        selectedWorkspaceRoot: () => routeStateRef.current.selectedWorkspaceRoot,
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        onmyagentServer: onmyagentServerStore,
        setProviders,
        setProviderDefaults,
        setProviderConnectedIds,
        setDisabledProviders,
        markOpencodeConfigReloadRequired: () => {
          setConfigActionStatus(t("settings.config_updated"));
          markReloadRequired("config", {
            type: "config",
            name: "opencode.json",
            action: "updated",
          });
        },
      }),
    [
      checkDesktopRestriction,
      markReloadRequired,
      onmyagentServerStore,
      setConfigActionStatus,
      setDisabledProviders,
      setProviderConnectedIds,
      setProviderDefaults,
      setProviders,
    ],
  );

  const extensionsStore = useMemo(
    () =>
      createExtensionsStore({
        client: () => routeStateRef.current.activeClient,
        projectDir: () => routeStateRef.current.selectedWorkspaceRoot,
        selectedWorkspaceId: () => routeStateRef.current.selectedWorkspaceId,
        selectedWorkspaceRoot: () => routeStateRef.current.selectedWorkspaceRoot,
        workspaceType: () => routeStateRef.current.selectedWorkspaceType,
        onmyagentServer: onmyagentServerStore,
        onmyagentServerConnection: () => ({
          onmyagentServerClient: routeStateRef.current.onmyagentServerClient,
          onmyagentServerStatus: routeStateRef.current.onmyagentServerStatus,
          onmyagentServerCapabilities: routeStateRef.current.onmyagentServerCapabilities,
        }),
        runtimeWorkspaceId: () => routeStateRef.current.runtimeWorkspaceId,
        setBusy,
        setBusyLabel,
        setBusyStartedAt: () => {},
        setError: setFacingRouteError,
        markReloadRequired,
      }),
    [
      markReloadRequired,
      onmyagentServerStore,
      setBusy,
      setBusyLabel,
      setFacingRouteError,
    ],
  );

  const onmyagentServerSnapshot = useOnMyAgentServerStoreSnapshot(onmyagentServerStore);
  const connectionsSnapshot = useConnectionsStoreSnapshot(connectionsStore);
  const providerAuthSnapshot = useProviderAuthStoreSnapshot(providerAuthStore);
  useExtensionsStoreSnapshot(extensionsStore);

  useEffect(() => {
    onmyagentServerStore.start();
    connectionsStore.start();
    providerAuthStore.start();
    extensionsStore.start();

    return () => {
      extensionsStore.dispose();
      providerAuthStore.dispose();
      connectionsStore.dispose();
      onmyagentServerStore.dispose();
    };
  }, [connectionsStore, extensionsStore, onmyagentServerStore, providerAuthStore]);

  useEffect(() => {
    onmyagentServerStore.syncFromOptions();
    connectionsStore.syncFromOptions();
    providerAuthStore.syncFromOptions();
    extensionsStore.syncFromOptions();
  }, [
    activeClient,
    connectionsStore,
    extensionsStore,
    onmyagentServerStore,
    providerAuthStore,
    selectedWorkspaceId,
    selectedWorkspaceType,
    selectedWorkspaceRoot,
  ]);

  return {
    routeStateRef: routeStateRef as MutableRefObject<SettingsRouteStateRef>,
    onmyagentServerStore,
    connectionsStore,
    providerAuthStore,
    extensionsStore,
    onmyagentServerSnapshot,
    connectionsSnapshot,
    providerAuthSnapshot,
    refreshMcpServersRef,
    notifyMcpReloadingRef,
    pollMcpServersAfterReloadRef,
  };
}
