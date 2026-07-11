/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ProviderListResponse,
} from "@opencode-ai/sdk/v2/client";

import { createClient, unwrap } from "../../app/lib/opencode";
import {
  listCommands,
} from "../../app/lib/opencode-session";
import {
  buildOnMyAgentWorkspaceBaseUrl,
  readOnMyAgentServerSettings,
  type OnMyAgentServerClient,
} from "../../app/lib/onmyagent-server";
import {
  resolveWorkspaceEndpoint,
  workspaceServerId,
  type ResolvedWorkspaceEndpoint,
} from "../../app/lib/workspace-endpoint";
import {
  describeRouteError,
  describeWorkspaceSessionLoadError,
  describeTaskCreateError,
  buildConnectedRouteRefreshPlan,
  buildDisconnectedRouteState,
  buildRouteRefreshErrorFallbackWorkspaces,
  buildRouteRefreshCompleteEvent,
  buildRouteRefreshErrorEvent,
  buildSettingsNavigationTarget,
  buildSelectedWorkspaceRouteState,
  emptyWorkspaceDisplay,
  findRouteWorkspace,
  isRemoteOnMyAgentWorkspace,
  orderRouteWorkspaces,
  removeRetryingWorkspaceId,
  retainWorkspaceErrorsById,
  resolveOrgOnboardingReloadAction,
  resolveRouteRefreshErrorSelectedWorkspace,
  serializeSDKError,
  shouldLaunchActivateWorkspace,
  shouldClearWorkspaceSessionLoadInFlight,
  shouldRunEmptyWorkspaceSessionRetry,
  shouldSkipWorkspaceSessionLoad,
  shouldScheduleEmptyWorkspaceSessionRetry,
  shouldRetryWorkspaceSessionLoad,
  toSessionGroups,
  waitForWorkspaceSessionLoadBackoff,
  workspaceSessionEmptyRetryDelayMs,
  workspaceLabel,
  type RouteWorkspace,
  type SessionSidebarAccount,
} from "./session-route-model";
import {
  clearConsumedPermissionNotice,
  resolveAccessModePermissionReply,
} from "./session-route-composer";
import {
  emptyModelBehaviorOptions,
  emptyPendingPermissions,
  emptyPendingQuestions,
  emptyTodos,
  focusPromptSoon,
  isActiveSessionStatus,
  permissionQueryKeyForSession,
  questionQueryKeyForSession,
  requiredPermissionQueryKey,
  requiredQuestionQueryKey,
  todoQueryKeyForSession,
  useQueryCacheState,
} from "./session-route-state";
import {
  buildConnectedModelOptions,
  buildProviderModelCatalog,
  filterAllowedModelOptions,
  resolveProviderDefaultModel,
  resolveModelVariantState,
  isSelectedModelUnavailable,
  type ProviderModelCatalog,
} from "./session-route-model-options";
import {
  clearOrgOnboardingReloadRequest,
  readDeveloperModeEnabled,
  readOrgOnboardingReloadRequested,
  readWindowSeenProviderIds,
} from "./session-route-storage";
import {
  activateDesktopSessionWorkspaceInBackground,
  loadDesktopSessionWorkspaces,
  resolveSelectedDesktopSessionWorkspaceId,
} from "./session-route-workspace-actions";
import { useSessionRouteInspector } from "./session-route-inspector";
import { useRouteEngineInfo } from "./session-route-engine-info";
import {
  clearSessionLocalServerRef,
  useSessionRouteRefs,
  writeSessionLocalServerRef,
} from "./session-route-refs";
import {
  applyWorkspaceConnectionDiagnosticPlan,
  applyWorkspaceSessionMissingEndpointState,
  applyWorkspaceSessionLoadingConnectionState,
  applyWorkspaceSessionLoadSuccessConnectionState,
  buildSidebarSessionStatusById,
  buildWorkspaceConnectionDiagnosticPlan,
  buildWorkspaceConnectionStateById,
  pruneWorkspaceConnectionStateById,
  removeWorkspaceConnectionStateById,
  resolveSidebarActiveWorkspaceId,
  setWorkspaceConnectionStateById,
} from "./session-route-sidebar-model";
import {
  getActiveReloadBlockingSessions,
  getActiveSessionIds,
  collectWorkspaceSessionItems,
  findFirstSessionIdMatching,
  findWorkspaceIdOwningSession,
  insertSidebarSession,
  maxSequence,
  mergeFetchedSessionsWithPending as mergeFetchedSessionsWithPendingState,
  mergeWorkspaceFetchedSessions,
  sessionListOwnsSession,
  toControlSessionEntries,
  toSidebarSessionItems,
  toPaletteSessionOptions,
  refreshCreatedSessionSnapshotWithRetries,
  type PendingCreatedSessionMap,
} from "./session-route-sessions";
import {
  installMarketplaceExpertAfterSessionCreated,
} from "./session-route-intent";
import { SessionCloudAccountBridge } from "./session-cloud-account-bridge";
import { usePendingAgentStore } from "../domains/agents";
import {
  readCustomAgentIdForSession,
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
} from "../domains/agents";
import {
  addExpertSession,
  isAssistantSession,
  isExpertSession,
  removeAssistantSession,
  removeExpertSession,
} from "../domains/agents/agent-session-state";
import {
  removeAutomationSessionRecord,
  renameAutomationSessionRecord,
} from "../domains/session";
import { useEnsureAgentRegistry } from "../domains/agents";
import {
  type OnMyAgentServerInfo,
  type WorkspaceList,
} from "../../app/lib/desktop";
import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerDraft,
  ModelOption,
  ModelRef,
  PendingPermission,
  PendingQuestion,
  SidebarSessionItem,
  SlashCommandOption,
  TodoItem,
  WorkspaceConnectionState,
  Client,
  ProviderListItem,
  WorkspaceDisplay,
  WorkspaceSessionGroup,
} from "../../app/types";
import { buildFeedbackUrl } from "../../app/lib/feedback";
import {
  isDesktopRuntime,
  normalizeDirectoryPath,
  resolveModelDisplayName,
  safeStringify,
} from "../../app/utils";
import { currentLocale, subscribeToLocale, t } from "../../i18n";
import { usePlatform } from "../kernel/platform";
import {
  SessionPage,
  type PageMode,
  type SessionAgentManagementIntent,
} from "../domains/session";
import { AgentsPage } from "../domains/agents";
import { legacyAssistantRoute } from "./workspace-routes";
import { isDesktopProviderBlocked } from "../../app/cloud/desktop-app-restrictions";
import { useCheckDesktopRestriction, useRestrictionNotice } from "../domains/cloud";
import { ReactSessionRuntime, useSessionActivityStore } from "../domains/session";
import {
  assistantSessionWorkspacesChangedEvent,
  dispatchAssistantSessionWorkspacesChanged,
  readAssistantSessionWorkspace,
  readAssistantSessionWorkspaceChangeOwner,
  readAssistantSessionWorkspaces,
  removeAssistantSessionWorkspace,
  seedPermissionState,
  seedQuestionState,
  seedSessionState,
  writeAssistantSessionWorkspace,
} from "../domains/session";
import {
  diagnoseRemoteWorkspaceTaskLoadFailure,
  useRemoteAccessRestart,
  useRemoteWorkspaceConnectionEditor,
} from "../domains/workspace";
import { createProviderAuthStore, useProviderAuthStoreSnapshot } from "../domains/connections";
import { useCloudProviderAutoSync } from "../domains/cloud";
import { useShareWorkspaceState } from "../domains/workspace";
import { useBootState } from "./boot-state";
import {
  forgetWorkspaceMemory,
  readActiveWorkspaceId,
  readLastSessionFor,
  readSessionTodos,
  readWorkspaceOrderIds,
  writeActiveWorkspaceId,
  writeLastSessionFor,
  writeSessionTodos,
  writeWorkspaceOrderIds,
} from "./session-memory";
import { recordInspectorEvent } from "./app-inspector";
import { saveSessionDraft } from "../domains/session";
import {
  useControlAction,
} from "./control/control-provider";
import {
  buildCommandPaletteControlAction,
  resolveControlSessionWorkspaceId,
  resolveSessionRouteModeSwitchPath,
  resolveSessionRouteRestoreNavigation,
  resolveSessionRouteGlobalShortcut,
  resolveWorkspaceSelectionSessionTarget,
  shouldRedirectSessionRouteToWelcome,
} from "./session-route-control";
import { useReactRenderWatchdog } from "./react-render-watchdog";

