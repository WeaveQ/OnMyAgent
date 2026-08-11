import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  SessionOriginDeleteResult,
  SessionOriginListPayload,
  SessionOriginRecord,
  SessionOriginTombstone,
  SessionOriginUpsertPayload,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { shortId } from "../core/utils.js";

const SESSION_ORIGINS_VERSION = 1;
const SESSION_ORIGINS_V2 = 2;
export const SESSION_ORIGIN_TOMBSTONE_MAX = 256;
const locks = new Map<string, Promise<void>>();

type SessionOriginsFile = {
  version: number;
  records: SessionOriginRecord[];
  revision?: number;
  tombstones?: SessionOriginTombstone[];
  tombstoneWatermark?: number;
};

type SessionOriginsReadState =
  | "ok"
  | "missing"
  | "corrupt"
  | "unknown_version";

type ReadOriginsResult = SessionOriginsFile & {
  complete: boolean;
  state: SessionOriginsReadState;
};

export function sessionOriginsPath(workspace: WorkspaceInfo): string {
  const workspaceRoot = workspace.path.trim();
  if (!workspaceRoot) {
    throw new ApiError(
      400,
      "session_origins_unavailable",
      "Session origins require a local workspace path",
    );
  }
  return join(workspaceRoot, ".opencode", "onmyagent", "session-origins.json");
}

export async function listSessionOrigins(workspace: WorkspaceInfo): Promise<SessionOriginListPayload> {
  return withPathLock(sessionOriginsPath(workspace), async (path) => {
    const file = await readOrigins(path);
    const tombstones = file.version === SESSION_ORIGINS_V2
      ? file.tombstones ?? []
      : [];
    const tombstoneKeys = new Set(
      tombstones.map((tombstone) => `${tombstone.workspaceId}\u0000${tombstone.sessionId}`),
    );
    const items = file.records.filter(
      (record) =>
        record.workspaceId === workspace.id &&
        !tombstoneKeys.has(`${record.workspaceId}\u0000${record.sessionId}`),
    );
    const workspaceTombstones = tombstones.filter(
      (tombstone) => tombstone.workspaceId === workspace.id,
    );
    return {
      version: SESSION_ORIGINS_V2,
      revision: file.revision ?? 0,
      items,
      tombstones: workspaceTombstones,
      ...(file.tombstoneWatermark !== undefined
        ? { tombstoneWatermark: file.tombstoneWatermark }
        : {}),
      complete: file.complete,
      state: file.state,
      ...(file.version !== SESSION_ORIGINS_VERSION ? { sourceVersion: file.version } : {}),
    };
  });
}

