/**
 * Snapshot / query wiring for SessionSurface.
 * Mechanical extract: opencode client, snapshot query, transcript/status shared state, hydration.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
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

  const snapshotQuery = useQuery<OnMyAgentSessionSnapshot>({
    queryKey: snapshotQueryKey,
    enabled: !draftOnly,
    queryFn: async () =>
      (
        await client.getSessionSnapshot(
          workspaceId,
          sessionId,
          sessionSnapshotFetchOptions(workspaceRoot),
        )
      ).item,
    staleTime: SESSION_SNAPSHOT_STALE_TIME_MS,
  });

  const currentSnapshot =
    snapshotQuery.data?.session.id === sessionId ? snapshotQuery.data : null;

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
  }, [sessionId, currentSnapshot]);

  useEffect(() => {
    if (!currentSnapshot) return;
    seedSessionState(workspaceId, currentSnapshot);
  }, [currentSnapshot, sessionId, workspaceId]);

  useEffect(() => {
    if (!currentSnapshot) return;
    const key = `${sessionId}:${currentSnapshot.session.time?.updated ?? currentSnapshot.session.time?.created ?? 0}:${currentSnapshot.messages.length}`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    seedSessionState(workspaceId, currentSnapshot);
  }, [sessionId, currentSnapshot, workspaceId]);

  const snapshot = resolveRenderedSessionSnapshot({
    sessionId,
    currentSnapshot,
    cachedRendered: rendered,
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
