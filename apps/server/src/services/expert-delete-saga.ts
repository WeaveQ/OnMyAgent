import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import type {
  ExpertDeleteRequest,
  ExpertDeleteResult,
  ExpertDeleteStep,
  SessionOriginRecord,
  ServerConfig,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { ApiError, isApiError } from "../core/errors.js";
import { deleteWorkspaceSession } from "./workspace-sessions.js";
import {
  resolveAuthorizedExpertSessionRuntimeDirectory,
  resolveExpertSessionRuntimeRoot,
} from "./expert-session-runtime.js";
import { deleteSessionOrigin, listSessionOrigins } from "./session-origins.js";
import { recordExpertLifecycleEvent } from "./expert-lifecycle-events.js";

const MAX_TARGETS = 64;
const DELETE_CONCURRENCY = 4;
const JOURNAL_VERSION = 1;
const journalLocks = new Map<string, Promise<void>>();

type Target = SessionOriginRecord & { directory: string };
type JournalStep = ExpertDeleteStep;
type JournalEntry = {
  version: 1;
  operationId: string;
  workspaceId: string;
  agentId: string;
  packageName: string;
  revision: number;
  state: ExpertDeleteResult["state"];
  steps: JournalStep[];
};

export type ExpertDeleteSagaOptions = {
  runtimeRoot?: string;
  journalPath?: string;
  signal?: AbortSignal;
  deleteSession?: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    sessionId: string,
    directory?: string,
  ) => Promise<void>;
  removeRuntimeDirectory?: (directory: string) => Promise<void>;
  beforeTombstone?: (sessionId: string) => Promise<void>;
  afterTombstone?: (sessionId: string) => Promise<void>;
};

/**
 * Resolve origin rows for a delete request.
 * UI often sends packageName = agentId ("pkg:pkg") while origins store "pkg".
 * Prefer exact agentId+packageName, then agentId-only. Short packageName is
 * only a fallback when the origin still belongs to this request's agentId
 * (exact, or composite ending with :short of this request). Never select
 * another expert by packageName alone.
 */
export function selectExpertDeleteOriginRecords(
  items: readonly SessionOriginRecord[],
  request: Pick<ExpertDeleteRequest, "agentId" | "packageName">,
): SessionOriginRecord[] {
  const agentId = request.agentId.trim();
  const packageName = request.packageName.trim();
  const experts = items.filter((item) => item.kind === "expert");
  const byBoth = experts.filter(
    (item) => item.agentId === agentId && item.packageName === packageName,
  );
  if (byBoth.length > 0) return byBoth;

  const byAgent = experts.filter((item) => item.agentId === agentId);
  if (byAgent.length > 0) return byAgent;

  const shortPackage = shortIdentity(packageName);
  const shortAgent = shortIdentity(agentId);
  return experts.filter(
    (item) =>
      item.packageName === shortPackage &&
      (item.agentId === agentId || item.agentId?.endsWith(`:${shortAgent}`)),
  );
}

/**
 * Destructive Expert deletion. The origin tombstone is deliberately the final
 * step; replay can therefore distinguish a completed target from a partially
 * removed runtime without resurrecting a stale record.
 */