export async function upsertSessionOrigin(
  workspace: WorkspaceInfo,
  sessionId: string,
  input: SessionOriginUpsertPayload,
): Promise<SessionOriginRecord> {
  const id = sessionId.trim();
  if (!id) throw new ApiError(400, "invalid_payload", "sessionId is required");
  const path = sessionOriginsPath(workspace);
  return withPathLock(path, async () => {
    const file = await readOrigins(path);
    assertWritableVersion(file);
    assertExpectedRevision(file, input.expectedRevision);
    if (input.kind === "expert" &&
      (!input.agentId?.trim() || !input.packageName?.trim() || !input.directory?.trim())) {
      throw new ApiError(
        400,
        "session_origin_expert_identity_required",
        "Expert origin writes require agentId, packageName, and directory",
      );
    }
    const now = Date.now();
    const visible = visibleRecords(file);
    const existingTombstone = file.version === SESSION_ORIGINS_V2 && file.state === "ok"
      ? (file.tombstones ?? []).find(
          (tombstone) => tombstone.workspaceId === workspace.id && tombstone.sessionId === id,
        )
      : undefined;
    if (existingTombstone && input.expectedRevision === undefined) {
      throw new ApiError(
        409,
        "session_origins_tombstone_unlock_required",
        "An expected revision is required to restore a tombstoned session origin",
      );
    }
    const previous = visible.find((record) => record.workspaceId === workspace.id && record.sessionId === id);
    const item: SessionOriginRecord = {
      workspaceId: workspace.id,
      sessionId: id,
      kind: input.kind,
      ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
      ...(input.packageName?.trim() ? { packageName: input.packageName.trim() } : {}),
      ...(input.directory?.trim() ? { directory: input.directory.trim() } : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    const records = file.records.filter(
      (record) => !(record.workspaceId === workspace.id && record.sessionId === id),
    );
    records.push(item);
    if (file.version === SESSION_ORIGINS_V2 && file.state === "ok") {
      const tombstones = (file.tombstones ?? []).filter(
        (tombstone) => !(tombstone.workspaceId === workspace.id && tombstone.sessionId === id),
      );
      const revision = nextRevision(file);
      const retained = compactTombstones({
        tombstones,
        watermark: file.tombstoneWatermark,
      });
      await writeOrigins(path, {
        version: SESSION_ORIGINS_V2,
        revision,
        records,
        tombstones: retained.tombstones,
        ...(retained.watermark !== undefined ? { tombstoneWatermark: retained.watermark } : {}),
      });
    } else {
      // First mutation migrates a missing/v1 file to the revisioned v2 format.
      await writeOrigins(path, { version: SESSION_ORIGINS_V2, revision: 1, records, tombstones: [] });
    }
    return item;
  });
}

export async function deleteSessionOrigin(
  workspace: WorkspaceInfo,
  sessionId: string,
  options?: { expectedRevision?: number },
): Promise<SessionOriginDeleteResult> {
  const id = sessionId.trim();
  if (!id) throw new ApiError(400, "invalid_payload", "sessionId is required");
  const path = sessionOriginsPath(workspace);
  return withPathLock(path, async () => {
    const file = await readOrigins(path);
    assertWritableVersion(file);
    assertExpectedRevision(file, options?.expectedRevision);
    const visible = visibleRecords(file);
    const records = file.version === SESSION_ORIGINS_V2 && file.state === "ok"
      ? file.records.filter((record) => !(record.workspaceId === workspace.id && record.sessionId === id))
      : visible.filter((record) => !(record.workspaceId === workspace.id && record.sessionId === id));
    const revision = nextRevision(file);
    const priorTombstone = (file.tombstones ?? []).find(
      (tombstone) => tombstone.workspaceId === workspace.id && tombstone.sessionId === id,
    );
    const tombstone: SessionOriginTombstone = priorTombstone ?? {
      workspaceId: workspace.id,
      sessionId: id,
      deletedAt: Date.now(),
      reason: "user_delete",
      revision,
    };
    if (file.version === SESSION_ORIGINS_V2 && file.state === "ok") {
      const tombstones = file.tombstones ?? [];
      const hadTargetRecord = file.records.some(
        (record) => record.workspaceId === workspace.id && record.sessionId === id,
      );
      if (!hadTargetRecord && priorTombstone) {
        return { ok: true, revision: file.revision ?? 0, tombstone: priorTombstone };
      }
      const nextTombstones = priorTombstone
        ? tombstones
        : [...tombstones, tombstone];
      const retained = compactTombstones({
        tombstones: nextTombstones,
        watermark: file.tombstoneWatermark,
      });
      await writeOrigins(path, {
        version: SESSION_ORIGINS_V2,
        revision,
        records,
        tombstones: retained.tombstones,
        ...(retained.watermark !== undefined ? { tombstoneWatermark: retained.watermark } : {}),
      });
      return { ok: true, revision, tombstone };
    }
    await writeOrigins(path, {
      version: SESSION_ORIGINS_V2,
      revision,
      records,
      tombstones: [tombstone],
    });
    return { ok: true, revision, tombstone };
  });
}

async function withPathLock<T>(path: string, operation: (path: string) => Promise<T>): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => operation(path));
  const current = run.then(() => undefined, () => undefined);
  locks.set(path, current);
  try {
    return await run;
  } finally {
    if (locks.get(path) === current) locks.delete(path);
  }
}

