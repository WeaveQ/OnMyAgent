import type { ExpertDirectoryProjection } from "@onmyagent/types/server";

export type ExpertDirectoryPageModel =
  | { state: "loading"; payload?: undefined }
  | { state: "ready"; payload: ExpertDirectoryProjection }
  | { state: "incomplete"; payload?: ExpertDirectoryProjection }
  | { state: "error"; error: unknown; payload?: ExpertDirectoryProjection };

export type ExpertDirectoryQuerySnapshot = {
  data?: ExpertDirectoryProjection;
  lastComplete?: ExpertDirectoryProjection;
  error?: unknown;
  isPending?: boolean;
  isLoading?: boolean;
};

function hasNumericRevision(
  payload: ExpertDirectoryProjection | null | undefined,
): payload is ExpertDirectoryProjection {
  return typeof payload?.revision === "number" && Number.isSafeInteger(payload.revision);
}

/** True when lastComplete is not newer than an incoming incomplete/error projection. */
export function isStaleLastComplete(input: {
  data?: ExpertDirectoryProjection;
  lastComplete?: ExpertDirectoryProjection;
}): boolean {
  const data = input.data;
  const cached = input.lastComplete;
  if (!hasNumericRevision(data) || !hasNumericRevision(cached)) return false;
  if (data.complete === true) return false;
  return cached.revision <= data.revision;
}

/**
 * Choose the live Directory payload. A complete cache must not overlay a
 * newer or equal-revision incomplete/error projection (post-delete ghosts).
 * Loading/offline with no newer data may still return lastComplete.
 */
export function selectLiveDirectoryPayload(input: {
  data?: ExpertDirectoryProjection;
  lastComplete?: ExpertDirectoryProjection;
}): ExpertDirectoryProjection | undefined {
  const data = input.data;
  const cached = input.lastComplete;
  if (hasNumericRevision(data)) {
    if (data.complete === true) return data;
    if (hasNumericRevision(cached) && cached.revision > data.revision) return cached;
    return data;
  }
  return cached ?? data;
}

/** Cold-open ready: complete page, or incomplete live incoming records — never a stale lastComplete. */
export function isExpertDirectoryReadyForIdentity(input: {
  state: ExpertDirectoryPageModel["state"];
  payload?: ExpertDirectoryProjection;
  data?: ExpertDirectoryProjection;
  lastComplete?: ExpertDirectoryProjection;
}): boolean {
  if (input.state === "ready") return true;
  if (input.state !== "incomplete" || !input.payload?.records?.length) return false;
  if (!isStaleLastComplete({ data: input.data, lastComplete: input.lastComplete })) {
    return true;
  }
  const live = selectLiveDirectoryPayload({
    data: input.data,
    lastComplete: input.lastComplete,
  });
  return live === input.data && Boolean(live?.records?.length);
}

/** Workspace failures win over query/cache state; loading never becomes empty. */
export function buildExpertDirectoryPageModel(input: {
  workspaceError?: string | null;
  query: ExpertDirectoryQuerySnapshot;
}): ExpertDirectoryPageModel {
  const workspaceError = input.workspaceError?.trim();
  const data = input.query.data;
  const cached = input.query.lastComplete;
  const live = selectLiveDirectoryPayload({ data, lastComplete: cached });
  const staleCache = isStaleLastComplete({ data, lastComplete: cached });
  if (workspaceError) {
    return { state: "error", error: workspaceError, ...(live ? { payload: live } : {}) };
  }
  if (input.query.error) {
    return { state: "error", error: input.query.error, ...(live ? { payload: live } : {}) };
  }
  if (data?.complete === true) return { state: "ready", payload: data };
  if (input.query.isPending === true || input.query.isLoading === true) {
    if (data && (staleCache || !cached)) {
      return { state: "incomplete", payload: data };
    }
    if (cached) return { state: "ready", payload: cached };
    return { state: "loading" };
  }
  if (!data) return cached ? { state: "ready", payload: cached } : { state: "loading" };
  return { state: "incomplete", ...(live ? { payload: live } : {}) };
}

export function selectExpertSessionIds(
  payload: ExpertDirectoryProjection | null | undefined,
): string[] {
  if (!payload) return [];
  return [...new Set(
    payload.records.flatMap((record) => record.sessionIds ?? []),
  )].sort();
}

export function selectAgentIdForSession(
  payload: ExpertDirectoryProjection | null | undefined,
  sessionId: string,
): string | null {
  const id = sessionId.trim();
  if (!payload || !id) return null;
  return payload.records.find((record) => (record.sessionIds ?? []).includes(id))?.agentId ?? null;
}

export type ExpertRailItem = {
  agentId: string;
  packageName: string;
  sessionIds: string[];
  runtimeMissing: boolean;
  sessionMissing?: boolean;
  declaredSkills: string[];
  installedSkills: string[];
  missingSkills: string[];
};

export function selectExpertRail(
  payload: ExpertDirectoryProjection | null | undefined,
): ExpertRailItem[] {
  if (!payload) return [];
  return payload.records.map((record) => ({
    agentId: record.agentId,
    packageName: record.packageName,
    sessionIds: [...record.sessionIds],
    runtimeMissing: record.runtimeMissing,
    ...(record.sessionMissing !== undefined ? { sessionMissing: record.sessionMissing } : {}),
    declaredSkills: [...record.declaredSkills],
    installedSkills: [...record.installedSkills],
    missingSkills: [...record.missingSkills],
  }));
}

export type LegacyExpertDirectorySnapshot = readonly {
  agentId: string;
  sessionIds: readonly string[];
}[];

export type ExpertDirectoryShadowDiff = {
  kind: "expert-directory-shadow-diff";
  workspaceIdHash: string;
  legacy: { agentCount: number; sessionCount: number; sessionIdsHash: string };
  projection: { agentCount: number; sessionCount: number; sessionIdsHash: string; complete: boolean };
  addedSessionIdsHash: string;
  removedSessionIdsHash: string;
};

export function buildExpertDirectoryShadowDiff(input: {
  workspaceId: string;
  legacy: LegacyExpertDirectorySnapshot;
  projection: ExpertDirectoryProjection;
}): ExpertDirectoryShadowDiff {
  const legacyIds = new Set(input.legacy.flatMap((item) => item.sessionIds.map((id) => id.trim()).filter(Boolean)));
  const projectionIds = new Set(selectExpertSessionIds(input.projection));
  return {
    kind: "expert-directory-shadow-diff",
    workspaceIdHash: hashStable(input.workspaceId),
    legacy: {
      agentCount: input.legacy.length,
      sessionCount: legacyIds.size,
      sessionIdsHash: hashSet(legacyIds),
    },
    projection: {
      agentCount: input.projection.records.length,
      sessionCount: projectionIds.size,
      sessionIdsHash: hashSet(projectionIds),
      complete: input.projection.complete,
    },
    addedSessionIdsHash: hashSet(new Set([...projectionIds].filter((id) => !legacyIds.has(id)))),
    removedSessionIdsHash: hashSet(new Set([...legacyIds].filter((id) => !projectionIds.has(id)))),
  };
}

export function hashStable(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hashSet(values: ReadonlySet<string>): string {
  return hashStable([...values].sort().join("\u0000"));
}
