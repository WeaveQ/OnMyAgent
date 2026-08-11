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

/** Workspace failures win over query/cache state; loading never becomes empty. */
export function buildExpertDirectoryPageModel(input: {
  workspaceError?: string | null;
  query: ExpertDirectoryQuerySnapshot;
}): ExpertDirectoryPageModel {
  const workspaceError = input.workspaceError?.trim();
  const cached = input.query.lastComplete;
  if (workspaceError) return { state: "error", error: workspaceError, ...(cached ? { payload: cached } : input.query.data ? { payload: input.query.data } : {}) };
  if (input.query.error) return { state: "error", error: input.query.error, ...(cached ? { payload: cached } : input.query.data ? { payload: input.query.data } : {}) };
  if (input.query.data?.complete === true) return { state: "ready", payload: input.query.data };
  if (input.query.isPending === true || input.query.isLoading === true) {
    if (cached) return { state: "ready", payload: cached };
    return { state: "loading" };
  }
  if (!input.query.data) return cached ? { state: "ready", payload: cached } : { state: "loading" };
  return { state: "incomplete", payload: cached ?? input.query.data };
}

export function selectExpertSessionIds(
  payload: ExpertDirectoryProjection | null | undefined,
): string[] {
  if (!payload) return [];
  return [...new Set(payload.records.flatMap((record) => record.sessionIds))].sort();
}

export function selectAgentIdForSession(
  payload: ExpertDirectoryProjection | null | undefined,
  sessionId: string,
): string | null {
  const id = sessionId.trim();
  if (!payload || !id) return null;
  return payload.records.find((record) => record.sessionIds.includes(id))?.agentId ?? null;
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
