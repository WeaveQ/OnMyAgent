import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
  ExpertDirectoryRecord,
  ExpertDirectorySession,
} from "@onmyagent/types/server";
import type { ExpertSessionMarker } from "./expert-session-runtime.js";
import type { WorkspaceSessionMarkerInventoryEntry } from "./workspace-session-marker-inventory.js";

export type ExpertSessionSkillState = {
  declaredSkills: string[];
  installedSkills: string[];
  missingSkills: string[];
};

export type MutableDirectoryRecord = {
  agentId: string;
  packageName: string;
  sessions: Map<string, ExpertDirectorySession>;
};

export const completeCache = new Map<string, import("@onmyagent/types/server").ExpertDirectoryProjection>();
export const latestCompleteByWorkspace = new Map<string, import("@onmyagent/types/server").ExpertDirectoryProjection>();

export function clearDirectoryCache(): void {
  completeCache.clear();
  latestCompleteByWorkspace.clear();
}

export function cacheKey(
  workspaceId: string,
  revision: number,
  inventoryFingerprint: string,
  sessionFingerprint: string,
): string {
  return `${workspaceId}\u0000${revision}\u0000${inventoryFingerprint}\u0000${sessionFingerprint}`;
}

export function latestComplete(workspaceId: string) {
  return latestCompleteByWorkspace.get(workspaceId);
}

export function addSession(
  grouped: Map<string, MutableDirectoryRecord>,
  input: {
    agentId: string;
    packageName: string;
    sessionId: string;
    runtimeKind?: "opencode" | "grok-build";
    runtimeSessionId?: string;
    profileId?: string;
    directory?: string;
    runtimeMissing: boolean;
    sessionMissing?: boolean;
    skills: ExpertSessionSkillState;
  },
): void {
  const key = `${input.agentId}\u0000${input.packageName}`;
  const record = grouped.get(key) ?? {
    agentId: input.agentId,
    packageName: input.packageName,
    sessions: new Map(),
  };
  record.sessions.set(input.sessionId, {
    sessionId: input.sessionId,
    ...(input.runtimeKind ? { runtimeKind: input.runtimeKind } : {}),
    ...(input.runtimeSessionId ? { runtimeSessionId: input.runtimeSessionId } : {}),
    ...(input.profileId ? { profileId: input.profileId } : {}),
    ...(input.directory ? { directory: input.directory } : {}),
    runtimeMissing: input.runtimeMissing,
    ...(input.sessionMissing !== undefined ? { sessionMissing: input.sessionMissing } : {}),
    ...input.skills,
  });
  grouped.set(key, record);
}

export function finalizeRecord(input: MutableDirectoryRecord): ExpertDirectoryRecord {
  const sessions = [...input.sessions.values()].sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const union = mergeSkills(sessions);
  const runtimeDirectories = [...new Set(
    sessions.flatMap((session) => session.directory ? [session.directory] : []),
  )].sort();
  return {
    agentId: input.agentId,
    packageName: input.packageName,
    sessionIds: sessions.map((session) => session.sessionId),
    runtimeDirectories,
    sessions,
    runtimeMissing: sessions.some((session) => session.runtimeMissing),
    ...(sessions.some((session) => session.sessionMissing !== undefined)
      ? { sessionMissing: sessions.some((session) => session.sessionMissing === true) } : {}),
    ...union,
  };
}

export function mergeSkills(sessions: readonly ExpertDirectorySession[]): ExpertSessionSkillState {
  const declared = new Set<string>();
  const installed = new Set<string>();
  const missing = new Set<string>();
  for (const session of sessions) {
    session.declaredSkills.forEach((skill) => declared.add(skill));
    session.installedSkills.forEach((skill) => installed.add(skill));
    session.missingSkills.forEach((skill) => missing.add(skill));
  }
  return {
    declaredSkills: [...declared].sort(),
    installedSkills: [...installed].sort(),
    missingSkills: [...missing].sort(),
  };
}

export function markerIdentityOf(marker: ExpertSessionMarker | undefined): {
  agentId: string;
  packageName: string;
  sessionId: string;
  runtimeKind?: "opencode" | "grok-build";
  runtimeSessionId?: string;
  profileId?: string;
} | null {
  if (!marker?.agentId?.trim() || !marker.packageName?.trim() || !marker.sessionId?.trim()) return null;
  return {
    agentId: marker.agentId.trim(),
    packageName: marker.packageName.trim(),
    sessionId: marker.sessionId.trim(),
    ...(marker.runtimeKind ? { runtimeKind: marker.runtimeKind } : {}),
    ...(marker.runtimeSessionId?.trim() ? { runtimeSessionId: marker.runtimeSessionId.trim() } : {}),
    ...(marker.profileId?.trim() ? { profileId: marker.profileId.trim() } : {}),
  };
}

export function explicitMarkerSessionId(marker: ExpertSessionMarker): string | null {
  return (marker.isolationVersion ?? 0) >= 3 && marker.sessionId?.trim() ? marker.sessionId.trim() : null;
}

export function skillsFromMarker(marker: ExpertSessionMarker | undefined): ExpertSessionSkillState {
  return {
    declaredSkills: marker?.declaredSkills ?? [],
    installedSkills: marker?.installedSkills ?? [],
    missingSkills: marker?.missingSkills ?? [],
  };
}

export function sameMarkerIdentity(left: ExpertSessionMarker, right: ExpertSessionMarker | undefined): boolean {
  if (!right) return false;
  return left.agentId === right.agentId
    && left.packageName === right.packageName
    && left.sessionId === right.sessionId
    && left.runtimeKind === right.runtimeKind
    && left.runtimeSessionId === right.runtimeSessionId
    && left.profileId === right.profileId;
}

export function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function sessionLookupFingerprint(
  sessions: readonly { id: string; directory?: string }[],
): string {
  return hashKey(
    sessions
      .map((session) =>
        `${session.id.trim()}\u0000${session.directory?.trim() ? canonicalDirectory(session.directory) : ""}`,
      )
      .sort()
      .join("\n"),
  );
}

export function canonicalDirectory(directory: string): string {
  return resolve(directory.trim()).replace(/[\\/]+$/, "");
}

export type LegacyIdentityResolution =
  | { identity: { agentId: string; packageName: string; sessionId: string } }
  | { code: "legacy_identity_ambiguous" | "legacy_identity_unresolved" };

export function resolveLegacyIdentity(
  entry: WorkspaceSessionMarkerInventoryEntry,
  sessions: readonly { id: string; directory?: string }[],
): LegacyIdentityResolution {
  if (!entry.agentSegment.trim()) return { code: "legacy_identity_unresolved" };
  const matches = sessions.filter((session) =>
    Boolean(session.directory?.trim()) && canonicalDirectory(session.directory!) === canonicalDirectory(entry.directory),
  );
  if (matches.length === 1) {
    return {
      identity: {
        agentId: entry.agentSegment,
        packageName: entry.agentSegment,
        sessionId: matches[0]!.id,
      },
    };
  }
  return {
    code: matches.length > 1 ? "legacy_identity_ambiguous" : "legacy_identity_unresolved",
  };
}