export async function deleteExpertSessions(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  request: ExpertDeleteRequest,
  options: ExpertDeleteSagaOptions = {},
): Promise<ExpertDeleteResult> {
  validateRequest(request);
  if (request.marketplace !== "my-experts") {
    throw new ApiError(409, "expert_builtin_delete_forbidden", "Built-in experts cannot be deleted");
  }
  throwIfAborted(options.signal);

  const journalPath = resolveJournalPath(config, workspace, options.journalPath);
  const originState = await listSessionOrigins(workspace);
  if (originState.state === "corrupt" || originState.state === "unknown_version") {
    throw new ApiError(409, "expert_delete_origins_unavailable", "Expert origins are not writable");
  }
  return withJournalLock(journalPath, async () => {
    const journal = await readJournal(journalPath);
    const previous = journal.find((entry) =>
      entry.operationId === request.operationId && entry.workspaceId === workspace.id,
    );
    if (previous && (previous.agentId !== request.agentId || previous.packageName !== request.packageName)) {
      throw new ApiError(409, "expert_delete_operation_conflict", "Operation id belongs to another Expert");
    }
    if (previous?.state === "completed") {
      const replayed = toResult(previous);
      recordDeleteResultEvent(workspace, request, replayed);
      return replayed;
    }
    if (!previous && request.expectedRevision !== undefined && request.expectedRevision !== originState.revision) {
      throw new ApiError(409, "session_origins_revision_conflict", "Expert origins revision is stale");
    }

    // Prefer agentId+packageName; fall back to agentId-only when the client
    // sent packageName=agentId (e.g. "pkg:pkg") while origins store "pkg".
    // `known` and `selected` share this live origin set; journal steps and
    // tombstones are replay-only and must not widen to every same-agentId row.
    const records = selectExpertDeleteOriginRecords(originState.items, request);
    const requestedIds = request.sessionIds?.map((id) => id.trim()).filter(Boolean);
    const selected = records.filter((record) =>
      !requestedIds || requestedIds.length === 0 || requestedIds.includes(record.sessionId),
    );
    if (requestedIds && requestedIds.length > 0) {
      const known = new Set([
        ...records.map((record) => record.sessionId),
        ...(previous?.steps ?? []).map((step) => step.sessionId),
        ...originState.tombstones.map((tombstone) => tombstone.sessionId),
      ]);
      const missing = requestedIds.find((id) => !known.has(id));
      if (missing) {
        throw new ApiError(404, "expert_delete_target_not_found", "Expert session target was not found");
      }
    }
    if (selected.length === 0 && !previous) {
      throw new ApiError(404, "expert_delete_target_not_found", "Expert session target was not found");
    }
    if (selected.length > MAX_TARGETS) {
      throw new ApiError(400, "expert_delete_target_limit", "Too many Expert sessions in one delete operation");
    }
    const targets: Target[] = [];
    for (const record of selected) {
      if (!record.directory?.trim()) {
        throw new ApiError(409, "expert_delete_directory_missing", "Expert session directory is unavailable");
      }
      targets.push({ ...record, directory: record.directory.trim() });
    }
    recordExpertLifecycleEvent({
      kind: "delete",
      phase: "requested",
      outcome: "started",
      code: "delete_started",
      workspaceId: workspace.id,
      expertId: request.agentId,
      count: targets.length,
    });

    const entry: JournalEntry = previous ?? {
      version: JOURNAL_VERSION,
      operationId: request.operationId,
      workspaceId: workspace.id,
      agentId: request.agentId,
      packageName: request.packageName,
      revision: originState.revision,
      state: "failed",
      steps: targets.map((target) => ({
        sessionId: target.sessionId,
        openCode: "pending",
        runtime: "pending",
        tombstone: "pending",
      })),
    };
    const existingTombstones = new Set(originState.tombstones.map((item) => item.sessionId));
    for (const step of entry.steps) {
      if (existingTombstones.has(step.sessionId) && step.tombstone === "pending") {
        step.tombstone = "skipped";
      }
    }
    for (const target of targets) {
      if (!entry.steps.some((step) => step.sessionId === target.sessionId)) {
        entry.steps.push({
          sessionId: target.sessionId,
          openCode: "pending",
          runtime: "pending",
          tombstone: "pending",
        });
      }
    }
    await persistJournal(journalPath, journal.filter((item) => item !== previous).concat(entry));

    const deleteSession = options.deleteSession ?? deleteWorkspaceSession;
    const removeRuntimeDirectory = options.removeRuntimeDirectory ??
      ((directory: string) => removeAuthorizedRuntimeDirectory(directory, options.runtimeRoot));
    let progress = Promise.resolve();
    const checkpoint = async () => {
      const previousProgress = progress;
      progress = previousProgress.then(() =>
        persistJournal(journalPath, journal.filter((item) => item !== previous).concat(entry)),
      );
      await progress;
    };
    await boundedForEach(targets, DELETE_CONCURRENCY, async (target) => {
      const step = entry.steps.find((item) => item.sessionId === target.sessionId)!;
      if (step.openCode === "pending" || step.openCode === "failed") {
        try {
          await deleteSession(config, workspace, target.sessionId, target.directory);
          step.openCode = "completed";
          if (step.code === "opencode_delete_failed") delete step.code;
        } catch (error) {
          if (isMissingDeleteError(error)) {
            step.openCode = "skipped";
            step.code = "session_missing";
          } else {
            step.openCode = "failed";
            step.code = "opencode_delete_failed";
          }
        }
        recordDeleteStepEvent(workspace, request, step, "opencode");
      }
      if (step.openCode === "failed") {
        await checkpoint();
        return;
      }
      if (step.runtime === "pending" || step.runtime === "failed") {
        try {
          const authorized = await resolveAuthorizedExpertSessionRuntimeDirectory({
            workspaceId: workspace.id,
            sessionRoot: target.directory,
            runtimeRoot: options.runtimeRoot,
          });
          if (!authorized) {
            step.runtime = "failed";
            step.code = "runtime_path_unauthorized";
          } else {
            await removeRuntimeDirectory(authorized);
            step.runtime = "completed";
            if (step.code === "runtime_delete_failed" || step.code === "runtime_path_unauthorized") {
              delete step.code;
            }
          }
        } catch {
          step.runtime = "failed";
          step.code = "runtime_delete_failed";
        }
        recordDeleteStepEvent(workspace, request, step, "runtime");
      }
      await checkpoint();
    });

    let revision = Math.max(entry.revision, originState.revision);
    for (const target of targets) {
      throwIfAborted(options.signal);
      const step = entry.steps.find((item) => item.sessionId === target.sessionId)!;
      if (step.openCode === "failed" || step.runtime === "failed") continue;
      if (step.tombstone === "completed" || step.tombstone === "skipped") continue;
      await options.beforeTombstone?.(target.sessionId);
      const current = await listSessionOrigins(workspace);
      const alreadyDeleted = current.tombstones.some((item) => item.sessionId === target.sessionId);
      if (alreadyDeleted) {
        step.tombstone = "skipped";
        revision = current.revision;
        recordDeleteStepEvent(workspace, request, step, "tombstone");
        await checkpoint();
        continue;
      }
      let tombstoneWritten = false;
      try {
        const deleted = await deleteSessionOrigin(workspace, target.sessionId, {
          expectedRevision: current.revision,
        });
        step.tombstone = "completed";
        if (step.code === "tombstone_write_failed") delete step.code;
        revision = deleted.revision;
        tombstoneWritten = true;
      } catch {
        step.tombstone = "failed";
        step.code = "tombstone_write_failed";
      }
      if (tombstoneWritten) await options.afterTombstone?.(target.sessionId);
      recordDeleteStepEvent(workspace, request, step, "tombstone");
      await checkpoint();
    }

    const failed = entry.steps.some((step) =>
      step.openCode === "failed" || step.runtime === "failed" || step.tombstone === "failed",
    );
    const pending = entry.steps.some((step) =>
      step.openCode === "pending" || step.runtime === "pending" || step.tombstone === "pending",
    );
    entry.revision = revision;
    entry.state = failed ? "partial" : pending ? "partial" : "completed";
    await persistJournal(journalPath, journal.filter((item) => item !== previous).concat(entry));
    const result = toResult(entry);
    recordDeleteResultEvent(workspace, request, result);
    return result;
  });
}

