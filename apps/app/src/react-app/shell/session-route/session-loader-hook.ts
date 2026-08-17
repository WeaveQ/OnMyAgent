/**
 * Background workspace session loading + pending-created-session merge.
 *
 * The renderer makes one workspace-scoped aggregate request per refresh. The
 * server owns marker authorization and bounded runtime fan-out; the renderer
 * never reads origins or probes individual expert directories here.
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
import { writeCachedSidebarSessionsForWorkspace } from "../session-memory";
import {
  describeWorkspaceSessionLoadError,
  findRouteWorkspace,
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
  collectWorkspaceSessionItemsWithStatus,
  mergeFetchedSessionsWithPending as mergeFetchedSessionsWithPendingState,
  mergeWorkspaceFetchedSessions,
  type PendingCreatedSessionMap,
} from "./sessions";
import { beginSessionRouteColdEnter } from "./cold-path-budget";
import { useSidebarSessionCacheSync } from "./sidebar-session-cache-hook";

type EndpointForWorkspace = (
  workspace: RouteWorkspace | null | undefined,
) => ResolvedWorkspaceEndpoint | null;

type Input = {
  endpointForWorkspace: EndpointForWorkspace;
  pendingCreatedSessionIdsRef: MutableRefObject<PendingCreatedSessionMap>;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
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
    sessionsByWorkspaceId,
    sessionsByWorkspaceIdRef,
    setErrorsByWorkspaceId,
    setRetryingWorkspaceIds,
    setSessionsByWorkspaceId,
    setWorkspaceConnectionOverrides,
    workspacesRef,
  } = input;

  useSidebarSessionCacheSync(sessionsByWorkspaceId);

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
    ) =>
      mergeFetchedSessionsWithPendingState({
        workspaceId,
        fetched,
        current,
        pendingByWorkspaceId: pendingCreatedSessionIdsRef.current,
        explicitAssistantSessionIds: new Set(
          readAssistantSessionWorkspaces(workspaceId).map(
            (item) => item.sessionId,
          ),
        ),
        now: Date.now(),
      }),
    [pendingCreatedSessionIdsRef],
  );

  const loadWorkspaceSessionsInBackground = useCallback(
    async (workspaces: RouteWorkspace[]) => {
      beginSessionRouteColdEnter(
        workspaces.map((workspace) => workspace.id).sort().join("|"),
      );
      const activeWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
      for (const workspaceId of backgroundSessionLoadInFlight.current.keys()) {
        if (!activeWorkspaceIds.has(workspaceId)) {
          backgroundSessionLoadInFlight.current.delete(workspaceId);
        }
      }

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
        if (shouldSkipWorkspaceSessionLoad({ startedAt, now: requestStartedAt })) {
          return;
        }
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
          const collection = await collectWorkspaceSessionItemsWithStatus({
            client: endpoint.client,
            workspaceId: endpoint.workspaceId,
            workspaceRoot: workspace.path ?? "",
            isRemoteOnMyAgentWorkspace: remoteOnMyAgentWorkspace,
            assistantSessionRecords: readAssistantSessionWorkspaces(
              workspace.id,
            ),
            normalizeDirectoryPath,
            limit: SIDEBAR_SESSION_LIST_LIMIT,
          });
          if (collection.skippedByColdPathBudget) {
            return;
          }

          setSessionsByWorkspaceId((current) => {
            const fetched = collection.complete
              ? collection.items
              : mergeFetchedSessionsWithPending(
                  workspace.id,
                  collection.items,
                  current[workspace.id] ?? [],
                );
            const next = mergeWorkspaceFetchedSessions({
              current,
              workspaceId: workspace.id,
              fetched,
              merge: (nextFetched, currentItems) =>
                mergeFetchedSessionsWithPending(
                  workspace.id,
                  nextFetched,
                  currentItems,
                ),
            });
            sessionsByWorkspaceIdRef.current = next;
            writeCachedSidebarSessionsForWorkspace(
              workspace.id,
              next[workspace.id] ?? collection.items,
            );
            return next;
          });

          // An incomplete aggregate is a visible diagnostic, never proof of an
          // empty workspace. Keep cached rows and let the next refresh retry.
          if (collection.complete) {
            setErrorsByWorkspaceId((current) => ({
              ...current,
              [workspace.id]: null,
            }));
            setWorkspaceConnectionOverrides((current) =>
              applyWorkspaceSessionLoadSuccessConnectionState({
                states: current,
                workspaceId: workspace.id,
                isRemoteOnMyAgentWorkspace: remoteOnMyAgentWorkspace,
                taskCount: collection.items.length,
                checkedAt: Date.now(),
                loadedMessage: t("workspace_list.connected_loaded_tasks", {
                  count: collection.items.length,
                }),
                emptyMessage: t("workspace.connected_no_tasks"),
              }),
            );
          }
          setRetryingWorkspaceIds((current) =>
            removeRetryingWorkspaceId(current, workspace.id),
          );

          if (
            collection.complete &&
            shouldScheduleEmptyWorkspaceSessionRetry({
              attempt,
              sessionCount: collection.items.length,
            })
          ) {
            window.setTimeout(() => {
              if (
                !shouldRunEmptyWorkspaceSessionRetry({
                  currentStartedAt: backgroundSessionLoadInFlight.current.get(
                    workspace.id,
                  ),
                })
              ) {
                return;
              }
              backgroundSessionLoadInFlight.current.delete(workspace.id);
              void fetchOnce(workspace, 1);
            }, workspaceSessionEmptyRetryDelayMs());
          }
        } catch (error) {
          const message = describeWorkspaceSessionLoadError({
            error,
            fallbackMessage: t("app.unknown_error"),
          });
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
              setTimeoutFn: (handler, timeout) =>
                window.setTimeout(handler, timeout),
            });
            await fetchOnce(workspace, attempt + 1);
            return;
          }
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
      pendingCreatedSessionIdsRef,
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
      if (workspace) void loadWorkspaceSessionsInBackground([workspace]);
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