async function readOrigins(path: string): Promise<ReadOriginsResult> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyOrigins("corrupt");
    }
    const version = "version" in parsed && typeof parsed.version === "number"
      ? parsed.version
      : undefined;
    const records = "records" in parsed ? parsed.records : undefined;
    if (!Array.isArray(records)) {
      return emptyOrigins(version === undefined ? "unknown_version" : "corrupt");
    }

    const parsedRecords = records.flatMap(parseRecord);
    if (version === SESSION_ORIGINS_VERSION) {
      return {
        version: SESSION_ORIGINS_VERSION,
        records: parsedRecords,
        complete: true,
        state: "ok",
      };
    }
    if (version === SESSION_ORIGINS_V2) {
      const rawTombstones = "tombstones" in parsed ? parsed.tombstones : undefined;
      const tombstones = Array.isArray(rawTombstones)
        ? rawTombstones.flatMap(parseTombstone)
        : [];
      const revision = "revision" in parsed && typeof parsed.revision === "number" &&
        Number.isSafeInteger(parsed.revision) && parsed.revision >= 0
        ? parsed.revision
        : undefined;
      const watermark = "tombstoneWatermark" in parsed && typeof parsed.tombstoneWatermark === "number" &&
        Number.isSafeInteger(parsed.tombstoneWatermark) && parsed.tombstoneWatermark >= 0
        ? parsed.tombstoneWatermark
        : undefined;
      const complete =
        revision !== undefined &&
        Array.isArray(rawTombstones) &&
        parsedRecords.length === records.length &&
        tombstones.length === rawTombstones.length &&
        rawTombstones.every((value) => isStrictTombstone(value, revision, watermark)) &&
        (!("tombstoneWatermark" in parsed) ||
          (watermark !== undefined && watermark < revision));
      return {
        version: SESSION_ORIGINS_V2,
        records: parsedRecords,
        ...(revision !== undefined ? { revision } : {}),
        tombstones,
        ...(watermark !== undefined ? { tombstoneWatermark: watermark } : {}),
        complete,
        state: complete ? "ok" : "corrupt",
      };
    }

    // Unknown but structurally parseable versions are retained as a
    // non-authoritative view. This avoids turning a future file into a false
    // empty directory while keeping the R0 writer pinned to v1.
    return {
      version: version ?? -1,
      records: parsedRecords,
      complete: false,
      state: "unknown_version",
    };
  } catch (error) {
    if (isMissingFileError(error)) return emptyOrigins("missing");
    return emptyOrigins("corrupt");
  }
}

function emptyOrigins(state: SessionOriginsReadState = "missing"): ReadOriginsResult {
  return {
    version: SESSION_ORIGINS_VERSION,
    records: [],
    complete: state === "ok",
    state,
  };
}

function assertWritableVersion(file: ReadOriginsResult): void {
  if (file.state === "unknown_version" || file.state === "corrupt") {
    throw new ApiError(
      409,
      "session_origins_version_unsupported",
      file.state === "unknown_version"
        ? "Session origins file uses an unsupported version"
        : "Session origins file is corrupt and cannot be safely updated",
    );
  }
}

function nextRevision(file: SessionOriginsFile): number {
  const current = file.revision ?? 0;
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new ApiError(409, "session_origins_revision_invalid", "Session origins revision is invalid");
  }
  return current + 1;
}

function assertExpectedRevision(
  file: ReadOriginsResult,
  expectedRevision: number | undefined,
): void {
  if (expectedRevision !== undefined &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
    throw new ApiError(400, "session_origins_revision_invalid", "expectedRevision must be a non-negative integer");
  }
  const current = file.revision ?? 0;
  if (file.tombstoneWatermark !== undefined && expectedRevision === undefined) {
    throw new ApiError(
      409,
      "session_origins_revision_required",
      "A revision is required after origin compaction",
    );
  }
  if (expectedRevision !== undefined && expectedRevision !== current) {
    throw new ApiError(
      409,
      "session_origins_revision_conflict",
      "Session origins revision is stale",
    );
  }
  if (file.tombstoneWatermark !== undefined &&
    expectedRevision !== undefined && expectedRevision <= file.tombstoneWatermark) {
    throw new ApiError(
      409,
      "session_origins_revision_conflict",
      "Session origins revision predates tombstone compaction",
    );
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}

function parseTombstone(value: unknown): SessionOriginTombstone[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const workspaceId = "workspaceId" in value ? value.workspaceId : undefined;
  const sessionId = "sessionId" in value ? value.sessionId : undefined;
  if (
    typeof workspaceId !== "string" || !workspaceId.trim() ||
    typeof sessionId !== "string" || !sessionId.trim()
  ) return [];
  const agentId = "agentId" in value && typeof value.agentId === "string" && value.agentId.trim()
    ? value.agentId.trim()
    : undefined;
  const packageName = "packageName" in value && typeof value.packageName === "string" && value.packageName.trim()
    ? value.packageName.trim()
    : undefined;
  const deletedAt = "deletedAt" in value && typeof value.deletedAt === "number" && Number.isFinite(value.deletedAt)
    ? value.deletedAt
    : undefined;
  const reason = "reason" in value && typeof value.reason === "string" && value.reason.trim()
    ? value.reason.trim()
    : undefined;
  const revision = "revision" in value && typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) && value.revision >= 0
    ? value.revision
    : undefined;
  return [{
    workspaceId: workspaceId.trim(),
    sessionId: sessionId.trim(),
    ...(agentId ? { agentId } : {}),
    ...(packageName ? { packageName } : {}),
    ...(deletedAt !== undefined ? { deletedAt } : {}),
    ...(reason ? { reason } : {}),
    ...(revision !== undefined ? { revision } : {}),
  }];
}

