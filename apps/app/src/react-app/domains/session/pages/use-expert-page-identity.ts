import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useAgentRegistryStore,
  usePendingAgentStore,
} from "../../agents";
import {
  expertDirectoryQuerySnapshotForPaint,
  scheduleAfterFirstPaint,
  shouldEnableExpertDirectoryNetwork,
  useExpertDirectoryShadow,
} from "../../../capabilities/session-identity/expert-directory-query";
import {
  buildExpertDirectoryPageModel,
  type ExpertDirectoryShadowDiff,
  type LegacyExpertDirectorySnapshot,
} from "../../../capabilities/session-identity/expert-directory-page-model";
import {
  buildExpertSidebarSessionGroups,
  buildExpertWorkspaceSessions,
  selectRawWorkspaceSessions,
} from "./expert-conversation-model";
import { buildExpertPageIdentityModel } from "./expert-page-identity-model";
import type { ExpertPageProps } from "./use-expert-page";

/** Owns authoritative Expert directory/session identity projection for the page. */
export function useExpertPageIdentity(props: ExpertPageProps) {
  const registry = useAgentRegistryStore((state) => state.registry);
  const pendingAgent = usePendingAgentStore((state) => state.agent);
  const rawWorkspaceSessions = useMemo(
    () => selectRawWorkspaceSessions(
      props.sidebar.workspaceSessionGroups,
      props.sidebar.selectedWorkspaceId,
    ),
    [props.sidebar.selectedWorkspaceId, props.sidebar.workspaceSessionGroups],
  );
  const workspaceSessions = useMemo(
    () => buildExpertWorkspaceSessions({ rawWorkspaceSessions }),
    [rawWorkspaceSessions],
  );
  const sidebarWorkspaceSessionGroups = useMemo(
    () => buildExpertSidebarSessionGroups({
      groups: props.sidebar.workspaceSessionGroups,
    }),
    [props.sidebar.workspaceSessionGroups],
  );
  // Shadow counts only: previous Directory projection hashes. Never treat
  // workspace sessions or a fake agentId "legacy" index as expert SoT.
  const previousProjectionShadowRef = useRef<LegacyExpertDirectorySnapshot>([]);
  const shadowLegacySnapshot = previousProjectionShadowRef.current;
  const workspaceKey = (
    props.runtimeWorkspaceId ?? props.selectedWorkspaceId
  ).trim();
  const [networkPaintKey, setNetworkPaintKey] = useState("");
  const afterFirstPaint = networkPaintKey === workspaceKey;
  useEffect(() => {
    if (!workspaceKey || networkPaintKey === workspaceKey) return;
    return scheduleAfterFirstPaint(() => setNetworkPaintKey(workspaceKey));
  }, [networkPaintKey, workspaceKey]);
  const directoryNetworkEnabled =
    Boolean(props.onmyagentServerClient && props.selectedWorkspaceId.trim()) &&
    shouldEnableExpertDirectoryNetwork({ afterFirstPaint });

  const emitShadow = useCallback((event: ExpertDirectoryShadowDiff) => {
    const client = props.onmyagentServerClient;
    const workspaceId = (
      props.runtimeWorkspaceId ?? props.selectedWorkspaceId
    ).trim();
    if (!client || !workspaceId) return;
    const changedFieldCount = [
      event.legacy.agentCount !== event.projection.agentCount,
      event.legacy.sessionCount !== event.projection.sessionCount,
      event.legacy.sessionIdsHash !== event.projection.sessionIdsHash,
    ].filter(Boolean).length;
    const change = changedFieldCount === 0
      ? "unchanged"
      : event.legacy.sessionCount === 0 && event.projection.sessionCount > 0
        ? "added"
        : event.projection.sessionCount === 0 && event.legacy.sessionCount > 0
          ? "removed"
          : "changed";
    void client.recordExpertDirectoryShadowDiff(workspaceId, {
      change,
      changedFieldCount,
      count: event.projection.sessionCount,
    }).catch(() => undefined);
  }, [
    props.onmyagentServerClient,
    props.runtimeWorkspaceId,
    props.selectedWorkspaceId,
  ]);
  const query = useExpertDirectoryShadow({
    workspaceId: props.selectedWorkspaceId,
    serverWorkspaceId: props.runtimeWorkspaceId ?? props.selectedWorkspaceId,
    client: props.onmyagentServerClient,
    legacy: shadowLegacySnapshot,
    enabled: directoryNetworkEnabled,
    isDevelopment: import.meta.env.DEV,
    emit: emitShadow,
  });
  useEffect(() => {
    const records = query.data?.records;
    if (!records) return;
    previousProjectionShadowRef.current = records.map((record) => ({
      agentId: record.agentId,
      sessionIds: [...record.sessionIds],
    }));
  }, [query.data]);
  const page = useMemo(
    () =>
      buildExpertDirectoryPageModel({
        workspaceError: props.selectedWorkspaceError,
        query: expertDirectoryQuerySnapshotForPaint({
          afterFirstPaint,
          data: query.data,
          lastComplete: query.lastComplete,
          error: query.error,
          isPending: query.isPending,
          isLoading: query.isLoading,
        }),
      }),
    [
      afterFirstPaint,
      props.selectedWorkspaceError,
      query.data,
      query.error,
      query.isLoading,
      query.isPending,
      query.lastComplete,
    ],
  );
  const identity = useMemo(
    () => buildExpertPageIdentityModel({
      directoryPage: page,
      workspaceSessions,
      registry,
      selectedSessionId: props.selectedSessionId,
      directoryQuery: {
        data: query.data,
        lastComplete: query.lastComplete,
      },
    }),
    [page, props.selectedSessionId, query.data, query.lastComplete, registry, workspaceSessions],
  );

  return {
    registry,
    pendingAgent,
    pendingAgentDraftSource: pendingAgent?.draftSource,
    rawWorkspaceSessions,
    workspaceSessions,
    sidebarWorkspaceSessionGroups,
    expertDirectoryPage: page,
    ...identity,
  };
}
