/**
 * Snapshot / query wiring for SessionSurface.
 * Mechanical extract: opencode client, snapshot query, transcript/status shared state, hydration.
 *
 * Session switches must not remount the host: query keys flip with sessionId,
 * and only same-session data is rendered (see resolveRenderedSessionSnapshot).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "../../../../app/lib/opencode";
import type { OnMyAgentSessionSnapshot } from "../../../../app/lib/onmyagent-server";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import {
  resolveRenderedSessionSnapshot,
} from "./session-render-state";
import {
  seedSessionState,
  statusKey as reactStatusKey,
  transcriptKey as reactTranscriptKey,
} from "../sync/session-sync";
import { SESSION_SNAPSHOT_STALE_TIME_MS } from "../sync/session-poll-policy";
import {
  sessionSnapshotFetchOptions,
  sessionSnapshotQueryKey,
} from "../sync/session-snapshot-query-policy";
import { useSharedQueryState } from "./session-surface-hooks";
import { EMPTY_TRANSCRIPT, IDLE_STATUS } from "./session-surface-constants";

export type SessionSurfaceSnapshotInput = {
  workspaceId: string;
  sessionId: string;
  workspaceRoot: string;
  draftOnly?: boolean;
  opencodeBaseUrl: string;
  onmyagentToken?: string;
  client: OnMyAgentServerClient;
};

function snapshotBelongsToSession(
  snapshot: OnMyAgentSessionSnapshot | null | undefined,
  sessionId: string,
): snapshot is OnMyAgentSessionSnapshot {
  return Boolean(snapshot && snapshot.session.id === sessionId);
}

/** Snapshot query, shared transcript/status caches, and session hydration. */
export function useSessionSurfaceSnapshot(input: SessionSurfaceSnapshotInput) {
  const {
    workspaceId,
    sessionId,
    workspaceRoot,
    draftOnly,
    opencodeBaseUrl,
    onmyagentToken,
    client,
  } = input;

  const queryClient = useQueryClient();
  const hydratedKeyRef = useRef<string | null>(null);
  const [rendered, setRendered] = useState<{
    sessionId: string;
    snapshot: OnMyAgentSessionSnapshot;
  } | null>(null);

  const opencodeClient = useMemo(
    () =>
      createClient(opencodeBaseUrl, undefined, {
        token: onmyagentToken,
        mode: "onmyagent",
      }),
    [opencodeBaseUrl, onmyagentToken],
  );

  const snapshotQueryKey = sessionSnapshotQueryKey(workspaceId, sessionId);
  const transcriptQueryKey = useMemo(
    () => reactTranscriptKey(workspaceId, sessionId),
    [workspaceId, sessionId],
  );
  const statusQueryKey = useMemo(
    () => reactStatusKey(workspaceId, sessionId),
    [workspaceId, sessionId],
  );

  // Drop previous-session paint immediately (before paint) so prop-driven
  // switches never flash the wrong transcript for a frame.
  useLayoutEffect(() => {
    setRendered((prev) =>
      prev && prev.sessionId !== sessionId ? null : prev,
    );
    if (draftOnly) {
      setRendered(null);
    }
  }, [draftOnly, sessionId]);

  const snapshotQuery = useQuery<OnMyAgentSessionSnapshot>({
    queryKey: snapshotQueryKey,
    enabled: !draftOnly && Boolean(sessionId.trim()),
    queryFn: async () =>
      (
        await client.getSessionSnapshot(
          workspaceId,
          sessionId,
          sessionSnapshotFetchOptions(workspaceRoot),
        )
      ).item,
    staleTime: SESSION_SNAPSHOT_STALE_TIME_MS,
    // Prefetch + revisit within staleTime should paint immediately; longer
    // gc keeps recently switched sessions warm when hopping back.
    gcTime: Math.max(SESSION_SNAPSHOT_STALE_TIME_MS * 10, 5 * 60_000),
    // Warm cache from hover prefetch / prior visits without a loading flash.
    initialData: () => {
      if (draftOnly) return undefined;
      const cached = queryClient.getQueryData<OnMyAgentSessionSnapshot>(
        snapshotQueryKey,
      );
      return snapshotBelongsToSession(cached, sessionId) ? cached : undefined;
    },
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(snapshotQueryKey)?.dataUpdatedAt,
  });

  // Only accept data that belongs to the intended session (guards placeholder
  // or racey cache entries when keys flip quickly).
  const currentSnapshot =
    !draftOnly && snapshotBelongsToSession(snapshotQuery.data, sessionId)
      ? snapshotQuery.data
      : null;

  const transcriptState = useSharedQueryState<UIMessage[]>(
    transcriptQueryKey,
    EMPTY_TRANSCRIPT,
  );
  const statusState = useSharedQueryState(
    statusQueryKey,
    currentSnapshot?.status ?? IDLE_STATUS,
  );

  useEffect(() => {
    if (!currentSnapshot) return;
    setRendered({ sessionId, snapshot: currentSnapshot });
    // Single seed path: skip duplicate work when the same snapshot is re-emitted.
    const key = `${sessionId}:${currentSnapshot.session.time?.updated ?? currentSnapshot.session.time?.created ?? 0}:${currentSnapshot.messages.length}`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    seedSessionState(workspaceId, currentSnapshot);
  }, [sessionId, currentSnapshot, workspaceId]);

  const snapshot = resolveRenderedSessionSnapshot({
    sessionId,
    currentSnapshot,
    cachedRendered: rendered?.sessionId === sessionId ? rendered : null,
  });

  const liveStatus = statusState ?? snapshot?.status ?? IDLE_STATUS;

  return {
    opencodeClient,
    snapshotQueryKey,
    statusQueryKey,
    snapshotQuery,
    currentSnapshot,
    transcriptState,
    statusState,
    snapshot,
    liveStatus,
    /** Reset hydration key when the active session changes (caller owns other resets). */
    resetHydrationKey: () => {
      hydratedKeyRef.current = null;
    },
  };
}
