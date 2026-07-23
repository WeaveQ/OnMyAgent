/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createClient, unwrap } from "../../../app/lib/opencode";
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
  emptyWorkspaceDisplay,
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
  getActiveReloadBlockingSessions,
  getActiveSessionIds,
  sessionListOwnsSession,
  toControlSessionEntries,
  toPaletteSessionOptions,
  type PendingCreatedSessionMap,
} from "./sessions";
import {
  isAssistantSession,
  isExpertSession,
} from "../../domains/agents";
import { useEnsureAgentRegistry } from "../../domains/agents";
import type { OnMyAgentServerInfo } from "../../../app/lib/desktop";
import type {
  Client,
  PendingPermission,
  PendingQuestion,
  SidebarSessionItem,
  TodoItem,
  WorkspaceConnectionState,
  WorkspaceDisplay,
} from "../../../app/types";
import { isDesktopRuntime } from "../../../app/utils";
import { usePlatform } from "../../kernel/platform";
import {
  useRemoteWorkspaceConnectionEditor,
  useShareWorkspaceState,
} from "../../domains/workspace";
import {
  createProviderAuthStore,
  useProviderAuthStoreSnapshot,
} from "../../domains/connections";
import {
  useCheckDesktopRestriction,
  useCloudProviderAutoSync,
  useRestrictionNotice,
} from "../../domains/cloud";
import { useBootState } from "../boot-state";
import {
  readActiveWorkspaceId,
  readLastSessionFor,
  readSessionTodos,
  readWorkspaceOrderIds,
  writeSessionTodos,
} from "../session-memory";
import { useReactRenderWatchdog } from "../react-render-watchdog";
import { ensureDesktopLocalOnMyAgentConnection } from "../desktop-local-onmyagent";
import { useStatusToasts } from "../../domains/shell-feedback";
import {
  readAssistantSessionWorkspace,
  resolveSelectedSessionFileRoot,
  seedPermissionState,
  seedQuestionState,
  useSessionActivityStore,
  useSessionControlActions,
} from "../../domains/session";
import { useProviderListQuery } from "../../domains/connections";
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
import { SessionRoutePageView } from "./page-view";
import {
  buildCommandPaletteControlAction,
  resolveControlSessionWorkspaceId,
  resolveSessionRouteRestoreNavigation,
  shouldRedirectSessionRouteToWelcome,
} from "./control";
import { useControlAction } from "../control/control-provider";

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
  } = useSessionRouteNavigation();
  const platform = usePlatform();
  const { showToast } = useStatusToasts();
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const restrictionNotice = useRestrictionNotice();

  const { markRouteReady: markBootRouteReady } = useBootState();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<OnMyAgentServerClient | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [workspaces, setWorkspaces] = useState<RouteWorkspace[]>([]);
  const [workspaceOrderIds, setWorkspaceOrderIds] = useState<string[]>(() =>
    readWorkspaceOrderIds(),
  );
  const [sessionsByWorkspaceId, setSessionsByWorkspaceId] = useState<
    Record<string, SidebarSessionItem[]>
  >({});
  const [errorsByWorkspaceId, setErrorsByWorkspaceId] = useState<
    Record<string, string | null>
  >({});
  const [workspaceConnectionOverrides, setWorkspaceConnectionOverrides] =
    useState<Record<string, WorkspaceConnectionState>>({});
  const [routeError, setRouteError] = useState<string | null>(null);
  const [legacySelectedWorkspaceId, setLegacySelectedWorkspaceId] =
    useState<string>(() => readActiveWorkspaceId() ?? "");
  const selectedWorkspaceId = routeWorkspaceId || legacySelectedWorkspaceId;
  const selectedWorkspace = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
      (selectedWorkspaceId ? null : (workspaces[0] ?? null)),
    [selectedWorkspaceId, workspaces],
  );
  // Workspace-scoped API calls (sessions, events, activate, opencode/*) must
  // hit the worker that owns the workspace, not the user's local server. The
  // single source of truth for that routing is `resolveWorkspaceEndpoint`.
  //
  // Route refs let stable callbacks read current workspace/session/server
  // values without cascading refresh loops.
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
        : isExpertSession(sessionId),
    [pageMode],
  );
  const firstSessionIdForPageMode = useCallback(
    (workspaceId: string) => {
      const sessions = sessionsByWorkspaceId[workspaceId] ?? [];
      const match = sessions.find((session: { id?: unknown }) => {
        const id = typeof session?.id === "string" ? session.id : "";
        return Boolean(id && sessionMatchesPageMode(id));
      });
      return typeof match?.id === "string" ? match.id : null;
    },
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

  // Ensure agent registry is loaded when a workspace is selected
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
    sessionsByWorkspaceIdRef,
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

  const handleRuntimeSessionUpdated = useCallback(
    (update: { sessionId: string; info: Record<string, unknown> }) => {
      if (!selectedWorkspaceId) return;
      setSessionsByWorkspaceId((current) => {
        const list = current[selectedWorkspaceId] ?? [];
        const index = list.findIndex(
          (session) => session.id === update.sessionId,
        );
        if (index < 0) return current;
        const nextSession = {
          ...list[index],
          ...update.info,
          id: update.sessionId,
        };
        if (JSON.stringify(nextSession) === JSON.stringify(list[index]))
          return current;
        const nextList = [...list];
        nextList[index] = nextSession;
        const next = { ...current, [selectedWorkspaceId]: nextList };
        sessionsByWorkspaceIdRef.current = next;
        return next;
      });
    },
    [selectedWorkspaceId, sessionsByWorkspaceIdRef],
  );

  /** Keep list-row `status` in sync with SSE so seed + activeSessionIds don't lag. */
  const handleRuntimeSessionStatus = useCallback(
    (update: { sessionId: string; status: unknown }) => {
      if (!selectedWorkspaceId) return;
      const sessionId = update.sessionId?.trim() ?? "";
      if (!sessionId) return;
      setSessionsByWorkspaceId((current) => {
        const list = current[selectedWorkspaceId] ?? [];
        const index = list.findIndex((session) => session.id === sessionId);
        if (index < 0) return current;
        const prev = list[index];
        if (prev.status === update.status) return current;
        const nextList = [...list];
        nextList[index] = { ...prev, status: update.status };
        const next = { ...current, [selectedWorkspaceId]: nextList };
        sessionsByWorkspaceIdRef.current = next;
        return next;
      });
    },
    [selectedWorkspaceId, sessionsByWorkspaceIdRef],
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

  // Once workspaces + sessions are loaded and the URL has no sessionId, try to
  // restore the last session the user opened in the active workspace.
  useEffect(() => {
    const navigation = resolveSessionRouteRestoreNavigation({
      firstSessionIdForPageMode,
      legacySelectedWorkspaceId,
      loading,
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
    pageMode,
    routeWorkspaceId,
    selectedSessionId,
    selectedWorkspaceId,
    sessionMatchesPageMode,
    sessionsByWorkspaceId,
    workspaces,
  ]);

  // Redirect to /welcome when no workspaces exist and the user hasn't
  // completed onboarding. This fires after the initial route refresh so
  // `loading` is false and we know for sure there are zero workspaces.
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

  // NOTE: Blueprint seeding was removed from the route.
  // It was firing `materializeBlueprintSessions` + a session re-fetch on every
  // workspace change, which cascaded setState updates and froze the UI after
  // a few rapid switches. Empty workspaces now simply show "No tasks yet." and
  // the user creates their first session explicitly via "New task". Seeding
  // can be reintroduced later as a one-shot triggered from a button or from
  // the onboarding flow, not from the route effect loop.

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
      setRouteError(message);
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
    effectiveLoading,
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
  const selectedSessionFileRoot = resolveSelectedSessionFileRoot({
    boundDirectory: selectedSessionWorkspace?.directory,
    sessionDirectory: selectedSessionDirectory,
    workspaceRoot: selectedWorkspaceRoot,
  });
  // Single source of truth for the selected workspace's server URL/token/id.
  // For remote workspaces this is the worker that owns the workspace; for
  // local workspaces it's the user's local OnMyAgent server.
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
  const providerListQuery = useProviderListQuery({
    client: opencodeClient,
    baseUrl: opencodeBaseUrl,
    directory: sessionWorkspaceRoot || undefined,
  });

  const {
    allowedModelOptions,
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
    navigate,
    opencodeBaseUrl,
    opencodeClient,
    pendingAgentModel: pendingAgent?.model,
    providerListData: providerListQuery.data,
    recentProviderIds,
    selectedSessionId,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
    sessionModelOverrideById,
    setSessionModelOverrideById,
    sessionWorkspaceRoot,
    setModelOptions,
    sidebarActiveWorkspaceId,
  });

  // Use the same model the composer shows (session override / pending agent /
  // global default). Checking only prefs.defaultModel false-positives
  // "模型已不可用" when the session has a valid override.
  const selectedModelUnavailable = isSelectedModelUnavailable({
    model: effectiveModelRef,
    checkRestriction: checkDesktopRestriction,
    connectedProviderIds: providerConnectedIds,
    providerListData: providerListQuery.data,
    // Only suppress while the first list has not arrived; background refetch
    // should still re-evaluate against the last known list.
    providerListLoading:
      !providerListQuery.data &&
      (providerListQuery.isPending || providerListQuery.isFetching),
  });
  // Always surface the composer banner when the active model is not pickable
  // (including the app default ghost opencode/big-pickle). Do not hide the
  // banner for signed-in users — the model menu would still show "未找到模型".
  const modelAvailabilityBlocksTask = selectedModelUnavailable;
  const canCreateTask = Boolean(
    opencodeClient &&
      selectedWorkspaceId &&
      !loading &&
      !selectedWorkspaceError &&
      !modelAvailabilityBlocksTask,
  );

  const sessionProviderAuthStateRef = useRef({
    opencodeClient: opencodeClient as Client | null,
    providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviderIds,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    selectedWorkspaceRoot: sessionWorkspaceRoot,
  });
  sessionProviderAuthStateRef.current = {
    opencodeClient,
    providers,
    providerDefaults,
    providerConnectedIds,
    disabledProviderIds,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    selectedWorkspaceRoot: sessionWorkspaceRoot,
  };

  const sessionProviderAuthStore = useMemo(
    () =>
      createProviderAuthStore({
        client: () => sessionProviderAuthStateRef.current.opencodeClient,
        providers: () => sessionProviderAuthStateRef.current.providers,
        providerDefaults: () =>
          sessionProviderAuthStateRef.current.providerDefaults,
        providerConnectedIds: () =>
          sessionProviderAuthStateRef.current.providerConnectedIds,
        disabledProviders: () =>
          sessionProviderAuthStateRef.current.disabledProviderIds,
        checkDesktopAppRestriction: checkDesktopRestriction,
        selectedWorkspaceDisplay: () =>
          sessionProviderAuthStateRef.current.selectedWorkspace
            ? ({
                ...sessionProviderAuthStateRef.current.selectedWorkspace,
                name: workspaceLabel(
                  sessionProviderAuthStateRef.current.selectedWorkspace,
                ),
              } as WorkspaceDisplay)
            : emptyWorkspaceDisplay,
        selectedWorkspaceRoot: () =>
          sessionProviderAuthStateRef.current.selectedWorkspaceRoot,
        runtimeWorkspaceId: () =>
          sessionProviderAuthStateRef.current.selectedWorkspaceEndpoint
            ?.workspaceId ?? null,
        onmyagentServer: {
          getSnapshot: () => ({
            onmyagentServerStatus: sessionProviderAuthStateRef.current
              .selectedWorkspaceEndpoint
              ? "connected"
              : "disconnected",
            onmyagentServerClient:
              sessionProviderAuthStateRef.current.selectedWorkspaceEndpoint
                ?.client ?? null,
            onmyagentServerCapabilities: sessionProviderAuthStateRef.current
              .selectedWorkspaceEndpoint
              ? {
                  config: { read: true, write: true },
                }
              : null,
          }),
        } as never,
        setProviders,
        setProviderDefaults,
        setProviderConnectedIds,
        setDisabledProviders: setDisabledProviderIds,
        markOpencodeConfigReloadRequired: () => {
          reloadCoordinator.markReloadRequired("config", {
            type: "config",
            name: "opencode.json",
            action: "updated",
          });
        },
      }),
    [checkDesktopRestriction, reloadCoordinator],
  );

  useEffect(() => {
    sessionProviderAuthStore.start();
    return () => {
      sessionProviderAuthStore.dispose();
    };
  }, [sessionProviderAuthStore]);

  useEffect(() => {
    if (!opencodeClient || !selectedWorkspaceId) return;

    void sessionProviderAuthStore
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
    sessionProviderAuthStore,
  ]);

  useEffect(() => {
    sessionProviderAuthStore.syncFromOptions();
  }, [
    opencodeClient,
    selectedWorkspace?.id,
    selectedWorkspace?.workspaceType,
    selectedWorkspaceEndpoint?.workspaceId,
    sessionWorkspaceRoot,
    sessionProviderAuthStore,
  ]);

  // Session is where forced sign-in lands. Keep org-managed cloud providers in
  // sync here so sign-in applies opencode.json changes before Settings opens.
  useCloudProviderAutoSync(sessionProviderAuthStore.runCloudProviderSync);
  const sessionProviderAuthSnapshot = useProviderAuthStoreSnapshot(
    sessionProviderAuthStore,
  );
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
    setLastVisibleTodosBySessionId((current) => ({
      ...current,
      [selectedSessionId]: todos,
    }));
  }, [selectedSessionId, todos, todosHaveContent]);
  useEffect(() => {
    writeSessionTodos(lastVisibleTodosBySessionId);
  }, [lastVisibleTodosBySessionId]);
  const visibleTodos = useMemo(() => {
    if (todosHaveContent) return todos;
    if (!selectedSessionId) return todos;
    return lastVisibleTodosBySessionId[selectedSessionId] ?? todos;
  }, [lastVisibleTodosBySessionId, selectedSessionId, todos, todosHaveContent]);
  useEffect(() => {
    if (!opencodeClient || !selectedWorkspaceId || !selectedSessionId) return;
    let cancelled = false;
    const directory = sessionWorkspaceRoot || undefined;
    void (async () => {
      const snapshotStartedAt = Date.now();
      try {
        const list = unwrap(
          await opencodeClient.permission.list({ directory }),
        );
        if (!cancelled) {
          seedPermissionState(selectedWorkspaceId, selectedSessionId, list, {
            snapshotStartedAt,
          });
        }
      } catch {
        // Keep event-synced permission state if the snapshot read fails.
        // Hiding a pending approval can block the running task.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    opencodeClient,
    selectedSessionId,
    selectedWorkspaceId,
    sessionWorkspaceRoot,
  ]);

  useEffect(() => {
    if (!opencodeClient || !selectedWorkspaceId || !selectedSessionId) return;
    let cancelled = false;
    const directory = sessionWorkspaceRoot || undefined;
    void (async () => {
      const snapshotStartedAt = Date.now();
      try {
        const list = unwrap(await opencodeClient.question.list({ directory }));
        if (!cancelled) {
          seedQuestionState(selectedWorkspaceId, selectedSessionId, list, {
            snapshotStartedAt,
          });
        }
      } catch {
        // Keep event-synced question state if the snapshot read fails.
        // Hiding a pending question can block the running task.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    opencodeClient,
    selectedSessionId,
    selectedWorkspaceId,
    sessionWorkspaceRoot,
  ]);

  const {
    activePermission,
    respondPermission,
    activeQuestion,
    respondQuestion,
  } = useSessionRoutePermissionQuestionHandlers({
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
    setAutoApprovedPermissionNoticeBySessionId,
    setPermissionReplyBusy,
    setQuestionReplyBusy,
    showToast,
    autoApprovedPermissionNoticeBySessionId,
  });

  const showPreparingStatus =
    effectiveLoading ||
    (!canCreateTask && !routeError && !selectedWorkspaceError);

  const surfaceProps = useSessionRouteSurfaceProps({
    assistantDraftWorkspaceRoot,
    client,
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
    refreshCreatedSessionSnapshot,
    refreshRouteState,
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

  useSessionRouteGlobalShortcuts({
    canCreateTask,
    handleCreateTaskInWorkspace,
    selectedWorkspaceId,
    setCommandPaletteOpen,
  });

  const navigateToSessionForControl = useCallback(
    (sessionId: string) => {
      const owner = resolveControlSessionWorkspaceId({
        sessionsByWorkspaceId,
        sessionId,
        fallbackWorkspaceId: selectedWorkspaceId,
      });
      navigateToWorkspaceSession(owner, sessionId);
    },
    [navigateToWorkspaceSession, selectedWorkspaceId, sessionsByWorkspaceId],
  );

  const navigateToSessionRootForControl = useCallback(() => {
    navigateToWorkspaceSession(selectedWorkspaceId);
  }, [navigateToWorkspaceSession, selectedWorkspaceId]);

  const openModelPickerForControl = useCallback(() => {
    setModelPickerOpen(true);
  }, [setModelPickerOpen]);

  const controlSessionsByWorkspaceId = useMemo(
    () => toControlSessionEntries(sessionsByWorkspaceId),
    [sessionsByWorkspaceId],
  );

  useSessionControlActions({
    workspaces,
    sessionsByWorkspaceId: controlSessionsByWorkspaceId,
    selectedWorkspaceId,
    selectedWorkspaceRoot: sessionWorkspaceRoot,
    selectedSessionId,
    canCreateTask,
    onmyagentClient: client,
    opencodeClient,
    navigateToSession: navigateToSessionForControl,
    navigateToSessionRoot: navigateToSessionRootForControl,
    createTaskInWorkspace: handleCreateTaskInWorkspace,
    openModelPicker: openModelPickerForControl,
    refreshRouteState,
  });

  const commandPaletteControlAction = useMemo(
    () =>
      buildCommandPaletteControlAction({
        openCommandPalette: () => setCommandPaletteOpen(true),
      }),
    [setCommandPaletteOpen],
  );
  useControlAction(commandPaletteControlAction);

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
