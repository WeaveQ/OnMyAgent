/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigationType } from "react-router-dom";

import { createClient } from "../../../app/lib/opencode";
import {
  readOnMyAgentServerSettings,
  type OnMyAgentServerClient,
} from "../../../app/lib/onmyagent-server";
import {
  resolveWorkspaceEndpoint,
  workspaceServerId,
  type ResolvedWorkspaceEndpoint,
} from "../../../app/lib/workspace-endpoint";
import {
  buildSelectedWorkspaceRouteState,
  describeRouteError,
  toSessionGroups,
  workspaceLabel,
  type RouteWorkspace,
} from "./model";
import {
  emptyPendingPermissions,
  emptyPendingQuestions,
  emptyTodos,
  permissionQueryKeyForSession,
  questionQueryKeyForSession,
  todoQueryKeyForSession,
  useQueryCacheState,
} from "./state";
import { isSelectedModelUnavailable } from "./model-options";
import { readDeveloperModeEnabled } from "./storage";
import { useSessionRouteInspector } from "./inspector";
import { useRouteEngineInfo } from "./engine-info";
import { useSessionRouteRefs } from "./refs";
import {
  buildSidebarSessionStatusById,
  buildWorkspaceConnectionStateById,
  pruneWorkspaceConnectionStateById,
  removeWorkspaceConnectionStateById,
  resolveSidebarActiveWorkspaceId,
} from "./sidebar-model";
import {
  findFirstSessionIdMatching,
  filterExpertCreationEphemeralSessionsByWorkspace,
  getActiveReloadBlockingSessions,
  getActiveSessionIds,
  sessionListOwnsSession,
  toPaletteSessionOptions,
  type PendingCreatedSessionMap,
} from "./sessions";
import { isAssistantSession, useEnsureAgentRegistry } from "../../domains/agents";
import { useExpertDirectoryStore } from "../../capabilities/session-identity/expert-directory-store";
import type { OnMyAgentServerInfo } from "../../../app/lib/desktop";
import type {
  PendingPermission,
  PendingQuestion,
  SidebarSessionItem,
  TodoItem,
  WorkspaceConnectionState,
} from "../../../app/types";
import { isDesktopRuntime } from "../../../app/utils";
import { usePlatform } from "../../kernel/platform";
import { userErrorFromRaw } from "../../kernel/user-error";
import {
  useRemoteWorkspaceConnectionEditor,
  useShareWorkspaceState,
} from "../../domains/workspace";
import {
  useCheckDesktopRestriction,
  useRestrictionNotice,
} from "../../domains/cloud";
import { useBootState } from "../boot-state";
import {
  readActiveWorkspaceId,
  readCachedSidebarSessionsByWorkspace,
  readLastSessionFor,
  readSessionTodos,
  readWorkspaceOrderIds,
  writeSessionTodos,
} from "../session-memory";
import { useShellInteractiveLoad } from "../use-shell-interactive-load";
import { useReactRenderWatchdog } from "../react-render-watchdog";
import { ensureDesktopLocalOnMyAgentConnection } from "../desktop-local-onmyagent";
import { useStatusToasts } from "../../domains/shell-feedback";
import {
  readAssistantSessionWorkspace,
  useSessionActivityStore,
} from "../../domains/session";
import { resolveSelectedSessionFileRoot } from "../../capabilities/session-identity/expert-session-directory";
import { sessionRouteProviderListEnabled, useProviderListQuery } from "../../domains/connections";
import { useSessionRouteNavigation } from "./navigation-hook";
import { useSessionRouteChromeState } from "./chrome-state-hook";
import { useSessionRouteModelPickerState } from "./model-picker-state-hook";
import { useSessionRouteComposerRuntimeState } from "./composer-runtime-state-hook";
import { useSessionRouteSurfaceProps } from "./surface-props-hook";
import { useSessionRouteWorkspaceInteraction } from "./workspace-interaction-hook";
import { useSessionRoutePermissionQuestionHandlers } from "./permission-question-hook";
import { useSessionRouteGlobalShortcuts } from "./global-shortcuts-hook";
import { useSessionRouteSessionLoader } from "./session-loader-hook";
import { useSessionRouteRefresh } from "./refresh-hook";
import { useSessionRouteModelCatalog } from "./model-catalog-hook";
import { useSessionRouteQuickCapture } from "./quick-capture-hook";
import { useSessionRouteControlWiring } from "./session-control-wiring-hook";
import { SessionRoutePageView } from "./page-view";
import {
  resolveSessionRouteRestoreNavigation,
  shouldRedirectSessionRouteToWelcome,
} from "./control";
import {
  resolveSessionModelAvailabilityBlocksTask,
  resolveSessionRouteCanCreateTask,
  resolveSessionRouteShowPreparingStatus,
} from "./runtime-session-state";
import { useSessionRouteProviderAuth } from "./provider-auth-hook";
import { useBufferedSidebarRuntimeUpdates } from "./sidebar-runtime-update-hook";
import { useRuntimeRoute } from "./runtime-route-hook";
import { useSessionRouteApprovalSnapshots } from "./use-session-route-approval-snapshots";

