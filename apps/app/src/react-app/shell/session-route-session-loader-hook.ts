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

import type { ResolvedWorkspaceEndpoint } from "../../app/lib/workspace-endpoint";
import type { SidebarSessionItem, WorkspaceConnectionState } from "../../app/types";
import { normalizeDirectoryPath } from "../../app/utils";
import { t } from "../../i18n";
import { diagnoseRemoteWorkspaceTaskLoadFailure } from "../domains/workspace";
import {
  assistantSessionWorkspacesChangedEvent,
  readAssistantSessionWorkspaceChangeOwner,
  readAssistantSessionWorkspaces,
} from "../domains/session";
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
} from "./session-route-model";
import {
  applyWorkspaceConnectionDiagnosticPlan,
  applyWorkspaceSessionMissingEndpointState,
  applyWorkspaceSessionLoadingConnectionState,
  applyWorkspaceSessionLoadSuccessConnectionState,
  buildWorkspaceConnectionDiagnosticPlan,
} from "./session-route-sidebar-model";
import {
  collectWorkspaceSessionItems,
  mergeFetchedSessionsWithPending as mergeFetchedSessionsWithPendingState,
  mergeWorkspaceFetchedSessions,
  type PendingCreatedSessionMap,
} from "./session-route-sessions";

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
