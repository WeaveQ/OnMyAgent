/**
 * Route refresh + workspace engine reload wiring for the session route.
 * Owns refreshRouteState, remote-access restart, and reload-event polling.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { OnMyAgentServerClient } from "../../app/lib/onmyagent-server";
import type { ResolvedWorkspaceEndpoint } from "../../app/lib/workspace-endpoint";
import type { OnMyAgentServerInfo } from "../../app/lib/desktop";
import type { SidebarSessionItem } from "../../app/types";
import { t } from "../../i18n";
import { getReactQueryClient } from "../infra/query-client";
import { refreshProviderListQueries } from "../domains/connections";
import { useRemoteAccessRestart } from "../domains/workspace";
import { recordInspectorEvent } from "./app-inspector";
import { useReloadCoordinator } from "./reload-coordinator";
import {
  clearSessionLocalServerRef,
  writeSessionLocalServerRef,
  type SessionLocalServerRefValue,
} from "./session-route-refs";
import { loadSessionOnMyAgentConnectionState } from "./session-route-server-actions";
import {
  buildConnectedRouteRefreshPlan,
  buildDisconnectedRouteState,
  buildRouteRefreshCompleteEvent,
  buildRouteRefreshErrorEvent,
  buildRouteRefreshErrorFallbackWorkspaces,
  describeRouteError,
  findRouteWorkspace,
  resolveOrgOnboardingReloadAction,
  resolveRouteRefreshErrorSelectedWorkspace,
  retainWorkspaceErrorsById,
  shouldLaunchActivateWorkspace,
  type RouteWorkspace,
} from "./session-route-model";
import { clearOrgOnboardingReloadRequest, readOrgOnboardingReloadRequested } from "./session-route-storage";
import {
  loadDesktopSessionWorkspaces,
  resolveSelectedDesktopSessionWorkspaceId,
} from "./session-route-workspace-actions";
import { maxSequence } from "./session-route-sessions";
import {
  readActiveWorkspaceId,
  writeActiveWorkspaceId,
} from "./session-memory";

type EndpointForWorkspace = (
  workspace: RouteWorkspace | null | undefined,
) => ResolvedWorkspaceEndpoint | null;

type Input = {
  activeReloadBlockingSessions: Array<{ id: string; title: string }>;
  client: OnMyAgentServerClient | null;
  endpointForWorkspace: EndpointForWorkspace;
  loadWorkspaceSessionsInBackground: (
    workspaces: RouteWorkspace[],
  ) => Promise<void>;
  localServerRef: MutableRefObject<SessionLocalServerRefValue>;
  markBootRouteReady: () => void;
  onmyagentServerSettings: { remoteAccessEnabled?: boolean };
  routeWorkspaceId: string;
  selectedSessionId: string | null;
  selectedWorkspace: RouteWorkspace | null | undefined;
  selectedWorkspaceId: string;
  sessionsByWorkspaceIdRef: MutableRefObject<
    Record<string, SidebarSessionItem[]>
  >;
  setBaseUrl: Dispatch<SetStateAction<string>>;
  setClient: Dispatch<SetStateAction<OnMyAgentServerClient | null>>;
  setEngineReloadVersion: Dispatch<SetStateAction<number>>;
  setErrorsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, string | null>>
  >;
  setLegacySelectedWorkspaceId: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setOnMyAgentServerHostInfoState: Dispatch<
    SetStateAction<OnMyAgentServerInfo | null>
  >;
  setOnMyAgentServerSettingsVersion: Dispatch<SetStateAction<number>>;
  setRetryingWorkspaceIds: Dispatch<SetStateAction<string[]>>;
  setRouteError: Dispatch<SetStateAction<string | null>>;
  setSessionsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, SidebarSessionItem[]>>
  >;
  setToken: Dispatch<SetStateAction<string>>;
  setWorkspaces: Dispatch<SetStateAction<RouteWorkspace[]>>;
  workspaceOrderIdsRef: MutableRefObject<string[]>;
  workspacesRef: MutableRefObject<RouteWorkspace[]>;
};

export function useSessionRouteRefresh(input: Input) {
  const {
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
  } = input;

  const reloadCoordinator = useReloadCoordinator();
  // One-way latch for "a refreshRouteState is currently running"; prevents
  // overlapping route refreshes from queueing up when the user clicks fast.
  const refreshInFlightRef = useRef(false);
  const reloadEventCursorByWorkspaceRef = useRef<Record<string, number | null>>(
    {},
  );
  const launchActivatedWorkspaceIdsRef = useRef(new Set<string>());
  const startupRetryTimerRef = useRef<number | null>(null);

  const refreshRouteState = useCallback(async () => {
    // Dedupe: if a refresh is already running, skip this call. Fast workspace
    // switches used to fire 5-6 overlapping refreshRouteState() calls which
    // each fetched workspaces + sessions for every workspace. That workload
    // multiplied quickly on the event loop and caused the UI to freeze.
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setLoading(true);
    setRouteError(null);
    let desktopList: Awaited<
      ReturnType<typeof loadDesktopSessionWorkspaces>
    >["desktopList"] = null;
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
          desktopSelectedId:
            resolveSelectedDesktopSessionWorkspaceId(desktopList),
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
        desktopSelectedId:
          resolveSelectedDesktopSessionWorkspaceId(desktopList),
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
      if (
        shouldLaunchActivateWorkspace({
          launchedWorkspaceIds: launchActivatedWorkspaceIdsRef.current,
          selectedWorkspaceId: nextWorkspaceId,
          serverActiveId: sessionConnection.serverActiveId,
        })
      ) {
        launchActivatedWorkspaceIdsRef.current.add(nextWorkspaceId);
        const nextWorkspace = findRouteWorkspace(
          nextWorkspaces,
          nextWorkspaceId,
        );
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
        void loadWorkspaceSessionsInBackground(
          refreshPlan.backgroundWorkspaces,
        );
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
        const orderedDesktopWorkspaces =
          buildRouteRefreshErrorFallbackWorkspaces({
            desktopWorkspaces,
            workspaceOrderIds: workspaceOrderIdsRef.current,
          });
        const desktopSelectedId =
          resolveSelectedDesktopSessionWorkspaceId(desktopList);
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
    endpointForWorkspace,
    loadWorkspaceSessionsInBackground,
    localServerRef,
    markBootRouteReady,
    routeWorkspaceId,
    selectedSessionId,
    sessionsByWorkspaceIdRef,
    setBaseUrl,
    setClient,
    setErrorsByWorkspaceId,
    setLegacySelectedWorkspaceId,
    setLoading,
    setOnMyAgentServerHostInfoState,
    setRetryingWorkspaceIds,
    setRouteError,
    setSessionsByWorkspaceId,
    setToken,
    setWorkspaces,
    workspaceOrderIdsRef,
    workspacesRef,
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
      window.dispatchEvent(
        new CustomEvent("onmyagent-server-settings-changed"),
      );
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
    setEngineReloadVersion,
    setRouteError,
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
  }, [refreshRouteState, setOnMyAgentServerSettingsVersion]);

  return {
    refreshRouteState,
    remoteAccessRestart,
    reloadWorkspaceEngineFromUi,
    reloadCoordinator,
  };
}