function validateRequest(request: ExpertDeleteRequest): void {
  if (!request || typeof request !== "object") {
    throw new ApiError(400, "invalid_payload", "Expert delete payload is required");
  }
  for (const [name, value] of [
    ["operationId", request.operationId],
    ["agentId", request.agentId],
    ["packageName", request.packageName],
  ] as const) {
    if (typeof value !== "string" || !value.trim() || value.length > 160) {
      throw new ApiError(400, "invalid_payload", `${name} is required`);
    }
  }
  if (request.sessionIds !== undefined &&
    (!Array.isArray(request.sessionIds) || request.sessionIds.some((id) => typeof id !== "string"))) {
    throw new ApiError(400, "invalid_payload", "sessionIds must be strings");
  }
  if (request.expectedRevision !== undefined &&
    (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)) {
    throw new ApiError(400, "session_origins_revision_invalid", "expectedRevision must be a non-negative integer");
  }
}

function resolveJournalPath(config: ServerConfig, workspace: WorkspaceInfo, override?: string): string {
  const fallback = config.configPath?.trim()
    ? join(dirname(resolve(config.configPath)), "expert-delete-operations.json")
    : join(process.env.ONMYAGENT_DATA_DIR?.trim() || join(homedir(), ".config", "onmyagent"), "expert-delete-operations.json");
  const candidate = resolve(override?.trim() || fallback);
  const workspaceRoot = resolve(workspace.path);
  const relativeCandidate = relative(workspaceRoot, candidate);
  if (candidate === workspaceRoot || (relativeCandidate && !relativeCandidate.startsWith(`..${sep}`) && relativeCandidate !== "..")) {
    throw new ApiError(409, "expert_delete_journal_unsafe", "Delete journal must be outside the workspace");
  }
  return candidate;
}

async function withJournalLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = journalLocks.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const current = run.then(() => undefined, () => undefined);
  journalLocks.set(path, current);
  try {
    return await run;
  } finally {
    if (journalLocks.get(path) === current) journalLocks.delete(path);
  }
}

