import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  SessionOriginListPayload,
  SessionOriginRecord,
  SessionOriginUpsertPayload,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { shortId } from "../core/utils.js";

const SESSION_ORIGINS_VERSION = 1;
const locks = new Map<string, Promise<void>>();

type SessionOriginsFile = { version: number; records: SessionOriginRecord[] };

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
  return withPathLock(sessionOriginsPath(workspace), async (path) => ({
    items: (await readOrigins(path)).records.filter((record) => record.workspaceId === workspace.id),
  }));
}

export async function upsertSessionOrigin(
  workspace: WorkspaceInfo,
  sessionId: string,
  input: SessionOriginUpsertPayload,
): Promise<SessionOriginRecord> {
  const id = sessionId.trim();
  const path = sessionOriginsPath(workspace);
  return withPathLock(path, async () => {
    const file = await readOrigins(path);
    const now = Date.now();
    const previous = file.records.find((record) => record.workspaceId === workspace.id && record.sessionId === id);
    const item: SessionOriginRecord = {
      workspaceId: workspace.id,
      sessionId: id,
      kind: input.kind,
      ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
      ...(input.directory?.trim() ? { directory: input.directory.trim() } : {}),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    file.records = file.records.filter((record) => !(record.workspaceId === workspace.id && record.sessionId === id));
    file.records.push(item);
    await writeOrigins(path, file);
    return item;
  });
}

export async function deleteSessionOrigin(workspace: WorkspaceInfo, sessionId: string): Promise<void> {
  const id = sessionId.trim();
  const path = sessionOriginsPath(workspace);
  await withPathLock(path, async () => {
    const file = await readOrigins(path);
    const records = file.records.filter((record) => !(record.workspaceId === workspace.id && record.sessionId === id));
    if (records.length === file.records.length) return;
    await writeOrigins(path, { version: SESSION_ORIGINS_VERSION, records });
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

async function readOrigins(path: string): Promise<SessionOriginsFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyOrigins();
    const version = "version" in parsed ? parsed.version : undefined;
    const records = "records" in parsed ? parsed.records : undefined;
    if (version !== SESSION_ORIGINS_VERSION || !Array.isArray(records)) return emptyOrigins();
    return { version: SESSION_ORIGINS_VERSION, records: records.flatMap(parseRecord) };
  } catch {
    return emptyOrigins();
  }
}

function emptyOrigins(): SessionOriginsFile {
  return { version: SESSION_ORIGINS_VERSION, records: [] };
}

function parseRecord(value: unknown): SessionOriginRecord[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const workspaceId = "workspaceId" in value ? value.workspaceId : undefined;
  const sessionId = "sessionId" in value ? value.sessionId : undefined;
  const kind = "kind" in value ? value.kind : undefined;
  const agentId = "agentId" in value ? value.agentId : undefined;
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
    ...(typeof directory === "string" && directory.trim() ? { directory } : {}),
    createdAt,
    updatedAt,
  }];
}

async function writeOrigins(path: string, file: SessionOriginsFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp.${shortId()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
