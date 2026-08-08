/**
 * Background workspace session loading + pending-created-session merge.
 * Keeps session-route-render free of the fetch/retry loop.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { ResolvedWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import type { SidebarSessionItem, WorkspaceConnectionState } from "../../../app/types";
import { normalizeDirectoryPath } from "../../../app/utils";
import { t } from "../../../i18n";
import { diagnoseRemoteWorkspaceTaskLoadFailure } from "../../domains/workspace";
import {
  assistantSessionWorkspacesChangedEvent,
  readAssistantSessionWorkspaceChangeOwner,
  readAssistantSessionWorkspaces,
  retryPendingSessionDeletesForWorkspace,
  SIDEBAR_SESSION_LIST_LIMIT,
} from "../../domains/session";
import {
  migrateLegacySessionOrigins,
  reconcileSessionOrigins,
} from "../../domains/agents";
import { writeCachedSidebarSessionsForWorkspace } from "../session-memory";
import {
  describeWorkspaceSessionLoadError,
  isRemoteOnMyAgentWorkspace,
  removeRetryingWorkspaceId,
  shouldClearWorkspaceSessionLoadInFlight,
  shouldRunEmptyWorkspaceSessionRetry,
  shouldScheduleEmptyWorkspaceSessionRetry,
  shouldSkipWorkspaceSessionLoad,
  shouldRetryWorkspaceSessionLoad,
  waitForWorkspaceSessionLoadBackoff,
  workspaceSessionEmptyRetryDelayMs,
  type RouteWorkspace,
} from "./model";
import {
  applyWorkspaceConnectionDiagnosticPlan,
  applyWorkspaceSessionMissingEndpointState,
  applyWorkspaceSessionLoadingConnectionState,
  applyWorkspaceSessionLoadSuccessConnectionState,
  buildWorkspaceConnectionDiagnosticPlan,
} from "./sidebar-model";
import {
  collectWorkspaceSessionItems,
  mergeFetchedSessionsWithPending as mergeFetchedSessionsWithPendingState,
  mergeWorkspaceFetchedSessions,
  recoverOriginDirectorySessionItems,
  type PendingCreatedSessionMap,
} from "./sessions";

type EndpointForWorkspace = (
  workspace: RouteWorkspace | null | undefined,
) => ResolvedWorkspaceEndpoint | null;

type Input = {
  endpointForWorkspace: EndpointForWorkspace;
  pendingCreatedSessionIdsRef: MutableRefObject<PendingCreatedSessionMap>;
  sessionsByWorkspaceIdRef: MutableRefObject<
    Record<string, SidebarSessionItem[]>
  >;
  setErrorsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, string | null>>
  >;
  setRetryingWorkspaceIds: Dispatch<SetStateAction<string[]>>;
  setSessionsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, SidebarSessionItem[]>>
  >;
  setWorkspaceConnectionOverrides: Dispatch<
    SetStateAction<Record<string, WorkspaceConnectionState>>
  >;
  workspacesRef: MutableRefObject<RouteWorkspace[]>;
};

export function useSessionRouteSessionLoader(input: Input) {
  const {
    endpointForWorkspace,
    pendingCreatedSessionIdsRef,
    sessionsByWorkspaceIdRef,
    setErrorsByWorkspaceId,
    setRetryingWorkspaceIds,
    setSessionsByWorkspaceId,
    setWorkspaceConnectionOverrides,
    workspacesRef,
  } = input;

  const backgroundSessionLoadInFlight = useRef<Map<string, number>>(new Map());
  const originReadInFlight = useRef<Set<string>>(new Set());

  const rememberPendingCreatedSession = useCallback(
    (workspaceId: string, sessionId: string) => {
      const id = sessionId.trim();
      if (!workspaceId || !id) return;
      pendingCreatedSessionIdsRef.current[workspaceId] = {
        ...(pendingCreatedSessionIdsRef.current[workspaceId] ?? {}),
        [id]: Date.now(),
      };
    },
    [pendingCreatedSessionIdsRef],
  );

  const mergeFetchedSessionsWithPending = useCallback(
    (
      workspaceId: string,
      fetched: SidebarSessionItem[],
      current: SidebarSessionItem[],
    ) => {
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
    [pendingCreatedSessionIdsRef],
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
            const message = t("app.error_remote_worker_url_missing");
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
        void retryPendingSessionDeletesForWorkspace({
          workspaceId: workspace.id,
          remoteWorkspaceId: endpoint.workspaceId,
          client: endpoint.client,
        });
        const startedAt =
          backgroundSessionLoadInFlight.current.get(workspace.id) ?? 0;
        const requestStartedAt = Date.now();
        if (shouldSkipWorkspaceSessionLoad({ startedAt, now: requestStartedAt }))
          return;
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
        const originController = new AbortController();
        const originTimeout = window.setTimeout(
          () => originController.abort(),
          2_000,
        );
        const originsPromise = endpoint.client
          .listSessionOrigins(endpoint.workspaceId, { signal: originController.signal })
          .catch(() => null)
          .finally(() => window.clearTimeout(originTimeout));
        try {
          const sidebarItems = await collectWorkspaceSessionItems({
            client: endpoint.client,
            workspaceId: endpoint.workspaceId,
            workspaceRoot: workspace.path ?? "",
            isRemoteOnMyAgentWorkspace: remoteOnMyAgentWorkspace,
            assistantSessionRecords: readAssistantSessionWorkspaces(
              workspace.id,
            ),
            normalizeDirectoryPath,
            // Cold path: skip per-directory listSessions until a retry — primary
            // list is enough for the sidebar and avoids OpenCode fan-out on boot.
            includeAssistantDirectories: attempt > 0,
          });
          setSessionsByWorkspaceId((current) => {
            const next = mergeWorkspaceFetchedSessions({
              current,
              workspaceId: workspace.id,
              fetched: sidebarItems,
              merge: (fetched, currentItems) =>
                mergeFetchedSessionsWithPending(
                  workspace.id,
                  fetched,
                  currentItems,
                ),
            });
            sessionsByWorkspaceIdRef.current = next;
            // Persist lightweight titles so the next cold start can paint the
            // sidebar before OpenCode finishes indexing.
            const persisted = next[workspace.id] ?? sidebarItems;
            writeCachedSidebarSessionsForWorkspace(workspace.id, persisted);
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
          // Origins are metadata only: start alongside the session request and
          // reconcile after the real list is available, without delaying the
          // sidebar or turning an origin error into a session-list error.
          void originsPromise.then(async (payload) => {
            if (!payload || originReadInFlight.current.has(workspace.id)) return;
            originReadInFlight.current.add(workspace.id);
            try {
              // The primary list is intentionally bounded and paints before
              // origin metadata resolves. Recover only origin ids absent from
              // that list, using their durable runtime directory in bounded
              // batches; an omitted page or failed directory remains unknown.
              const recoveredItems = await recoverOriginDirectorySessionItems({
                client: endpoint.client,
                workspaceId: endpoint.workspaceId,
                originWorkspaceId: endpoint.workspaceId,
                primaryItems: sidebarItems,
                origins: payload.items,
                limit: SIDEBAR_SESSION_LIST_LIMIT,
              });
              if (recoveredItems.length > 0) {
                setSessionsByWorkspaceId((current) => {
                  const next = mergeWorkspaceFetchedSessions({
                    current,
                    workspaceId: workspace.id,
                    fetched: recoveredItems,
                    merge: (fetched, currentItems) => [
                      ...fetched,
                      ...currentItems,
                    ],
                  });
                  sessionsByWorkspaceIdRef.current = next;
                  writeCachedSidebarSessionsForWorkspace(
                    workspace.id,
                    next[workspace.id] ?? recoveredItems,
                  );
                  return next;
                });
              }
              const realSessionIds = new Set([
                ...sidebarItems.map((item) => item.id),
                ...recoveredItems.map((item) => item.id),
              ]);
              reconcileSessionOrigins({
                localWorkspaceId: workspace.id,
                originWorkspaceId: endpoint.workspaceId,
                realSessionIds,
                origins: payload.items,
              });
              await migrateLegacySessionOrigins({
                client: endpoint.client,
                localWorkspaceId: workspace.id,
                originWorkspaceId: endpoint.workspaceId,
                realSessionIds,
                origins: payload.items,
              });
            } finally {
              originReadInFlight.current.delete(workspace.id);
              setSessionsByWorkspaceId((current) => ({ ...current }));
            }
          });
          // When a workspace returns zero sessions during the initial batch
          // load, OpenCode may still be warming up its index.  Schedule a
          // single delayed retry so the sidebar doesn't stay permanently
          // empty while the managed engine finishes starting.
          if (
            shouldScheduleEmptyWorkspaceSessionRetry({
              attempt,
              sessionCount: sidebarItems.length,
            })
          ) {
            window.setTimeout(() => {
              if (
                !shouldRunEmptyWorkspaceSessionRetry({
                  currentStartedAt: backgroundSessionLoadInFlight.current.get(
                    workspace.id,
                  ),
                })
              )
                return;
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
            if (
              shouldClearWorkspaceSessionLoadInFlight({
                currentStartedAt: backgroundSessionLoadInFlight.current.get(
                  workspace.id,
                ),
                requestStartedAt,
              })
            ) {
              backgroundSessionLoadInFlight.current.delete(workspace.id);
            }
            await waitForWorkspaceSessionLoadBackoff({
              attempt,
              // Wrapper keeps `this` bound — bare window.setTimeout Illegal invocation.
              setTimeoutFn: (handler, timeout) => window.setTimeout(handler, timeout),
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
    [
      endpointForWorkspace,
      mergeFetchedSessionsWithPending,
      sessionsByWorkspaceIdRef,
      setErrorsByWorkspaceId,
      setRetryingWorkspaceIds,
      setSessionsByWorkspaceId,
      setWorkspaceConnectionOverrides,
    ],
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
    return () =>
      window.removeEventListener(
        assistantSessionWorkspacesChangedEvent,
        handleAssistantSessionWorkspacesChanged,
      );
  }, [loadWorkspaceSessionsInBackground, workspacesRef]);

  return {
    loadWorkspaceSessionsInBackground,
    rememberPendingCreatedSession,
  };
}
