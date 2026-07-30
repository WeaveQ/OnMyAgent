/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { createClient } from "../../../app/lib/opencode";
import {
  createOnMyAgentServerClient,
  type OnMyAgentServerCapabilities,
  type OnMyAgentServerClient,
} from "../../../app/lib/onmyagent-server";
import { resolveWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import { buildOnMyAgentEnvRuntimeKey } from "../../../app/lib/onmyagent-env-runtime";
import type {
  Client,
  ProviderListItem,
  SidebarSessionItem,
  WorkspaceConnectionState,
  WorkspaceDisplay,
  WorkspacePreset,
} from "../../../app/types";
import { getWorkspaceTaskLoadErrorDisplay, isSandboxWorkspace } from "../../../app/utils";
import { t } from "../../../i18n";
import { cn } from "@/lib/utils";
import { createConnectionsStore, useConnectionsStoreSnapshot } from "../../domains/connections";
import { createOnMyAgentServerStore, useOnMyAgentServerStoreSnapshot } from "../../domains/shared";
import { createProviderAuthStore, useProviderAuthStoreSnapshot } from "../../domains/connections";
import { ProviderAuthModal } from "../../domains/connections";
import { ConnectionsModals } from "../../domains/connections";
import type { AiSettingsConnectedProvider } from "../../domains/settings";
import { OpenCodeProviderConfigDialog } from "../../domains/session";
import {
  CloudSessionProvider,
  SettingsStack,
  useCloudSession,
  useDebugViewModel,
  useDenSession,
  useElectronUpdaterState,
  useMessagingViewProps,
  useRecoveryViewModel,
  createExtensionsStore,
  useExtensionsStoreSnapshot,
  SettingsShell,
  useAiProvidersController,
} from "../../domains/settings";
import { useBootState } from "../boot-state";
import { userErrorFromRaw } from "../../kernel/user-error";
import { useShellInteractiveLoad } from "../use-shell-interactive-load";
import { useFacingRouteError } from "./facing-route-error";
import {
  canDeleteOpenCodeProvider,
  canDisconnectProviderRow,
  canEditOpenCodeProvider,
} from "./provider-disconnect-policy";
import {
  deleteOpenCodeManagedProvider,
  disconnectSettingsProvider,
} from "./provider-list-actions";
import { buildOpenCodeProviderEditFallback } from "./open-code-provider-edit";
import { useSettingsProvidersPrewarm } from "./providers-prewarm-hook";
import { SettingsTabBody } from "./settings-tab-body";
import { SettingsRouteErrorSlot } from "./route-error-slot";
import {
  LazyAiSettingsView,
  LazyArchivedTasksView,
  LazyAuthorizedFoldersPanel,
  LazyCloudMarketplacesView,
  LazyCloudProvidersView,
  LazyConversationMemoryView,
  LazyDebugView,
  LazyRecoveryView,
  LazyEnvironmentView,
  LazyGeneralSettingsView,
  LazyMemoryView,
  LazyPreferencesView,
  LazySystemAuthorizationsView,
  LazyUpdatesView,
  LazyUsageView,
  SettingsAiTabSuspense,
  SettingsTabSuspense,
} from "./lazy-tab-views";
import { usePlatform } from "../../kernel/platform";
import { useLocal } from "../../kernel/local-provider";
import type { OnboardingProfile } from "../../kernel/local-provider";
import {
  onmyagentServerInfo,
  pickDirectory,
  resolveWorkspaceListSelectedId,
  type AgentManagementManagedProvider,
  type WorkspaceList,
} from "../../../app/lib/desktop";
import { readLocalAuthUser } from "../../../app/lib/local-auth";
import { isDesktopProviderBlocked } from "../../../app/cloud/desktop-app-restrictions";
import {
  useCheckDesktopRestriction,
  useDesktopConfig,
  useRestrictionNotice,
  useCloudProviderAutoSync,
} from "../../domains/cloud";
import {
  isDesktopRuntime,
  resolveModelDisplayName,
  resolveProviderDisplayName,
  safeStringify,
} from "../../../app/utils";
import { isProviderModelFree } from "../../../app/utils/providers";
import {
  CreateRemoteWorkspaceModal,
  CreateWorkspaceModal,
  RenameWorkspaceModal,
  diagnoseRemoteWorkspaceTaskLoadFailure,
  useRemoteWorkspaceConnectionEditor,
  useShareWorkspaceState,
} from "../../domains/workspace";
import { ShareWorkspaceModal } from "../../domains/workspace";
import { ModelPickerModal, workspaceSwatchColor } from "../../domains/session";
import type { ModelOption, ModelRef } from "../../../app/types";
import { recordInspectorEvent } from "../app-inspector";
import {
  aiProvidersStatusI18nKey,
  aiProvidersSummaryI18nKey,
  resolveAiProvidersUiPhase,
  describeRouteError,
  describeWorkspaceCreateError,
  buildSettingsRefreshErrorEvent,
  buildSettingsWorkspaceBootstrapErrorEvent,
  buildSettingsEnvironmentWorkspacePaths,
  buildSettingsWorkspaceOptions,
  buildWorkspaceConnectionStateById,
  formatDefaultModelLabel,
  formatDefaultModelRefLabel,
  isOnMyAgentCloudProvider,
  listActiveReloadBlockingSessions,
  mapDesktopWorkspace,
  parseSettingsPath,
  readHistoryIndexFromWindow,
  readNavigationPageMode,
  readNavigationReturnTo,
  readNavigationSessionId,
  readNavigationWorkspaceId,
  reconcileSelectedWorkspaceId,
  resolveSettingsReturnPath,
  shouldPreferHistoryBackFromSettings,
  resolveSettingsFallbackWorkspaceId,
  resolveSettingsPreferredWorkspaceId,
  settingsPathForRoute,
  buildSettingsSessionMaps,
  toSelectedWorkspaceDisplay,
  toSessionGroups,
  updateSettingsWorkspaceConnectionOverrides,
  workspaceLabel,
  type RouteWorkspace,
} from "./model";
import { loadSettingsWorkspaceSessionState } from "./sessions";
import {
  activateDesktopSettingsWorkspaceInBackground,
  applySettingsEnvironmentChangesAndRefresh,
  bootstrapDesktopSettingsWorkspaces,
  createLocalSettingsWorkspaceAndRefresh,
  createRemoteSettingsWorkspaceAndRefresh,
  forgetSettingsWorkspaceAndRefresh,
  pickAndExportSettingsWorkspaceConfig,
  renameSettingsWorkspaceAndRefresh,
  revealSettingsWorkspacePath,
} from "./workspace-actions";
import { ensureDesktopLocalOnMyAgentConnection } from "../desktop-local-onmyagent";
import { resolveOnMyAgentConnection } from "../onmyagent-connection";
import {
  useSettingsEmbeddedRedirect,
  useSettingsPathNavigator,
} from "./embedded-path";
import { useSettingsWorkspaceRefs } from "./refs";
import {
  reconnectOnMyAgentServerAndRefresh,
  resolveOnMyAgentServerStartupPreference,
  restartLocalOnMyAgentServer,
  restartOnMyAgentServerAndRefresh,
} from "./server-actions";
import {
  buildRemoteWorkspaceConnectingState,
  remoteWorkspaceConnectionCheckIsCurrent,
  resolveRemoteWorkspaceConnectionCheckTarget,
  runRemoteWorkspaceConnectionCheckTarget,
} from "./remote-workspace-actions";
import { abortSessionSafe } from "../../../app/lib/opencode-session";
import { useReloadCoordinator } from "../reload-coordinator";
import { getDenInferenceUrl } from "../../../app/lib/den";
import { readActiveWorkspaceId, writeActiveWorkspaceId } from "../session-memory";
import {
  readStoredBoolean,
  SETTINGS_DEVELOPER_MODE_KEY,
  SETTINGS_HIDE_TITLEBAR_KEY,
  SETTINGS_UPDATE_AUTO_CHECK_KEY,
  SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY,
  writeStoredBoolean,
} from "./storage";
import {
  workspaceAssistantRoute,
  workspaceSessionRoute,
  workspaceSettingsRoute,
} from "../workspace-routes";
import { getReactQueryClient } from "../../infra/query-client";
import {
  ensureProviderListQuery,
  getConnectedProviderItems,
  refreshProviderListQueries,
} from "../../domains/connections";
import { openModelPickerEvent, pendingModelPickerProviderIdsKey } from "../new-providers-toast";

const ROUTE_ONMYAGENT_CAPABILITIES: OnMyAgentServerCapabilities = {
  skills: { read: true, write: true, source: "onmyagent" },
  plugins: { read: true, write: true },
  mcp: { read: true, write: true },
  commands: { read: true, write: true },
  config: { read: true, write: true },
};

export type SettingsSurfaceProps = {
  embedded?: boolean;
  initialPath?: string;
  workspaceId?: string;
  onClose?: () => void;
};

function SettingsRouteContent(props: SettingsSurfaceProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ workspaceId?: string }>();
  const routeWorkspaceId = props.workspaceId?.trim() || params.workspaceId?.trim() || "";
  const local = useLocal();
  const platform = usePlatform();
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const restrictionNotice = useRestrictionNotice();
  const desktopConfig = useDesktopConfig();
  const reloadCoordinator = useReloadCoordinator();
  const [embeddedPath, setEmbeddedPath] = useState(props.initialPath ?? "general");
  const route = props.embedded ? parseSettingsPath(`/settings/${embeddedPath}`) : parseSettingsPath(location.pathname);
  const navigationWorkspaceId = readNavigationWorkspaceId(location.state);
  const navigationSessionId = readNavigationSessionId(location.state);
  const navigationPageMode = readNavigationPageMode(location.state);
  const navigationReturnTo = readNavigationReturnTo(location.state);

  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<RouteWorkspace[]>([]);
  const [sessionsByWorkspaceId, setSessionsByWorkspaceId] = useState<Record<string, SidebarSessionItem[]>>({});
  const [errorsByWorkspaceId, setErrorsByWorkspaceId] = useState<Record<string, string | null>>({});
  const [workspaceConnectionOverrides, setWorkspaceConnectionOverrides] = useState<Record<string, WorkspaceConnectionState>>({});
  const [legacySelectedWorkspaceId, setLegacySelectedWorkspaceId] = useState(() => navigationWorkspaceId ?? readActiveWorkspaceId() ?? "");
  const selectedWorkspaceId = routeWorkspaceId || legacySelectedWorkspaceId;
  useSettingsEmbeddedRedirect({
    embedded: props.embedded,
    redirectPath: route.redirectPath,
    setEmbeddedPath,
  });
  // Tab switches replace (do not stack) and keep returnTo/pageMode in state.
  const navigateWorkspaceSettingsPath = useCallback(
    (path: string) => {
      navigate(
        selectedWorkspaceId
          ? workspaceSettingsRoute(selectedWorkspaceId, path)
          : `/settings/${path}`,
        { replace: true, state: location.state },
      );
    },
    [location.state, navigate, selectedWorkspaceId],
  );
  const handleCloseSettings = useCallback(() => {
    if (props.onClose) {
      props.onClose();
      return;
    }
    // Prefer history.back: settings tabs replace, so -1 restores the exact
    // pre-settings shell entry (mode + session + ?view=).
    if (
      shouldPreferHistoryBackFromSettings({
        returnTo: navigationReturnTo,
        pageMode: navigationPageMode,
        sessionId: navigationSessionId,
        historyIndex: readHistoryIndexFromWindow(
          typeof window !== "undefined" ? window.history.state : null,
        ),
      })
    ) {
      navigate(-1);
      return;
    }
    navigate(
      resolveSettingsReturnPath({
        returnTo: navigationReturnTo,
        workspaceId: selectedWorkspaceId,
        sessionId: navigationSessionId,
        pageMode: navigationPageMode,
        workspaceAssistantRoute,
        workspaceSessionRoute,
      }),
      { replace: true },
    );
  }, [
    navigationPageMode,
    navigationReturnTo,
    navigationSessionId,
    navigate,
    props.onClose,
    selectedWorkspaceId,
  ]);
  const navigateSettingsPath = useSettingsPathNavigator({
    embedded: props.embedded,
    navigatePath: navigateWorkspaceSettingsPath,
    setEmbeddedPath,
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [onmyagentClient, setOnMyAgentClient] = useState<OnMyAgentServerClient | null>(null);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const {
    routeError,
    routeErrorAction,
    setFacingRouteError,
    clearFacingRouteError,
  } = useFacingRouteError();
  const { workspacesRef } = useSettingsWorkspaceRefs(workspaces);
  const refreshInFlightRef = useRef(false);
  const reconnectAttemptedWorkspaceIdRef = useRef("");
  const refreshMcpServersRef = useRef<(() => void | Promise<void>) | null>(null);
  const notifyMcpReloadingRef = useRef<(() => void) | null>(null);
  const pollMcpServersAfterReloadRef = useRef<(() => void | Promise<void>) | null>(null);
  const remoteWorkspaceCheckRunRef = useRef<Record<string, string>>({});
  const remoteWorkspaceCheckRunCounterRef = useRef(0);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providerDefaults, setProviderDefaults] = useState<Record<string, string>>({});
  const [providerConnectedIds, setProviderConnectedIds] = useState<string[]>([]);
  const [openCodeProviderConfigOpen, setOpenCodeProviderConfigOpen] = useState(false);
  const [editingOpenCodeProvider, setEditingOpenCodeProvider] =
    useState<AgentManagementManagedProvider | null>(null);
  const [providerActionBusyId, setProviderActionBusyId] = useState<string | null>(null);
  /** True while post-save/delete apply + catalog refresh is in flight. */
  const [providerSyncBusy, setProviderSyncBusy] = useState(false);
  /** Error message for AI provider save/delete only (not success banners). */
  const [providerActionError, setProviderActionError] = useState<string | null>(null);
  const [disabledProviders, setDisabledProviders] = useState<string[]>([]);
  const [developerMode, setDeveloperMode] = useState(() => readStoredBoolean(SETTINGS_DEVELOPER_MODE_KEY, false));
  const [hideTitlebar, setHideTitlebar] = useState(() => readStoredBoolean(SETTINGS_HIDE_TITLEBAR_KEY, false));
  const [updateAutoCheck, setUpdateAutoCheck] = useState(() =>
    readStoredBoolean(SETTINGS_UPDATE_AUTO_CHECK_KEY, false),
  );
  const [updateAutoDownload, setUpdateAutoDownload] = useState(() =>
    readStoredBoolean(SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY, false),
  );
  const [configActionStatus, setConfigActionStatus] = useState<string | null>(null);
  const [revealConfigBusy, setRevealConfigBusy] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [createWorkspaceBusy, setCreateWorkspaceBusy] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const [createWorkspaceRemoteBusy, setCreateWorkspaceRemoteBusy] = useState(false);
  const [createWorkspaceRemoteError, setCreateWorkspaceRemoteError] = useState<string | null>(null);
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(null);
  const [renameWorkspaceTitle, setRenameWorkspaceTitle] = useState("");
  const [renameWorkspaceBusy, setRenameWorkspaceBusy] = useState(false);
  const [exportWorkspaceBusy, setExportWorkspaceBusy] = useState(false);
  const [autoCompactContext, setAutoCompactContext] = useState(true);
  const [autoCompactContextBusy, setAutoCompactContextBusy] = useState(false);
  const [autoCompactContextLoaded, setAutoCompactContextLoaded] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  // initialTab removed — model picker no longer has tabs
  const [modelPickerQuery, setModelPickerQuery] = useState("");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [memoryDraft, setMemoryDraft] = useState<OnboardingProfile | null>(() =>
    local.prefs.onboardingProfile,
  );
  const [conversationMemoryDraft, setConversationMemoryDraft] = useState(
    () => local.prefs.conversationMemory,
  );

  useEffect(() => {
    setMemoryDraft(local.prefs.onboardingProfile);
  }, [local.prefs.onboardingProfile]);

  useEffect(() => {
    setConversationMemoryDraft(local.prefs.conversationMemory);
  }, [local.prefs.conversationMemory]);

  // 偏好: tone / custom instructions / profile all auto-persist (no page Save).
  const persistMemoryDraft = useCallback(
    (draft: OnboardingProfile) => {
      setMemoryDraft(draft);
      local.setPrefs((previous) => ({
        ...previous,
        onboardingProfile: { ...draft, updatedAt: Date.now() },
      }));
    },
    [local],
  );

  const persistConversationMemory = useCallback(
    (next: typeof conversationMemoryDraft) => {
      setConversationMemoryDraft(next);
      local.setPrefs((previous) => ({
        ...previous,
        conversationMemory: next,
      }));
    },
    [local],
  );

  const emptyWorkspaceDisplay = useMemo<WorkspaceDisplay>(
    () => ({
      id: "",
      name: t("session.workspace_fallback"),
      path: "",
      preset: "starter",
      workspaceType: "local",
    }),
    [],
  );

  const routeStateRef = useRef({
    activeClient: null as Client | null,
    selectedWorkspaceId: "",
    selectedWorkspaceRoot: "",
    selectedWorkspaceType: "local" as "local" | "remote",
    runtimeWorkspaceId: null as string | null,
    onmyagentServerClient: null as OnMyAgentServerClient | null,
    onmyagentServerStatus: "disconnected" as "connected" | "disconnected",
    onmyagentServerCapabilities: null as OnMyAgentServerCapabilities | null,
    selectedWorkspaceDisplay: emptyWorkspaceDisplay as WorkspaceDisplay,
    providerItems: [] as ProviderListItem[],
    providerDefaults: {} as Record<string, string>,
    providerConnectedIds: [] as string[],
    disabledProviders: [] as string[],
    developerMode: false,
  });

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? (selectedWorkspaceId ? null : workspaces[0] ?? null),
    [selectedWorkspaceId, workspaces],
  );
  const workspaceConnectionStateById = useMemo(
    () =>
      buildWorkspaceConnectionStateById({
        workspaces,
        errorsByWorkspaceId,
        workspaceConnectionOverrides,
        errorMessageFor: (workspace, error) =>
          getWorkspaceTaskLoadErrorDisplay(workspace, error).message || error,
      }),
    [errorsByWorkspaceId, workspaceConnectionOverrides, workspaces],
  );
  const selectedWorkspaceRoot = selectedWorkspace?.path?.trim() || "";
  const selectedWorkspaceDisplay = useMemo<WorkspaceDisplay>(
    () =>
      toSelectedWorkspaceDisplay({
        selectedWorkspace,
        empty: emptyWorkspaceDisplay,
      }),
    [emptyWorkspaceDisplay, selectedWorkspace],
  );

  routeStateRef.current = {
    activeClient,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedWorkspaceType: selectedWorkspace?.workspaceType ?? "local",
    runtimeWorkspaceId: selectedWorkspace?.id ?? null,
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

  const activeReloadBlockingSessions = useMemo(
    () =>
      listActiveReloadBlockingSessions(
        sessionsByWorkspaceId,
        t("session.untitled"),
      ),
    [sessionsByWorkspaceId],
  );

  const onmyagentServerStore = useMemo(
    () =>
      createOnMyAgentServerStore({
        startupPreference: resolveOnMyAgentServerStartupPreference,
        documentVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
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
        markReloadRequired: reloadCoordinator.markReloadRequired,
      }),
    [onmyagentServerStore, reloadCoordinator.markReloadRequired],
  );
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
          reloadCoordinator.markReloadRequired("config", {
            type: "config",
            name: "opencode.json",
            action: "updated",
          });
        },
      }),
    [checkDesktopRestriction, onmyagentServerStore, reloadCoordinator.markReloadRequired],
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
        markReloadRequired: reloadCoordinator.markReloadRequired,
      }),
    [onmyagentServerStore, reloadCoordinator.markReloadRequired],
  );
  const onmyagentServerSnapshot = useOnMyAgentServerStoreSnapshot(onmyagentServerStore);
  const connectionsSnapshot = useConnectionsStoreSnapshot(connectionsStore);
  const providerAuthSnapshot = useProviderAuthStoreSnapshot(providerAuthStore);
  useExtensionsStoreSnapshot(extensionsStore);

  const denSession = useDenSession({
    developerMode,
    openLink: (url) => platform.openLink(url),
  });
  const cloudSession = useCloudSession();

  const hasOnMyAgentCloudProvider = useMemo(
    () =>
      providerAuthSnapshot.cloudOrgProviders.some(isOnMyAgentCloudProvider) ||
      Object.values(providerAuthSnapshot.importedCloudProviders ?? {}).some(isOnMyAgentCloudProvider),
    [providerAuthSnapshot.cloudOrgProviders, providerAuthSnapshot.importedCloudProviders],
  );
  const showOnMyAgentModelsSubscribe = false;

  const subscribeToOnMyAgentModels = useCallback(() => {
    providerAuthStore.closeProviderAuthModal();
    const accountPath = selectedWorkspaceId
      ? workspaceSettingsRoute(selectedWorkspaceId, "ai")
      : "/settings/ai";
    navigate(accountPath);
    window.setTimeout(() => {
      platform.openLink(getDenInferenceUrl(cloudSession.baseUrl));
    }, 0);
  }, [cloudSession.baseUrl, navigate, platform, providerAuthStore, selectedWorkspaceId]);

  const handleOpenCustomProviderConfig = useCallback(() => {
    setConfigActionStatus(null);
    setEditingOpenCodeProvider(null);
    setOpenCodeProviderConfigOpen(true);
  }, []);

  const handleOpenProviderAuth = useCallback(() => {
    if (checkDesktopRestriction({ restriction: "allowCustomProviders" })) {
      restrictionNotice.show({
        title: t("workspace_list.custom_providers_restricted_title"),
        message: t("workspace_list.custom_providers_restricted_message"),
      });
      return;
    }
    // Official provider list requires a live OpenCode client; avoid a red
    // "load failed / not connected" flash when the runtime is down.
    if (!routeStateRef.current.activeClient) {
      setProviderActionError(t("settings.connect_provider_runtime_required_short"));
      return;
    }
    setProviderActionError(null);
    void providerAuthStore.openProviderAuthModal();
  }, [checkDesktopRestriction, providerAuthStore, restrictionNotice]);

  useEffect(() => {
    if (!activeClient || !selectedWorkspaceId) return;
    // Org policy: only force-disable Zen when blocked. When allowed, do not
    // re-enable it — users may have disconnected free OpenCode Zen themselves.
    const zenBlocked = checkDesktopRestriction({ restriction: "allowZenModel" });
    if (!zenBlocked) return;

    void providerAuthStore
      .ensureProjectProviderDisabledState("opencode", true)
      .catch((error) => {
        console.warn("[desktop-app-restrictions] failed to sync Zen restriction", error);
      });
  }, [activeClient, checkDesktopRestriction, disabledProviders, providerAuthStore, selectedWorkspaceId, selectedWorkspaceRoot]);

  const shareWorkspaceState = useShareWorkspaceState({
    workspaces,
    onmyagentServerHostInfo: onmyagentServerSnapshot.onmyagentServerHostInfo,
    onmyagentServerSettings: onmyagentServerSnapshot.onmyagentServerSettings,
    engineInfo: null,
    exportWorkspaceBusy,
    openLink: (url) => platform.openLink(url),
    workspaceLabel,
  });

  const debugViewProps = useDebugViewModel({
    developerMode,
    onmyagentServerStore,
    onmyagentServerSnapshot,
    runtimeWorkspaceId: selectedWorkspace?.id ?? null,
    selectedWorkspaceRoot,
    setRouteError: setFacingRouteError,
  });
  const recoveryViewProps = useRecoveryViewModel({
    anyActiveRuns: activeReloadBlockingSessions.length > 0,
    setRouteError: setFacingRouteError,
  });
  const onReleaseChannelChange = useCallback(
    (next: "stable" | "alpha") => {
      local.setPrefs((previous) => ({ ...previous, releaseChannel: next }));
    },
    [local],
  );
  const electronUpdaterState = useElectronUpdaterState({
    releaseChannel: local.prefs.releaseChannel ?? "stable",
    onReleaseChannelChange,
    updateAutoCheck,
    updateAutoDownload,
    desktopConfig: desktopConfig.config,
    setError: setFacingRouteError,
  });

  const workspaceSessionGroups = useMemo(
    () => toSessionGroups(workspaces, sessionsByWorkspaceId, errorsByWorkspaceId),
    [errorsByWorkspaceId, sessionsByWorkspaceId, workspaces],
  );

  const selectedWorkspaceEndpoint = useMemo(
    () => resolveWorkspaceEndpoint(selectedWorkspace, { baseUrl, token }),
    [baseUrl, selectedWorkspace, token],
  );
  const opencodeBaseUrl = selectedWorkspaceEndpoint?.opencodeBaseUrl ?? "";
  const runtimeWorkspaceId = selectedWorkspaceEndpoint?.workspaceId ?? selectedWorkspace?.id ?? null;
  routeStateRef.current.runtimeWorkspaceId = runtimeWorkspaceId;

  const opencodeClient = useMemo(() => {
    if (!selectedWorkspaceEndpoint || !selectedWorkspaceEndpoint.token) return null;
    return createClient(
      selectedWorkspaceEndpoint.opencodeBaseUrl,
      selectedWorkspaceRoot || undefined,
      {
        token: selectedWorkspaceEndpoint.token,
        mode: "onmyagent",
      },
    );
  }, [selectedWorkspaceEndpoint, selectedWorkspaceRoot]);

  useEffect(() => {
    setActiveClient(opencodeClient);
    // Clear connect-time errors once the workspace runtime is available again.
    if (opencodeClient) setProviderActionError(null);
  }, [opencodeClient]);

  useSettingsProvidersPrewarm({
    opencodeClient,
    opencodeBaseUrl,
    selectedWorkspaceRoot,
  });

  useEffect(() => {
    const openFromPending = (raw: string | null) => {
      if (!raw) return false;
      setModelPickerQuery("");
      setModelPickerOpen(true);
      return true;
    };

    try {
      const raw = window.localStorage.getItem(pendingModelPickerProviderIdsKey);
      if (openFromPending(raw)) {
        window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
      }
    } catch {
      window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
    }

    const handler = () => {
      setModelPickerQuery("");
      setModelPickerOpen(true);
      try {
        window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
      } catch {}
    };
    window.addEventListener(openModelPickerEvent, handler);
    return () => window.removeEventListener(openModelPickerEvent, handler);
  }, []);

  useEffect(() => {
    if (!modelPickerOpen || !opencodeClient) return;
    let cancelled = false;
    void providerAuthStore.refreshProviders();
    void (async () => {
      try {
        const data = await ensureProviderListQuery(getReactQueryClient(), {
          client: opencodeClient,
          baseUrl: opencodeBaseUrl,
          directory: selectedWorkspaceRoot || undefined,
        });
        if (cancelled || !data?.all) return;
        let seenIds: Set<string>;
        try {
          const raw = window.localStorage.getItem("onmyagent.seenProviderIds");
          seenIds = new Set(raw ? JSON.parse(raw) : []);
        } catch {
          seenIds = new Set();
        }
        const options: ModelOption[] = [];
        for (const provider of getConnectedProviderItems(data)) {
          const modelIds = Object.keys(provider.models);
          const isNew = !seenIds.has(provider.id);
          for (const id of modelIds) {
            const model = provider.models[id];
            options.push({
              providerID: provider.id,
              modelID: id,
              title: model.name || id,
              description: provider.name,
              behaviorTitle: t("settings.model_reasoning"),
              behaviorLabel: t("settings.default_label"),
              behaviorDescription: "",
              behaviorValue: null,
              isFree: isProviderModelFree({
                providerId: provider.id,
                modelId: id,
                model,
              }),
              isConnected: true,
              isRecommended: isNew,
              source: /^lpr_/i.test(provider.id) ? "cloud" as const : undefined,
            });
          }
        }
        setModelOptions(options);
      } catch (error) {
        setFacingRouteError(
          error instanceof Error ? error.message : t("app.unknown_error"),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    modelPickerOpen,
    opencodeBaseUrl,
    opencodeClient,
    selectedWorkspaceRoot,
    setFacingRouteError,
  ]);

  useEffect(() => {
    local.setUi((previous) => ({ ...previous, view: "settings", tab: route.tab }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- local is stable via context
  }, [route.tab]);

  useEffect(() => {
    writeStoredBoolean(SETTINGS_HIDE_TITLEBAR_KEY, hideTitlebar);
  }, [hideTitlebar]);

  useEffect(() => {
    writeStoredBoolean(SETTINGS_UPDATE_AUTO_CHECK_KEY, updateAutoCheck);
  }, [updateAutoCheck]);

  useEffect(() => {
    writeStoredBoolean(SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY, updateAutoDownload);
  }, [updateAutoDownload]);

  const { markRouteReady: markBootRouteReady } = useBootState();
  const { shellInteractive } = useShellInteractiveLoad({
    loading,
    firstLoadScope: "route-settings",
  });
  const refreshRouteState = useMemo(() => async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    clearFacingRouteError();
    let desktopList: WorkspaceList | null = null;
    let desktopWorkspaces = workspacesRef.current;
    try {
      try {
        desktopList = await bootstrapDesktopSettingsWorkspaces();
        if (desktopList) {
          desktopWorkspaces = (desktopList.workspaces ?? []).map(mapDesktopWorkspace);
        }
      } catch (error) {
        const bootstrapError = buildSettingsWorkspaceBootstrapErrorEvent({
          error,
          preservedWorkspaceCount: workspacesRef.current.length,
        });
        console.error("[settings-route] workspaceBootstrap failed", error);
        recordInspectorEvent("route.workspace_bootstrap.error", bootstrapError);
        desktopWorkspaces = workspacesRef.current;
      }
      const { normalizedBaseUrl, resolvedToken, resolvedHostToken } = await resolveOnMyAgentConnection();

      if (!normalizedBaseUrl || !resolvedToken) {
        setOnMyAgentClient(null);
        setBaseUrl("");
        setToken("");
        setWorkspaces(desktopWorkspaces);
        setSessionsByWorkspaceId({});
        setErrorsByWorkspaceId({});
        setLegacySelectedWorkspaceId((current) => {
          const next = resolveSettingsFallbackWorkspaceId({
            currentWorkspaceId: current,
            persistedWorkspaceId: readActiveWorkspaceId() || "",
            desktopSelectedId: resolveWorkspaceListSelectedId(desktopList),
            workspaces: desktopWorkspaces,
          });
          writeActiveWorkspaceId(next || null);
          return next;
        });
        return;
      }

      const client = createOnMyAgentServerClient({
        baseUrl: normalizedBaseUrl,
        token: resolvedToken,
        hostToken: resolvedHostToken || undefined,
      });
      const {
        serverList,
        sessionEntries,
        workspaces: nextWorkspaces,
      } = await loadSettingsWorkspaceSessionState({
        client,
        desktopWorkspaces,
        diagnoseRemoteWorkspaceTaskLoadFailure,
        fallbackUnknownError: t("app.unknown_error"),
        remoteConnectionFailedError: t("app.error_remote_worker_connection_failed"),
      });

      setOnMyAgentClient(client);
      setBaseUrl(normalizedBaseUrl);
      setToken(resolvedToken);
      setWorkspaces(nextWorkspaces);
      const sessionMaps = buildSettingsSessionMaps(sessionEntries);
      setSessionsByWorkspaceId(sessionMaps.sessionsByWorkspaceId);
      setErrorsByWorkspaceId(sessionMaps.errorsByWorkspaceId);
      setWorkspaceConnectionOverrides((current) =>
        updateSettingsWorkspaceConnectionOverrides({ current, entries: sessionEntries }),
      );
      setLegacySelectedWorkspaceId((current) => {
        const preferred = resolveSettingsPreferredWorkspaceId({
          routeWorkspaceId,
          navigationSessionId,
          navigationWorkspaceId,
          currentWorkspaceId: current,
          persistedWorkspaceId: readActiveWorkspaceId() || "",
          sessionEntries,
        });
        const next = reconcileSelectedWorkspaceId(preferred, serverList, desktopList, nextWorkspaces);
        writeActiveWorkspaceId(next || null);
        return next;
      });
    } catch (error) {
      const message = describeRouteError(error);
      console.error("[settings-route] refreshRouteState failed", error);
      recordInspectorEvent(
        "route.refresh.error",
        buildSettingsRefreshErrorEvent({
          message,
          preservedWorkspaceCount: desktopWorkspaces.length,
        }),
      );
      setFacingRouteError(message);
      if (desktopWorkspaces.length > 0) {
        setWorkspaces(desktopWorkspaces);
        setLegacySelectedWorkspaceId((current) => {
          const next = resolveSettingsFallbackWorkspaceId({
            currentWorkspaceId: current,
            persistedWorkspaceId: readActiveWorkspaceId() || "",
            desktopSelectedId: resolveWorkspaceListSelectedId(desktopList),
            workspaces: desktopWorkspaces,
          });
          writeActiveWorkspaceId(next || null);
          return next;
        });
      }
    } finally {
      setLoading(false);
      refreshInFlightRef.current = false;
      // Settings can be the first route a user lands on (direct link, deep
      // link, or after reload). Let the boot overlay dismiss once we've
      // completed our first data load.
      markBootRouteReady();
    }
  }, [markBootRouteReady, navigationSessionId, navigationWorkspaceId, routeWorkspaceId]);

  useEffect(() => {
    const activeWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    setWorkspaceConnectionOverrides((current) => {
      let changed = false;
      const next: Record<string, WorkspaceConnectionState> = {};
      for (const [workspaceId, state] of Object.entries(current)) {
        if (activeWorkspaceIds.has(workspaceId)) {
          next[workspaceId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [workspaces]);

  const handleRemoteWorkspaceConnectionSaved = useCallback(
    async (workspaceId: string) => {
      delete remoteWorkspaceCheckRunRef.current[workspaceId];
      setWorkspaceConnectionOverrides((current) => {
        const next = { ...current };
        delete next[workspaceId];
        return next;
      });
      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: null }));
      await refreshRouteState();
    },
    [refreshRouteState],
  );

  const remoteWorkspaceConnectionEditor = useRemoteWorkspaceConnectionEditor({
    workspaces,
    onSaved: handleRemoteWorkspaceConnectionSaved,
  });

  const runRemoteWorkspaceConnectionCheck = useCallback(
    async (workspaceId: string, mode: "test" | "recover") => {
      remoteWorkspaceCheckRunCounterRef.current += 1;
      const runId = String(remoteWorkspaceCheckRunCounterRef.current);
      const target = resolveRemoteWorkspaceConnectionCheckTarget({
        runId,
        workspaceId,
        workspaces: workspacesRef.current,
      });
      if (!target) return false;
      remoteWorkspaceCheckRunRef.current[workspaceId] = runId;

      setWorkspaceConnectionOverrides((current) => ({
        ...current,
        [workspaceId]: buildRemoteWorkspaceConnectingState(),
      }));

      const check = await runRemoteWorkspaceConnectionCheckTarget(target);
      if (!check) return false;
      const currentWorkspace = workspacesRef.current.find((item) => item.id === workspaceId);
      if (!remoteWorkspaceConnectionCheckIsCurrent({
        activeRunId: remoteWorkspaceCheckRunRef.current[workspaceId],
        check,
        currentWorkspace,
      })) {
        if (remoteWorkspaceCheckRunRef.current[workspaceId] === check.runId) {
          delete remoteWorkspaceCheckRunRef.current[workspaceId];
        }
        return false;
      }
      setWorkspaceConnectionOverrides((current) => ({
        ...current,
        [workspaceId]: check.result.state,
      }));

      if (!check.result.ok) {
        setErrorsByWorkspaceId((current) => ({
          ...current,
          [workspaceId]: check.result.state.message ?? t("app.error_remote_worker_connection_failed"),
        }));
        if (remoteWorkspaceCheckRunRef.current[workspaceId] === check.runId) {
          delete remoteWorkspaceCheckRunRef.current[workspaceId];
        }
        return false;
      }

      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: null }));
      if (mode === "recover") {
        await refreshRouteState();
      }
      if (remoteWorkspaceCheckRunRef.current[workspaceId] === check.runId) {
        delete remoteWorkspaceCheckRunRef.current[workspaceId];
      }
      return true;
    },
    [refreshRouteState],
  );

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (loading) return;
    if (onmyagentClient) {
      reconnectAttemptedWorkspaceIdRef.current = "";
      return;
    }
    if (!selectedWorkspace || selectedWorkspace.workspaceType !== "local") return;
    const workspaceId = selectedWorkspace.id?.trim() ?? "";
    if (!workspaceId || reconnectAttemptedWorkspaceIdRef.current === workspaceId) return;
    reconnectAttemptedWorkspaceIdRef.current = workspaceId;

    void ensureDesktopLocalOnMyAgentConnection({
      route: "settings",
      workspace: selectedWorkspace,
      allWorkspaces: workspaces,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : describeRouteError(error);
      setFacingRouteError(message);
    });
  }, [loading, onmyagentClient, selectedWorkspace, setFacingRouteError, workspaces]);

  useEffect(() => {
    void refreshRouteState();
    const handleSettingsChange = () => {
      void refreshRouteState();
    };
    window.addEventListener("onmyagent-server-settings-changed", handleSettingsChange);
    return () => {
      window.removeEventListener("onmyagent-server-settings-changed", handleSettingsChange);
    };
  }, [refreshRouteState]);

  // Load auto-compaction state from OpenCode config on workspace change.
  useEffect(() => {
    if (!onmyagentClient || !selectedWorkspaceId) return;
    const workspaceId = routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId;
    let cancelled = false;
    (async () => {
      try {
        const config = await onmyagentClient.getConfig(workspaceId);
        if (cancelled) return;
        const compaction = config.opencode?.compaction;
        const auto = compaction && typeof compaction === "object" && "auto" in compaction
          ? (compaction as { auto?: boolean }).auto
          : undefined;
        setAutoCompactContext(auto !== false);
        setAutoCompactContextLoaded(true);
      } catch {
        if (!cancelled) setAutoCompactContextLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [onmyagentClient, selectedWorkspaceId]);

  const toggleAutoCompactContext = useCallback(async () => {
    if (autoCompactContextBusy) return;
    const workspaceId = routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId;
    if (!onmyagentClient || !workspaceId) return;
    const next = !autoCompactContext;
    setAutoCompactContext(next);
    setAutoCompactContextBusy(true);
    try {
      await onmyagentClient.patchConfig(workspaceId, {
        opencode: { compaction: { auto: next } },
      });
      reloadCoordinator.markReloadRequired("config", {
        type: "config",
        name: "opencode.json",
        action: "updated",
      });
    } catch {
      setAutoCompactContext(!next);
    } finally {
      setAutoCompactContextBusy(false);
    }
  }, [autoCompactContext, autoCompactContextBusy, onmyagentClient, reloadCoordinator, selectedWorkspaceId]);

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

  // Periodically reconcile workspace-imported cloud providers from Den while
  // signed in (dev #1509 "auto-sync cloud providers"). Mounted here because
  // the settings route owns the provider-auth store.
  useCloudProviderAutoSync(providerAuthStore.runCloudProviderSync);

  useEffect(() => {
    if (route.tab !== "cloud-providers") return;
    void providerAuthStore.runCloudProviderSync("settings_cloud_opened");
  }, [providerAuthStore, route.tab]);

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
    selectedWorkspace?.id,
    selectedWorkspace?.workspaceType,
    selectedWorkspaceRoot,
  ]);

  const isProviderBlocked = useCallback(
    (providerId: string) =>
      isDesktopProviderBlocked({
        providerId,
        checkRestriction: checkDesktopRestriction,
      }),
    [checkDesktopRestriction],
  );

  const aiProviders = useAiProvidersController({
    activeClient: Boolean(activeClient),
    selectedWorkspaceRoot,
    selectedWorkspaceId: selectedWorkspace?.id,
    sdkProviders: providers,
    connectedIds: providerConnectedIds,
    isBlocked: isProviderBlocked,
    refreshSdkProviders: () => providerAuthStore.refreshProviders(),
    refreshMcpServers: () => {
      void connectionsStore.refreshMcpServers();
    },
  });

  const {
    connectedProviders,
    providerListHydrated,
    opencodeInventoryReady,
    opencodeManagedProviders,
    setOpenCodeManagedProviders,
    providersDiscovering,
    inventorySyncing,
    loadOpenCodeManagedProviders,
    findManagedProvider,
  } = aiProviders;

  useEffect(() => {
    if (!activeClient) {
      setProviders([]);
      setProviderDefaults({});
      setProviderConnectedIds([]);
      setDisabledProviders([]);
    }
  }, [activeClient]);

  const handleEditOpenCodeProvider = useCallback(
    (provider: AiSettingsConnectedProvider) => {
      if (!canEditOpenCodeProvider(provider)) return;
      setProviderActionError(null);
      const fallback = buildOpenCodeProviderEditFallback(provider, providers);
      // Prefer in-memory inventory for instant open. After save, inventory is
      // updated from the save response (opencodeProviders), so re-edit is fresh
      // without awaiting IPC. Background refresh only updates the list for later.
      const cached = findManagedProvider(provider.id);

      if (cached) {
        setEditingOpenCodeProvider(cached);
        setOpenCodeProviderConfigOpen(true);
        void loadOpenCodeManagedProviders().then((next) => {
          setOpenCodeManagedProviders(next);
        });
        return;
      }

      // Cold path: inventory not ready yet, or config-only install (no DB row).
      if (providerActionBusyId) return;
      setProviderActionBusyId(provider.id);
      void loadOpenCodeManagedProviders()
        .then((next) => {
          setOpenCodeManagedProviders(next);
          setEditingOpenCodeProvider(
            next.find((item) => item.id === provider.id) ?? fallback,
          );
          setOpenCodeProviderConfigOpen(true);
        })
        .catch(() => {
          setEditingOpenCodeProvider(fallback);
          setOpenCodeProviderConfigOpen(true);
        })
        .finally(() => {
          setProviderActionBusyId(null);
        });
    },
    [
      findManagedProvider,
      loadOpenCodeManagedProviders,
      providerActionBusyId,
      providers,
      setOpenCodeManagedProviders,
    ],
  );

  const selectedWorkspaceName = selectedWorkspace?.displayNameResolved ?? t("session.workspace_fallback");
  const workspaceOptions = buildSettingsWorkspaceOptions(workspaces, workspaceSwatchColor);
  const selectedWorkspaceColor = workspaceSwatchColor(selectedWorkspaceId);
  const workspaceType = selectedWorkspace?.workspaceType ?? "local";
  const isRemoteWorkspace = workspaceType === "remote";
  const defaultModelLabel = formatDefaultModelLabel({
    defaultModel: local.prefs.defaultModel,
    providers,
    resolveProviderDisplayName,
    resolveModelDisplayName,
    fallback: t("session.default_model"),
  });
  const defaultModelRef = formatDefaultModelRefLabel({
    defaultModel: local.prefs.defaultModel,
    fallback: t("settings.default_label"),
  });
  const defaultModelVariantLabel = local.prefs.modelVariant ?? t("settings.default_label");
  // Inventory merges in the background so first paint is not blocked on desktop IPC.
  const providersUiPhase = resolveAiProvidersUiPhase({
    discovering: providersDiscovering,
    providerCount: connectedProviders.length,
  });
  const providerStatusLabel = t(aiProvidersStatusI18nKey(providersUiPhase));
  const providerStatusStyle =
    providersUiPhase === "ready"
      ? "border-dls-status-success-border bg-dls-status-success-soft text-dls-status-success-fg"
      : "bg-dls-active text-dls-secondary border-dls-mist";
  const providerSummary =
    providersUiPhase === "ready"
      ? t(aiProvidersSummaryI18nKey(providersUiPhase), {
          count: connectedProviders.length,
        })
      : t(aiProvidersSummaryI18nKey(providersUiPhase));
  const routeOnMyAgentStatus = onmyagentClient ? "connected" : "disconnected";
  const notFoundRouteError = !loading && routeWorkspaceId && !selectedWorkspace
    ? t("workspace_list.not_found_route_error")
    : null;
  const routeOnMyAgentCapabilities: OnMyAgentServerCapabilities | null = onmyagentClient
    ? ROUTE_ONMYAGENT_CAPABILITIES
    : null;
  const environmentRuntimeKey = buildOnMyAgentEnvRuntimeKey({
    baseUrl: onmyagentServerSnapshot.onmyagentServerBaseUrl || onmyagentServerSnapshot.onmyagentServerUrl,
    pid: onmyagentServerSnapshot.onmyagentServerHostInfo?.pid ?? null,
    port: onmyagentServerSnapshot.onmyagentServerHostInfo?.port ?? null,
  });

  const handleApplyEnvironmentChanges = async () => {
    return applySettingsEnvironmentChangesAndRefresh({
      activeReloadBlockingSessionsCount: activeReloadBlockingSessions.length,
      selectedWorkspaceRoot,
      workspacePaths: buildSettingsEnvironmentWorkspacePaths({ selectedWorkspaceRoot, workspaces }),
      onmyagentRemoteAccess: onmyagentServerSnapshot.onmyagentServerSettings.remoteAccessEnabled === true,
      reconnectOnMyAgentServer: onmyagentServerStore.reconnectOnMyAgentServer,
      refreshRouteState,
    });
  };

  const handleOpenCreateWorkspace = () => {
    if (
      workspaces.length > 0 &&
      checkDesktopRestriction({ restriction: "allowMultipleWorkspaces" })
    ) {
      restrictionNotice.show({
        title: t("workspace_list.restricted_workspaces_title"),
        message:
          t("workspace_list.restricted_workspaces_message"),
      });
      return;
    }

    setCreateWorkspaceError(null);
    setCreateWorkspaceRemoteError(null);
    setCreateWorkspaceOpen(true);
  };

  const handleSelectSettingsWorkspace = useCallback((workspaceId: string) => {
    setLegacySelectedWorkspaceId(workspaceId);
    writeActiveWorkspaceId(workspaceId);
    activateDesktopSettingsWorkspaceInBackground(workspaceId);
    navigate(workspaceSettingsRoute(workspaceId, settingsPathForRoute(route)), { state: location.state });
  }, [location, navigate, route]);

  const handleOpenRenameWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    setRenameWorkspaceId(workspaceId);
    setRenameWorkspaceTitle(workspaceLabel(workspace));
  }, [workspaces]);

  const handleSaveRenameWorkspace = useCallback(async () => {
    if (!renameWorkspaceId) return;
    const trimmed = renameWorkspaceTitle.trim();
    if (!trimmed) return;
    setRenameWorkspaceBusy(true);
    try {
      await renameSettingsWorkspaceAndRefresh({
        displayName: trimmed,
        onmyagentClient,
        refreshRouteState,
        workspaceId: renameWorkspaceId,
      });
      setRenameWorkspaceId(null);
      setRenameWorkspaceTitle("");
    } finally {
      setRenameWorkspaceBusy(false);
    }
  }, [onmyagentClient, refreshRouteState, renameWorkspaceId, renameWorkspaceTitle]);

  const handleRevealWorkspace = useCallback(async (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    await revealSettingsWorkspacePath(workspace?.path ?? "");
  }, [workspaces]);

  const handleExportWorkspaceConfig = useCallback(async (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId) ?? null;
    if (!workspace) return;
    setExportWorkspaceBusy(true);
    try {
      await pickAndExportSettingsWorkspaceConfig({
        workspaceId,
        workspaceLabel: workspaceLabel(workspace),
      });
    } finally {
      setExportWorkspaceBusy(false);
    }
  }, [workspaces]);

  const handleForgetWorkspace = useCallback(async (workspaceId: string) => {
    if (typeof window !== "undefined") {
      const message = t("workspace_list.remove_confirm");
      if (!window.confirm(message)) return;
    }
    const nextId = await forgetSettingsWorkspaceAndRefresh({
      onmyagentClient,
      refreshRouteState,
      selectedWorkspaceId,
      workspaceId,
      workspaces,
    });
    if (nextId !== selectedWorkspaceId) {
      setLegacySelectedWorkspaceId(nextId);
    }
  }, [onmyagentClient, refreshRouteState, selectedWorkspaceId, workspaces]);

  const handleCreateWorkspace = async (preset: WorkspacePreset, folder: string | null) => {
    if (!folder) return;
    setCreateWorkspaceBusy(true);
    setCreateWorkspaceError(null);
    try {
      await createLocalSettingsWorkspaceAndRefresh({ folder, onmyagentClient, preset, refreshRouteState });
      setCreateWorkspaceOpen(false);
    } catch (error) {
      setCreateWorkspaceError(describeWorkspaceCreateError(error));
    } finally {
      setCreateWorkspaceBusy(false);
    }
  };

  const handleCreateRemoteWorkspace = async (input: {
    onmyagentHostUrl?: string | null;
    onmyagentToken?: string | null;
    directory?: string | null;
    displayName?: string | null;
  }) => {
    setCreateWorkspaceRemoteBusy(true);
    setCreateWorkspaceRemoteError(null);
    try {
      const created = await createRemoteSettingsWorkspaceAndRefresh({ ...input, refreshRouteState });
      if (!created) return false;
      setCreateWorkspaceOpen(false);
      return true;
    } catch (error) {
      setCreateWorkspaceRemoteError(error instanceof Error ? error.message : t("app.unknown_error"));
      return false;
    } finally {
      setCreateWorkspaceRemoteBusy(false);
    }
  };

  const handleReconnectMessagingServer = useCallback(async () => {
    return reconnectOnMyAgentServerAndRefresh({
      reconnectOnMyAgentServer: onmyagentServerStore.reconnectOnMyAgentServer,
      refreshRouteState,
    });
  }, [onmyagentServerStore, refreshRouteState]);

  const handleRestartOnMyAgentServerAndRefresh = useCallback(async () => {
    return restartOnMyAgentServerAndRefresh({
      reconnectOnMyAgentServer: onmyagentServerStore.reconnectOnMyAgentServer,
      refreshRouteState,
    });
  }, [onmyagentServerStore, refreshRouteState]);

  /**
   * Apply engine config so a newly saved provider/model is usable immediately.
   * Prefer soft OpenCode instance dispose (fast); fall back to full desktop
   * managed-server restart when soft reload fails (stale binary / plugin mess).
   * Declared after onmyagentServerStore + refreshRouteState to avoid TDZ crashes
   * when opening Settings.
   */
  const applyEngineConfigForProviders = useCallback(async () => {
    const workspaceId =
      routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId.trim();
    if (!onmyagentClient || !workspaceId) {
      return false;
    }

    let softOk = false;
    try {
      await onmyagentClient.reloadEngine(workspaceId);
      softOk = true;
    } catch {
      softOk = false;
    }

    if (!softOk && isDesktopRuntime()) {
      const hardOk = await restartOnMyAgentServerAndRefresh({
        reconnectOnMyAgentServer: onmyagentServerStore.reconnectOnMyAgentServer,
        refreshRouteState,
      });
      if (!hardOk) return false;
    } else if (!softOk) {
      return false;
    }

    await refreshProviderListQueries(getReactQueryClient()).catch(() => null);
    try {
      window.dispatchEvent(new CustomEvent("onmyagent-server-settings-changed"));
    } catch {
      // ignore
    }
    void pollMcpServersAfterReloadRef.current?.();
    return true;
  }, [
    onmyagentClient,
    onmyagentServerStore.reconnectOnMyAgentServer,
    refreshRouteState,
    selectedWorkspaceId,
  ]);

  const reloadWorkspaceEngineFromUi = useCallback(async () => {
    const workspaceId =
      routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId.trim();
    if (!onmyagentClient || !workspaceId) {
      setFacingRouteError(null, "not_connected");
      return false;
    }
    return applyEngineConfigForProviders();
  }, [applyEngineConfigForProviders, onmyagentClient, selectedWorkspaceId, setFacingRouteError]);

  useEffect(() => {
    return reloadCoordinator.registerWorkspaceReloadControls({
      canReloadWorkspaceEngine: () =>
        Boolean(onmyagentClient && (selectedWorkspace?.id || selectedWorkspaceId)),
      reloadWorkspaceEngine: reloadWorkspaceEngineFromUi,
      activeSessions: () => activeReloadBlockingSessions,
      stopSession: async (sessionId) => {
        if (!activeClient) return;
        await abortSessionSafe(activeClient, sessionId);
      },
    });
  }, [
    activeClient,
    activeReloadBlockingSessions,
    onmyagentClient,
    reloadCoordinator,
    reloadWorkspaceEngineFromUi,
    selectedWorkspace?.id,
    selectedWorkspaceId,
  ]);

  const handleRestartMessagingWorker = handleRestartOnMyAgentServerAndRefresh;

  const messagingViewProps = useMessagingViewProps({
    busy,
    onmyagentServerStatus: onmyagentServerSnapshot.onmyagentServerStatus,
    onmyagentServerUrl: onmyagentServerSnapshot.onmyagentServerUrl,
    onmyagentServerClient:
      onmyagentClient ?? onmyagentServerSnapshot.onmyagentServerClient,
    onmyagentReconnectBusy: onmyagentServerSnapshot.onmyagentReconnectBusy,
    reconnectOnMyAgentServer: handleReconnectMessagingServer,
    restartMessagingWorker: handleRestartMessagingWorker,
    workspaceId: runtimeWorkspaceId,
    selectedWorkspaceRoot,
  });

  if (route.redirectPath && !props.embedded) {
    const target = selectedWorkspaceId
      ? workspaceSettingsRoute(selectedWorkspaceId, route.redirectPath)
      : `/settings/${route.redirectPath}`;
    return <Navigate to={target} replace state={location.state} />;
  }

  if (!props.embedded && !routeWorkspaceId && selectedWorkspaceId) {
    return <Navigate to={workspaceSettingsRoute(selectedWorkspaceId, settingsPathForRoute(route))} replace state={location.state} />;
  }

  const openCloudAccountSettings = () => {
    navigateSettingsPath("ai");
  };

  const settingsView = SettingsTabBody({
    tab: route.tab,
    navigateSettingsPath,
    developerMode,
    platform,
    onmyagentClient,
    routeOnMyAgentStatus,
    routeOnMyAgentCapabilities,
    runtimeWorkspaceId,
    selectedWorkspaceRoot,
    workspaceType,
    busy,
    local,
    setConfigActionStatus,
    providerAuthStore,
    connectionsStore,
    providerAuthSnapshot,
    providerStatusLabel,
    providerStatusStyle,
    providerSummary,
    connectedProviders,
    providerActionBusyId,
    providerActionError,
    providerSyncBusy,
    activeClient,
    providersDiscovering,
    inventorySyncing,
    handleOpenProviderAuth,
    handleOpenCustomProviderConfig,
    setProviderActionBusyId,
    setProviderActionError,
    opencodeInventoryReady,
    handleEditOpenCodeProvider,
    setProviderSyncBusy,
    setOpenCodeManagedProviders,
    applyEngineConfigForProviders,
    loadOpenCodeManagedProviders,
    reloadCoordinator,
    showOnMyAgentModelsSubscribe,
    subscribeToOnMyAgentModels,
    denSession,
    memoryDraft,
    persistMemoryDraft,
    conversationMemoryDraft,
    persistConversationMemory,
    autoCompactContext,
    autoCompactContextBusy,
    toggleAutoCompactContext,
    extensionsStore,
    electronUpdaterState,
    updateAutoCheck,
    setUpdateAutoCheck,
    updateAutoDownload,
    setUpdateAutoDownload,
    activeReloadBlockingSessions,
    workspaces,
    selectedWorkspaceId,
    isRemoteWorkspace,
    handleApplyEnvironmentChanges,
    environmentRuntimeKey,
    recoveryViewProps,
    debugViewProps,
    onmyagentServerSnapshot,
  });


  return (
    <>
      <SettingsShell
        activeTab={route.tab}
        onSelectTab={(tab) => navigateSettingsPath(tab)}
        developerMode={developerMode}
        selectedWorkspaceId={selectedWorkspaceId}
        selectedWorkspaceName={selectedWorkspaceName}
        selectedWorkspaceColor={selectedWorkspaceColor}
        workspaces={workspaceOptions}
        onSelectWorkspace={handleSelectSettingsWorkspace}
        onOpenCreateWorkspace={handleOpenCreateWorkspace}
        headerStatus={routeOnMyAgentStatus}
        busyHint={
          loading && !shellInteractive
            ? t("system.load_settings_route")
            : busyLabel
        }
        onClose={handleCloseSettings}
        error={routeError ?? notFoundRouteError}
        errorSlot={
          routeError ? (
            <SettingsRouteErrorSlot
              action={routeErrorAction}
              onRetry={() => void refreshRouteState()}
              onOpenAiSettings={() => navigateSettingsPath("ai")}
            />
          ) : null
        }
        compact={props.embedded}
        panelToolbarSlot={undefined}
      >
        {settingsView}
      </SettingsShell>

      <OpenCodeProviderConfigDialog
        open={openCodeProviderConfigOpen}
        workspaceRoot={selectedWorkspaceRoot}
        initialProvider={editingOpenCodeProvider}
        onOpenChange={(open) => {
          setOpenCodeProviderConfigOpen(open);
          if (!open) setEditingOpenCodeProvider(null);
        }}
        onSaved={async (saved) => {
          setEditingOpenCodeProvider(null);
          setProviderSyncBusy(true);
          setProviderActionError(null);
          try {
            // Product path: fill form → write opencode.json → apply engine → use model.
            // 1) Prefer the new model in UI prefs immediately (create / fill-and-use only).
            if (saved.defaultModel?.providerID && saved.defaultModel.modelID) {
              local.setPrefs((previous) => ({
                ...previous,
                defaultModel: {
                  providerID: saved.defaultModel!.providerID,
                  modelID: saved.defaultModel!.modelID,
                },
                modelVariant: null,
              }));
            }

            // Prefer save-response inventory (already live-merged) so re-edit
            // immediately sees added models without racing a second snapshot.
            if (saved.opencodeProviders && saved.opencodeProviders.length > 0) {
              setOpenCodeManagedProviders(saved.opencodeProviders);
            } else {
              try {
                const managedProviders = await loadOpenCodeManagedProviders({
                  force: true,
                });
                setOpenCodeManagedProviders(managedProviders);
              } catch {
                // best-effort inventory
              }
            }

            // 2) Soft dispose first; hard restart only if needed.
            let applied = false;
            try {
              applied = await applyEngineConfigForProviders();
            } catch {
              applied = false;
            }

            // 3) Refresh catalogs so composer / settings see the provider.
            await providerAuthStore.refreshProviders({ dispose: true }).catch(() => null);
            await refreshProviderListQueries(getReactQueryClient()).catch(() => null);

            if (applied) {
              reloadCoordinator.clearReloadRequired();
            } else {
              reloadCoordinator.markReloadRequired("config", {
                type: "config",
                name: "opencode.json",
                action: "updated",
              });
            }
          } catch (error) {
            setProviderActionError(
              userErrorFromRaw(
                error instanceof Error ? error.message : String(error),
              ),
            );
          } finally {
            setProviderSyncBusy(false);
          }
        }}
      />

      <ProviderAuthModal
        open={providerAuthSnapshot.providerAuthModalOpen}
        loading={false}
        submitting={providerAuthSnapshot.providerAuthBusy}
        error={providerAuthSnapshot.providerAuthError}
        preferredProviderId={providerAuthSnapshot.providerAuthPreferredProviderId}
        workerType={providerAuthSnapshot.providerAuthWorkerType}
        // Hide any provider the org blocks at the desktop layer so users
        // can't connect a forbidden one (dev #1505). Same helper covers
        // opencode-provider gating via the `allowZenModel` restriction.
        // We also strip the matching key from `authMethods` because the
        // modal builds its entry list from `Object.keys(authMethods)`,
        // not from `providers`.
        providers={providerAuthSnapshot.providerAuthProviders.filter(
          (provider) =>
            !isDesktopProviderBlocked({
              providerId: provider.id,
              checkRestriction: checkDesktopRestriction,
            }),
        )}
        connectedProviderIds={providerConnectedIds}
        authMethods={Object.fromEntries(
          Object.entries(providerAuthSnapshot.providerAuthMethods).filter(
            ([providerId]) =>
              !isDesktopProviderBlocked({
                providerId,
                checkRestriction: checkDesktopRestriction,
              }),
          ),
        )}
        onSelect={providerAuthStore.startProviderAuth}
        onSubmitApiKey={providerAuthStore.submitProviderApiKey}
        onConnectCloudProvider={providerAuthStore.connectCloudProvider}
        onSubmitOAuth={providerAuthStore.completeProviderAuthOAuth}
        onRefreshProviders={providerAuthStore.refreshProviders}
        showOnMyAgentModelsSubscribe={showOnMyAgentModelsSubscribe}
        onSubscribeOnMyAgentModels={subscribeToOnMyAgentModels}
        onClose={() => providerAuthStore.closeProviderAuthModal()}
      />
      <CreateWorkspaceModal
        open={createWorkspaceOpen}
        onClose={() => {
          setCreateWorkspaceOpen(false);
          setCreateWorkspaceError(null);
        }}
        onConfirm={handleCreateWorkspace}
        onConfirmRemote={handleCreateRemoteWorkspace}
        onPickFolder={() => pickDirectory({ title: t("onboarding.authorize_folder") }) as Promise<string | null>}
        submitting={createWorkspaceBusy}
        localError={createWorkspaceError}
        remoteSubmitting={createWorkspaceRemoteBusy}
        remoteError={createWorkspaceRemoteError}
      />
      <RenameWorkspaceModal
        open={renameWorkspaceId !== null}
        title={renameWorkspaceTitle}
        busy={renameWorkspaceBusy}
        canSave={!renameWorkspaceBusy && renameWorkspaceTitle.trim().length > 0}
        onClose={() => {
          if (renameWorkspaceBusy) return;
          setRenameWorkspaceId(null);
          setRenameWorkspaceTitle("");
        }}
        onSave={() => void handleSaveRenameWorkspace()}
        onTitleChange={setRenameWorkspaceTitle}
      />
      {shareWorkspaceState.shareWorkspaceOpen ? (
        <ShareWorkspaceModal
          open
          onClose={shareWorkspaceState.closeShareWorkspace}
          workspaceName={shareWorkspaceState.shareWorkspaceName}
          workspaceDetail={shareWorkspaceState.shareWorkspaceDetail}
          fields={shareWorkspaceState.shareFields}
          note={shareWorkspaceState.shareNote}
          onExportConfig={
            shareWorkspaceState.exportDisabledReason === null
              ? () => {
                  const id = shareWorkspaceState.shareWorkspaceId;
                  if (!id) return;
                  void handleExportWorkspaceConfig(id);
                }
              : undefined
          }
          exportDisabledReason={shareWorkspaceState.exportDisabledReason}
        />
      ) : null}
      <CreateRemoteWorkspaceModal
        open={remoteWorkspaceConnectionEditor.workspace !== null}
        onClose={remoteWorkspaceConnectionEditor.close}
        onConfirm={(input) => void remoteWorkspaceConnectionEditor.save(input)}
        initialValues={remoteWorkspaceConnectionEditor.initialValues}
        submitting={remoteWorkspaceConnectionEditor.busy}
        error={remoteWorkspaceConnectionEditor.error}
        title={t("dashboard.edit_remote_workspace_title")}
        subtitle={t("dashboard.edit_remote_workspace_subtitle")}
        confirmLabel={t("dashboard.edit_remote_workspace_confirm")}
      />
      <ConnectionsModals
        client={activeClient}
        projectDir={selectedWorkspaceRoot}
        reloadBlocked={activeReloadBlockingSessions.length > 0}
        activeSessions={activeReloadBlockingSessions}
        isRemoteWorkspace={selectedWorkspace?.workspaceType === "remote"}
        onForceStopSession={(sessionId) => {
          if (!activeClient) return undefined;
          return abortSessionSafe(activeClient, sessionId);
        }}
        onReloadEngine={reloadCoordinator.reloadWorkspaceEngine}
        modalState={{
          mcpAuthModalOpen: connectionsSnapshot.mcpAuthModalOpen,
          mcpAuthEntry: connectionsSnapshot.mcpAuthEntry,
          mcpAuthNeedsReload: connectionsSnapshot.mcpAuthNeedsReload,
        }}
        onCloseMcpAuthModal={() => connectionsStore.closeMcpAuthModal()}
        onCompleteMcpAuthModal={() => connectionsStore.completeMcpAuthModal()}
      />
      <ModelPickerModal
        open={modelPickerOpen}
        options={modelOptions}
        query={modelPickerQuery}
        setQuery={setModelPickerQuery}
        target="default"
        current={
          local.prefs.defaultModel ?? { providerID: "", modelID: "" }
        }
        onSelect={(next: ModelRef) => {
          local.setPrefs((prev) => ({
            ...prev,
            defaultModel: next,
            modelVariant: prev.defaultModel?.providerID === next.providerID && prev.defaultModel.modelID === next.modelID
              ? prev.modelVariant
              : null,
          }));
          setModelPickerOpen(false);
        }}
        onBehaviorChange={() => {}}
        onOpenSettings={() => {
          setModelPickerOpen(false);
          handleOpenProviderAuth();
        }}
        onClose={() => setModelPickerOpen(false)}
      />
    </>
  );
}

export function SettingsRoute() {
  return <SettingsSurface />;
}

export function SettingsSurface(props: SettingsSurfaceProps) {
  return (
    <CloudSessionProvider>
      <SettingsRouteContent {...props} />
    </CloudSessionProvider>
  );
}