export function SessionRouteRender() {
  const {
    navigate,
    local,
    sidebarAccount,
    setSidebarAccount,
    routeWorkspaceId,
    selectedSessionId,
    pageMode,
    agentManagementIntent,
    clearAgentManagementIntent,
    handleSignOut,
    navigateToWorkspaceSession,
    location,
  } = useSessionRouteNavigation();
  const navigationType = useNavigationType();
  const platform = usePlatform();
  const { showToast } = useStatusToasts();
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const restrictionNotice = useRestrictionNotice();

  const { markRouteReady: markBootRouteReady } = useBootState();
  const [loading, setLoading] = useState(true);
  const { shellInteractive } = useShellInteractiveLoad({
    loading,
    firstLoadScope: "route-session",
    softRefreshScope: "session-refresh",
  });
  const [client, setClient] = useState<OnMyAgentServerClient | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [workspaces, setWorkspaces] = useState<RouteWorkspace[]>([]);
  const [workspaceOrderIds, setWorkspaceOrderIds] = useState<string[]>(() =>
    readWorkspaceOrderIds(),
  );
  const [sessionsByWorkspaceId, setSessionsByWorkspaceId] = useState<
    Record<string, SidebarSessionItem[]>
  >(() => filterExpertCreationEphemeralSessionsByWorkspace(readCachedSidebarSessionsByWorkspace()));
  const [errorsByWorkspaceId, setErrorsByWorkspaceId] = useState<
    Record<string, string | null>
  >({});
  const [workspaceConnectionOverrides, setWorkspaceConnectionOverrides] =
    useState<Record<string, WorkspaceConnectionState>>({});
  const [routeError, setRouteError] = useState<string | null>(null);
  const [legacySelectedWorkspaceId, setLegacySelectedWorkspaceId] =
    useState<string>(() => readActiveWorkspaceId() ?? "");
  const selectedWorkspaceId = routeWorkspaceId || legacySelectedWorkspaceId;
  const expertDirectoryIdentity = useExpertDirectoryStore((state) =>
    state.getIdentity(selectedWorkspaceId),
  );
  const selectedWorkspace = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
      (selectedWorkspaceId ? null : (workspaces[0] ?? null)),
    [selectedWorkspaceId, workspaces],
  );
  const {
    localServerRef,
    sessionsByWorkspaceIdRef,
    workspacesRef,
    workspaceOrderIdsRef,
  } = useSessionRouteRefs({
    baseUrl,
    sessionsByWorkspaceId,
    token,
    workspaces,
    workspaceOrderIds,
  });
  const endpointForWorkspace = useCallback(
    (
      workspace: RouteWorkspace | null | undefined,
    ): ResolvedWorkspaceEndpoint | null =>
      resolveWorkspaceEndpoint(workspace, localServerRef.current),
    [],
  );
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [assistantDraftWorkspaceRoot, setAssistantDraftWorkspaceRoot] =
    useState("");
  const sessionMatchesPageMode = useCallback(
    (sessionId: string) =>
      pageMode === "assistant"
        ? isAssistantSession(sessionId)
        : expertDirectoryIdentity.sessionIds.has(sessionId),
    [expertDirectoryIdentity.sessionIds, pageMode],
  );
  const firstSessionIdForPageMode = useCallback(
    (workspaceId: string) =>
      findFirstSessionIdMatching(
        sessionsByWorkspaceId[workspaceId] ?? [],
        sessionMatchesPageMode,
      ),
    [sessionMatchesPageMode, sessionsByWorkspaceId],
  );
  const remoteWorkspaceCheckRunRef = useRef<Record<string, string>>({});
  const remoteWorkspaceCheckRunCounterRef = useRef(0);
  const pendingCreatedSessionIdsRef = useRef<PendingCreatedSessionMap>({});
  const creatingSessionWorkspaceIdsRef = useRef(new Set<string>());
  const suppressRestoreSessionRef = useRef(false);
  const forceNewSessionOnNextSendRef = useRef(false);
  const [retryingWorkspaceIds, setRetryingWorkspaceIds] = useState<string[]>(
    [],
  );
  const {
    createWorkspaceOpen,
    setCreateWorkspaceOpen,
    createWorkspaceBusy,
    setCreateWorkspaceBusy,
    createWorkspaceError,
    setCreateWorkspaceError,
    createWorkspaceRemoteBusy,
    setCreateWorkspaceRemoteBusy,
    createWorkspaceRemoteError,
    setCreateWorkspaceRemoteError,
    renameWorkspaceId,
    setRenameWorkspaceId,
    renameWorkspaceTitle,
    setRenameWorkspaceTitle,
    renameWorkspaceBusy,
    setRenameWorkspaceBusy,
    commandPaletteOpen,
    setCommandPaletteOpen,
    paletteAccessibleTargets,
    setPaletteAccessibleTargets,
  } = useSessionRouteChromeState({
    selectedSessionId,
    selectedWorkspaceId,
  });
  const {
    modelPickerOpen,
    setModelPickerOpen,
    compactModelPickerOpen,
    setCompactModelPickerOpen,
    modelPickerQuery,
    setModelPickerQuery,
    modelOptions,
    setModelOptions,
    recentProviderIds,
    setRecentProviderIds,
    denSessionVersion,
  } = useSessionRouteModelPickerState();

  useEnsureAgentRegistry(client, selectedWorkspaceId || undefined);

  const {
    permissionReplyBusy,
    setPermissionReplyBusy,
    permissionReplyBusyRef,
    sessionAccessModeById,
    setSessionAccessModeById,
    sessionCollaborationModeById,
    setSessionCollaborationModeById,
    sessionModelOverrideById,
    setSessionModelOverrideById,
    sessionPlanRuntimeById,
    setSessionPlanRuntimeById,
    sessionGoalRuntimeById,
    setSessionGoalRuntimeById,
    autoApprovedPermissionNoticeBySessionId,
    setAutoApprovedPermissionNoticeBySessionId,
    questionReplyBusy,
    setQuestionReplyBusy,
    questionReplyBusyRef,
    pendingAgent,
  } = useSessionRouteComposerRuntimeState({ selectedWorkspaceId });

  const [onmyagentServerHostInfoState, setOnMyAgentServerHostInfoState] =
    useState<OnMyAgentServerInfo | null>(null);
  useReactRenderWatchdog("SessionRoute", {
    selectedSessionId,
    selectedWorkspaceId,
    loading,
    workspaceCount: workspaces.length,
    sessionGroupCount: Object.keys(sessionsByWorkspaceId).length,
    commandPaletteOpen,
    modelPickerOpen,
  });
  const [onmyagentServerSettingsVersion, setOnMyAgentServerSettingsVersion] =
    useState(0);
  const [engineReloadVersion, setEngineReloadVersion] = useState(0);
  const routeEngineInfo = useRouteEngineInfo();
  const reconnectAttemptedWorkspaceIdRef = useRef("");

  const onmyagentServerSettings = useMemo(
    () => readOnMyAgentServerSettings(),
    [onmyagentServerSettingsVersion],
  );

  const shareWorkspaceState = useShareWorkspaceState({
    workspaces,
    onmyagentServerHostInfo: onmyagentServerHostInfoState,
    onmyagentServerSettings,
    engineInfo: routeEngineInfo,
    exportWorkspaceBusy: false,
    openLink: (url) => platform.openLink(url),
    workspaceLabel,
  });

  const activeReloadBlockingSessions = useMemo(
    () => getActiveReloadBlockingSessions(sessionsByWorkspaceId),
    [sessionsByWorkspaceId],
  );
  const activeSelectedWorkspaceSessionIds = useMemo(
    () => getActiveSessionIds(sessionsByWorkspaceId[selectedWorkspaceId] ?? []),
    [selectedWorkspaceId, sessionsByWorkspaceId],
  );

  const {
    loadWorkspaceSessionsInBackground,
    rememberPendingCreatedSession,
  } = useSessionRouteSessionLoader({
    endpointForWorkspace,
    pendingCreatedSessionIdsRef,
    sessionsByWorkspaceId, sessionsByWorkspaceIdRef,
    setErrorsByWorkspaceId,
    setRetryingWorkspaceIds,
    setSessionsByWorkspaceId,
    setWorkspaceConnectionOverrides,
    workspacesRef,
  });

  const {
    refreshRouteState,
    remoteAccessRestart,
    reloadCoordinator,
  } = useSessionRouteRefresh({
    activeReloadBlockingSessions,
    client,
    endpointForWorkspace,
    loadWorkspaceSessionsInBackground,
    localServerRef,
    markBootRouteReady,
    waitForStaticHomeFirstPaint:
      pageMode === "assistant" && selectedSessionId === null,
    onmyagentServerSettings,
    routeWorkspaceId,
    selectedSessionId,
    selectedWorkspace,
    selectedWorkspaceId,
    sessionsByWorkspaceIdRef,
    setBaseUrl,
    setClient,
    setEngineReloadVersion,
    setErrorsByWorkspaceId,
    setLegacySelectedWorkspaceId,
    setLoading,
    setOnMyAgentServerHostInfoState,
    setOnMyAgentServerSettingsVersion,
    setRetryingWorkspaceIds,
    setRouteError,
    setSessionsByWorkspaceId,
    setToken,
    setWorkspaces,
    workspaceOrderIdsRef,
    workspacesRef,
  });

  const enqueueSidebarRuntimeUpdate = useBufferedSidebarRuntimeUpdates({
    sessionsByWorkspaceIdRef,
    setSessionsByWorkspaceId,
  });

  const handleRuntimeSessionUpdated = useCallback(
    (update: { sessionId: string; info: Record<string, unknown> }) => {
      if (!selectedWorkspaceId) return;
      enqueueSidebarRuntimeUpdate({
        kind: "info",
        workspaceId: selectedWorkspaceId,
        update,
      });
    },
    [enqueueSidebarRuntimeUpdate, selectedWorkspaceId],
  );

  const handleRuntimeSessionStatus = useCallback(
    (update: { sessionId: string; status: unknown }) => {
      if (!selectedWorkspaceId) return;
      enqueueSidebarRuntimeUpdate({
        kind: "status",
        workspaceId: selectedWorkspaceId,
        update,
      });
    },
    [enqueueSidebarRuntimeUpdate, selectedWorkspaceId],
  );

  useEffect(() => {
    const activeWorkspaceIds = new Set(
      workspaces.map((workspace) => workspace.id),
    );
    setWorkspaceConnectionOverrides((current) =>
      pruneWorkspaceConnectionStateById({
        states: current,
        activeWorkspaceIds,
      }),
    );
  }, [workspaces]);

  const handleRemoteWorkspaceConnectionSaved = useCallback(
    async (workspaceId: string) => {
      delete remoteWorkspaceCheckRunRef.current[workspaceId];
      setWorkspaceConnectionOverrides((current) =>
        removeWorkspaceConnectionStateById({ states: current, workspaceId }),
      );
      setErrorsByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: null,
      }));
      setRetryingWorkspaceIds((current) =>
        current.filter((id) => id !== workspaceId),
      );
      await refreshRouteState();
    },
    [refreshRouteState],
  );

  const remoteWorkspaceConnectionEditor = useRemoteWorkspaceConnectionEditor({
    workspaces,
    onSaved: handleRemoteWorkspaceConnectionSaved,
  });

  const sessionRouteInspectorInput = useMemo(
    () => ({
      baseUrl,
      clientConnected: Boolean(client),
      errorsByWorkspaceId,
      loading,
      retryingWorkspaceIds,
      routeError,
      selectedSessionId,
      selectedWorkspaceId,
      sessionsByWorkspaceId,
      token,
      workspaces,
    }),
    [
      baseUrl,
      client,
      errorsByWorkspaceId,
      loading,
      retryingWorkspaceIds,
      routeError,
      selectedSessionId,
      selectedWorkspaceId,
      sessionsByWorkspaceId,
      token,
      workspaces,
    ],
  );
  useSessionRouteInspector(sessionRouteInspectorInput);

  // Once workspaces are loaded, repair invalid workspace URLs. Do not re-open
  // the last chat when the URL has no sessionId — cold start stays on new-task home.
  useEffect(() => {
    const navigation = resolveSessionRouteRestoreNavigation({
      firstSessionIdForPageMode,
      legacySelectedWorkspaceId,
      loading,
      navigationType,
      pageMode,
      readLastSessionFor,
      routeWorkspaceId,
      selectedSessionId,
      selectedWorkspaceId,
      sessionListOwnsSession,
      sessionMatchesPageMode,
      sessionsByWorkspaceId,
      suppressRestoreSession: suppressRestoreSessionRef.current,
      workspaces,
    });
    if (navigation.type === "workspace") {
      navigateToWorkspaceSession(navigation.workspaceId, navigation.sessionId, {
        replace: true,
      });
      return;
    }
    if (navigation.type === "reset-suppression") {
      suppressRestoreSessionRef.current = false;
    }
  }, [
    firstSessionIdForPageMode,
    loading,
    legacySelectedWorkspaceId,
    navigateToWorkspaceSession,
    navigationType,
    pageMode,
    routeWorkspaceId,
    selectedSessionId,
    selectedWorkspaceId,
    sessionMatchesPageMode,
    sessionsByWorkspaceId,
    workspaces,
  ]);

  useEffect(() => {
    if (
      !shouldRedirectSessionRouteToWelcome({
        hasCompletedOnboarding: local.prefs.hasCompletedOnboarding,
        loading,
        workspaceCount: workspaces.length,
      })
    )
      return;
    navigate("/welcome", { replace: true });
  }, [
    loading,
    local.prefs.hasCompletedOnboarding,
    navigate,
    workspaces.length,
  ]);


  const workspaceSessionGroups = useMemo(
    () =>
      toSessionGroups(
        workspaces,
        sessionsByWorkspaceId,
        errorsByWorkspaceId,
        new Set(retryingWorkspaceIds),
      ),
    [
      errorsByWorkspaceId,
      retryingWorkspaceIds,
      sessionsByWorkspaceId,
      workspaces,
    ],
  );
  const seedWorkspaceActivitySessions = useSessionActivityStore(
    (state) => state.seedWorkspaceSessions,
  );
  const sessionActivityByWorkspaceId = useSessionActivityStore(
    (state) => state.statusesByWorkspaceId,
  );

  useEffect(() => {
    for (const group of workspaceSessionGroups) {
      seedWorkspaceActivitySessions(group.workspace.id, group.sessions);
      const serverId = workspaceServerId(group.workspace);
      if (serverId && serverId !== group.workspace.id) {
        seedWorkspaceActivitySessions(serverId, group.sessions);
      }
    }
  }, [seedWorkspaceActivitySessions, workspaceSessionGroups]);

  const sidebarSessionStatusById = useMemo(
    () =>
      buildSidebarSessionStatusById({
        groups: workspaceSessionGroups,
        activityByWorkspaceId: sessionActivityByWorkspaceId,
      }),
    [sessionActivityByWorkspaceId, workspaceSessionGroups],
  );

  const sidebarActiveWorkspaceId = useMemo(
    () =>
      resolveSidebarActiveWorkspaceId({
        selectedSessionId,
        selectedWorkspaceId,
        groups: workspaceSessionGroups,
      }),
    [selectedSessionId, selectedWorkspaceId, workspaceSessionGroups],
  );

  const workspaceConnectionStateById = useMemo(
    () =>
      buildWorkspaceConnectionStateById({
        workspaces,
        errorsByWorkspaceId,
        overrides: workspaceConnectionOverrides,
      }),
    [errorsByWorkspaceId, workspaceConnectionOverrides, workspaces],
  );

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (loading) return;
    if (client) {
      reconnectAttemptedWorkspaceIdRef.current = "";
      return;
    }
    if (!selectedWorkspace || selectedWorkspace.workspaceType !== "local")
      return;
    const workspaceId = selectedWorkspace.id?.trim() ?? "";
    if (
      !workspaceId ||
      reconnectAttemptedWorkspaceIdRef.current === workspaceId
    )
      return;
    reconnectAttemptedWorkspaceIdRef.current = workspaceId;

    void ensureDesktopLocalOnMyAgentConnection({
      route: "session",
      workspace: selectedWorkspace,
      allWorkspaces: workspaces,
    }).catch((error) => {
      const message =
        error instanceof Error ? error.message : describeRouteError(error);
      setRouteError(userErrorFromRaw(message));
    });
  }, [client, loading, selectedWorkspace, workspaces]);

  const selectedSessionWorkspace =
    readAssistantSessionWorkspace(selectedSessionId);
  const selectedSessionDirectory =
    selectedSessionId && selectedWorkspaceId
      ? (sessionsByWorkspaceId[selectedWorkspaceId] ?? []).find(
          (session) => session.id === selectedSessionId,
        )?.directory
      : null;
  const {
    selectedWorkspaceRoot,
    sessionWorkspaceRoot,
    selectedWorkspaceError,
    routeNotFoundMessage,
    effectiveLoading: routeDataLoading,
  } = buildSelectedWorkspaceRouteState({
    selectedWorkspace,
    selectedSessionWorkspaceDirectory:
      selectedSessionWorkspace?.directory ?? "",
    selectedSessionDirectory,
    selectedSessionId,
    selectedWorkspaceId,
    routeWorkspaceId,
    loading,
    retryingWorkspaceIds,
    errorsByWorkspaceId,
    sessionsByWorkspaceId,
  });
  const effectiveLoading = routeDataLoading && !shellInteractive;
  const selectedSessionFileRoot = resolveSelectedSessionFileRoot({
    boundDirectory: selectedSessionWorkspace?.directory,
    sessionDirectory: selectedSessionDirectory,
    workspaceRoot: selectedWorkspaceRoot,
  });
  const selectedWorkspaceEndpoint = useMemo(
    () => resolveWorkspaceEndpoint(selectedWorkspace, { baseUrl, token }),
    [baseUrl, selectedWorkspace, token],
  );
  const selectedWorkspaceServerToken = selectedWorkspaceEndpoint?.token ?? "";
  const opencodeBaseUrl = selectedWorkspaceEndpoint?.opencodeBaseUrl ?? "";
  const opencodeClient = useMemo(
    () =>
      opencodeBaseUrl && selectedWorkspaceServerToken && !selectedWorkspaceError
        ? createClient(opencodeBaseUrl, sessionWorkspaceRoot || undefined, {
            token: selectedWorkspaceServerToken,
            mode: "onmyagent",
          })
        : null,
    [
      opencodeBaseUrl,
      selectedWorkspaceError,
      sessionWorkspaceRoot,
      selectedWorkspaceServerToken,
    ],
  );
  const {
    routeRuntimeKind,
    runtimeModelCatalog,
    opencodeCatalogClient,
    activeRuntimeSession,
  } = useRuntimeRoute({
    client,
    opencodeClient,
    workspaceId: selectedWorkspaceId,
    sessionId: selectedSessionId,
  });
  const providerListQuery = useProviderListQuery({
    client: opencodeCatalogClient,
    baseUrl: opencodeBaseUrl,
    directory: sessionWorkspaceRoot || undefined,
    enabled: sessionRouteProviderListEnabled({
      hasClient: Boolean(opencodeClient), pickerOpen: modelPickerOpen || compactModelPickerOpen,
    }),
  });

  const {
    allowedModelOptions, catalogContextWindow,
    disabledProviderIds,
    effectiveModelRef,
    handleOpenSettings,
    listSlashCommands,
    localeSnapshot,
    modelBehaviorOptions,
    modelLabel,
    modelVariantLabel,
    modelVariantValue,
    providerConnectedIds,
    providerDefaults,
    providers,
    refreshCreatedSessionSnapshot,
    setDisabledProviderIds,
    setProviderConnectedIds,
    setProviderDefaults,
    setProviders,
  } = useSessionRouteModelCatalog({
    checkDesktopRestriction,
    denSessionVersion,
    engineReloadVersion,
    local,
    modelOptions,
    modelPickerOpen,
    compactModelPickerOpen,
    navigate,
    opencodeBaseUrl,
    opencodeClient: opencodeCatalogClient,
    pageMode,
    pendingAgentModel: pendingAgent?.model,
    providerListData: providerListQuery.data,
    recentProviderIds,
    returnTo: `${location.pathname}${location.search}`,
    selectedSessionId,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
    sessionModelOverrideById,
    setSessionModelOverrideById,
    sessionWorkspaceRoot,
    setModelOptions,
    sidebarActiveWorkspaceId,
  });

  const selectedModelUnavailable = isSelectedModelUnavailable({
    model: effectiveModelRef,
    checkRestriction: checkDesktopRestriction,
    connectedProviderIds: providerConnectedIds,
    providerListData: providerListQuery.data,
    providerListLoading:
      !providerListQuery.data &&
      (providerListQuery.isPending || providerListQuery.isFetching),
  });
  const modelAvailabilityBlocksTask = resolveSessionModelAvailabilityBlocksTask({
    runtimeKind: routeRuntimeKind,
    unavailable: selectedModelUnavailable,
  });
  const canCreateTask = resolveSessionRouteCanCreateTask({
    hasOpencodeClient: Boolean(opencodeClient),
    selectedWorkspaceId,
    loading,
    selectedWorkspaceError,
    modelAvailabilityBlocksTask,
  });

  const markOpencodeConfigReloadRequired = useCallback(() => {
    reloadCoordinator.markReloadRequired("config", {
      type: "config",
      name: "opencode.json",
      action: "updated",
    });
  }, [reloadCoordinator]);

  const { sessionProviderAuthStore, sessionProviderAuthSnapshot } =
    useSessionRouteProviderAuth({
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
    });
  const permissionQueryKey = useMemo(
    () => permissionQueryKeyForSession(selectedWorkspaceId, selectedSessionId),
    [selectedSessionId, selectedWorkspaceId],
  );
  const pendingPermissions = useQueryCacheState<PendingPermission[]>(
    permissionQueryKey,
    emptyPendingPermissions,
  );
  const questionQueryKey = useMemo(
    () => questionQueryKeyForSession(selectedWorkspaceId, selectedSessionId),
    [selectedSessionId, selectedWorkspaceId],
  );
  const pendingQuestions = useQueryCacheState<PendingQuestion[]>(
    questionQueryKey,
    emptyPendingQuestions,
  );
  const todoQueryKey = useMemo(
    () => todoQueryKeyForSession(selectedWorkspaceId, selectedSessionId),
    [selectedSessionId, selectedWorkspaceId],
  );
  const todos = useQueryCacheState<TodoItem[]>(todoQueryKey, emptyTodos);
  const [lastVisibleTodosBySessionId, setLastVisibleTodosBySessionId] =
    useState<Record<string, TodoItem[]>>(() => readSessionTodos());
  const todosHaveContent = todos.some((todo) => todo.content.trim());
  useEffect(() => {
    if (!selectedSessionId || !todosHaveContent) return;
    setLastVisibleTodosBySessionId((current) => {
      const previous = current[selectedSessionId];
      if (
        previous &&
        previous.length === todos.length &&
        previous.every(
          (todo, index) =>
            todo.id === todos[index]?.id &&
            todo.content === todos[index]?.content &&
            todo.status === todos[index]?.status,
        )
      ) {
        return current;
      }
      return {
        ...current,
        [selectedSessionId]: todos,
      };
    });
  }, [selectedSessionId, todos, todosHaveContent]);
  useEffect(() => {
    writeSessionTodos(lastVisibleTodosBySessionId);
  }, [lastVisibleTodosBySessionId]);
  const visibleTodos = useMemo(() => todos, [todos]);
  useSessionRouteApprovalSnapshots({
    runtimeKind: activeRuntimeSession?.runtimeKind,
    opencodeClient,
    workspaceId: selectedWorkspaceId,
    sessionId: selectedSessionId,
    workspaceRoot: sessionWorkspaceRoot,
  });

  const {
    activePermission,
    respondPermission,
    activeQuestion,
    respondQuestion,
  } = useSessionRoutePermissionQuestionHandlers({
    client,
    opencodeClient,
    pendingPermissions,
    pendingQuestions,
    permissionReplyBusy,
    permissionReplyBusyRef,
    questionReplyBusyRef,
    selectedSessionId,
    selectedWorkspaceId,
    sessionAccessModeById,
    sessionWorkspaceRoot,
    routeRuntimeKind,
    setAutoApprovedPermissionNoticeBySessionId,
    setPermissionReplyBusy,
    setQuestionReplyBusy,
    showToast,
    autoApprovedPermissionNoticeBySessionId,
  });

  const showPreparingStatus = resolveSessionRouteShowPreparingStatus({
    effectiveLoading,
    canCreateTask,
    routeError,
    selectedWorkspaceError,
  });

  const surfaceProps = useSessionRouteSurfaceProps({
    assistantDraftWorkspaceRoot,
    client, catalogContextWindow,
    compactModelPickerOpen,
    creatingSessionWorkspaceIdsRef,
    effectiveModelRef,
    forceNewSessionOnNextSendRef,
    handleOpenSettings,
    handleRuntimeSessionUpdated,
    handleRuntimeSessionStatus,
    listSlashCommands,
    local,
    localeSnapshot,
    modelAvailabilityBlocksTask,
    modelBehaviorOptions,
    modelLabel,
    modelVariantLabel,
    modelVariantValue,
    navigate,
    navigateToWorkspaceSession,
    onmyagentServerHostInfoState,
    opencodeBaseUrl,
    opencodeClient,
    pageMode,
    providerConnectedIds,
    refreshCreatedSessionSnapshot,
    refreshRouteState,
    routeRuntimeKind,
    runtimeModelCatalog,
    rememberPendingCreatedSession,
    selectedAgent,
    selectedSessionId,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
    sessionAccessModeById,
    sessionCollaborationModeById,
    sessionGoalRuntimeById,
    sessionModelOverrideById,
    sessionPlanRuntimeById,
    sessionWorkspaceRoot,
    sessionsByWorkspaceId,
    sessionsByWorkspaceIdRef,
    setAssistantDraftWorkspaceRoot,
    setCompactModelPickerOpen,
    setLastVisibleTodosBySessionId,
    setLegacySelectedWorkspaceId,
    setModelPickerOpen,
    setModelPickerQuery,
    setSelectedAgent,
    setSessionAccessModeById,
    setSessionCollaborationModeById,
    setSessionGoalRuntimeById,
    setSessionModelOverrideById,
    setSessionPlanRuntimeById,
    setSessionsByWorkspaceId,
    suppressRestoreSessionRef,
    token,
  });

  const {
    handleOpenCreateWorkspace,
    handleOpenRenameWorkspace,
    handleSaveRenameWorkspace,
    handleRevealWorkspace,
    handleShareWorkspace,
    handleSaveShareRemoteAccess,
    handleExportWorkspaceConfig,
    handleForgetWorkspace,
    runRemoteWorkspaceConnectionCheck,
    handleCreateTaskInWorkspace,
    handleReorderWorkspaces,
    handleCreateWorkspace,
    handleCreateRemoteWorkspace,
  } = useSessionRouteWorkspaceInteraction({
    checkDesktopRestriction,
    client,
    loading,
    local,
    navigate,
    navigateToWorkspaceSession,
    refreshRouteState,
    remoteAccessRestart,
    remoteWorkspaceCheckRunCounterRef,
    remoteWorkspaceCheckRunRef,
    renameWorkspaceId,
    renameWorkspaceTitle,
    restrictionNotice,
    retryingWorkspaceIds,
    selectedWorkspaceId,
    setAssistantDraftWorkspaceRoot,
    setCreateWorkspaceBusy,
    setCreateWorkspaceError,
    setCreateWorkspaceOpen,
    setCreateWorkspaceRemoteBusy,
    setCreateWorkspaceRemoteError,
    setErrorsByWorkspaceId,
    setLegacySelectedWorkspaceId,
    setRenameWorkspaceBusy,
    setRenameWorkspaceId,
    setRenameWorkspaceTitle,
    setRetryingWorkspaceIds,
    setWorkspaceConnectionOverrides,
    setWorkspaceOrderIds,
    setWorkspaces,
    shareWorkspaceState,
    suppressRestoreSessionRef,
    workspaces,
    workspacesRef,
    workspaceOrderIdsRef,
  });

  const { handleCreateTaskWithPrompt, handleOpenRecentSession } =
    useSessionRouteQuickCapture({
      baseUrl,
      token,
      client,
      pageMode,
      workspaces,
      selectedWorkspaceId,
      sessionsByWorkspaceId,
      sessionMatchesPageMode,
      effectiveModelRef,
      allowedModelOptions,
      modelLabel,
      handleCreateTaskInWorkspace,
      navigateToWorkspaceSession,
      rememberPendingCreatedSession,
      setSessionsByWorkspaceId,
    });

  useSessionRouteGlobalShortcuts({
    canCreateTask,
    handleCreateTaskInWorkspace,
    handleCreateTaskWithPrompt,
    handleOpenRecentSession,
    selectedWorkspaceId,
    setCommandPaletteOpen,
  });

  useSessionRouteControlWiring({
    workspaces,
    sessionsByWorkspaceId,
    selectedWorkspaceId,
    selectedSessionId,
    sessionWorkspaceRoot,
    canCreateTask,
    client,
    opencodeClient,
    handleCreateTaskInWorkspace,
    navigateToWorkspaceSession,
    setModelPickerOpen,
    setCommandPaletteOpen,
    refreshRouteState,
    routeRuntimeKind,
  });

  const paletteSessionOptions = useMemo(
    () =>
      toPaletteSessionOptions({
        workspaces,
        sessionsByWorkspaceId,
        selectedWorkspaceId,
      }),
    [sessionsByWorkspaceId, selectedWorkspaceId, workspaces],
  );

  const developerMode = readDeveloperModeEnabled();

  return (
    <SessionRoutePageView
      activePermission={activePermission}
      activeQuestion={activeQuestion}
      activeSelectedWorkspaceSessionIds={activeSelectedWorkspaceSessionIds}
      agentManagementIntent={agentManagementIntent}
      allowedModelOptions={allowedModelOptions}
      autoApprovedPermissionNoticeBySessionId={
        autoApprovedPermissionNoticeBySessionId
      }
      baseUrl={baseUrl}
      canCreateTask={canCreateTask}
      checkDesktopRestriction={checkDesktopRestriction}
      clearAgentManagementIntent={clearAgentManagementIntent}
      client={client}
      commandPaletteOpen={commandPaletteOpen}
      createWorkspaceBusy={createWorkspaceBusy}
      createWorkspaceError={createWorkspaceError}
      createWorkspaceOpen={createWorkspaceOpen}
      createWorkspaceRemoteBusy={createWorkspaceRemoteBusy}
      createWorkspaceRemoteError={createWorkspaceRemoteError}
      creatingSessionWorkspaceIdsRef={creatingSessionWorkspaceIdsRef}
      developerMode={developerMode}
      disabledProviderIds={disabledProviderIds}
      effectiveLoading={effectiveLoading}
      endpointForWorkspace={endpointForWorkspace}
      firstSessionIdForPageMode={firstSessionIdForPageMode}
      forceNewSessionOnNextSendRef={forceNewSessionOnNextSendRef}
      handleCreateRemoteWorkspace={handleCreateRemoteWorkspace}
      handleCreateTaskInWorkspace={handleCreateTaskInWorkspace}
      handleCreateWorkspace={handleCreateWorkspace}
      handleForgetWorkspace={handleForgetWorkspace}
      handleOpenCreateWorkspace={handleOpenCreateWorkspace}
      handleOpenRenameWorkspace={handleOpenRenameWorkspace}
      handleOpenSettings={handleOpenSettings}
      handleReorderWorkspaces={handleReorderWorkspaces}
      handleRevealWorkspace={handleRevealWorkspace}
      handleRuntimeSessionUpdated={handleRuntimeSessionUpdated}
      handleRuntimeSessionStatus={handleRuntimeSessionStatus}
      handleSaveRenameWorkspace={handleSaveRenameWorkspace}
      handleSaveShareRemoteAccess={handleSaveShareRemoteAccess}
      handleShareWorkspace={handleShareWorkspace}
      handleSignOut={handleSignOut}
      handleExportWorkspaceConfig={handleExportWorkspaceConfig}
      loadWorkspaceSessionsInBackground={loadWorkspaceSessionsInBackground}
      local={local}
      modelPickerOpen={modelPickerOpen}
      modelPickerQuery={modelPickerQuery}
      navigate={navigate}
      navigateToWorkspaceSession={navigateToWorkspaceSession}
      onmyagentServerSettings={onmyagentServerSettings}
      opencodeBaseUrl={opencodeBaseUrl}
      opencodeClient={opencodeClient}
      pageMode={pageMode}
      paletteAccessibleTargets={paletteAccessibleTargets}
      paletteSessionOptions={paletteSessionOptions}
      permissionReplyBusy={permissionReplyBusy}
      providerConnectedIds={providerConnectedIds}
      providers={providers}
      questionReplyBusy={questionReplyBusy}
      refreshRouteState={refreshRouteState}
      rememberPendingCreatedSession={rememberPendingCreatedSession}
      remoteAccessRestart={remoteAccessRestart}
      remoteWorkspaceConnectionEditor={remoteWorkspaceConnectionEditor}
      renameWorkspaceBusy={renameWorkspaceBusy}
      renameWorkspaceId={renameWorkspaceId}
      renameWorkspaceTitle={renameWorkspaceTitle}
      respondPermission={respondPermission}
      respondQuestion={respondQuestion}
      routeNotFoundMessage={routeNotFoundMessage}
      runRemoteWorkspaceConnectionCheck={runRemoteWorkspaceConnectionCheck}
      selectedSessionFileRoot={selectedSessionFileRoot}
      selectedSessionId={selectedSessionId}
      selectedWorkspace={selectedWorkspace}
      selectedWorkspaceEndpoint={selectedWorkspaceEndpoint}
      selectedWorkspaceError={selectedWorkspaceError}
      selectedWorkspaceId={selectedWorkspaceId}
      selectedWorkspaceRoot={selectedWorkspaceRoot}
      selectedWorkspaceServerToken={selectedWorkspaceServerToken}
      isExpertSessionInDirectory={(sessionId) =>
        expertDirectoryIdentity.sessionIds.has(sessionId)}
      sessionMatchesPageMode={sessionMatchesPageMode}
      sessionProviderAuthSnapshot={sessionProviderAuthSnapshot}
      sessionProviderAuthStore={sessionProviderAuthStore}
      sessionsByWorkspaceId={sessionsByWorkspaceId}
      sessionsByWorkspaceIdRef={sessionsByWorkspaceIdRef}
      sessionWorkspaceRoot={sessionWorkspaceRoot}
      setCommandPaletteOpen={setCommandPaletteOpen}
      setCreateWorkspaceError={setCreateWorkspaceError}
      setCreateWorkspaceOpen={setCreateWorkspaceOpen}
      setDisabledProviderIds={setDisabledProviderIds}
      setLegacySelectedWorkspaceId={setLegacySelectedWorkspaceId}
      setModelPickerOpen={setModelPickerOpen}
      setModelPickerQuery={setModelPickerQuery}
      setPaletteAccessibleTargets={setPaletteAccessibleTargets}
      setRecentProviderIds={setRecentProviderIds}
      setRenameWorkspaceId={setRenameWorkspaceId}
      setRenameWorkspaceTitle={setRenameWorkspaceTitle}
      setRetryingWorkspaceIds={setRetryingWorkspaceIds}
      setSessionsByWorkspaceId={setSessionsByWorkspaceId}
      setSidebarAccount={setSidebarAccount}
      shareWorkspaceState={shareWorkspaceState}
      showPreparingStatus={showPreparingStatus}
      sidebarAccount={sidebarAccount}
      sidebarSessionStatusById={sidebarSessionStatusById}
      surfaceProps={surfaceProps}
      suppressRestoreSessionRef={suppressRestoreSessionRef}
      token={token}
      visibleTodos={visibleTodos}
      workspaceConnectionStateById={workspaceConnectionStateById}
      workspaceSessionGroups={workspaceSessionGroups}
      workspaces={workspaces}
    />
  );
}

// Public render surface companions
export { SessionRoutePageView } from "./page-view";
export { SessionRouteModals } from "./modals";
