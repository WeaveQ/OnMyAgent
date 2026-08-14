/**
 * Shared query key + fetch options for focused session snapshots.
 *
 * SessionSurface `useQuery` and route sidebar hover/focus prefetch MUST use the
 * same contract so a warm cache hit is possible after open.
 */

/** Message cap for the focused session snapshot (unchanged product default). */
export const SESSION_SNAPSHOT_MESSAGE_LIMIT = 140;

export type SessionSnapshotQueryKey = readonly [
  "react-session-snapshot",
  string,
  string,
];

export function sessionSnapshotQueryKey(
  workspaceId: string,
  sessionId: string,
): SessionSnapshotQueryKey {
  return ["react-session-snapshot", workspaceId, sessionId] as const;
}

export type SessionSnapshotFetchOptions = {
  limit: number;
  directory: string | undefined;
};

/**
 * Options passed to `getSessionSnapshot` for the focused surface / prefetch.
 * Keep limit + directory shape identical to SessionSurface.
 */
export function sessionSnapshotFetchOptions(
  directory: string | undefined,
): SessionSnapshotFetchOptions {
  return {
    limit: SESSION_SNAPSHOT_MESSAGE_LIMIT,
    directory,
  };
}

/**
 * Pure prefetch spec: same query key, staleTime, and fetch options the surface
 * uses. Callers pass this into `queryClient.prefetchQuery` with their client.
 */
export function buildSessionSnapshotPrefetchSpec(input: {
  workspaceId: string;
  sessionId: string;
  directory: string | undefined;
  staleTimeMs: number;
}): {
  queryKey: SessionSnapshotQueryKey;
  staleTime: number;
  fetchOptions: SessionSnapshotFetchOptions;
} {
  return {
    queryKey: sessionSnapshotQueryKey(input.workspaceId, input.sessionId),
    staleTime: input.staleTimeMs,
    fetchOptions: sessionSnapshotFetchOptions(input.directory),
  };
}

/** Same query key as SessionSurface; callers must not fetch. */
export function tabTitleSurfaceSnapshotObserveQuery(input: {
  workspaceId: string;
  sessionId: string;
}): {
  queryKey: SessionSnapshotQueryKey;
  enabled: false;
  staleTime: number;
} {
  return {
    queryKey: sessionSnapshotQueryKey(input.workspaceId, input.sessionId),
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  };
}

/** Distinct tab-title snapshots are gone — never request a sidebar preview limit. */
export function tabTitleSnapshotFetchLimit(): null {
  return null;
}

/** Live tab chips must not start their own getSessionSnapshot. */
export function shouldIssueTabTitleSnapshotQuery(): boolean {
  return false;
}
