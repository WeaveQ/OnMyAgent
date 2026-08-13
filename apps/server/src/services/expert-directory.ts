import { realpath } from "node:fs/promises";
import type {
  ExpertDirectoryFailure,
  ExpertDirectoryHealAction,
  ExpertDirectoryHealRequest,
  ExpertDirectoryHealResponse,
  ExpertDirectoryProjection,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import {
  ensureExpertSessionRuntimeIsolation,
} from "./expert-session-runtime.js";
import {
  listSessionOrigins,
  upsertSessionOrigin,
} from "./session-origins.js";
import {
  scanWorkspaceExpertSessionMarkers,
  type WorkspaceSessionMarkerInventoryEntry,
} from "./workspace-session-marker-inventory.js";
import {
  addSession,
  cacheKey,
  clearDirectoryCache,
  completeCache,
  explicitMarkerSessionId,
  finalizeRecord,
  hashKey,
  latestComplete,
  latestCompleteByWorkspace,
  markerIdentityOf,
  resolveLegacyIdentity,
  sameMarkerIdentity,
  sessionLookupFingerprint,
  skillsFromMarker,
} from "./expert-directory-model.js";
import type { MutableDirectoryRecord } from "./expert-directory-model.js";
import { recordExpertLifecycleEvent } from "./expert-lifecycle-events.js";

export type ExpertDirectoryBuildOptions = {
  signal?: AbortSignal;
  runtimeRoot?: string;
  /** Bounded OpenCode/session lookup. Routes supply this; tests can inject it. */
  readSessions?: (signal?: AbortSignal) => Promise<readonly {
    id: string;
    directory?: string;
  }[]>;
};

export function clearExpertDirectoryCache(): void {
  clearDirectoryCache();
}

export function legacyAgentIdFromDirectory(
  entry: WorkspaceSessionMarkerInventoryEntry,
  siblingEntries: readonly WorkspaceSessionMarkerInventoryEntry[],
  sessions: readonly { id: string; directory?: string }[],
): { agentId: string; packageName: string; sessionId: string } | null {
  /** @deprecated Path-derived identity is allowed only during explicit heal. */
  void siblingEntries;
  const result = resolveLegacyIdentity(entry, sessions);
  return "identity" in result ? result.identity : null;
}

export async function buildExpertDirectory(
  workspace: WorkspaceInfo,
  options: ExpertDirectoryBuildOptions = {},
): Promise<ExpertDirectoryProjection> {
  const startedAt = Date.now();
  recordExpertLifecycleEvent({
    kind: "directory_fetch",
    source: "workspace",
    phase: "requested",
    outcome: "started",
    workspaceId: workspace.id,
  });
  const failures: ExpertDirectoryFailure[] = [];
  let origins;
  try {
    origins = await listSessionOrigins(workspace);
  } catch {
    recordExpertLifecycleEvent({
      kind: "directory_fetch",
      source: "origin",
      phase: "fetch",
      outcome: "failed",
      code: "origins_unavailable",
      failureCount: 1,
      workspaceId: workspace.id,
      durationMs: Date.now() - startedAt,
    });
    return incompleteProjection(workspace.id, 0, "origins_unavailable", failures);
  }

  let inventory;
  try {
    inventory = await scanWorkspaceExpertSessionMarkers({
      workspace,
      runtimeRoot: options.runtimeRoot,
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    recordExpertLifecycleEvent({
      kind: "directory_fetch",
      source: "runtime",
      phase: "fetch",
      outcome: "failed",
      code: "inventory_unavailable",
      failureCount: 1,
      workspaceId: workspace.id,
      durationMs: Date.now() - startedAt,
    });
    return incompleteProjection(workspace.id, origins.revision, "inventory_unavailable", failures);
  }
  failures.push(...inventory.failures.map((failure, index) => ({
    source: "expert-runtime" as const,
    key: failure.key,
    index,
    code: mapInventoryFailureCode(failure.code),
  })));
  let lookupSessions: readonly { id: string; directory?: string }[] = [];
  const sessionIds = new Set<string>();
  let lookupComplete = false;
  if (options.readSessions) {
    try {
      lookupSessions = await options.readSessions(options.signal);
      for (const session of lookupSessions) {
        if (session.id.trim()) sessionIds.add(session.id.trim());
      }
      lookupComplete = true;
    } catch (error) {
      if (isAbortError(error)) throw error;
      failures.push({ source: "opencode", key: hashKey("session-lookup"), index: 0, code: "session_lookup_failed" });
    }
  } else {
    failures.push({ source: "opencode", key: hashKey("session-lookup"), index: 0, code: "session_lookup_failed" });
  }

  const tombstones = new Set(
    origins.tombstones.map((tombstone) => tombstone.sessionId),
  );
  const originsAuthoritative = origins.complete || origins.state === "missing";
  const sessionFingerprint = lookupComplete
    ? sessionLookupFingerprint(lookupSessions)
    : "";
  if (
    originsAuthoritative && inventory.complete && lookupComplete &&
    failures.length === 0
  ) {
    const cached = completeCache.get(
      cacheKey(
        workspace.id,
        origins.revision,
        inventory.fingerprint,
        sessionFingerprint,
      ),
    );
    if (cached) {
      recordExpertLifecycleEvent({
        kind: "directory_fetch",
        source: "cache",
        phase: "fetch",
        outcome: "succeeded",
        complete: true,
        count: cached.records.length,
        workspaceId: workspace.id,
        durationMs: Date.now() - startedAt,
      });
      return cached;
    }
  }
  const entriesBySession = new Map<string, WorkspaceSessionMarkerInventoryEntry[]>();
  for (const entry of inventory.entries) {
    const sessionId = explicitMarkerSessionId(entry.marker);
    if (!sessionId) continue;
    const current = entriesBySession.get(sessionId) ?? [];
    current.push(entry);
    entriesBySession.set(sessionId, current);
  }

  const grouped = new Map<string, MutableDirectoryRecord>();
  const originSessionIds = new Set<string>();
  for (const origin of origins.items.filter((item) => item.kind === "expert")) {
    originSessionIds.add(origin.sessionId);
    if (tombstones.has(origin.sessionId)) continue;
    const candidates = entriesBySession.get(origin.sessionId) ?? [];
    const marker = candidates[0]?.marker;
    const markerIdentity = markerIdentityOf(marker);
    if (candidates.length > 1 && candidates.some((entry) => !sameMarkerIdentity(entry.marker, marker))) {
      failures.push({ source: "expert-runtime", key: hashKey(origin.sessionId), index: failures.length, code: "marker_identity_conflict" });
    }
    if (markerIdentity &&
      ((origin.agentId && origin.agentId !== markerIdentity.agentId) ||
        (origin.packageName && origin.packageName !== markerIdentity.packageName))) {
      failures.push({ source: "expert-runtime", key: hashKey(origin.sessionId), index: failures.length, code: "marker_identity_conflict" });
    }
    const agentId = markerIdentity?.agentId || origin.agentId;
    // Older expert origins were written with agentId only (no packageName).
    // Derive package from `package:agent` marketplace ids so the directory stays
    // complete instead of permanently failing open with legacy_identity_unresolved.
    const packageName = markerIdentity?.packageName
      || origin.packageName
      || derivePackageNameFromAgentId(agentId);
    if (!agentId || !packageName) {
      failures.push({ source: "origins", key: hashKey(origin.sessionId), index: failures.length, code: "legacy_identity_unresolved" });
      continue;
    }
    const directory = markerIdentity ? candidates[0]!.directory : origin.directory;
    addSession(grouped, {
      agentId,
      packageName,
      sessionId: origin.sessionId,
      directory,
      runtimeMissing: !markerIdentity,
      sessionMissing: lookupComplete ? !sessionIds.has(origin.sessionId) : undefined,
      skills: skillsFromMarker(marker),
    });
  }

  for (const [sessionId, entries] of entriesBySession) {
    if (originSessionIds.has(sessionId) || tombstones.has(sessionId)) continue;
    const entry = entries[0]!;
    const identity = markerIdentityOf(entry.marker);
    if (!identity) continue;
    addSession(grouped, {
      ...identity,
      sessionId,
      directory: entry.directory,
      runtimeMissing: false,
      sessionMissing: lookupComplete ? !sessionIds.has(sessionId) : undefined,
      skills: skillsFromMarker(entry.marker),
    });
  }

  const records = [...grouped.values()].map(finalizeRecord).sort((left, right) =>
    `${left.packageName}\u0000${left.agentId}`.localeCompare(`${right.packageName}\u0000${right.agentId}`),
  );
  // A missing origins file is an authoritative empty state, so marker-only
  // candidates remain healable. Corrupt/unknown origins stay incomplete.
  // marker_identity_conflict stays in `failures` (no record field) but must
  // not force workspace complete=false when remaining origins are healthy.
  const blockingFailures = failures.filter(
    (failure) => failure.code !== "marker_identity_conflict",
  );
  const complete = originsAuthoritative && inventory.complete && lookupComplete && blockingFailures.length === 0;
  const projection: ExpertDirectoryProjection = {
    version: 1,
    schema: "onmyagent.expert-directory.v1",
    revision: origins.revision,
    complete,
    state: complete ? origins.state : failures.some((failure) => failure.source === "opencode") ? "session_lookup_failed" : origins.state,
    failures,
    inventoryFingerprint: inventory.fingerprint,
    records,
    tombstonedSessionIds: [...tombstones].sort(),
  };
  if (complete) {
    completeCache.set(
      cacheKey(
        workspace.id,
        projection.revision,
        projection.inventoryFingerprint,
        sessionFingerprint,
      ),
      projection,
    );
    latestCompleteByWorkspace.set(workspace.id, projection);
  } else {
    const lastComplete = latestComplete(workspace.id);
    if (lastComplete) projection.lastComplete = {
      revision: lastComplete.revision,
      inventoryFingerprint: lastComplete.inventoryFingerprint,
    };
  }
  recordExpertLifecycleEvent({
    kind: "directory_fetch",
    source: "workspace",
    phase: "complete",
    outcome: projection.complete ? "succeeded" : "partial",
    complete: projection.complete,
    failureCount: projection.failures.length,
    count: projection.records.length,
    workspaceId: workspace.id,
    durationMs: Date.now() - startedAt,
  });
  return projection;
}

export async function healExpertDirectory(
  workspace: WorkspaceInfo,
  request: ExpertDirectoryHealRequest,
  options: ExpertDirectoryBuildOptions = {},
): Promise<ExpertDirectoryHealResponse> {
  const startedAt = Date.now();
  recordExpertLifecycleEvent({
    kind: "heal",
    phase: request.apply === true ? "apply" : "dry_run",
    outcome: "started",
    workspaceId: workspace.id,
  });
  const projection = await buildExpertDirectory(workspace, options);
  const dryRun = request.apply !== true;
  if (!dryRun) {
    if (request.expectedRevision === undefined) {
      throw new ApiError(400, "expert_directory_revision_required", "expectedRevision is required for apply");
    }
    if (request.expectedRevision !== projection.revision) {
      throw new ApiError(409, "session_origins_revision_conflict", "Expert directory revision is stale");
    }
    const blockingFailures = projection.failures.filter(
      (failure) => failure.code !== "marker_identity_conflict",
    );
    if (!projection.complete && blockingFailures.length > 0) {
      throw new ApiError(409, "expert_directory_incomplete", "Expert directory is incomplete");
    }
  }
  const inventory = await scanWorkspaceExpertSessionMarkers({
    workspace,
    runtimeRoot: options.runtimeRoot,
    signal: options.signal,
  });
  const origins = await listSessionOrigins(workspace);
  const ensureRuntimeRoot = options.runtimeRoot
    ? await realpath(options.runtimeRoot).catch(() => options.runtimeRoot)
    : options.runtimeRoot;
  const originsById = new Map(
    origins.items
      .filter((item) => item.kind === "expert")
      .map((item) => [item.sessionId, item] as const),
  );
  const tombstones = new Set(origins.tombstones.map((item) => item.sessionId));
  let lookupSessions: readonly { id: string; directory?: string }[] = [];
  if (options.readSessions) {
    try {
      lookupSessions = await options.readSessions(options.signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
  }
  const actions: ExpertDirectoryHealAction[] = [];
  const failures: ExpertDirectoryFailure[] = dryRun
    ? [...projection.failures]
    : projection.failures.filter(
        (failure) => failure.code !== "marker_identity_conflict",
      );
  let expectedRevision = origins.revision;
  const markerEntriesBySession = new Map<string, WorkspaceSessionMarkerInventoryEntry[]>();
  for (const candidate of inventory.entries) {
    const candidateSessionId = explicitMarkerSessionId(candidate.marker);
    if (!candidateSessionId) continue;
    markerEntriesBySession.set(candidateSessionId, [
      ...(markerEntriesBySession.get(candidateSessionId) ?? []),
      candidate,
    ]);
  }
  for (const entry of inventory.entries) {
    const markerIdentity = markerIdentityOf(entry.marker);
    const legacy = markerIdentity
      ? { identity: markerIdentity }
      : resolveLegacyIdentity(entry, lookupSessions);
    if (!("identity" in legacy)) {
      failures.push({ source: "expert-runtime", key: entry.key, index: failures.length, code: legacy.code });
      actions.push({ directory: entry.directory, kind: "skip", result: "skipped", code: legacy.code });
      continue;
    }
    const identity = legacy.identity;
    const sessionId = identity.sessionId;
    const sameSessionMarkers = markerEntriesBySession.get(sessionId) ?? [];
    if (
      sameSessionMarkers.length > 1 &&
      sameSessionMarkers.some((candidate) =>
        !sameMarkerIdentity(candidate.marker, entry.marker),
      )
    ) {
      actions.push({ ...identity, directory: entry.directory, kind: "skip", result: "skipped", code: "marker_identity_conflict" });
      failures.push({ source: "heal", key: entry.key, index: failures.length, code: "marker_identity_conflict" });
      continue;
    }
    if (tombstones.has(sessionId) && request.restoreTombstoned !== true) {
      actions.push({ ...identity, directory: entry.directory, kind: "skip", result: "skipped", code: "tombstone_protected" });
      failures.push({ source: "heal", key: entry.key, index: failures.length, code: "tombstone_protected" });
      continue;
    }
    const needsMarkerUpgrade = entry.marker.isolationVersion !== 3;
    // Isolation v3 sessions can still have empty physical skills after a failed
    // first materialize; re-ensure so heal restores them without requiring upgrade.
    const needsSkillRepair = (entry.marker.missingSkills?.length ?? 0) > 0;
    const currentOrigin = originsById.get(sessionId);
    const hasVisibleOrigin = Boolean(
      currentOrigin && !tombstones.has(sessionId) &&
      currentOrigin.agentId === identity.agentId &&
      currentOrigin.packageName === identity.packageName &&
      currentOrigin.directory?.trim() === entry.directory,
    );
    const originKind = tombstones.has(sessionId) ? "restore_origin" : "write_origin";
    if (needsMarkerUpgrade || needsSkillRepair) {
      const markerAction: ExpertDirectoryHealAction = {
        ...identity,
        directory: entry.directory,
        kind: needsMarkerUpgrade ? "upgrade_marker" : "repair_skills",
        result: dryRun ? "planned" : "applied",
      };
      actions.push(markerAction);
      if (!dryRun) {
        try {
          const ensured = await ensureExpertSessionRuntimeIsolation({
            workspace,
            directory: entry.directory,
            runtimeRoot: ensureRuntimeRoot,
            agentId: identity.agentId,
            packageName: identity.packageName,
            sessionId,
            skillNames: entry.marker.declaredSkills,
          });
          assertBoundMarker(ensured, identity);
        } catch {
          markerAction.result = "failed";
          markerAction.code = "write_failed";
          failures.push({ source: "heal", key: entry.key, index: failures.length, code: "write_failed" });
          continue;
        }
      }
    }
    if (hasVisibleOrigin) continue;
    const originAction: ExpertDirectoryHealAction = {
      ...identity,
      directory: entry.directory,
      kind: originKind,
      result: dryRun ? "planned" : "applied",
    };
    actions.push(originAction);
    if (dryRun) continue;
    try {
      const ensured = await ensureExpertSessionRuntimeIsolation({
        workspace,
        directory: entry.directory,
        runtimeRoot: ensureRuntimeRoot,
        agentId: identity.agentId,
        packageName: identity.packageName,
        sessionId,
        skillNames: entry.marker.declaredSkills,
      });
      assertBoundMarker(ensured, identity);
      await upsertSessionOrigin(workspace, sessionId, {
        kind: "expert",
        agentId: identity.agentId,
        packageName: identity.packageName,
        directory: entry.directory,
        expectedRevision,
      });
      expectedRevision += 1;
    } catch {
      originAction.result = "failed";
      originAction.code = "write_failed";
      failures.push({ source: "heal", key: entry.key, index: failures.length, code: "write_failed" });
    }
  }
  const finalProjection = dryRun
    ? projection
    : await buildExpertDirectory(workspace, options);
  const result = {
    dryRun,
    complete: finalProjection.complete && failures.length === 0,
    revision: finalProjection.revision,
    projection: finalProjection,
    actions,
    failures,
  };
  recordExpertLifecycleEvent({
    kind: "heal",
    phase: dryRun ? "dry_run" : "complete",
    outcome: result.complete ? "succeeded" : "partial",
    action: dryRun ? "skip" : "write_origin",
    count: result.actions.length,
    failureCount: result.failures.length,
    workspaceId: workspace.id,
    durationMs: Date.now() - startedAt,
  });
  return result;
}

function incompleteProjection(
  workspaceId: string,
  revision: number,
  code: "origins_unavailable" | "inventory_unavailable",
  failures: ExpertDirectoryFailure[],
): ExpertDirectoryProjection {
  const projection: ExpertDirectoryProjection = {
    version: 1,
    schema: "onmyagent.expert-directory.v1",
    revision,
    complete: false,
    state: code === "origins_unavailable" ? "corrupt" : "session_lookup_failed",
    failures: [...failures, { source: code === "origins_unavailable" ? "origins" : "expert-runtime", key: hashKey(workspaceId), index: failures.length, code }],
    inventoryFingerprint: "",
    records: [],
    tombstonedSessionIds: [],
  };
  const lastComplete = latestComplete(workspaceId);
  if (lastComplete) projection.lastComplete = {
    revision: lastComplete.revision,
    inventoryFingerprint: lastComplete.inventoryFingerprint,
  };
  return projection;
}

function mapInventoryFailureCode(
  code: string,
): "inventory_unavailable" | "marker_invalid" {
  return code === "marker_invalid" ? "marker_invalid" : "inventory_unavailable";
}

/** Best-effort package id from marketplace agent ids (`pkg:agent` → `pkg`). */
export function derivePackageNameFromAgentId(
  agentId: string | undefined | null,
): string | undefined {
  const id = agentId?.trim();
  if (!id) return undefined;
  const colon = id.indexOf(":");
  if (colon > 0) {
    const pkg = id.slice(0, colon).trim();
    return pkg || undefined;
  }
  return id;
}

function assertBoundMarker(
  marker: Awaited<ReturnType<typeof ensureExpertSessionRuntimeIsolation>>,
  identity: { agentId: string; packageName: string; sessionId: string },
): asserts marker is NonNullable<typeof marker> {
  if (!marker || marker.isolationVersion !== 3 ||
    marker.agentId !== identity.agentId ||
    marker.packageName !== identity.packageName ||
    marker.sessionId !== identity.sessionId) {
    throw new Error("Expert session marker identity binding failed");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
