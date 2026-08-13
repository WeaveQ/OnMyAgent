/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { createClient } from "../../../app/lib/opencode";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { resolveWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import { buildOnMyAgentEnvRuntimeKey } from "../../../app/lib/onmyagent-env-runtime";
import type {
  Client,
  ProviderListItem,
  SidebarSessionItem,
  WorkspaceConnectionState,
  WorkspaceDisplay,
} from "../../../app/types";
import { getWorkspaceTaskLoadErrorDisplay } from "../../../app/utils";
import { t } from "../../../i18n";
import {
  ConnectionsModals,
  ProviderAuthModal,
  refreshProviderListQueries,
} from "../../domains/connections";
import { OpenCodeProviderConfigDialog, ModelPickerModal, workspaceSwatchColor } from "../../domains/session";
import {
  CloudSessionProvider,
  SettingsShell,
  schedulePrefetchCommonSettingsTabs,
  useAiProvidersController,
  useCloudSession,
  useDebugViewModel,
  useDenSession,
  useElectronUpdaterState,
  useMessagingViewProps,
  useRecoveryViewModel,
} from "../../domains/settings";
import { userErrorFromRaw } from "../../kernel/user-error";
import { useShellInteractiveLoad } from "../use-shell-interactive-load";
import { useFacingRouteError } from "./facing-route-error";
import { useSettingsProvidersPrewarm } from "./providers-prewarm-hook";
import { SettingsTabBody } from "./settings-tab-body";
import { SettingsRouteErrorSlot } from "./route-error-slot";
import { usePlatform } from "../../kernel/platform";
import { useLocal } from "../../kernel/local-provider";
import type { OnboardingProfile } from "../../kernel/local-provider";
import {
  buildUserProfileLabelMaps,
  scheduleSyncMemoryAwarenessFiles,
  scheduleSyncPersonalAwarenessFiles,
  scheduleSyncStyleAwarenessFiles,
  syncMemoryAwarenessFiles,
  syncPersonalAwarenessFiles,
} from "../../domains/shared";
import {
  industryOptions,
  roleOptions,
  taskOptions,
  toolOptions,
} from "../../domains/settings";
import {
  pickDirectory,
  type AgentManagementManagedProvider,
} from "../../../app/lib/desktop";
import { isDesktopProviderBlocked } from "../../../app/cloud/desktop-app-restrictions";
import {
  useCheckDesktopRestriction,
  useDesktopConfig,
  useRestrictionNotice,
} from "../../domains/cloud";
import {
  resolveModelDisplayName,
  resolveProviderDisplayName,
} from "../../../app/utils";
import {
  CreateRemoteWorkspaceModal,
  CreateWorkspaceModal,
  RenameWorkspaceModal,
  ShareWorkspaceModal,
  useShareWorkspaceState,
} from "../../domains/workspace";
import type { ModelRef } from "../../../app/types";
import {
  aiProvidersStatusI18nKey,
  aiProvidersSummaryI18nKey,
  resolveAiProvidersUiPhase,
  buildSettingsEnvironmentWorkspacePaths,
  buildSettingsWorkspaceOptions,
  buildWorkspaceConnectionStateById,
  formatDefaultModelLabel,
  formatDefaultModelRefLabel,
  isOnMyAgentCloudProvider,
  listActiveReloadBlockingSessions,
  parseSettingsPath,
  readHistoryIndexFromWindow,
  readNavigationPageMode,
  readNavigationReturnTo,
  readNavigationSessionId,
  readNavigationWorkspaceId,
  resolveSettingsReturnPath,
  shouldPreferHistoryBackFromSettings,
  settingsPathForRoute,
  toSelectedWorkspaceDisplay,
  toSessionGroups,
  workspaceLabel,
  type RouteWorkspace,
} from "./model";
import { applySettingsEnvironmentChangesAndRefresh } from "./workspace-actions";
import {
  useSettingsEmbeddedRedirect,
  useSettingsPathNavigator,
} from "./embedded-path";
import { useSettingsWorkspaceRefs } from "./refs";
import {
  reconnectOnMyAgentServerAndRefresh,
  restartOnMyAgentServerAndRefresh,
} from "./server-actions";
import { abortSessionSafe } from "../../../app/lib/opencode-session";
import { useReloadCoordinator } from "../reload-coordinator";
import { getDenInferenceUrl } from "../../../app/lib/den";
import { readActiveWorkspaceId } from "../session-memory";
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
  ROUTE_ONMYAGENT_CAPABILITIES,
  useSettingsRouteStores,
} from "./route-stores-hook";
import { useSettingsRouteRefresh } from "./refresh-hook";
import { useSettingsWorkspaceHandlers } from "./workspace-handlers-hook";
import { useSettingsProviderHandlers } from "./provider-handlers-hook";
import { useSettingsModelPicker } from "./model-picker-hook";

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
  const route = props.embedded
    ? parseSettingsPath(`/settings/${embeddedPath}`)
    : parseSettingsPath(location.pathname);
  const navigationWorkspaceId = readNavigationWorkspaceId(location.state);
  const navigationSessionId = readNavigationSessionId(location.state);
  const navigationPageMode = readNavigationPageMode(location.state);
  const navigationReturnTo = readNavigationReturnTo(location.state);

  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<RouteWorkspace[]>([]);
  const [sessionsByWorkspaceId, setSessionsByWorkspaceId] = useState<
    Record<string, SidebarSessionItem[]>
  >({});
  const [errorsByWorkspaceId, setErrorsByWorkspaceId] = useState<
    Record<string, string | null>
  >({});
  const [workspaceConnectionOverrides, setWorkspaceConnectionOverrides] = useState<
    Record<string, WorkspaceConnectionState>
  >({});
  const [legacySelectedWorkspaceId, setLegacySelectedWorkspaceId] = useState(
    () => navigationWorkspaceId ?? readActiveWorkspaceId() ?? "",
  );
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
  const [developerMode, setDeveloperMode] = useState(() =>
    readStoredBoolean(SETTINGS_DEVELOPER_MODE_KEY, false),
  );
  const [hideTitlebar, setHideTitlebar] = useState(() =>
    readStoredBoolean(SETTINGS_HIDE_TITLEBAR_KEY, false),
  );
  void setDeveloperMode;
  void setHideTitlebar;
  const [updateAutoCheck, setUpdateAutoCheck] = useState(() =>
    readStoredBoolean(SETTINGS_UPDATE_AUTO_CHECK_KEY, true),
  );
  const [updateAutoDownload, setUpdateAutoDownload] = useState(() =>
    readStoredBoolean(SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY, false),
  );
  const [configActionStatus, setConfigActionStatus] = useState<string | null>(null);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [createWorkspaceBusy, setCreateWorkspaceBusy] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const [createWorkspaceRemoteBusy, setCreateWorkspaceRemoteBusy] = useState(false);
  const [createWorkspaceRemoteError, setCreateWorkspaceRemoteError] = useState<string | null>(
    null,
  );
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(null);
  const [renameWorkspaceTitle, setRenameWorkspaceTitle] = useState("");
  const [renameWorkspaceBusy, setRenameWorkspaceBusy] = useState(false);
  const [exportWorkspaceBusy, setExportWorkspaceBusy] = useState(false);
  const [autoCompactContext, setAutoCompactContext] = useState(true);
  const [autoCompactContextBusy, setAutoCompactContextBusy] = useState(false);
  const [autoCompactContextLoaded, setAutoCompactContextLoaded] = useState(false);
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

  const userProfileLabels = useMemo(
    () =>
      buildUserProfileLabelMaps({
        roles: roleOptions,
        industries: industryOptions,
        tools: toolOptions,
        tasks: taskOptions,
      }),
    [],
  );

  // 偏好 auto-persist; mirror Personal → USER.md + style.md (desktop).
  const persistMemoryDraft = useCallback(
    (draft: OnboardingProfile) => {
      const next = { ...draft, updatedAt: Date.now() };
      setMemoryDraft(next);
      local.setPrefs((previous) => ({
        ...previous,
        onboardingProfile: next,
      }));
      scheduleSyncPersonalAwarenessFiles({
        profile: next,
        labels: userProfileLabels,
        responseTone: local.prefs.responseTone,
        customInstructions: local.prefs.customInstructions,
      });
    },
    [local, userProfileLabels],
  );

  const persistResponseTone = useCallback(
    (responseTone: typeof local.prefs.responseTone) => {
      local.setPrefs((previous) => ({ ...previous, responseTone }));
      scheduleSyncStyleAwarenessFiles(
        responseTone,
        local.prefs.customInstructions,
      );
    },
    [local],
  );

  const persistCustomInstructions = useCallback(
    (customInstructions: string) => {
      local.setPrefs((previous) => ({ ...previous, customInstructions }));
      scheduleSyncStyleAwarenessFiles(
        local.prefs.responseTone,
        customInstructions,
      );
    },
    [local],
  );

  // One-shot backfill when settings opens (write paths schedule their own sync).
  useEffect(() => {
    void syncPersonalAwarenessFiles({
      profile: local.prefs.onboardingProfile,
      labels: userProfileLabels,
      responseTone: local.prefs.responseTone,
      customInstructions: local.prefs.customInstructions,
    });
    void syncMemoryAwarenessFiles(local.prefs.conversationMemory);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount backfill only
  }, []);

  const persistConversationMemory = useCallback(
    (next: typeof conversationMemoryDraft) => {
      setConversationMemoryDraft(next);
      local.setPrefs((previous) => ({
        ...previous,
        conversationMemory: next,
      }));
      scheduleSyncMemoryAwarenessFiles(next);
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

  const selectedWorkspace = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
      (selectedWorkspaceId ? null : workspaces[0] ?? null),
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

  const activeReloadBlockingSessions = useMemo(
    () =>
      listActiveReloadBlockingSessions(sessionsByWorkspaceId, t("session.untitled")),
    [sessionsByWorkspaceId],
  );

  const {
    routeStateRef,
    onmyagentServerStore,
    connectionsStore,
    providerAuthStore,
    extensionsStore,
    onmyagentServerSnapshot,
    connectionsSnapshot,
    providerAuthSnapshot,
    pollMcpServersAfterReloadRef,
  } = useSettingsRouteStores({
    emptyWorkspaceDisplay,
    activeClient,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedWorkspaceType: selectedWorkspace?.workspaceType ?? "local",
    runtimeWorkspaceId: selectedWorkspace?.id ?? null,
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
    markReloadRequired: reloadCoordinator.markReloadRequired,
  });

  const denSession = useDenSession({
    developerMode,
    openLink: (url) => platform.openLink(url),
  });
  const cloudSession = useCloudSession();

  const hasOnMyAgentCloudProvider = useMemo(
    () =>
      providerAuthSnapshot.cloudOrgProviders.some(isOnMyAgentCloudProvider) ||
      Object.values(providerAuthSnapshot.importedCloudProviders ?? {}).some(
        isOnMyAgentCloudProvider,
      ),
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
  const runtimeWorkspaceId =
    selectedWorkspaceEndpoint?.workspaceId ?? selectedWorkspace?.id ?? null;
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

  const {
    modelPickerOpen,
    setModelPickerOpen,
    modelPickerQuery,
    setModelPickerQuery,
    modelOptions,
  } = useSettingsModelPicker({
    opencodeClient,
    opencodeBaseUrl,
    selectedWorkspaceRoot,
    providerAuthStore,
    setFacingRouteError,
  });

  useEffect(() => {
    local.setUi((previous) => ({ ...previous, view: "settings", tab: route.tab }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- local is stable via context
  }, [route.tab]);

  // Warm high-traffic tab chunks on idle so 系统设置 → 快捷键 does not flash Suspense.
  useEffect(() => schedulePrefetchCommonSettingsTabs(), []);

  useEffect(() => {
    writeStoredBoolean(SETTINGS_HIDE_TITLEBAR_KEY, hideTitlebar);
  }, [hideTitlebar]);

  useEffect(() => {
    writeStoredBoolean(SETTINGS_UPDATE_AUTO_CHECK_KEY, updateAutoCheck);
    void window.__ONMYAGENT_ELECTRON__?.updater?.setAutoCheck?.(updateAutoCheck);
  }, [updateAutoCheck]);

  useEffect(() => {
    writeStoredBoolean(SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY, updateAutoDownload);
  }, [updateAutoDownload]);

  const { shellInteractive } = useShellInteractiveLoad({
    loading,
    firstLoadScope: "route-settings",
  });

  const { refreshRouteState, toggleAutoCompactContext } = useSettingsRouteRefresh({
    routeWorkspaceId,
    navigationSessionId,
    navigationWorkspaceId,
    workspacesRef,
    workspaces,
    selectedWorkspace,
    selectedWorkspaceId,
    onmyagentClient,
    loading,
    setLoading,
    setWorkspaces,
    setSessionsByWorkspaceId,
    setErrorsByWorkspaceId,
    setWorkspaceConnectionOverrides,
    setLegacySelectedWorkspaceId,
    setOnMyAgentClient,
    setBaseUrl,
    setToken,
    setFacingRouteError,
    clearFacingRouteError,
    routeStateRef,
    setAutoCompactContext,
    setAutoCompactContextLoaded,
    autoCompactContext,
    autoCompactContextBusy,
    setAutoCompactContextBusy,
    markReloadRequired: reloadCoordinator.markReloadRequired,
  });

  const {
    remoteWorkspaceConnectionEditor,
    handleOpenCreateWorkspace,
    handleSelectSettingsWorkspace,
    handleSaveRenameWorkspace,
    handleExportWorkspaceConfig,
    handleCreateWorkspace,
    handleCreateRemoteWorkspace,
  } = useSettingsWorkspaceHandlers({
    workspaces,
    workspacesRef,
    selectedWorkspaceId,
    onmyagentClient,
    route,
    locationState: location.state,
    navigate,
    checkDesktopRestriction,
    restrictionNotice,
    refreshRouteState,
    setLegacySelectedWorkspaceId,
    setCreateWorkspaceOpen,
    setCreateWorkspaceBusy,
    setCreateWorkspaceError,
    setCreateWorkspaceRemoteBusy,
    setCreateWorkspaceRemoteError,
    renameWorkspaceId,
    setRenameWorkspaceId,
    renameWorkspaceTitle,
    setRenameWorkspaceTitle,
    setRenameWorkspaceBusy,
    setExportWorkspaceBusy,
    setWorkspaceConnectionOverrides,
    setErrorsByWorkspaceId,
  });

  useEffect(() => {
    if (!activeClient) {
      setProviders([]);
      setProviderDefaults({});
      setProviderConnectedIds([]);
      setDisabledProviders([]);
    }
  }, [activeClient]);

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
    opencodeInventoryReady,
    setOpenCodeManagedProviders,
    providersDiscovering,
    inventorySyncing,
    loadOpenCodeManagedProviders,
    findManagedProvider,
    reorderConnectedProviders,
    moveConnectedProvider,
  } = aiProviders;

  const {
    handleOpenCustomProviderConfig,
    handleOpenProviderAuth,
    handleEditOpenCodeProvider,
    applyEngineConfigForProviders,
  } = useSettingsProviderHandlers({
    routeStateRef,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedWorkspace,
    onmyagentClient,
    activeClient,
    providers,
    providerActionBusyId,
    disabledProviders,
    checkDesktopRestriction,
    restrictionNotice,
    providerAuthStore,
    findManagedProvider,
    loadOpenCodeManagedProviders,
    setOpenCodeManagedProviders,
    setEditingOpenCodeProvider,
    setOpenCodeProviderConfigOpen,
    setProviderActionBusyId,
    setProviderActionError,
    setConfigActionStatus,
    setFacingRouteError,
    reconnectOnMyAgentServer: onmyagentServerStore.reconnectOnMyAgentServer,
    refreshRouteState,
    pollMcpServersAfterReloadRef,
    activeReloadBlockingSessions,
    reloadCoordinator,
  });

  const selectedWorkspaceName =
    selectedWorkspace?.displayNameResolved ?? t("session.workspace_fallback");
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
  const notFoundRouteError =
    !loading && routeWorkspaceId && !selectedWorkspace
      ? t("workspace_list.not_found_route_error")
      : null;
  const routeOnMyAgentCapabilities = onmyagentClient ? ROUTE_ONMYAGENT_CAPABILITIES : null;
  const environmentRuntimeKey = buildOnMyAgentEnvRuntimeKey({
    baseUrl:
      onmyagentServerSnapshot.onmyagentServerBaseUrl ||
      onmyagentServerSnapshot.onmyagentServerUrl,
    pid: onmyagentServerSnapshot.onmyagentServerHostInfo?.pid ?? null,
    port: onmyagentServerSnapshot.onmyagentServerHostInfo?.port ?? null,
  });

  const handleApplyEnvironmentChanges = async () => {
    return applySettingsEnvironmentChangesAndRefresh({
      activeReloadBlockingSessionsCount: activeReloadBlockingSessions.length,
      selectedWorkspaceRoot,
      workspacePaths: buildSettingsEnvironmentWorkspacePaths({
        selectedWorkspaceRoot,
        workspaces,
      }),
      onmyagentRemoteAccess:
        onmyagentServerSnapshot.onmyagentServerSettings.remoteAccessEnabled === true,
      reconnectOnMyAgentServer: onmyagentServerStore.reconnectOnMyAgentServer,
      refreshRouteState,
    });
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

  // Keep parity with pre-extract locals that UI tabs / future wiring may reference.
  void workspaceConnectionStateById;
  void hasOnMyAgentCloudProvider;
  void workspaceSessionGroups;
  void defaultModelLabel;
  void defaultModelRef;
  void defaultModelVariantLabel;
  void messagingViewProps;
  void configActionStatus;
  void autoCompactContextLoaded;

  if (route.redirectPath && !props.embedded) {
    const target = selectedWorkspaceId
      ? workspaceSettingsRoute(selectedWorkspaceId, route.redirectPath)
      : `/settings/${route.redirectPath}`;
    return <Navigate to={target} replace state={location.state} />;
  }

  if (!props.embedded && !routeWorkspaceId && selectedWorkspaceId) {
    return (
      <Navigate
        to={workspaceSettingsRoute(selectedWorkspaceId, settingsPathForRoute(route))}
        replace
        state={location.state}
      />
    );
  }

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
    reorderConnectedProviders,
    moveConnectedProvider,
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
    persistResponseTone,
    persistCustomInstructions,
    conversationMemoryDraft,
    persistConversationMemory,
    userProfileLabels,
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
          loading && !shellInteractive ? t("system.load_settings_route") : busyLabel
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
        onPickFolder={() =>
          pickDirectory({ title: t("onboarding.authorize_folder") }) as Promise<string | null>
        }
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
        current={local.prefs.defaultModel ?? { providerID: "", modelID: "" }}
        onSelect={(next: ModelRef) => {
          local.setPrefs((prev) => ({
            ...prev,
            defaultModel: next,
            modelVariant:
              prev.defaultModel?.providerID === next.providerID &&
              prev.defaultModel.modelID === next.modelID
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