import { filterProviderList } from "../../app/utils/providers";
import { ensureDesktopLocalOnMyAgentConnection } from "./desktop-local-onmyagent";
import { loadSessionOnMyAgentConnectionState } from "./session-route-server-actions";
import { useReloadCoordinator } from "./reload-coordinator";
import { getReactQueryClient } from "../infra/query-client";
import { useStatusToasts } from "../domains/shell-feedback";
import { useSessionControlActions } from "../domains/session";
import {
  legacySessionRoute,
  workspaceSettingsRoute,
} from "./workspace-routes";
import { WorkspaceProvider } from "./workspace-provider";
import type { OpenTarget } from "../domains/session";
import { SettingsSurface } from "./settings-route";
import { CloudSessionProvider } from "../domains/settings";
import {
  ensureProviderListQuery,
  refreshProviderListQueries,
  useProviderListQuery,
} from "../domains/connections/provider-list-query";
import { useSessionRouteNavigation } from "./session-route-navigation-hook";
import { useSessionRouteChromeState } from "./session-route-chrome-state-hook";
import { useSessionRouteModelPickerState } from "./session-route-model-picker-state-hook";
import { useSessionRouteComposerRuntimeState } from "./session-route-composer-runtime-state-hook";
import { useSessionRouteSurfaceProps } from "./session-route-surface-props-hook";
import { useSessionRouteWorkspaceInteraction } from "./session-route-workspace-interaction-hook";
import { SessionRouteModals } from "./session-route-modals";
import { useSessionRoutePermissionQuestionHandlers } from "./session-route-permission-question-hook";
import { useSessionRouteGlobalShortcuts } from "./session-route-global-shortcuts-hook";

