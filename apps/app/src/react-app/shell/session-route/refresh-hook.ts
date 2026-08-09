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

import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type { ResolvedWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import type { OnMyAgentServerInfo } from "../../../app/lib/desktop";
import type { SidebarSessionItem } from "../../../app/types";
import { getReactQueryClient } from "../../infra/query-client";
import { refreshProviderListQueries } from "../../domains/connections";
import { useRemoteAccessRestart } from "../../domains/workspace";
import {
  userErrorFromRaw,
  userErrorMessage,
} from "../../kernel/user-error";
import { recordInspectorEvent } from "../app-inspector";
import { useReloadCoordinator } from "../reload-coordinator";
import {
  clearSessionLocalServerRef,
  writeSessionLocalServerRef,
  type SessionLocalServerRefValue,
} from "./refs";
import { loadSessionOnMyAgentConnectionState } from "./server-actions";
import {
  RELOAD_EVENTS_POLL_INTERVAL_MS,
  shouldRunReloadEventsPoll,
} from "../../domains/session";
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
} from "./model";
import { clearOrgOnboardingReloadRequest, readOrgOnboardingReloadRequested } from "./storage";
import {
  loadDesktopSessionWorkspaces,
  resolveSelectedDesktopSessionWorkspaceId,
} from "./workspace-actions";
import {
  filterExpertCreationEphemeralSessionsByWorkspace,
  maxSequence,
} from "./sessions";
import {
  readActiveWorkspaceId,
  readCachedSidebarSessionsByWorkspace,
  writeActiveWorkspaceId,
} from "../session-memory";
import { scheduleIdleWork } from "./prewarm-schedule";

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
  /** Assistant draft home owns the first-paint boot latch. */
  waitForStaticHomeFirstPaint: boolean;
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
    waitForStaticHomeFirstPaint,
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
  const startupRetryAttemptsRef = useRef(0);
  const refreshRouteStateRef = useRef<(() => Promise<void>) | null>(null);
  // Session navigation must not recreate refreshRouteState: doing so reran the
  // route effect and revalidated every durable expert directory on each click.
  // Explicit refreshes still read the latest route session through this ref.
  const selectedSessionIdRef = useRef(selectedSessionId);
  selectedSessionIdRef.current = selectedSessionId;
  const waitForStaticHomeFirstPaintRef = useRef(waitForStaticHomeFirstPaint);
  waitForStaticHomeFirstPaintRef.current = waitForStaticHomeFirstPaint;

  const scheduleStartupConnectionRetry = useCallback(() => {
    if (startupRetryTimerRef.current !== null) return;
    if (startupRetryAttemptsRef.current >= 8) return;
    const attempt = startupRetryAttemptsRef.current + 1;
    // Backoff while desktop runtime finishes embedding the local server.
    startupRetryTimerRef.current = window.setTimeout(() => {
      startupRetryTimerRef.current = null;
      startupRetryAttemptsRef.current = attempt;
      refreshInFlightRef.current = false;
      void refreshRouteStateRef.current?.();
    }, Math.min(350 * attempt, 2_000));
  }, []);

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
    let shellReadyMarked = false;
    const markShellReady = () => {
      if (shellReadyMarked) return;
      shellReadyMarked = true;
      // Only dismiss boot overlay after the first connection attempt finishes
      // (success or scheduled retry). Cache can paint under the overlay first.
      markBootRouteReady();
    };
    try {
      const desktopBootstrap = await loadDesktopSessionWorkspaces({
        fallbackWorkspaces: workspacesRef.current,
      });
      desktopList = desktopBootstrap.desktopList;
      desktopWorkspaces = desktopBootstrap.desktopWorkspaces;

      // Cache-first paint under the boot overlay (do not mark route ready yet —
      // that used to drop the overlay onto an empty/disconnected home).
      if (desktopWorkspaces.length > 0) {
        const cachedSessions = filterExpertCreationEphemeralSessionsByWorkspace(
          readCachedSidebarSessionsByWorkspace(),
        );
        const desktopSelectedId =
          resolveSelectedDesktopSessionWorkspaceId(desktopList);
        const disconnectedPreview = buildDisconnectedRouteState({
          desktopWorkspaces,
          workspaceOrderIds: workspaceOrderIdsRef.current,
          desktopSelectedId,
        });
        setWorkspaces(disconnectedPreview.orderedWorkspaces);
        if (Object.keys(cachedSessions).length > 0) {
          const nextSessions = { ...cachedSessions };
          sessionsByWorkspaceIdRef.current = {
            ...sessionsByWorkspaceIdRef.current,
            ...nextSessions,
          };
          setSessionsByWorkspaceId((current) => ({
            ...current,
            ...nextSessions,
          }));
        }
        if (disconnectedPreview.selectedWorkspaceId) {
          setLegacySelectedWorkspaceId((current) =>
            current?.trim()
              ? current
              : disconnectedPreview.selectedWorkspaceId,
          );
        }
      }

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
        // Keep cached sidebar titles during transient disconnect on cold start
        // so the shell does not flash empty while the runtime is still booting.
        if (Object.keys(sessionsByWorkspaceIdRef.current).length === 0) {
          const cachedSessions = filterExpertCreationEphemeralSessionsByWorkspace(
            readCachedSidebarSessionsByWorkspace(),
          );
          if (Object.keys(cachedSessions).length > 0) {
            sessionsByWorkspaceIdRef.current = cachedSessions;
            setSessionsByWorkspaceId(cachedSessions);
          } else {
            sessionsByWorkspaceIdRef.current = {};
            setSessionsByWorkspaceId({});
          }
        }
        setErrorsByWorkspaceId({});
        setLegacySelectedWorkspaceId(disconnectedState.selectedWorkspaceId);
        // Defer overlay dismiss to finally: engine boot may still be running.
        scheduleStartupConnectionRetry();
        return;
      }
      // Connected — stop cold-start connection polling.
      startupRetryAttemptsRef.current = 0;
      if (startupRetryTimerRef.current !== null) {
        window.clearTimeout(startupRetryTimerRef.current);
        startupRetryTimerRef.current = null;
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
        selectedSessionId: selectedSessionIdRef.current,
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
      // boot. Idle-defer so we don't compete with engine warm-up / first paint.
      if (refreshPlan.backgroundWorkspaces.length > 0) {
        const workspacesToLoad = refreshPlan.backgroundWorkspaces;
        scheduleIdleWork({
          run: () => {
            void loadWorkspaceSessionsInBackground(workspacesToLoad);
          },
          // Bound wait: long enough for route commit, short enough that the
          // sidebar is not empty for many seconds after overlay hide.
          idleTimeoutMs: 1_200,
          fallbackDelayMs: 200,
        });
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
      // Product-facing banner: keep raw message in inspector only.
      setRouteError(userErrorFromRaw(message));
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
      // Ensure overlay can dismiss even if desktop workspace list was empty
      // (first-run / no local workspaces yet).
      if (!waitForStaticHomeFirstPaintRef.current) markShellReady();
    }
  }, [
    endpointForWorkspace,
    loadWorkspaceSessionsInBackground,
    localServerRef,
    markBootRouteReady,
    routeWorkspaceId,
    scheduleStartupConnectionRetry,
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

  refreshRouteStateRef.current = refreshRouteState;

  const remoteAccessRestart = useRemoteAccessRestart({
    isEnabled: () => onmyagentServerSettings.remoteAccessEnabled === true,
    onHostInfo: setOnMyAgentServerHostInfoState,
    onSettingsChanged: () =>
      setOnMyAgentServerSettingsVersion((value) => value + 1),
  });

  const reloadWorkspaceEngineFromUi = useCallback(async () => {
    if (!client || !selectedWorkspaceId) {
      setRouteError(userErrorMessage("not_connected"));
      return false;
    }
    const endpoint = endpointForWorkspace(selectedWorkspace);
    if (!endpoint) {
      setRouteError(userErrorMessage("not_connected"));
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
      // Keep the poller installed while hidden; skip this round until visible
      // again. The next round is scheduled from `finally`, never from a fixed
      // interval, so a slow server cannot accumulate concurrent list calls.
      if (!shouldRunReloadEventsPoll()) return;
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

    let timer: number | null = null;
    const scheduleNextPoll = () => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        timer = null;
        void runPoll();
      }, RELOAD_EVENTS_POLL_INTERVAL_MS);
    };
    const runPoll = async () => {
      try {
        await pollReloadEvents();
      } finally {
        scheduleNextPoll();
      }
    };

    void runPoll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
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