async function readJournal(path: string): Promise<JournalEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new ApiError(409, "expert_delete_journal_corrupt", "Expert delete journal is not writable");
    }
    const entries: JournalEntry[] = [];
    const keys = new Set<string>();
    for (const value of parsed) {
      if (!isJournalEntry(value)) {
        throw new ApiError(409, "expert_delete_journal_corrupt", "Expert delete journal is not writable");
      }
      const entry = value as JournalEntry;
      const key = `${entry.workspaceId}\u0000${entry.operationId}`;
      if (keys.has(key)) {
        throw new ApiError(409, "expert_delete_journal_corrupt", "Expert delete journal is not writable");
      }
      keys.add(key);
      entries.push(entry);
    }
    return entries;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw new ApiError(409, "expert_delete_journal_corrupt", "Expert delete journal is not writable");
  }
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<JournalEntry>;
  if (entry.version !== JOURNAL_VERSION ||
    !isNonEmptyString(entry.operationId) ||
    !isNonEmptyString(entry.workspaceId) ||
    !isNonEmptyString(entry.agentId) ||
    !isNonEmptyString(entry.packageName) ||
    !isNonNegativeSafeInteger(entry.revision) ||
    !isDeleteResultState(entry.state) ||
    !Array.isArray(entry.steps)) return false;
  return entry.steps.every(isJournalStep);
}

function isJournalStep(value: unknown): value is JournalStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Partial<JournalStep>;
  if (!isNonEmptyString(step.sessionId) ||
    !isDeleteStepState(step.openCode) ||
    !isDeleteStepState(step.runtime) ||
    !isDeleteStepState(step.tombstone)) return false;
  return step.code === undefined || isNonEmptyString(step.code);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDeleteStepState(value: unknown): value is ExpertDeleteStep["openCode"] {
  return value === "pending" || value === "completed" || value === "skipped" || value === "failed";
}

function isDeleteResultState(value: unknown): value is ExpertDeleteResult["state"] {
  return value === "completed" || value === "partial" || value === "failed";
}

async function persistJournal(path: string, entries: readonly JournalEntry[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${hashKey(String(Date.now()) + Math.random())}`;
  try {
    await writeFile(tmp, `${JSON.stringify(entries.slice(-32), null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function boundedForEach<T>(items: readonly T[], concurrency: number, operation: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await operation(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

async function removeAuthorizedRuntimeDirectory(directory: string, runtimeRoot?: string): Promise<void> {
  const canonical = await realpath(directory);
  const info = await lstat(canonical);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Runtime target is not a directory");
  const root = await realpath(resolveExpertSessionRuntimeRoot(runtimeRoot));
  if (canonical === root) throw new Error("Runtime root cannot be deleted");
  await rm(canonical, { recursive: true, force: true });
}

function isMissingDeleteError(error: unknown): boolean {
  if (isApiError(error)) {
    const details = error.details;
    const status = details && typeof details === "object" && "status" in details
      ? Number((details as { status?: unknown }).status)
      : NaN;
    return status === 404 || /not found|session_not_found/i.test(error.message);
  }
  return error instanceof Error && /not found|session_not_found/i.test(error.message);
}

function toResult(entry: JournalEntry): ExpertDeleteResult {
  return {
    operationId: entry.operationId,
    workspaceId: entry.workspaceId,
    agentId: entry.agentId,
    packageName: entry.packageName,
    revision: entry.revision,
    state: entry.state,
    steps: entry.steps.map((step) => ({ ...step })),
  };
}

function recordDeleteStepEvent(
  workspace: WorkspaceInfo,
  request: ExpertDeleteRequest,
  step: ExpertDeleteStep,
  phase: "opencode" | "runtime" | "tombstone",
): void {
  const state = step[phase === "opencode" ? "openCode" : phase];
  recordExpertLifecycleEvent({
    kind: "delete",
    phase,
    step: phase,
    outcome: state === "completed" ? "succeeded" : state === "failed" ? "failed" : state === "skipped" ? "skipped" : "started",
    ...(step.code ? { code: step.code } : {}),
    workspaceId: workspace.id,
    expertId: request.agentId,
    sessionId: step.sessionId,
  });
}

function recordDeleteResultEvent(
  workspace: WorkspaceInfo,
  request: ExpertDeleteRequest,
  result: ExpertDeleteResult,
): void {
  const failureCount = result.steps.filter((step) =>
    step.openCode === "failed" || step.runtime === "failed" || step.tombstone === "failed",
  ).length;
  recordExpertLifecycleEvent({
    kind: "delete",
    phase: "complete",
    step: "complete",
    outcome: result.state === "completed" ? "succeeded" : "partial",
    code: `delete_${result.state}`,
    count: result.steps.length,
    failureCount,
    workspaceId: workspace.id,
    expertId: request.agentId,
  });
}

function shortIdentity(value: string): string {
  if (!value.includes(":")) return value;
  return value.split(":").filter(Boolean).at(-1) ?? value;
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}