export function SessionRouteRender() {
  const {
    navigate,
    local,
    sidebarAccount,
    setSidebarAccount,
    localUserSignedIn,
    routeWorkspaceId,
    selectedSessionId,
    isAssistantMode,
    pageMode,
    agentManagementIntent,
    clearAgentManagementIntent,
    handleSignOut,
    navigateToWorkspaceSession,
    location,
  } = useSessionRouteNavigation();
  const platform = usePlatform();
  const reloadCoordinator = useReloadCoordinator();
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
  // One-way latch for "a refreshRouteState is currently running"; prevents
  // overlapping route refreshes from queueing up when the user clicks fast.
  const refreshInFlightRef = useRef(false);
  const reloadEventCursorByWorkspaceRef = useRef<Record<string, number | null>>(
    {},
  );
  const remoteWorkspaceCheckRunRef = useRef<Record<string, string>>({});
  const remoteWorkspaceCheckRunCounterRef = useRef(0);
  const pendingCreatedSessionIdsRef = useRef<PendingCreatedSessionMap>({});
  const creatingSessionWorkspaceIdsRef = useRef(new Set<string>());
  const suppressRestoreSessionRef = useRef(false);
  const forceNewSessionOnNextSendRef = useRef(false);
  const startupRetryTimerRef = useRef<number | null>(null);
  const [retryingWorkspaceIds, setRetryingWorkspaceIds] = useState<string[]>(
    [],
  );
  const launchActivatedWorkspaceIdsRef = useRef(new Set<string>());
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
    bumpDenSessionVersion,
  } = useSessionRouteModelPickerState();
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providerDefaults, setProviderDefaults] = useState<
    Record<string, string>
  >({});
  const [providerConnectedIds, setProviderConnectedIds] = useState<string[]>(
    [],
  );
  const [disabledProviderIds, setDisabledProviderIds] = useState<string[]>([]);

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

  // Provider catalog cache. Used to compute the reasoning/thinking variant
  // options for whichever model is currently selected so the composer's
  // behavior pill actually shows its options (bug: was empty before).
  const [providerCatalog, setProviderCatalog] = useState<ProviderModelCatalog>({});
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
  const backgroundSessionLoadInFlight = useRef<Map<string, number>>(new Map());
  const rememberPendingCreatedSession = useCallback(
    (workspaceId: string, sessionId: string) => {
      const id = sessionId.trim();
      if (!workspaceId || !id) return;
      pendingCreatedSessionIdsRef.current[workspaceId] = {
        ...(pendingCreatedSessionIdsRef.current[workspaceId] ?? {}),
        [id]: Date.now(),
      };
    },
    [],
  );
  const mergeFetchedSessionsWithPending = useCallback(
    (workspaceId: string, fetched: SidebarSessionItem[], current: SidebarSessionItem[]) => {
      const explicitAssistantSessionIds = new Set(
        readAssistantSessionWorkspaces(workspaceId).map(
          (item) => item.sessionId,
        ),
      );
      return mergeFetchedSessionsWithPendingState({
        workspaceId,
        fetched,
        current,
        pendingByWorkspaceId: pendingCreatedSessionIdsRef.current,
        explicitAssistantSessionIds,
        now: Date.now(),
      });
    },
    [],
  );
  const loadWorkspaceSessionsInBackground = useCallback(
    async (workspaces: RouteWorkspace[]) => {
      const fetchOnce = async (
        workspace: RouteWorkspace,
        attempt: number,
      ): Promise<void> => {
        const remoteOnMyAgentWorkspace = isRemoteOnMyAgentWorkspace(workspace);
        const endpoint = endpointForWorkspace(workspace);
        if (!endpoint) {
          if (workspace.workspaceType === "remote") {
            const message =
              t("app.error_remote_worker_url_missing");
            setErrorsByWorkspaceId((current) => ({
              ...current,
              [workspace.id]: message,
            }));
            setWorkspaceConnectionOverrides((current) =>
              applyWorkspaceSessionMissingEndpointState({
                states: current,
                workspaceId: workspace.id,
                message,
                checkedAt: Date.now(),
              }),
            );
            setRetryingWorkspaceIds((current) =>
              removeRetryingWorkspaceId(current, workspace.id),
            );
          }
          return;
        }
        const startedAt =
          backgroundSessionLoadInFlight.current.get(workspace.id) ?? 0;
        const requestStartedAt = Date.now();
        if (shouldSkipWorkspaceSessionLoad({ startedAt, now: requestStartedAt })) return;
        backgroundSessionLoadInFlight.current.set(
          workspace.id,
          requestStartedAt,
        );
        if (remoteOnMyAgentWorkspace) {
          setWorkspaceConnectionOverrides((current) =>
            applyWorkspaceSessionLoadingConnectionState({
              states: current,
              workspaceId: workspace.id,
              message: t("workspace_list.loading_remote_tasks"),
            }),
          );
        }
        try {
          const sidebarItems = await collectWorkspaceSessionItems({
            client: endpoint.client,
            workspaceId: endpoint.workspaceId,
            workspaceRoot: workspace.path ?? "",
            isRemoteOnMyAgentWorkspace: remoteOnMyAgentWorkspace,
            assistantSessionRecords: readAssistantSessionWorkspaces(workspace.id),
            normalizeDirectoryPath,
          });
          setSessionsByWorkspaceId((current) => {
            const next = mergeWorkspaceFetchedSessions({
              current,
              workspaceId: workspace.id,
              fetched: sidebarItems,
              merge: (fetched, currentItems) =>
                mergeFetchedSessionsWithPending(workspace.id, fetched, currentItems),
            });
            sessionsByWorkspaceIdRef.current = next;
            return next;
          });
          setErrorsByWorkspaceId((current) => ({
            ...current,
            [workspace.id]: null,
          }));
          setWorkspaceConnectionOverrides((current) =>
            applyWorkspaceSessionLoadSuccessConnectionState({
              states: current,
              workspaceId: workspace.id,
              isRemoteOnMyAgentWorkspace: remoteOnMyAgentWorkspace,
              taskCount: sidebarItems.length,
              checkedAt: Date.now(),
              loadedMessage: t("workspace_list.connected_loaded_tasks", {
                count: sidebarItems.length,
              }),
              emptyMessage: t("workspace.connected_no_tasks"),
            }),
          );
          setRetryingWorkspaceIds((current) =>
            removeRetryingWorkspaceId(current, workspace.id),
          );
          // When a workspace returns zero sessions during the initial batch
          // load, OpenCode may still be warming up its index.  Schedule a
          // single delayed retry so the sidebar doesn't stay permanently
          // empty while the managed engine finishes starting.
          if (shouldScheduleEmptyWorkspaceSessionRetry({ attempt, sessionCount: sidebarItems.length })) {
            window.setTimeout(() => {
              if (!shouldRunEmptyWorkspaceSessionRetry({
                currentStartedAt: backgroundSessionLoadInFlight.current.get(workspace.id),
              })) return;
              backgroundSessionLoadInFlight.current.delete(workspace.id);
              void fetchOnce(workspace, 1);
            }, workspaceSessionEmptyRetryDelayMs());
          }
        } catch (error) {
          const message = describeWorkspaceSessionLoadError({
            error,
            fallbackMessage: t("app.unknown_error"),
          });
          // The first cold call to OpenCode's /session endpoint often hits
          // the 12s server timeout while the daemon finishes warming up
          // its index. Retry silently with backoff until we get a response
          // or run out of attempts — the sidebar keeps its "loading" state
          // in the meantime instead of flashing "error" next to the
          // workspace name.
          if (shouldRetryWorkspaceSessionLoad({ attempt, message })) {
            if (shouldClearWorkspaceSessionLoadInFlight({
              currentStartedAt: backgroundSessionLoadInFlight.current.get(workspace.id),
              requestStartedAt,
            })) {
              backgroundSessionLoadInFlight.current.delete(workspace.id);
            }
            await waitForWorkspaceSessionLoadBackoff({
              attempt,
              setTimeoutFn: window.setTimeout,
            });
            await fetchOnce(workspace, attempt + 1);
            return;
          }
          // Final failure: keep local workspace startup quiet, but give
          // remote workers a precise endpoint/token/workspace diagnostic.
          if (workspace.workspaceType === "remote") {
            const connectionState =
              await diagnoseRemoteWorkspaceTaskLoadFailure(workspace, message);
            const diagnosticPlan = buildWorkspaceConnectionDiagnosticPlan({
              state: connectionState,
              fallbackMessage: t("app.error_remote_worker_connection_failed"),
            });
            setErrorsByWorkspaceId((current) => ({
              ...current,
              [workspace.id]: diagnosticPlan.errorMessage,
            }));
            setWorkspaceConnectionOverrides((current) =>
              applyWorkspaceConnectionDiagnosticPlan({
                states: current,
                workspaceId: workspace.id,
                plan: diagnosticPlan,
              }),
            );
          }
          setRetryingWorkspaceIds((current) =>
            removeRetryingWorkspaceId(current, workspace.id),
          );
        } finally {
          if (
            backgroundSessionLoadInFlight.current.get(workspace.id) ===
            requestStartedAt
          ) {
            backgroundSessionLoadInFlight.current.delete(workspace.id);
          }
        }
      };

      await Promise.all(workspaces.map((workspace) => fetchOnce(workspace, 0)));
    },
    [endpointForWorkspace, mergeFetchedSessionsWithPending],
  );

  useEffect(() => {
    const handleAssistantSessionWorkspacesChanged = (event: Event) => {
      const ownerWorkspaceId = readAssistantSessionWorkspaceChangeOwner(event);
      if (!ownerWorkspaceId) return;
      const workspace = workspacesRef.current.find(
        (item) => item.id === ownerWorkspaceId,
      );
      if (workspace) {
        void loadWorkspaceSessionsInBackground([workspace]);
      }
    };
    window.addEventListener(
      assistantSessionWorkspacesChangedEvent,
      handleAssistantSessionWorkspacesChanged,
    );
    return () => window.removeEventListener(
      assistantSessionWorkspacesChangedEvent,
      handleAssistantSessionWorkspacesChanged,
    );
  }, [loadWorkspaceSessionsInBackground]);

  const refreshRouteState = useCallback(async () => {
    // Dedupe: if a refresh is already running, skip this call. Fast workspace
    // switches used to fire 5-6 overlapping refreshRouteState() calls which
    // each fetched workspaces + sessions for every workspace. That workload
    // multiplied quickly on the event loop and caused the UI to freeze.
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    setRouteError(null);
    let desktopList: WorkspaceList | null = null;
    let desktopWorkspaces = workspacesRef.current;
    try {
      const desktopBootstrap = await loadDesktopSessionWorkspaces({
        fallbackWorkspaces: workspacesRef.current,
      });
      desktopList = desktopBootstrap.desktopList;
      desktopWorkspaces = desktopBootstrap.desktopWorkspaces;

      const sessionConnection = await loadSessionOnMyAgentConnectionState();
      setOnMyAgentServerHostInfoState(sessionConnection.hostInfo);
      if (!sessionConnection.onmyagentClient) {
        // Keep `localServerRef` in lockstep with the disconnected state.
        // Otherwise a previously-cached baseUrl/token would still resolve a
        // (now invalid) endpoint for any callback that consults the ref.
        clearSessionLocalServerRef(localServerRef);
        setClient(null);
        setBaseUrl("");
        setToken("");
        const disconnectedState = buildDisconnectedRouteState({
          desktopWorkspaces,
          workspaceOrderIds: workspaceOrderIdsRef.current,
          desktopSelectedId: resolveSelectedDesktopSessionWorkspaceId(desktopList),
        });
        setWorkspaces(disconnectedState.orderedWorkspaces);
        sessionsByWorkspaceIdRef.current = {};
        setSessionsByWorkspaceId({});
        setErrorsByWorkspaceId({});
        setLegacySelectedWorkspaceId(disconnectedState.selectedWorkspaceId);
        return;
      }

      // Update the local-server ref synchronously, BEFORE we kick off any
      // workspace-scoped requests below. `endpointForWorkspace` reads from
      // this ref synchronously; the `useEffect` that mirrors `[baseUrl,
      // token]` into the ref doesn't run until after the next React commit,
      // which is too late for the `activateWorkspace` and
      // `loadWorkspaceSessionsInBackground` calls that fire later in this
      // function. Stale ref => `resolveWorkspaceEndpoint` returns null for
      // local workspaces => sidebar gets stuck in "loading" forever.
      writeSessionLocalServerRef(localServerRef, {
        baseUrl: sessionConnection.normalizedBaseUrl,
        token: sessionConnection.resolvedToken,
      });

      const onmyagentClient = sessionConnection.onmyagentClient;
      const refreshPlan = buildConnectedRouteRefreshPlan({
        serverWorkspaces: sessionConnection.serverWorkspaces,
        desktopWorkspaces,
        workspaceOrderIds: workspaceOrderIdsRef.current,
        sessionsByWorkspaceId: sessionsByWorkspaceIdRef.current,
        routeWorkspaceId,
        selectedSessionId,
        persistedActiveId: readActiveWorkspaceId() || "",
        desktopSelectedId: resolveSelectedDesktopSessionWorkspaceId(desktopList),
        serverActiveId: sessionConnection.serverActiveId,
      });
      const nextWorkspaces = refreshPlan.workspaces;
      const nextWorkspaceId = refreshPlan.selectedWorkspaceId;

      setClient(onmyagentClient);
      setBaseUrl(sessionConnection.normalizedBaseUrl);
      setToken(sessionConnection.resolvedToken);
      setWorkspaces(nextWorkspaces);
      sessionsByWorkspaceIdRef.current = refreshPlan.sessionsByWorkspaceId;
      setSessionsByWorkspaceId(refreshPlan.sessionsByWorkspaceId);
      setErrorsByWorkspaceId((previous) =>
        retainWorkspaceErrorsById({ workspaces: nextWorkspaces, previous }),
      );
      setRetryingWorkspaceIds(refreshPlan.retryingWorkspaceIds);
      setLegacySelectedWorkspaceId(nextWorkspaceId);
      writeActiveWorkspaceId(nextWorkspaceId || null);
      // Mark the chosen workspace as active on the server so that the
      // OpenCode engine bound to it re-reads opencode.jsonc and applies
      // permissions. Fire-and-forget; the route is idempotent and any
      // transport failure is non-fatal. See issue #870.
      if (shouldLaunchActivateWorkspace({
        launchedWorkspaceIds: launchActivatedWorkspaceIdsRef.current,
        selectedWorkspaceId: nextWorkspaceId,
        serverActiveId: sessionConnection.serverActiveId,
      })) {
        launchActivatedWorkspaceIdsRef.current.add(nextWorkspaceId);
        const nextWorkspace = findRouteWorkspace(nextWorkspaces, nextWorkspaceId);
        const nextEndpoint = endpointForWorkspace(nextWorkspace);
        if (nextEndpoint) {
          void nextEndpoint.client
            .activateWorkspace(nextEndpoint.workspaceId)
            .catch(() => undefined);
        }
      }
      recordInspectorEvent(
        "route.refresh.complete",
        buildRouteRefreshCompleteEvent({
          workspaces: nextWorkspaces,
          selectedWorkspaceId: nextWorkspaceId,
        }),
      );

      // Session list comes from OpenCode's index and can be slow on cold
      // boot. Kick it off in the background instead of blocking the route
      // so the UI is interactive immediately; the sidebar shows a
      // loading state per-workspace until the list arrives.
      if (refreshPlan.backgroundWorkspaces.length > 0) {
        void loadWorkspaceSessionsInBackground(refreshPlan.backgroundWorkspaces);
      }
    } catch (error) {
      const message = describeRouteError(error);
      console.error("[session-route] refreshRouteState failed", error);
      recordInspectorEvent(
        "route.refresh.error",
        buildRouteRefreshErrorEvent({
          message,
          preservedWorkspaceCount: desktopWorkspaces.length,
        }),
      );
      setRouteError(message);
      if (desktopWorkspaces.length > 0) {
        const orderedDesktopWorkspaces = buildRouteRefreshErrorFallbackWorkspaces({
          desktopWorkspaces,
          workspaceOrderIds: workspaceOrderIdsRef.current,
        });
        const desktopSelectedId = resolveSelectedDesktopSessionWorkspaceId(desktopList);
        setWorkspaces(orderedDesktopWorkspaces);
        setLegacySelectedWorkspaceId((current) => {
          return resolveRouteRefreshErrorSelectedWorkspace({
            currentWorkspaceId: current,
            desktopSelectedId,
            orderedWorkspaces: orderedDesktopWorkspaces,
          });
        });
      }
    } finally {
      setLoading(false);
      refreshInFlightRef.current = false;
      // Tell the boot overlay the first route data load has completed so
      // the overlay dismisses after BOTH the desktop boot and the workspace
      // list/sessions are ready.
      markBootRouteReady();
    }
  }, [
    loadWorkspaceSessionsInBackground,
    markBootRouteReady,
    routeWorkspaceId,
    selectedSessionId,
  ]);

  const remoteAccessRestart = useRemoteAccessRestart({
    isEnabled: () => onmyagentServerSettings.remoteAccessEnabled === true,
    onHostInfo: setOnMyAgentServerHostInfoState,
    onSettingsChanged: () =>
      setOnMyAgentServerSettingsVersion((value) => value + 1),
  });

  const reloadWorkspaceEngineFromUi = useCallback(async () => {
    if (!client || !selectedWorkspaceId) {
      setRouteError(t("app.error_connect_first"));
      return false;
    }
    const endpoint = endpointForWorkspace(selectedWorkspace);
    if (!endpoint) {
      setRouteError(t("app.error_connect_first"));
      return false;
    }
    await endpoint.client.reloadEngine(endpoint.workspaceId);
    await refreshProviderListQueries(getReactQueryClient());
    setEngineReloadVersion((v) => v + 1);
    try {
      window.dispatchEvent(new CustomEvent("onmyagent-server-settings-changed"));
    } catch {
      // ignore browser event dispatch failures
    }
    await refreshRouteState();
    return true;
  }, [
    client,
    endpointForWorkspace,
    refreshRouteState,
    selectedWorkspace,
    selectedWorkspaceId,
  ]);

  useEffect(() => {
    return reloadCoordinator.registerWorkspaceReloadControls({
      canReloadWorkspaceEngine: () => Boolean(client && selectedWorkspaceId),
      reloadWorkspaceEngine: reloadWorkspaceEngineFromUi,
      activeSessions: () => activeReloadBlockingSessions,
    });
  }, [
    activeReloadBlockingSessions,
    client,
    reloadCoordinator,
    reloadWorkspaceEngineFromUi,
    selectedWorkspaceId,
  ]);

  useEffect(() => {
    const shouldReloadAfterOnboarding = readOrgOnboardingReloadRequested();
    const action = resolveOrgOnboardingReloadAction({
      canReloadWorkspaceEngine: reloadCoordinator.canReloadWorkspaceEngine,
      reloadPending: reloadCoordinator.reloadPending,
      shouldReloadAfterOnboarding,
    });
    if (action === "mark-required") {
      reloadCoordinator.markReloadRequired("config", {
        type: "config",
        name: "opencode.json",
        action: "updated",
      });
      return;
    }
    if (action !== "reload") return;
    clearOrgOnboardingReloadRequest();
    void reloadCoordinator.reloadWorkspaceEngine();
  }, [
    reloadCoordinator,
    reloadCoordinator.canReloadWorkspaceEngine,
    reloadCoordinator.reloadPending,
  ]);

  useEffect(() => {
    if (!client || !selectedWorkspaceId) return;
    const endpoint = endpointForWorkspace(selectedWorkspace);
    if (!endpoint) return;
    let cancelled = false;

    const pollReloadEvents = async () => {
      const currentCursor =
        reloadEventCursorByWorkspaceRef.current[selectedWorkspaceId];
      try {
        const response = await endpoint.client.listReloadEvents(
          endpoint.workspaceId,
          typeof currentCursor === "number"
            ? { since: currentCursor }
            : undefined,
        );
        if (cancelled) return;
        reloadEventCursorByWorkspaceRef.current[selectedWorkspaceId] =
          typeof response.cursor === "number"
            ? response.cursor
            : Math.max(currentCursor ?? 0, maxSequence(response.items ?? []));
        // The first poll establishes the server cursor so historical reload
        // events don't show a stale toast on route entry. Subsequent polls mark
        // new filesystem/server-side mutations, including skills created by an
        // agent while the session page is open.
        if (currentCursor === undefined || currentCursor === null) return;
        for (const event of response.items ?? []) {
          reloadCoordinator.markReloadRequired(event.reason, event.trigger);
        }
      } catch {
        // Reload-event polling is best-effort; normal route health checks still
        // surface connection failures.
      }
    };

    void pollReloadEvents();
    const interval = window.setInterval(() => void pollReloadEvents(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    client,
    endpointForWorkspace,
    reloadCoordinator,
    selectedWorkspace,
    selectedWorkspaceId,
  ]);

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
    [selectedWorkspaceId],
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

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (cancelled) return;
        await refreshRouteState();
      } finally {
        if (cancelled) return;
      }
    })();

    const handleSettingsChange = () => {
      setOnMyAgentServerSettingsVersion((value) => value + 1);
      // Self-heal: if the previous refresh got stuck mid-flight (e.g. macOS
      // backgrounded the webview and never let a fetch resolve), clear the
      // guard so a re-entry after resume actually goes through.
      refreshInFlightRef.current = false;
      void refreshRouteState();
    };
    window.addEventListener(
      "onmyagent-server-settings-changed",
      handleSettingsChange,
    );

    // Also retry on visibility flip independently — even when nobody else
    // dispatches the settings event.
    const handleVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      refreshInFlightRef.current = false;
      void refreshRouteState();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      cancelled = true;
      if (startupRetryTimerRef.current !== null) {
        window.clearTimeout(startupRetryTimerRef.current);
        startupRetryTimerRef.current = null;
      }
      window.removeEventListener(
        "onmyagent-server-settings-changed",
        handleSettingsChange,
      );
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [refreshRouteState]);

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
      navigateToWorkspaceSession(navigation.workspaceId, navigation.sessionId, { replace: true });
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
    routeWorkspaceId,
    selectedSessionId,
    selectedWorkspaceId,
    sessionListOwnsSession,
    sessionMatchesPageMode,
    sessionsByWorkspaceId,
    workspaces,
  ]);

  // Redirect to /welcome when no workspaces exist and the user hasn't
  // completed onboarding. This fires after the initial route refresh so
  // `loading` is false and we know for sure there are zero workspaces.
  useEffect(() => {
    if (!shouldRedirectSessionRouteToWelcome({
      hasCompletedOnboarding: local.prefs.hasCompletedOnboarding,
      loading,
      workspaceCount: workspaces.length,
    })) return;
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
    selectedSessionWorkspaceDirectory: selectedSessionWorkspace?.directory ?? "",
    selectedSessionDirectory,
    selectedSessionId,
    selectedWorkspaceId,
    routeWorkspaceId,
    loading,
    retryingWorkspaceIds,
    errorsByWorkspaceId,
    sessionsByWorkspaceId,
  });
  const normalizedSelectedWorkspaceRoot = normalizeDirectoryPath(selectedWorkspaceRoot);
  const normalizedSessionDirectory = normalizeDirectoryPath(selectedSessionDirectory ?? "");
  const selectedSessionFileRoot =
    selectedSessionWorkspace?.directory?.trim() ||
    (normalizedSessionDirectory &&
    normalizedSessionDirectory !== normalizedSelectedWorkspaceRoot
      ? selectedSessionDirectory?.trim() ?? ""
      : "");
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
  const selectedModelUnavailable = isSelectedModelUnavailable({
    defaultModel: local.prefs.defaultModel,
    checkRestriction: checkDesktopRestriction,
    connectedProviderIds: providerConnectedIds,
    providerListData: providerListQuery.data,
  });
  const modelAvailabilityBlocksTask =
    selectedModelUnavailable && !localUserSignedIn;
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

  useEffect(() => {
    if (!opencodeClient) {
      setProviders([]);
      setProviderDefaults({});
      setProviderConnectedIds([]);
      return;
    }

    let cancelled = false;

    const applyProviderState = (value: ProviderListResponse) => {
      if (cancelled) return;
      setProviders(value.all ?? []);
      setProviderConnectedIds(value.connected ?? []);
      setProviderDefaults(value.default ?? {});

      const providerDefaultModel = resolveProviderDefaultModel({
        defaults: value.default,
        currentDefault: local.prefs.defaultModel,
      });
      if (providerDefaultModel) {
        local.setPrefs((previous) => ({
          ...previous,
          defaultModel: providerDefaultModel,
        }));
      }

      // New-provider detection is handled globally by the provider auth
      // store's applyProviderListState, which fires dispatchNewProviders.
    };

    void (async () => {
      let disabledProviders: string[] = [];
      try {
        const config = unwrap(
          await opencodeClient.config.get({
            directory: sessionWorkspaceRoot || undefined,
          }),
        ) as { disabled_providers?: string[] };
        disabledProviders = Array.isArray(config.disabled_providers)
          ? config.disabled_providers
          : [];
        if (!cancelled) setDisabledProviderIds(disabledProviders);
      } catch {
        // ignore config read failures and continue with provider discovery
      }

      try {
        applyProviderState(
          filterProviderList(
            await ensureProviderListQuery(getReactQueryClient(), {
              client: opencodeClient,
              baseUrl: opencodeBaseUrl,
              directory: sessionWorkspaceRoot || undefined,
            }),
            disabledProviders,
          ),
        );
      } catch {
        if (cancelled) return;
        setProviders([]);
        setProviderDefaults({});
        setProviderConnectedIds([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    opencodeBaseUrl,
    opencodeClient,
    sessionWorkspaceRoot,
    denSessionVersion,
  ]);

  const modelScopeSessionId = selectedSessionId ?? `draft:${selectedWorkspaceId}`;
  // Priority: 1) this session's override, 2) pending agent's configured model,
  // 3) global default. Session controls must never rewrite the global default.
  const effectiveModelRef =
    sessionModelOverrideById[modelScopeSessionId] ??
    pendingAgent?.model ??
    local.prefs.defaultModel;
  const modelLabel = effectiveModelRef
    ? resolveModelDisplayName(effectiveModelRef.modelID)
    : t("session.default_model");
  const localeSnapshot = useSyncExternalStore(
    subscribeToLocale,
    currentLocale,
    currentLocale,
  );

  // Prefetch the full provider catalog once so `getModelBehaviorSummary` has
  // everything it needs to expose the reasoning/thinking variants the active
  // model supports — without waiting for the model picker to open. Cached
  // as providerID → modelID → ProviderModel.
  useEffect(() => {
    const data = providerListQuery.data;
    if (!data?.all) return;
    setProviderCatalog(buildProviderModelCatalog(data));
  }, [providerListQuery.data]);

  // Compute behavior (reasoning/thinking variant) options for the current
  // default model. This is what the composer renders as its variant pill.
  const { modelVariantLabel, modelBehaviorOptions, modelVariantValue } =
    useMemo(
      () =>
        resolveModelVariantState({
          ref: effectiveModelRef,
          variant: local.prefs.modelVariant,
          providerCatalog,
          emptyOptions: emptyModelBehaviorOptions,
        }),
      [effectiveModelRef, local.prefs.modelVariant, localeSnapshot, providerCatalog],
    );

  // Load the picker list lazily the first time the modal opens. Uses the
  // cached catalog when available, otherwise re-fetches.
  useEffect(() => {
    if (!modelPickerOpen || !opencodeClient) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await ensureProviderListQuery(getReactQueryClient(), {
          client: opencodeClient,
          baseUrl: opencodeBaseUrl,
          directory: sessionWorkspaceRoot || undefined,
        });
        if (cancelled || !data?.all) return;
        setModelOptions(
          buildConnectedModelOptions({
            data,
            seenProviderIds: readWindowSeenProviderIds(),
            recentProviderIds,
          }),
        );
      } catch {
        // Silent: the picker surfaces an empty list rather than blocking the UI.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    modelPickerOpen,
    opencodeBaseUrl,
    opencodeClient,
    recentProviderIds,
    sessionWorkspaceRoot,
  ]);

  // Apply org-level restrictions (dev #1505) on top of the raw model list
  // so the picker never surfaces blocked options:
  //   - `allowZenModel` hides the built-in OpenCode provider entries when false
  //   - `allowCustomProviders` hides providers that OpenCode does not report
  //     as connected through the provider list endpoint.
  const allowedModelOptions = useMemo(
    () =>
      filterAllowedModelOptions({
        options: modelOptions,
        checkRestriction: checkDesktopRestriction,
      }),
    [checkDesktopRestriction, modelOptions],
  );

  const listSlashCommands = useCallback(async (): Promise<
    SlashCommandOption[]
  > => {
    // engineReloadVersion is included so the callback identity changes after
    // an engine reload, which invalidates the composer's command list cache
    // and causes it to re-fetch (picking up newly created skills).
    void engineReloadVersion;
    if (!opencodeClient) return [];
    return listCommands(opencodeClient, sessionWorkspaceRoot || undefined);
  }, [engineReloadVersion, opencodeClient, sessionWorkspaceRoot]);

  const refreshCreatedSessionSnapshot = useCallback(
    (sessionId: string, directory: string) => {
      const endpoint = selectedWorkspaceEndpoint;
      if (!endpoint) return;
      void refreshCreatedSessionSnapshotWithRetries({
        directory,
        endpoint,
        sessionId,
        setQueryData: (queryKey, value) => getReactQueryClient().setQueryData(queryKey, value),
        seedSessionState,
      });
    },
    [selectedWorkspaceEndpoint],
  );

  const handleOpenSettings = useCallback(
    (route = "/settings/general", workspaceId = sidebarActiveWorkspaceId) => {
      const navigation = buildSettingsNavigationTarget({
        route,
        workspaceId,
        activeWorkspaceId: sidebarActiveWorkspaceId,
        selectedSessionId,
        workspaceSettingsRoute,
      });
      writeActiveWorkspaceId(workspaceId || null);
      navigate(navigation.target, { state: navigation.state });
    },
    [navigate, selectedSessionId, sidebarActiveWorkspaceId],
  );

  const surfaceProps = useSessionRouteSurfaceProps({
    assistantDraftWorkspaceRoot,
    client,
    compactModelPickerOpen,
    creatingSessionWorkspaceIdsRef,
    effectiveModelRef,
    forceNewSessionOnNextSendRef,
    handleOpenSettings,
    handleRuntimeSessionUpdated,
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
  }, []);

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
    () => buildCommandPaletteControlAction({
      openCommandPalette: () => setCommandPaletteOpen(true),
    }),
    [],
  );
  useControlAction(commandPaletteControlAction);

  const paletteSessionOptions = useMemo(
    () => toPaletteSessionOptions({
      workspaces,
      sessionsByWorkspaceId,
      selectedWorkspaceId,
    }),
    [sessionsByWorkspaceId, selectedWorkspaceId, workspaces],
  );

  const developerMode = readDeveloperModeEnabled();

  return (
    <CloudSessionProvider>
      <SessionCloudAccountBridge
        developerMode={developerMode}
        onAccountChange={setSidebarAccount}
      />
      <WorkspaceProvider
        client={opencodeClient}
        opencodeBaseUrl={opencodeBaseUrl}
        selectedWorkspaceRoot={sessionWorkspaceRoot}
      >
        {opencodeClient &&
        selectedWorkspaceEndpoint &&
        opencodeBaseUrl &&
        selectedWorkspaceServerToken ? (
          <ReactSessionRuntime
            // Use the server-side workspace id (the one without the `rem_`
            // prefix) so the React Query cache keys session-sync writes match
            // the keys SessionSurface reads from. Otherwise events arrive but
            // the UI never sees them and gets stuck on "thinking".
            workspaceId={selectedWorkspaceEndpoint.workspaceId}
            sessionId={selectedSessionId}
            activeSessionIds={activeSelectedWorkspaceSessionIds}
            directory={sessionWorkspaceRoot}
            opencodeBaseUrl={opencodeBaseUrl}
            onmyagentToken={selectedWorkspaceServerToken}
            onSessionUpdated={handleRuntimeSessionUpdated}
          />
        ) : null}
        <SessionPage
          mode={pageMode}
          agentManagementIntent={agentManagementIntent}
          onAgentManagementIntentConsumed={clearAgentManagementIntent}
          onNavigateToMode={(targetMode) => {
            if (targetMode === "assistant") {
              suppressRestoreSessionRef.current = true;
            }
            const path = resolveSessionRouteModeSwitchPath({
              currentMode: pageMode,
              findFirstSessionIdMatching,
              isExpertSession,
              readLastSessionFor,
              sessionListOwnsSession,
              sessionsByWorkspaceId,
              targetMode,
              workspaceId: selectedWorkspaceId,
            });
            if (path) navigate(path, { replace: true });
          }}
          selectedSessionId={selectedSessionId}
          selectedWorkspaceId={selectedWorkspaceId}
          selectedWorkspaceDisplay={
            selectedWorkspace
              ? {
                  id: selectedWorkspace.id,
                  name: selectedWorkspace.name ?? undefined,
                  displayName: selectedWorkspace.displayNameResolved,
                  workspaceType: selectedWorkspace.workspaceType,
                }
              : { workspaceType: "local" }
          }
          selectedWorkspaceRoot={sessionWorkspaceRoot}
          selectedSessionFileRoot={selectedSessionFileRoot}
          selectedWorkspaceError={selectedWorkspaceError}
          runtimeWorkspaceId={selectedWorkspaceEndpoint?.workspaceId || null}
          opencodeBaseUrl={opencodeBaseUrl}
          workspaces={workspaces}
          clientConnected={canCreateTask}
          onmyagentServerStatus={client ? "connected" : "disconnected"}
          onmyagentServerClient={selectedWorkspaceEndpoint?.client ?? client}
          onmyagentServerToken={selectedWorkspaceServerToken}
          developerMode={developerMode}
          headerStatus={
            canCreateTask ? t("status.connected") : t("session.loading_detail")
          }
          busyHint={effectiveLoading ? t("session.loading_detail") : null}
          startupPhase={effectiveLoading ? "nativeInit" : "ready"}
          providerConnectedIds={providerConnectedIds}
          providers={providers}
          renderAgentsPage={(agentsPageProps) => <AgentsPage {...agentsPageProps} />}
          mcpConnectedCount={0}
          onSendFeedback={() => {
            platform.openLink(
              buildFeedbackUrl({
                entrypoint: "status-bar",
              }),
            );
          }}
          onOpenSettings={() => handleOpenSettings("/settings/general")}
          providerAuthModal={
            sessionProviderAuthSnapshot.providerAuthModalOpen
              ? {
                  open: true,
                  loading: false,
                  submitting: sessionProviderAuthSnapshot.providerAuthBusy,
                  error: sessionProviderAuthSnapshot.providerAuthError,
                  preferredProviderId:
                    sessionProviderAuthSnapshot.providerAuthPreferredProviderId,
                  workerType:
                    sessionProviderAuthSnapshot.providerAuthWorkerType,
                  providers:
                    sessionProviderAuthSnapshot.providerAuthProviders.filter(
                      (provider) =>
                        !isDesktopProviderBlocked({
                          providerId: provider.id,
                          checkRestriction: checkDesktopRestriction,
                        }),
                    ),
                  connectedProviderIds: providerConnectedIds,
                  authMethods: Object.fromEntries(
                    Object.entries(
                      sessionProviderAuthSnapshot.providerAuthMethods,
                    ).filter(
                      ([providerId]) =>
                        !isDesktopProviderBlocked({
                          providerId,
                          checkRestriction: checkDesktopRestriction,
                        }),
                    ),
                  ),
                  onSelect: sessionProviderAuthStore.startProviderAuth,
                  onSubmitApiKey: sessionProviderAuthStore.submitProviderApiKey,
                  onConnectCloudProvider:
                    sessionProviderAuthStore.connectCloudProvider,
                  onSubmitOAuth:
                    sessionProviderAuthStore.completeProviderAuthOAuth,
                  onRefreshProviders: sessionProviderAuthStore.refreshProviders,
                  onClose: () =>
                    sessionProviderAuthStore.closeProviderAuthModal(),
                }
              : null
          }
          settingsSlot={
            <SettingsSurface
              embedded
              initialPath="extensions"
              workspaceId={selectedWorkspaceId}
              onClose={() => {
                try {
                  window.dispatchEvent(
                    new CustomEvent("onmyagent-close-right-pane"),
                  );
                } catch {
                  // ignore
                }
              }}
            />
          }
          onCreateSessionForAgent={() => {
            forceNewSessionOnNextSendRef.current = true;
          }}
          onCreateFreshSessionForAgent={async (workspaceId) => {
            // Called when the user clicks "+对话" on an agent that is NOT yet
            // present in the left-side agent list. We must create a real
            // session right now (so the new agent is visible on the left as
            // soon as we navigate to that session).
            if (!opencodeClient) return;
            if (creatingSessionWorkspaceIdsRef.current.has(workspaceId)) return;
            creatingSessionWorkspaceIdsRef.current.add(workspaceId);
            let newSession: { id: string; title?: string; time?: unknown } | null = null;
            try {
              newSession = unwrap(
                await opencodeClient.session.create({
                  directory: selectedWorkspaceRoot?.trim() || undefined,
                }),
              );
              useSessionActivityStore
                .getState()
                .startRun(workspaceId, newSession.id);
            } finally {
              creatingSessionWorkspaceIdsRef.current.delete(workspaceId);
            }
            if (!newSession) return;

            // Bind the pending agent to this new session (so it appears with
            // the agent avatar + system prompt when user sends first message).
            const pendingAgentSnapshot =
              usePendingAgentStore.getState().getAgent();
            if (pendingAgentSnapshot) {
              usePendingAgentStore.getState().setAgent({
                ...pendingAgentSnapshot,
                boundSessionId: newSession.id,
              });
              writeCustomAgentIdForSession(
                newSession.id,
                pendingAgentSnapshot.id,
              );
              writeSessionAgentSnapshot(newSession.id, pendingAgentSnapshot);
              await installMarketplaceExpertAfterSessionCreated(
                pendingAgentSnapshot,
              );
            }

            addExpertSession(newSession.id);

            // Optimistically append the new session into the workspace list
            // so the left-side agent panel renders the new agent immediately.
            setLegacySelectedWorkspaceId(workspaceId);
            writeActiveWorkspaceId(workspaceId || null);
            writeLastSessionFor(workspaceId, newSession.id);
            rememberPendingCreatedSession(workspaceId, newSession.id);
            setSessionsByWorkspaceId((current) => {
              const next = insertSidebarSession({
                current,
                workspaceId,
                session: newSession,
              });
              sessionsByWorkspaceIdRef.current = next;
              return next;
            });
            navigateToWorkspaceSession(workspaceId, newSession.id);
            focusPromptSoon();
            void refreshRouteState();
          }}
          sidebar={{
            workspaceSessionGroups,
            selectedWorkspaceId,
            selectedSessionId,
            developerMode: false,
            sessionStatusById: sidebarSessionStatusById,
            connectingWorkspaceId: null,
            workspaceConnectionStateById,
            newTaskDisabled: !canCreateTask,
            sidebarHydratedFromCache: Object.values(sessionsByWorkspaceId).some(
              (list) => list.length > 0,
            ),
            startupPhase: effectiveLoading ? "nativeInit" : "ready",
            onSelectWorkspace: async (workspaceId) => {
              if (workspaceId === selectedWorkspaceId) return true;
              setLegacySelectedWorkspaceId(workspaceId);
              writeActiveWorkspaceId(workspaceId || null);
              const workspace = workspaces.find(
                (item) => item.id === workspaceId,
              );
              if (
                client &&
                workspace &&
                !sessionsByWorkspaceId[workspaceId]?.length
              ) {
                setRetryingWorkspaceIds((current) =>
                  Array.from(new Set([...current, workspaceId])),
                );
                void loadWorkspaceSessionsInBackground([workspace]);
              }
              // Fire desktop IPC updates but don't await them — they're bookkeeping and
              // awaiting 2 IPC roundtrips on every click used to stall rapid
              // workspace switches behind a queue.
              activateDesktopSessionWorkspaceInBackground(workspaceId);
              // Tell the OnMyAgent server this workspace is now active so it can
              // emit a config reload event that the OpenCode engine picks up.
              // Without this, the permissions from opencode.jsonc are never
              // applied on the workspace the user is already on at launch. See
              // issue #870.
              if (workspaceId && client) {
                const workspace = findRouteWorkspace(workspaces, workspaceId);
                const endpoint = endpointForWorkspace(workspace);
                if (endpoint) {
                  void endpoint.client
                    .activateWorkspace(endpoint.workspaceId)
                    .catch(() => undefined);
                }
              }
              const targetSessionId = resolveWorkspaceSelectionSessionTarget({
                firstSessionIdForPageMode,
                readLastSessionFor,
                selectedSessionId,
                sessionMatchesPageMode,
                sessionsByWorkspaceId,
                workspaceId,
              });
              navigateToWorkspaceSession(workspaceId, targetSessionId);
              return true;
            },
            onOpenSession: (workspaceId, sessionId) => {
              setLegacySelectedWorkspaceId(workspaceId);
              writeActiveWorkspaceId(workspaceId || null);
              writeLastSessionFor(workspaceId, sessionId);
              navigateToWorkspaceSession(workspaceId, sessionId);
            },
            onPrefetchSession: () => {},
            onCreateTaskInWorkspace: (workspaceId) => {
              void handleCreateTaskInWorkspace(workspaceId);
            },
            onCreateTaskWithPrompt: (workspaceId, prompt) => {
              void (async () => {
                const workspace = workspaces.find(
                  (item) => item.id === workspaceId,
                );
                if (!workspace) return;
                const endpoint = resolveWorkspaceEndpoint(workspace, {
                  baseUrl,
                  token,
                });
                if (!endpoint?.token) return;
                const workspaceClient = createClient(
                  endpoint.opencodeBaseUrl,
                  workspace.path?.trim() || undefined,
                  { token: endpoint.token, mode: "onmyagent" },
                );
                try {
                  const session = unwrap(
                    await workspaceClient.session.create({
                      directory: workspace.path?.trim() || undefined,
                    }),
                  );
                  saveSessionDraft(workspaceId, session.id, {
                    text: prompt,
                    mode: "prompt",
                  });
                  writeActiveWorkspaceId(workspaceId || null);
                  writeLastSessionFor(workspaceId, session.id);
                  rememberPendingCreatedSession(workspaceId, session.id);
                  setSessionsByWorkspaceId((current) =>
                    insertSidebarSession({
                      current,
                      workspaceId,
                      session,
                    }),
                  );
                  navigateToWorkspaceSession(workspaceId, session.id);
                  focusPromptSoon();
                } catch {
                  // Fall back to normal task creation without prompt
                  void handleCreateTaskInWorkspace(workspaceId);
                }
              })();
            },
            onOpenRenameWorkspace: handleOpenRenameWorkspace,
            onShareWorkspace: handleShareWorkspace,
            onRevealWorkspace: (id) => void handleRevealWorkspace(id),
            onRecoverWorkspace: (workspaceId) =>
              runRemoteWorkspaceConnectionCheck(workspaceId, "recover"),
            onTestWorkspaceConnection: (workspaceId) =>
              runRemoteWorkspaceConnectionCheck(workspaceId, "test"),
            onEditWorkspaceConnection: remoteWorkspaceConnectionEditor.open,
            onForgetWorkspace: (id) => void handleForgetWorkspace(id),
            onOpenCreateWorkspace: handleOpenCreateWorkspace,
            onReorderWorkspaces: handleReorderWorkspaces,
          }}
          surface={surfaceProps}
          history={{
            canUndo: false,
            canRedo: false,
            busyAction: null,
            onUndo: () => {},
            onRedo: () => {},
          }}
          todos={visibleTodos}
          sessionLoadingById={(sessionId) =>
            effectiveLoading &&
            Boolean(sessionId && sessionId === selectedSessionId)
          }
          shareWorkspaceModal={
            shareWorkspaceState.shareWorkspaceOpen
              ? {
                  open: true,
                  onClose: shareWorkspaceState.closeShareWorkspace,
                  workspaceName: shareWorkspaceState.shareWorkspaceName,
                  workspaceDetail: shareWorkspaceState.shareWorkspaceDetail,
                  fields: shareWorkspaceState.shareFields,
                  remoteAccess:
                    isDesktopRuntime() &&
                    shareWorkspaceState.shareWorkspace?.workspaceType ===
                      "local"
                      ? {
                          enabled:
                            onmyagentServerSettings.remoteAccessEnabled === true,
                          busy: remoteAccessRestart.busy,
                          error: remoteAccessRestart.error,
                          status: remoteAccessRestart.status,
                          onSave: handleSaveShareRemoteAccess,
                        }
                      : undefined,
                  note: shareWorkspaceState.shareNote,
                  onExportConfig:
                    shareWorkspaceState.exportDisabledReason === null
                      ? () => {
                          const id = shareWorkspaceState.shareWorkspaceId;
                          if (!id) return;
                          void handleExportWorkspaceConfig(id);
                        }
                      : undefined,
                  exportDisabledReason:
                    shareWorkspaceState.exportDisabledReason,
                }
              : null
          }
          activePermission={activePermission}
          permissionReplyBusy={permissionReplyBusy}
          respondPermission={respondPermission}
          autoApprovedPermissionNoticeId={
            selectedSessionId
              ? autoApprovedPermissionNoticeBySessionId[selectedSessionId] ?? null
              : null
          }
          activeQuestion={activeQuestion}
          questionReplyBusy={questionReplyBusy}
          respondQuestion={respondQuestion}
          safeStringify={safeStringify}
          onRenameSession={
            opencodeClient
              ? async (sessionId, nextTitle) => {
                  const trimmed = nextTitle.trim();
                  if (!trimmed) return;
                  const assistantSessionWorkspace =
                    readAssistantSessionWorkspace(sessionId);
                  await opencodeClient.session.update({
                    sessionID: sessionId,
                    title: trimmed,
                    directory:
                      assistantSessionWorkspace?.directory ||
                      selectedWorkspaceRoot ||
                      undefined,
                  });
                  if (assistantSessionWorkspace?.ownerWorkspaceId) {
                    renameAutomationSessionRecord(
                      assistantSessionWorkspace.ownerWorkspaceId,
                      sessionId,
                      trimmed,
                    );
                  }
                  await refreshRouteState();
                }
              : undefined
          }
          onDeleteSession={
            client && selectedWorkspaceId
              ? async (sessionId) => {
                  const endpoint = endpointForWorkspace(selectedWorkspace);
                  if (!endpoint) return;
                  const assistantSessionWorkspace =
                    readAssistantSessionWorkspace(sessionId);
                  await endpoint.client.deleteSession(
                    endpoint.workspaceId,
                    sessionId,
                    {
                      directory: assistantSessionWorkspace?.directory,
                    },
                  );
                  removeAssistantSession(sessionId);
                  removeExpertSession(sessionId);
                  writeCustomAgentIdForSession(sessionId, null);
                  writeSessionAgentSnapshot(sessionId, null);
                  if (assistantSessionWorkspace?.ownerWorkspaceId) {
                    removeAutomationSessionRecord(
                      assistantSessionWorkspace.ownerWorkspaceId,
                      sessionId,
                    );
                  }
                  removeAssistantSessionWorkspace(sessionId);
                  if (assistantSessionWorkspace?.ownerWorkspaceId) {
                    dispatchAssistantSessionWorkspacesChanged(
                      assistantSessionWorkspace.ownerWorkspaceId,
                    );
                  }
                  if (selectedSessionId === sessionId) {
                    navigateToWorkspaceSession(selectedWorkspaceId);
                  }
                  await refreshRouteState();
                }
              : undefined
          }
          statusBar={{ loading: showPreparingStatus }}
          notFoundMessage={routeNotFoundMessage}
          onAccessibleTargetsChange={setPaletteAccessibleTargets}
          account={sidebarAccount}
          onOpenAccountSettings={() =>
            handleOpenSettings("/settings/general")
          }
          onSignOut={handleSignOut}
        />
        <SessionRouteModals
          createWorkspaceOpen={createWorkspaceOpen}
          setCreateWorkspaceOpen={setCreateWorkspaceOpen}
          setCreateWorkspaceError={setCreateWorkspaceError}
          handleCreateWorkspace={handleCreateWorkspace}
          handleCreateRemoteWorkspace={handleCreateRemoteWorkspace}
          createWorkspaceBusy={createWorkspaceBusy}
          createWorkspaceError={createWorkspaceError}
          createWorkspaceRemoteBusy={createWorkspaceRemoteBusy}
          createWorkspaceRemoteError={createWorkspaceRemoteError}
          remoteWorkspaceConnectionEditor={remoteWorkspaceConnectionEditor}
          renameWorkspaceId={renameWorkspaceId}
          renameWorkspaceTitle={renameWorkspaceTitle}
          renameWorkspaceBusy={renameWorkspaceBusy}
          setRenameWorkspaceId={setRenameWorkspaceId}
          setRenameWorkspaceTitle={setRenameWorkspaceTitle}
          handleSaveRenameWorkspace={handleSaveRenameWorkspace}
          commandPaletteOpen={commandPaletteOpen}
          setCommandPaletteOpen={setCommandPaletteOpen}
          selectedWorkspaceId={selectedWorkspaceId}
          handleCreateTaskInWorkspace={handleCreateTaskInWorkspace}
          navigateToWorkspaceSession={navigateToWorkspaceSession}
          handleOpenSettings={handleOpenSettings}
          paletteAccessibleTargets={paletteAccessibleTargets}
          paletteSessionOptions={paletteSessionOptions}
          modelPickerOpen={modelPickerOpen}
          setModelPickerOpen={setModelPickerOpen}
          allowedModelOptions={allowedModelOptions}
          modelPickerQuery={modelPickerQuery}
          setModelPickerQuery={setModelPickerQuery}
          defaultModel={local.prefs.defaultModel}
          setPrefs={local.setPrefs}
          disabledProviderIds={disabledProviderIds}
          setDisabledProviderIds={setDisabledProviderIds}
          setRecentProviderIds={setRecentProviderIds}
          opencodeClient={opencodeClient}
        />
      </WorkspaceProvider>
    </CloudSessionProvider>
  );
}