function isStrictTombstone(
  value: unknown,
  fileRevision?: number,
  watermark?: number,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (
    !("workspaceId" in value) || typeof value.workspaceId !== "string" || !value.workspaceId.trim() ||
    !("sessionId" in value) || typeof value.sessionId !== "string" || !value.sessionId.trim()
  ) return false;
  if ("agentId" in value && (typeof value.agentId !== "string" || !value.agentId.trim())) return false;
  if ("packageName" in value && (typeof value.packageName !== "string" || !value.packageName.trim())) return false;
  if (
    "deletedAt" in value &&
    (typeof value.deletedAt !== "number" || !Number.isFinite(value.deletedAt))
  ) return false;
  if ("reason" in value && (typeof value.reason !== "string" || !value.reason.trim())) return false;
  if (
    "revision" in value &&
    (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0)
  ) return false;
  if (
    ("revision" in value && fileRevision !== undefined && (value.revision as number) > fileRevision) ||
    (watermark !== undefined &&
      (!("revision" in value) || (value.revision as number) <= watermark))
  ) return false;
  return true;
}

function visibleRecords(file: SessionOriginsFile): SessionOriginRecord[] {
  if (file.version !== SESSION_ORIGINS_V2) return file.records;
  const tombstoneKeys = new Set(
    (file.tombstones ?? []).map((tombstone) => `${tombstone.workspaceId}\u0000${tombstone.sessionId}`),
  );
  return file.records.filter(
    (record) => !tombstoneKeys.has(`${record.workspaceId}\u0000${record.sessionId}`),
  );
}

function parseRecord(value: unknown): SessionOriginRecord[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const workspaceId = "workspaceId" in value ? value.workspaceId : undefined;
  const sessionId = "sessionId" in value ? value.sessionId : undefined;
  const kind = "kind" in value ? value.kind : undefined;
  const agentId = "agentId" in value ? value.agentId : undefined;
  const packageName = "packageName" in value ? value.packageName : undefined;
  const directory = "directory" in value ? value.directory : undefined;
  const createdAt = "createdAt" in value ? value.createdAt : undefined;
  const updatedAt = "updatedAt" in value ? value.updatedAt : undefined;
  if (
    typeof workspaceId !== "string" || !workspaceId.trim() ||
    typeof sessionId !== "string" || !sessionId.trim() ||
    (kind !== "assistant" && kind !== "expert" && kind !== "automation") ||
    typeof createdAt !== "number" || !Number.isFinite(createdAt) ||
    typeof updatedAt !== "number" || !Number.isFinite(updatedAt)
  ) return [];
  return [{
    workspaceId,
    sessionId,
    kind,
    ...(typeof agentId === "string" && agentId.trim() ? { agentId } : {}),
    ...(typeof packageName === "string" && packageName.trim() ? { packageName } : {}),
    ...(typeof directory === "string" && directory.trim() ? { directory } : {}),
    createdAt,
    updatedAt,
  }];
}

function compactTombstones(input: {
  tombstones: SessionOriginTombstone[];
  watermark: number | undefined;
}): { tombstones: SessionOriginTombstone[]; watermark?: number } {
  if (input.tombstones.length <= SESSION_ORIGIN_TOMBSTONE_MAX) {
    return {
      tombstones: input.tombstones,
      ...(input.watermark !== undefined ? { watermark: input.watermark } : {}),
    };
  }
  const ordered = [...input.tombstones].sort((left, right) =>
    (left.revision ?? Number.MAX_SAFE_INTEGER) - (right.revision ?? Number.MAX_SAFE_INTEGER),
  );
  const removable = ordered.slice(0, ordered.length - SESSION_ORIGIN_TOMBSTONE_MAX);
  if (removable.some((tombstone) => tombstone.revision === undefined)) {
    throw new ApiError(
      409,
      "session_origins_tombstone_limit",
      "Session origin tombstones require migration before compaction",
    );
  }
  const highestRemovedRevision = removable.reduce(
    (highest, tombstone) => Math.max(highest, tombstone.revision ?? 0),
    input.watermark ?? 0,
  );
  return {
    tombstones: ordered.slice(-SESSION_ORIGIN_TOMBSTONE_MAX),
    watermark: highestRemovedRevision,
  };
}

async function writeOrigins(path: string, file: SessionOriginsFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp.${shortId()}`;
  try {
    const persisted = {
      version: file.version,
      records: file.records,
      ...(file.revision !== undefined ? { revision: file.revision } : {}),
      ...(file.tombstones !== undefined ? { tombstones: file.tombstones } : {}),
      ...(file.tombstoneWatermark !== undefined ? { tombstoneWatermark: file.tombstoneWatermark } : {}),
    };
    await writeFile(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
