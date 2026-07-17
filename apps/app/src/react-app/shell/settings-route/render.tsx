/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { SUGGESTED_PLUGINS } from "../../../app/constants";
import type { EnablementContext } from "../../../app/enablement";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createConnectionsStore, useConnectionsStoreSnapshot } from "../../domains/connections";
import { createOnMyAgentServerStore, useOnMyAgentServerStoreSnapshot } from "../../domains/shared";
import { createProviderAuthStore, useProviderAuthStoreSnapshot } from "../../domains/connections";
import { ProviderAuthModal } from "../../domains/connections";
import { ConnectionsModals } from "../../domains/connections";
import {
  AiSettingsView,
  type AiSettingsConnectedProvider,
} from "../../domains/settings";
import { OpenCodeProviderConfigDialog } from "../../domains/session";
import { getExtensionConfigSlot, getExtensionConnected, type ExtensionConfigContext } from "../../domains/settings";
import { isOnMyAgentExtensionEnabled } from "../../domains/shared";
import {
  AdvancedView,
  AuthorizedFoldersPanel,
  CloudMarketplacesView,
  CloudProvidersView,
  CloudSessionProvider,
  CloudWorkersView,
  DebugView,
  EnvironmentView,
  ExtensionsView,
  GeneralSettingsView,
  McpView,
  MemoryView,
  MessagingView,
  PreferencesView,
  RecoveryView,
  SettingsStack,
  SkillsView,
  SystemAuthorizationsView,
  UpdatesView,
  useCloudSession,
  useDebugViewModel,
  useDenSession,
  useElectronUpdaterState,
  useMessagingViewProps,
} from "../../domains/settings";
import { useBootState } from "../boot-state";
import {
  SettingsShell,
  createExtensionsStore,
  useExtensionsStoreSnapshot,
} from "../../domains/settings";
import { usePlatform } from "../../kernel/platform";
import { useLocal } from "../../kernel/local-provider";
import type { OnboardingProfile } from "../../kernel/local-provider";
import {
  agentManagementSnapshot,
  onmyagentServerInfo,
  pickDirectory,
  resolveWorkspaceListSelectedId,
  type AgentManagementManagedProvider,
  type WorkspaceList,
} from "../../../app/lib/desktop";
import { isBlockedProvider } from "../../../app/cloud/blocked-providers";
import { isDesktopProviderBlocked } from "../../../app/cloud/desktop-app-restrictions";
import {
  useCheckDesktopRestriction,
  useDesktopConfig,
  useRestrictionNotice,
  useCloudProviderAutoSync,
} from "../../domains/cloud";
import {
  isDesktopRuntime,
  isElectronRuntime,
  resolveModelDisplayName,
  resolveProviderDisplayName,
  safeStringify,
} from "../../../app/utils";
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
import { normalizeSettingsProviderSource,
  describeRouteError,
  describeWorkspaceCreateError,
  buildSettingsRefreshErrorEvent,
  buildSettingsWorkspaceBootstrapErrorEvent,
  buildSettingsEnvironmentWorkspacePaths,
  getSessionStatus,
  isActiveSessionStatus,
  isOnMyAgentCloudProvider,
  mapDesktopWorkspace,
  parseSettingsPath,
  readNavigationSessionId,
  readNavigationWorkspaceId,
  reconcileSelectedWorkspaceId,
  resolveSettingsFallbackWorkspaceId,
  resolveSettingsPreferredWorkspaceId,
  settingsPathForRoute,
  buildSettingsSessionMaps,
  settingsMemoryHasChanges,
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
import { buildFeedbackUrl } from "../../../app/lib/feedback";
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
import { workspaceSessionRoute, workspaceSettingsRoute } from "../workspace-routes";
import { getReactQueryClient } from "../../infra/query-client";
import { ensureProviderListQuery, getConnectedProviderItems, refreshProviderListQueries } from "../../domains/connections";
import { openModelPickerEvent, pendingModelPickerProviderIdsKey } from "../new-providers-toast";
import {
  OPENAI_API_KEY_ENV_KEY,
  OPENAI_IMAGE_EXTENSION_ID,
  OPENAI_IMAGE_MODEL,
  installOpenAiImageExtensionFiles,
  openAiImageResponseToArrayBuffer,
  requestOpenAiImage,
  slugifyImageArtifactName,
  OLLAMA_PROVIDER_CONFIG,
  type LocalProviderInstallInput,
} from "../../domains/settings";

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
  const navigateWorkspaceSettingsPath = useCallback(
    (path: string) => {
      navigate(selectedWorkspaceId ? workspaceSettingsRoute(selectedWorkspaceId, path) : `/settings/${path}`);
    },
    [navigate, selectedWorkspaceId],
  );
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
  const [routeError, setRouteError] = useState<string | null>(null);
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
  const [opencodeManagedProviders, setOpenCodeManagedProviders] = useState<AgentManagementManagedProvider[]>([]);
  const [openCodeProviderConfigOpen, setOpenCodeProviderConfigOpen] = useState(false);
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
  const [localProviderBusy, setLocalProviderBusy] = useState(false);
  const [localProviderStatus, setLocalProviderStatus] = useState<string | null>(null);
  const [localProviderError, setLocalProviderError] = useState<string | null>(null);
  const [imageExtensionInstalled, setImageExtensionInstalled] = useState(false);
  const [imageExtensionBusy, setImageExtensionBusy] = useState(false);
  const [imageExtensionStatus, setImageExtensionStatus] = useState<string | null>(null);
  const [imageExtensionError, setImageExtensionError] = useState<string | null>(null);
  const [imageGenerationBusy, setImageGenerationBusy] = useState(false);
  const [imageGenerationStatus, setImageGenerationStatus] = useState<string | null>(null);
  const [imageGenerationError, setImageGenerationError] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [userEnvKeys, setUserEnvKeys] = useState<string[]>([]);
  const [memoryDraft, setMemoryDraft] = useState<OnboardingProfile | null>(() =>
    local.prefs.onboardingProfile,
  );

  useEffect(() => {
    setMemoryDraft(local.prefs.onboardingProfile);
  }, [local.prefs.onboardingProfile]);

  const [memorySaved, setMemorySaved] = useState(false);

  const memoryHasChanges = useMemo(
    () => settingsMemoryHasChanges({
      draft: memoryDraft,
      saved: local.prefs.onboardingProfile,
    }),
    [memoryDraft, local.prefs.onboardingProfile],
  );

  const handleMemorySave = useCallback(() => {
    if (!memoryDraft) return;
    local.setPrefs((previous) => ({
      ...previous,
      onboardingProfile: { ...memoryDraft, updatedAt: Date.now() },
    }));
    setMemorySaved(true);
    setTimeout(() => setMemorySaved(false), 2000);
  }, [local, memoryDraft]);

  const memoryToolbarSlot = route.tab === "memory" ? (
    <div className="flex items-center justify-end">
      <Button
        type="button"
        size="lg"
        onClick={handleMemorySave}
      >
        {memorySaved ? t("settings.memory_saved") : t("settings.memory_save")}
      </Button>
    </div>
  ) : undefined;

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
  const workspaceConnectionStateById = useMemo(() => {
    const next: Record<string, WorkspaceConnectionState> = { ...workspaceConnectionOverrides };
    for (const workspace of workspaces) {
      if (workspace.workspaceType !== "remote") continue;
      const error = errorsByWorkspaceId[workspace.id]?.trim();
      if (!error || next[workspace.id]?.status === "connecting") continue;
      next[workspace.id] ??= {
        status: "error",
        message: getWorkspaceTaskLoadErrorDisplay(workspace, error).message || error,
        checkedAt: null,
      };
    }
    return next;
  }, [errorsByWorkspaceId, workspaceConnectionOverrides, workspaces]);
  const selectedWorkspaceRoot = selectedWorkspace?.path?.trim() || "";
  const selectedWorkspaceDisplay = useMemo<WorkspaceDisplay>(
    () =>
      selectedWorkspace
        ? {
            id: selectedWorkspace.id,
            name: selectedWorkspace.name ?? selectedWorkspace.displayNameResolved,
            path: selectedWorkspace.path ?? "",
            preset: "starter",
            workspaceType: selectedWorkspace.workspaceType ?? "local",
            displayName: selectedWorkspace.displayNameResolved,
            onmyagentWorkspaceName: selectedWorkspace.onmyagentWorkspaceName,
          }
        : emptyWorkspaceDisplay,
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
      Object.values(sessionsByWorkspaceId)
        .flat()
        .flatMap((session) => {
          if (!isActiveSessionStatus(getSessionStatus(session))) return [];
          const id = String(session?.id ?? "");
          if (!id) return [];
          return [{
            id,
            title:
              String(session?.title ?? session?.slug ?? session?.id ?? "").trim() ||
              t("session.untitled"),
          }];
        }),
    [sessionsByWorkspaceId],
  );

  const reloadWorkspaceEngineFromUi = useCallback(async () => {
    const workspaceId = routeStateRef.current.runtimeWorkspaceId?.trim() || selectedWorkspaceId.trim();
    if (!onmyagentClient || !workspaceId) {
      setRouteError(t("app.error_connect_first"));
      return false;
    }

    await onmyagentClient.reloadEngine(workspaceId);
    await refreshProviderListQueries(getReactQueryClient());

    try {
      window.dispatchEvent(new CustomEvent("onmyagent-server-settings-changed"));
    } catch {
      // ignore browser event dispatch failures
    }

    // OpenCode reconnects MCPs async after dispose — the store polls until
    // statuses settle so users don't have to collapse/expand the card.
    void pollMcpServersAfterReloadRef.current?.();

    return true;
  }, [onmyagentClient, selectedWorkspaceId]);

  useEffect(() => {
    return reloadCoordinator.registerWorkspaceReloadControls({
      canReloadWorkspaceEngine: () => Boolean(onmyagentClient && (selectedWorkspace?.id || selectedWorkspaceId)),
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
        setError: setRouteError,
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
      ? workspaceSettingsRoute(selectedWorkspaceId, "cloud-workers")
      : "/settings/cloud-workers";
    navigate(accountPath);
    window.setTimeout(() => {
      platform.openLink(getDenInferenceUrl(cloudSession.baseUrl));
    }, 0);
  }, [cloudSession.baseUrl, navigate, platform, providerAuthStore, selectedWorkspaceId]);

  const handleOpenCustomProviderConfig = useCallback(() => {
    setConfigActionStatus(null);
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

    void providerAuthStore.openProviderAuthModal();
  }, [checkDesktopRestriction, providerAuthStore, restrictionNotice]);

  useEffect(() => {
    if (!activeClient || !selectedWorkspaceId) return;

    void providerAuthStore
      .ensureProjectProviderDisabledState(
        "opencode",
        checkDesktopRestriction({ restriction: "allowZenModel" }),
      )
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
    setRouteError,
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
    setError: setRouteError,
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
  }, [opencodeClient]);

  useEffect(() => {
    const client = selectedWorkspaceEndpoint?.client ?? onmyagentClient;
    const workspaceId = runtimeWorkspaceId?.trim() ?? "";
    if (!client || !workspaceId) {
      setImageExtensionInstalled(false);
      return;
    }

    let cancelled = false;
    void client.listPlugins(workspaceId, { includeGlobal: false })
      .then((result) => {
        if (cancelled) return;
        setImageExtensionInstalled(
          result.items.some((item) =>
            item.spec.includes(OPENAI_IMAGE_EXTENSION_ID) ||
            item.path?.includes(OPENAI_IMAGE_EXTENSION_ID) === true,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setImageExtensionInstalled(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onmyagentClient, runtimeWorkspaceId, selectedWorkspaceEndpoint]);

  useEffect(() => {
    if (!onmyagentClient) {
      setUserEnvKeys([]);
      return;
    }
    let cancelled = false;
    void onmyagentClient.listUserEnvKeys()
      .then((response) => { if (!cancelled) setUserEnvKeys(response.keys); })
      .catch(() => { if (!cancelled) setUserEnvKeys([]); });
    return () => { cancelled = true; };
  }, [onmyagentClient]);

  const installOpenAiImageExtension = useCallback(async (apiKey: string) => {
    const workspaceClient = selectedWorkspaceEndpoint?.client ?? onmyagentClient;
    const workspaceId = runtimeWorkspaceId?.trim() ?? "";
    const resolvedApiKey = apiKey.trim();
    if (!workspaceClient || !workspaceId) {
      setImageExtensionError(t("extensions.openai_image_server_not_connected"));
      return;
    }
    if (!resolvedApiKey) {
      setImageExtensionError(t("extensions.openai_image_api_key_required"));
      return;
    }

    setImageExtensionBusy(true);
    setImageExtensionStatus(null);
    setImageExtensionError(null);
    try {
      await installOpenAiImageExtensionFiles({
        apiKey: resolvedApiKey,
        client: workspaceClient,
        workspaceId,
      });
      // upsertUserEnv requires the host token; use onmyagentClient which carries it.
      if (onmyagentClient) {
        await onmyagentClient.upsertUserEnv([{ key: OPENAI_API_KEY_ENV_KEY, value: resolvedApiKey }]);
        setUserEnvKeys((current) => Array.from(new Set([...current, OPENAI_API_KEY_ENV_KEY])));
      }
      reloadCoordinator.markReloadRequired("plugins", { type: "plugin", name: OPENAI_IMAGE_EXTENSION_ID, action: "added" });
      setImageExtensionInstalled(true);
      setImageExtensionStatus(t("extensions.openai_image_installed_status"));
    } catch (error) {
      setImageExtensionError(describeRouteError(error));
    } finally {
      setImageExtensionBusy(false);
    }
  }, [onmyagentClient, reloadCoordinator, runtimeWorkspaceId, selectedWorkspaceEndpoint]);

  const generateOpenAiTestImage = useCallback(async (input: { apiKey: string; prompt: string }) => {
    const client = selectedWorkspaceEndpoint?.client ?? onmyagentClient;
    const workspaceId = runtimeWorkspaceId?.trim() ?? "";
    const apiKey = input.apiKey.trim();
    const prompt = input.prompt.trim();
    if (!client || !workspaceId) {
      setImageGenerationError(t("extensions.openai_image_server_not_connected"));
      return;
    }
    if (!apiKey) {
      setImageGenerationError(t("extensions.openai_image_api_key_required"));
      return;
    }
    if (!prompt) {
      setImageGenerationError(t("app.error_prompt_required"));
      return;
    }

    setImageGenerationBusy(true);
    setImageGenerationStatus(null);
    setImageGenerationError(null);
    try {
      const payload = await requestOpenAiImage({ apiKey, prompt });
      const data = await openAiImageResponseToArrayBuffer(payload);
      const fileName = `${slugifyImageArtifactName(prompt)}.png`;
      await client.writeWorkspaceBinaryFile(workspaceId, { path: `artifacts/${fileName}`, data, force: true });
      setImageGenerationStatus(t("extensions.openai_image_generated_status", { fileName, model: OPENAI_IMAGE_MODEL }));
    } catch (error) {
      setImageGenerationError(describeRouteError(error));
    } finally {
      setImageGenerationBusy(false);
    }
  }, [onmyagentClient, runtimeWorkspaceId, selectedWorkspaceEndpoint]);

  const saveVoiceApiKey = useCallback(async (apiKey: string) => {
    const resolvedApiKey = apiKey.trim();
    if (!onmyagentClient || !resolvedApiKey) {
      setVoiceError(t("extensions.voice_openai_api_key_required"));
      return;
    }
    setVoiceBusy(true);
    setVoiceStatus(null);
    setVoiceError(null);
    try {
      await onmyagentClient.upsertUserEnv([{ key: OPENAI_API_KEY_ENV_KEY, value: resolvedApiKey }]);
      setUserEnvKeys((current) => Array.from(new Set([...current, OPENAI_API_KEY_ENV_KEY])));
      setVoiceStatus(t("extensions.voice_saved_status"));
    } catch (error) {
      setVoiceError(describeRouteError(error));
    } finally {
      setVoiceBusy(false);
    }
  }, [onmyagentClient]);

  const testVoiceSession = useCallback(async () => {
    if (!onmyagentClient) {
      setVoiceError(t("extensions.voice_server_not_connected"));
      return;
    }
    setVoiceBusy(true);
    setVoiceStatus(null);
    setVoiceError(null);
    try {
      const session = await onmyagentClient.createVoiceRealtimeSession();
      setVoiceStatus(t("extensions.voice_realtime_ready_status", { model: session.model, count: session.tools.length }));
    } catch (error) {
      setVoiceError(describeRouteError(error));
    } finally {
      setVoiceBusy(false);
    }
  }, [onmyagentClient]);

  const installLocalProvider = useCallback(async (input: LocalProviderInstallInput) => {
    const client = selectedWorkspaceEndpoint?.client ?? onmyagentClient;
    const workspaceId = runtimeWorkspaceId?.trim() ?? "";
    const modelId = input.modelId.trim();
    if (!client || !workspaceId) {
      setLocalProviderError(t("extensions.local_provider_server_not_connected"));
      return;
    }
    if (!modelId) {
      setLocalProviderError(t("extensions.local_provider_model_required"));
      return;
    }

    setLocalProviderBusy(true);
    setLocalProviderStatus(null);
    setLocalProviderError(null);
    try {
      await client.patchConfig(workspaceId, {
        opencode: {
          provider: {
            [input.providerId]: {
              npm: "@ai-sdk/openai-compatible",
              name: input.name,
              options: { baseURL: input.baseURL },
              models: { [modelId]: { name: input.modelName.trim() || modelId } },
            },
          },
        },
      });
      if (input.setDefault) {
        local.setPrefs((previous) => ({
          ...previous,
          defaultModel: { providerID: input.providerId, modelID: modelId },
          modelVariant: null,
        }));
      }
      reloadCoordinator.markReloadRequired("config", { type: "config", name: "opencode.json", action: "updated" });
      try {
        await client.reloadEngine(workspaceId);
      } catch {
        // The reload toast still lets the user retry if the immediate reload fails.
      }
      await refreshProviderListQueries(getReactQueryClient());
      try {
        window.dispatchEvent(new CustomEvent("onmyagent-server-settings-changed"));
      } catch {
        // ignore browser event dispatch failures
      }
      setLocalProviderStatus(t("extensions.local_provider_added_status", { name: input.name, modelId }));
    } catch (error) {
      setLocalProviderError(describeRouteError(error));
    } finally {
      setLocalProviderBusy(false);
    }
  }, [local, onmyagentClient, reloadCoordinator, runtimeWorkspaceId, selectedWorkspaceEndpoint]);

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
              isFree: false,
              isConnected: true,
              isRecommended: isNew,
              source: /^lpr_/i.test(provider.id) ? "cloud" as const : undefined,
            });
          }
        }
        setModelOptions(options);
      } catch (error) {
        setRouteError(
          error instanceof Error
            ? error.message
            : t("app.unknown_error"),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelPickerOpen, opencodeBaseUrl, opencodeClient, selectedWorkspaceRoot]);

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
  const refreshRouteState = useMemo(() => async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    setRouteError(null);
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
      setRouteError(message);
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
      setRouteError(message);
    });
  }, [loading, onmyagentClient, selectedWorkspace, workspaces]);

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

  useEffect(() => {
    if (!activeClient) {
      setProviders([]);
      setProviderDefaults({});
      setProviderConnectedIds([]);
      setDisabledProviders([]);
      return;
    }
    void providerAuthStore.refreshProviders();
    void connectionsStore.refreshMcpServers();
  }, [activeClient, connectionsStore, providerAuthStore, selectedWorkspace?.id]);

  const loadOpenCodeManagedProviders = useCallback(async () => {
    if (!selectedWorkspaceRoot) return [];
    try {
      const snapshot = await agentManagementSnapshot({ workspaceRoot: selectedWorkspaceRoot });
      return snapshot.providers.byAgent.opencode;
    } catch (error) {
      console.warn("[settings] failed to load OpenCode managed providers", error);
      return [];
    }
  }, [selectedWorkspaceRoot]);

  useEffect(() => {
    if (route.tab !== "ai" || !selectedWorkspaceRoot) {
      setOpenCodeManagedProviders([]);
      return;
    }
    let cancelled = false;
    void loadOpenCodeManagedProviders().then((providers) => {
      if (cancelled) return;
      setOpenCodeManagedProviders(providers);
    });
    return () => {
      cancelled = true;
    };
  }, [loadOpenCodeManagedProviders, route.tab, selectedWorkspaceRoot]);

  const selectedWorkspaceName = selectedWorkspace?.displayNameResolved ?? t("session.workspace_fallback");
  const workspaceOptions = workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.displayNameResolved,
    color: workspaceSwatchColor(workspace.id),
  }));
  const selectedWorkspaceColor = workspaceSwatchColor(selectedWorkspaceId);
  const workspaceType = selectedWorkspace?.workspaceType ?? "local";
  const isRemoteWorkspace = workspaceType === "remote";
  const canWriteWorkspaceSkills =
    !isRemoteWorkspace || onmyagentServerSnapshot.onmyagentServerCanWriteSkills;
  const canWriteWorkspacePlugins =
    !isRemoteWorkspace || onmyagentServerSnapshot.onmyagentServerCanWritePlugins;
  const skillsAccessHint =
    isRemoteWorkspace && !canWriteWorkspaceSkills ? t("app.skills_hint_readonly") : null;
  const pluginsAccessHint =
    isRemoteWorkspace && !canWriteWorkspacePlugins ? t("app.plugins_hint_readonly") : null;
  const defaultModelLabel = local.prefs.defaultModel
    ? (() => {
        const provider = providers.find((item) => item.id === local.prefs.defaultModel?.providerID);
        const model = provider?.models?.[local.prefs.defaultModel.modelID];
        const providerLabel = provider?.name ?? resolveProviderDisplayName(local.prefs.defaultModel.providerID);
        const modelLabel = model?.name ?? resolveModelDisplayName(local.prefs.defaultModel.modelID);
        return `${providerLabel} - ${modelLabel}`;
      })()
    : t("session.default_model");
  const defaultModelRef = local.prefs.defaultModel
    ? `${local.prefs.defaultModel.providerID}/${local.prefs.defaultModel.modelID}`
    : t("settings.default_label");
  const defaultModelVariantLabel = local.prefs.modelVariant ?? t("settings.default_label");
  const providerConnectedIdSet = new Set(providerConnectedIds);
  const connectedProvidersById = new Map<string, AiSettingsConnectedProvider>();
  for (const provider of providers) {
    if (!providerConnectedIdSet.has(provider.id) || isBlockedProvider(provider.id)) continue;
    connectedProvidersById.set(provider.id, {
      id: provider.id,
      name: provider.name ?? provider.id,
      source: normalizeSettingsProviderSource(provider.source),
    });
  }
  for (const provider of opencodeManagedProviders) {
    if (!provider.livePresent || isBlockedProvider(provider.id)) continue;
    connectedProvidersById.set(provider.id, {
      id: provider.id,
      name: provider.name || provider.id,
      source: "custom",
      managedBy: "opencode",
    });
  }
  const connectedProviders = [...connectedProvidersById.values()];
  const providerStatusLabel = connectedProviders.length > 0 ? t("status.connected") : t("status.disconnected_label");
  const providerStatusStyle = connectedProviders.length > 0
    ? "border-dls-status-success-border bg-dls-status-success-soft text-dls-status-success-fg"
    : "bg-dls-active text-dls-secondary border-dls-mist";
  const providerSummary = connectedProviders.length > 0
    ? t("status.providers_connected", { count: connectedProviders.length })
    : t("settings.no_providers_connected");
  const mcpConnectedAppsCount = connectionsSnapshot.mcpServers.length;

  // Build enablement context from all available runtime state.
  const enablementContext = useMemo<EnablementContext>(() => {
    const mcpConfigured = new Set(connectionsSnapshot.mcpServers.map((s) => s.name));
    const connectedProviders = new Set(providerConnectedIds);
    const configuredEnvKeys = new Set(userEnvKeys);
    const loadedPlugins = new Set<string>();
    // imageExtensionInstalled is derived from listPlugins — add it to the set.
    if (imageExtensionInstalled) loadedPlugins.add(OPENAI_IMAGE_EXTENSION_ID);
    return {
      mcpStatuses: connectionsSnapshot.mcpStatuses,
      mcpConfigured,
      loadedPlugins,
      connectedProviders,
      configuredEnvKeys,
      // Toggle state reader for extensions with defaultEnabled / explicit toggle.
      isToggleEnabled: (ref: string) => {
        const catalog = connectionsStore.quickConnect;
        const match = catalog.find((e: { id?: string; serverName?: string }) => (e.id ?? e.serverName) === ref);
        return match ? isOnMyAgentExtensionEnabled(match) : false;
      },
    };
  }, [connectionsSnapshot, providerConnectedIds, userEnvKeys, imageExtensionInstalled]);
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

  const handleRestartLocalServer = handleRestartOnMyAgentServerAndRefresh;
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
    navigateSettingsPath("cloud-workers");
  };

  const settingsView = (() => {
    switch (route.tab) {
      case "general":
        return (
          <GeneralSettingsView
            onNavigateTab={(tab) => navigateSettingsPath(tab)}
            developerMode={developerMode}
            onSendFeedback={() => platform.openLink(buildFeedbackUrl({ entrypoint: "settings" }))}
            onReportIssue={() => platform.openLink("https://github.com/WeaveQ/onmyagent/issues/new?template=bug.yml")}
          />
        );
      case "permissions":
        return (
          <SettingsStack>
            <AuthorizedFoldersPanel
              onmyagentServerClient={onmyagentClient}
              onmyagentServerStatus={routeOnMyAgentStatus}
              onmyagentServerCapabilities={routeOnMyAgentCapabilities}
              runtimeWorkspaceId={runtimeWorkspaceId}
              selectedWorkspaceRoot={selectedWorkspaceRoot}
              activeWorkspaceType={workspaceType}
              onConfigUpdated={() => {
                setConfigActionStatus(t("settings.config_updated"));
                void providerAuthStore.refreshProviders();
                void connectionsStore.refreshMcpServers();
              }}
            />
            <SystemAuthorizationsView />
          </SettingsStack>
        );
      case "ai":
        return (
          <AiSettingsView
            busy={busy}
            providerAuthBusy={providerAuthSnapshot.providerAuthBusy}
            providerStatusLabel={providerStatusLabel}
            providerStatusStyle={providerStatusStyle}
            providerSummary={providerSummary}
            providerConnected={connectedProviders.length > 0}
            connectedProviders={connectedProviders}
            disconnectingProviderId={null}
            providerConnectError={providerAuthSnapshot.providerAuthError}
            providerDisconnectStatus={configActionStatus}
            providerDisconnectError={null}
            onOpenProviderAuth={handleOpenProviderAuth}
            onOpenOpencodeConfig={handleOpenCustomProviderConfig}
            onDisconnectProvider={async (providerId) => {
              await providerAuthStore.disconnectProvider(providerId);
            }}
            canDisconnectProvider={(provider) => provider.managedBy !== "opencode"}
            cloudProviderIds={new Set(
              Object.values(providerAuthSnapshot.importedCloudProviders ?? {}).map((p) => p.providerId)
            )}
            showOnMyAgentModelsSubscribe={showOnMyAgentModelsSubscribe}
            onSubscribeOnMyAgentModels={subscribeToOnMyAgentModels}
            cloudProvidersView={
              <CloudProvidersView
                embedded
                cloudOrgProviders={providerAuthSnapshot.cloudOrgProviders}
                connectCloudProvider={providerAuthStore.connectCloudProvider}
                importedCloudProviders={providerAuthSnapshot.importedCloudProviders}
                refreshCloudOrgProviders={providerAuthStore.refreshCloudOrgProviders}
                removeCloudProvider={providerAuthStore.removeCloudProvider}
                session={denSession}
              />
            }
          />
        );
      case "memory":
        return (
          <MemoryView
            draft={memoryDraft ?? {
              userName: "",
              assistantName: "",
              mbti: "",
              roles: [],
              industries: [],
              tools: [],
              tasks: [],
              skipped: false,
              updatedAt: 0,
            }}
            onDraftChange={setMemoryDraft}
          />
        );
      case "preferences":
        return (
          <PreferencesView
            busy={busy}
            showThinking={local.prefs.showThinking}
            onToggleShowThinking={() => {
              local.setPrefs((previous) => ({ ...previous, showThinking: !previous.showThinking }));
            }}
            responseTone={local.prefs.responseTone}
            onResponseToneChange={(responseTone) => {
              local.setPrefs((previous) => ({ ...previous, responseTone }));
            }}
            customInstructions={local.prefs.customInstructions}
            onCustomInstructionsChange={(customInstructions) => {
              local.setPrefs((previous) => ({ ...previous, customInstructions }));
            }}
            autoCompactContext={autoCompactContext}
            autoCompactContextBusy={autoCompactContextBusy}
            onToggleAutoCompactContext={toggleAutoCompactContext}
            desktopNotifyOnAgentReady={local.prefs.desktopNotifyOnAgentReady === true}
            onDesktopNotifyOnAgentReadyChange={(enabled) => {
              local.setPrefs((previous) => ({
                ...previous,
                desktopNotifyOnAgentReady: enabled,
              }));
            }}
          />
        );
      case "skills":
        return (
          <SkillsView
            workspaceName={selectedWorkspaceName}
            busy={busy}
            canInstallSkillCreator={canWriteWorkspaceSkills}
            canUseDesktopTools={!isRemoteWorkspace}
            accessHint={skillsAccessHint}
            extensions={extensionsStore}
            onOpenLink={(url) => platform.openLink(url)}
            createSessionAndOpen={async (_command?: string): Promise<string | undefined> => {
              props.onClose?.();
              navigate(selectedWorkspaceId ? workspaceSessionRoute(selectedWorkspaceId) : "/session");
              return undefined;
            }}
          />
        );
      case "extensions":
        return (
          <ExtensionsView
            busy={busy}
            selectedWorkspaceRoot={selectedWorkspaceRoot}
            isRemoteWorkspace={isRemoteWorkspace}
            canEditPlugins={canWriteWorkspacePlugins}
            canUseGlobalScope={!isRemoteWorkspace}
            accessHint={pluginsAccessHint}
            suggestedPlugins={SUGGESTED_PLUGINS}
            extensions={extensionsStore}
            mcpConnectedAppsCount={mcpConnectedAppsCount}
            initialSection={route.extensionsSection}
            setSectionRoute={(section) => {
              const path = `extensions/${section}`;
              navigateSettingsPath(path);
            }}
            onRefresh={() => {
              void connectionsStore.refreshMcpServers();
              void extensionsStore.refreshPlugins();
              void extensionsStore.refreshCloudOrgMarketplaces({ force: true });
            }}
            mcpView={
              <McpView
                busy={busy}
                selectedWorkspaceRoot={selectedWorkspaceRoot}
                isRemoteWorkspace={isRemoteWorkspace}
                mcpServers={connectionsSnapshot.mcpServers}
                mcpStatus={connectionsSnapshot.mcpStatus}
                mcpLastUpdatedAt={connectionsSnapshot.mcpLastUpdatedAt}
                mcpStatuses={connectionsSnapshot.mcpStatuses}
                mcpConnectingName={connectionsSnapshot.mcpConnectingName}
                selectedMcp={connectionsSnapshot.selectedMcp}
                setSelectedMcp={(name) => connectionsStore.setSelectedMcp(name)}
                quickConnect={connectionsStore.quickConnect}
                enablementContext={enablementContext}
                builtInExtensionsDisabled={checkDesktopRestriction({ restriction: "allowBuiltInExtensions" })}
                connectMcp={(entry) => {
                  void connectionsStore.connectMcp(entry);
                }}
                configSlotForEntry={(entry) => getExtensionConfigSlot(entry, {
                  onmyagentServerClient: selectedWorkspaceEndpoint?.client ?? onmyagentClient,
                  computerUse: {
                    connected: connectionsSnapshot.mcpServers.some((server) => server.name === "computer-use"),
                    connecting: connectionsSnapshot.mcpConnectingName === entry.name,
                    onConnect: () => connectionsStore.connectMcp(entry),
                    onRefresh: () => connectionsStore.refreshMcpServers(),
                  },
                  imageExtension: {
                    busy: imageExtensionBusy || imageGenerationBusy,
                    status: imageExtensionStatus ?? imageGenerationStatus,
                    error: imageExtensionError ?? imageGenerationError,
                    envKeyDetected: providers.some((p) => p.id === "openai" && p.source === "env") || providerConnectedIds.includes("openai"),
                    onInstall: installOpenAiImageExtension,
                    onTestGenerate: generateOpenAiTestImage,
                  },
                  voiceExtension: {
                    busy: voiceBusy,
                    status: voiceStatus,
                    error: voiceError,
                    envKeyDetected:
                      userEnvKeys.includes("OPENAI_REALTIME_API_KEY") ||
                      userEnvKeys.includes(OPENAI_API_KEY_ENV_KEY) ||
                      providers.some((p) => p.id === "openai" && p.source === "env") ||
                      providerConnectedIds.includes("openai"),
                    onSaveApiKey: saveVoiceApiKey,
                    onTestSession: testVoiceSession,
                  },
                  localProvider: {
                    busy: localProviderBusy,
                    status: localProviderStatus,
                    error: localProviderError,
                    onInstall: installLocalProvider,
                  },
                })}
                isExtensionConnected={(entry) => {
                  const runtimeConnected = getExtensionConnected(entry, {
                    onmyagentServerClient: selectedWorkspaceEndpoint?.client ?? onmyagentClient,
                  });
                  if (runtimeConnected !== null) return runtimeConnected;
                  const id = entry.serverName ?? entry.name;
                  if (id === "openai-image-gen") return imageExtensionInstalled;
                  if (id === "ollama") return providerConnectedIds.includes("ollama");
                  return false;
                }}
                authorizeMcp={(entry) => {
                  void connectionsStore.authorizeMcp(entry);
                }}
                logoutMcpAuth={(name) => connectionsStore.logoutMcpAuth(name)}
                removeMcp={(name) => {
                  void connectionsStore.removeMcp(name);
                }}
                setMcpEnabled={
                  routeOnMyAgentStatus === "connected" && routeOnMyAgentCapabilities?.mcp?.write
                    ? (name, enabled) => connectionsStore.setMcpEnabled(name, enabled)
                    : undefined
                }
                readConfigFile={(scope) => connectionsStore.readMcpConfigFile(scope)}
                installedSkills={extensionsStore.skills()}
                installedPlugins={Object.values(extensionsStore.importedCloudPlugins())}
                uninstallSkill={(name) => { void extensionsStore.uninstallSkill(name); }}
                removeCloudPlugin={(pluginId) => { void extensionsStore.removeCloudOrgPlugin(pluginId); }}
                readSkill={(name) => extensionsStore.readSkill(name)}
                showHeader={false}
              />
            }

            cloudMarketplaceView={
              <CloudMarketplacesView
                embedded
                extensions={extensionsStore}
                session={denSession}
              />
            }
          />
        );
      case "cloud-account":
        return null;
      case "cloud-marketplaces":
        return (
          <CloudMarketplacesView
            extensions={extensionsStore}
            session={denSession}
          />
        );
      case "cloud-workers":
        return (
          <CloudWorkersView
            connectRemoteWorkspace={async () => false}
          />
        );
      case "cloud-providers":
        return (
          <CloudProvidersView
            cloudOrgProviders={providerAuthSnapshot.cloudOrgProviders}
            connectCloudProvider={providerAuthStore.connectCloudProvider}
            importedCloudProviders={providerAuthSnapshot.importedCloudProviders}
            refreshCloudOrgProviders={providerAuthStore.refreshCloudOrgProviders}
            removeCloudProvider={providerAuthStore.removeCloudProvider}
            session={denSession}
          />
        );
      case "advanced":
        return (
          <AdvancedView
            busy={busy}
            baseUrl={opencodeBaseUrl}
            headerStatus={onmyagentServerSnapshot.onmyagentServerStatus}
            clientConnected={Boolean(opencodeClient)}
            opencodeConnectStatus={null}
            onmyagentServerStatus={onmyagentServerSnapshot.onmyagentServerStatus}
            onmyagentServerUrl={onmyagentServerSnapshot.onmyagentServerUrl}
            onmyagentReconnectBusy={onmyagentServerSnapshot.onmyagentReconnectBusy}
            reconnectOnMyAgentServer={onmyagentServerStore.reconnectOnMyAgentServer}
            engineInfo={null}
            restartLocalServer={handleRestartLocalServer}
            stopHost={() => {}}
            developerMode={developerMode}
            toggleDeveloperMode={() => setDeveloperMode((current) => {
              const next = !current;
              writeStoredBoolean(SETTINGS_DEVELOPER_MODE_KEY, next);
              return next;
            })}
            opencodeDevModeEnabled={false}
            openDebugDeepLink={async () => ({ ok: false, message: t("settings.debug_deep_links_unavailable") })}
            opencodeEnableExa={true}
            toggleOpencodeEnableExa={() => {}}
            microsandboxCreateSandboxEnabled={local.prefs.featureFlags.microsandboxCreateSandbox}
            toggleMicrosandboxCreateSandbox={() => {
              local.setPrefs((previous) => ({
                ...previous,
                featureFlags: {
                  ...previous.featureFlags,
                  microsandboxCreateSandbox: !previous.featureFlags.microsandboxCreateSandbox,
                },
              }));
            }}
            configView={{
              busy,
              clientConnected: Boolean(opencodeClient),
              anyActiveRuns: false,
              onmyagentServerStatus: onmyagentServerSnapshot.onmyagentServerStatus,
              onmyagentServerUrl: onmyagentServerSnapshot.onmyagentServerUrl,
              onmyagentServerSettings: onmyagentServerSnapshot.onmyagentServerSettings,
              onmyagentServerHostInfo: onmyagentServerSnapshot.onmyagentServerHostInfo,
              runtimeWorkspaceId,
              updateOnMyAgentServerSettings: onmyagentServerStore.updateOnMyAgentServerSettings,
              resetOnMyAgentServerSettings: onmyagentServerStore.resetOnMyAgentServerSettings,
              testOnMyAgentServerConnection: onmyagentServerStore.testOnMyAgentServerConnection,
              canReloadWorkspace: reloadCoordinator.canReloadWorkspaceEngine,
              reloadWorkspaceEngine: reloadCoordinator.reloadWorkspaceEngine,
              reloadBusy: false,
              reloadError: routeError,
              developerMode,
            }}
          />
        );
      case "updates":
        return (
          <UpdatesView
            busy={busy}
            webDeployment={platform.platform === "web"}
            appVersion={electronUpdaterState.appVersion}
            updateEnv={electronUpdaterState.updateEnv}
            updateAutoCheck={updateAutoCheck}
            toggleUpdateAutoCheck={() => setUpdateAutoCheck((current) => !current)}
            updateAutoDownload={updateAutoDownload}
            toggleUpdateAutoDownload={() => setUpdateAutoDownload((current) => !current)}
            updateStatus={electronUpdaterState.updateStatus}
            anyActiveRuns={activeReloadBlockingSessions.length > 0}
            checkForUpdates={electronUpdaterState.checkForUpdates}
            downloadUpdate={electronUpdaterState.downloadUpdate}
            installUpdateAndRestart={electronUpdaterState.installUpdateAndRestart}
            releaseChannel={local.prefs.releaseChannel ?? "stable"}
            onReleaseChannelChange={electronUpdaterState.setReleaseChannel}
            // Lightweight GitHub Releases checker is stable-only; main reports
            // alphaSupported=false. Prefer that over platform heuristics.
            alphaChannelSupported={electronUpdaterState.alphaSupported === true}
          />
        );
      case "recovery":
        return (
          <RecoveryView
            workspaceConfigPath={selectedWorkspaceRoot ? `${selectedWorkspaceRoot}/.opencode/onmyagent.json` : ""}
            configActionStatus={configActionStatus}
            cacheRepairResult={null}
            dockerCleanupResult={null}
          />
        );
      case "environment":
        return (
          <EnvironmentView
            client={onmyagentServerSnapshot.onmyagentServerClient}
            isRemoteWorkspace={isRemoteWorkspace}
            onApplyChanges={isDesktopRuntime() && !isRemoteWorkspace ? handleApplyEnvironmentChanges : undefined}
            applyBlocked={activeReloadBlockingSessions.length > 0}
            applyBlockedReason={
              activeReloadBlockingSessions.length > 0
                ? t("settings.environment.apply_blocked_active_tasks")
                : null
            }
            runtimeKey={environmentRuntimeKey}
          />
        );
      case "debug":
        return <DebugView {...debugViewProps} />;
      default:
        return null;
    }
  })();

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
        busyHint={loading ? t("session.loading_detail") : busyLabel}
        onClose={props.onClose ?? (() => navigate(selectedWorkspaceId ? workspaceSessionRoute(selectedWorkspaceId) : "/session"))}
        error={routeError ?? notFoundRouteError}
        compact={props.embedded}
        panelToolbarSlot={memoryToolbarSlot}
      >
        {settingsView}
      </SettingsShell>

      <OpenCodeProviderConfigDialog
        open={openCodeProviderConfigOpen}
        workspaceRoot={selectedWorkspaceRoot}
        onOpenChange={setOpenCodeProviderConfigOpen}
        onSaved={async () => {
          setConfigActionStatus(t("settings.config_updated"));
          const managedProviders = await loadOpenCodeManagedProviders();
          setOpenCodeManagedProviders(managedProviders);
          await providerAuthStore.refreshProviders();
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
        onOpenSettings={() => {}}
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
