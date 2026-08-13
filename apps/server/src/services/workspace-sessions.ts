import { createHash } from "node:crypto";
import type {
  ServerConfig,
  WorkspaceInfo,
  WorkspaceSessionListFailure,
  WorkspaceSessionListPayload,
} from "@onmyagent/types/server";
import { ApiError, isApiError } from "../core/errors.js";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";
import { getWorkspaceOpencodeClient } from "./opencode-client-pool.js";
import { unwrapOpencodeResult } from "./opencode-proxy.js";
import {
  buildSession,
  buildSessionList,
  buildSessionMessages,
  buildSessionSnapshot,
  buildSessionStatuses,
  buildSessionTodos,
} from "./session-read-model.js";
import type { SessionInfoReadModel } from "./session-read-model.js";
import {
  formatWorkspaceSessionListTiming,
  formatWorkspaceSessionDirectoryTiming,
  assertWorkspaceSessionAggregateWindow,
  MAX_WORKSPACE_SESSION_DIRECTORIES,
  WORKSPACE_SESSION_DIRECTORY_CONCURRENCY,
  normalizeWorkspaceSessionListInput,
  shouldLogSlowWorkspaceSessionDirectory,
  shouldLogSlowWorkspaceSessionList,
  type NormalizedWorkspaceSessionListInput,
  type WorkspaceSessionListInput,
} from "./workspace-session-list-policy.js";
import { getEngine, resolveEngineId } from "../engines/index.js";
import { scanWorkspaceExpertSessionMarkers } from "./workspace-session-marker-inventory.js";

/**
 * Convert pi AgentMessage (flat role/content/timestamp) into the OpenCode
 * session-message read model ({info, parts[]}) consumed by the UI timeline.
 * Parts carry the original shape through passthrough fields.
 */
function convertPiMessages(sessionId: string, messages: unknown[]): unknown[] {
  return (Array.isArray(messages) ? messages : []).map((raw, i) => {
    const msg = (raw ?? {}) as {
      role?: string;
      content?: unknown;
      timestamp?: number | string;
      model?: string;
      provider?: string;
    };
    const role = String(msg.role ?? "");
    const content = Array.isArray(msg.content) ? msg.content : [];
    const messageId = `${sessionId}-m${i}`;
    return {
      info: {
        id: messageId,
        sessionID: sessionId,
        role,
        ...(msg.timestamp
          ? {
              time: {
                created:
                  typeof msg.timestamp === "number"
                    ? msg.timestamp
                    : Date.parse(String(msg.timestamp)) || undefined,
              },
            }
          : {}),
      },
      parts: content.map((part, j: number) => {
        const record = part && typeof part === "object" ? (part as Record<string, unknown>) : {};
        return {
          id: `${messageId}-p${j}`,
          messageID: messageId,
          sessionID: sessionId,
          type: String(record.type ?? "text"),
          ...(typeof record.text === "string" ? { text: record.text } : {}),
          ...(typeof record.thinking === "string" ? { thinking: record.thinking } : {}),
          ...(record.type === "toolCall" ? { toolCall: record } : {}),
        };
      }),
      ...(msg.model ? { model: msg.model } : {}),
      ...(msg.provider ? { provider: msg.provider } : {}),
    };
  });
}

import {
  isSessionNotFoundApiError,
  sessionNotFoundError,
  shouldRetryWorkspaceSessionSnapshot,
} from "./session-snapshot-policy.js";

export type WorkspaceSessionSnapshotReads<
  Session,
  Messages,
  Todos,
  Statuses,
> = {
  session: (signal?: AbortSignal) => Promise<Session>;
  messages: (signal?: AbortSignal) => Promise<Messages>;
  todos: (signal?: AbortSignal) => Promise<Todos>;
  statuses: (signal?: AbortSignal) => Promise<Statuses>;
};

/**
 * Starts all snapshot reads together and gives each one the caller's signal.
 * Kept separate from the OpenCode client so cancellation behavior stays
 * directly testable without an HTTP server or a global fetch override.
 */
export async function readWorkspaceSessionSnapshotReads<
  Session,
  Messages,
  Todos,
  Statuses,
>(
  reads: WorkspaceSessionSnapshotReads<Session, Messages, Todos, Statuses>,
  signal?: AbortSignal,
): Promise<{
  session: Session;
  messages: Messages;
  todos: Todos;
  statuses: Statuses;
}> {
  const [session, messages, todos, statuses] = await Promise.all([
    reads.session(signal),
    reads.messages(signal),
    reads.todos(signal),
    reads.statuses(signal),
  ]);
  return { session, messages, todos, statuses };
}

function remapSessionReadError(error: unknown): never {
  if (isApiError(error) && error.code === "opencode_request_failed") {
    const details = error.details;
    const upstreamStatus =
      details && typeof details === "object" && "status" in details
        ? Number((details as { status?: unknown }).status)
        : NaN;
    if (upstreamStatus === 400) {
      throw new ApiError(
        400,
        "invalid_query",
        "OpenCode rejected the session read request",
        details,
      );
    }
    if (upstreamStatus === 404) {
      throw sessionNotFoundError(details);
    }
  }
  throw error;
}

export async function listWorkspaceSessions(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  input: WorkspaceSessionListInput & { signal?: AbortSignal },
) {
  const started = performance.now();
  const normalized = normalizeWorkspaceSessionListInput(input);
  // Pi engine: enumerate the managed --session-dir instead of OpenCode.
  if (resolveEngineId(config, workspace) === "pi") {
    const engine = getEngine(config, workspace);
    const sessions = await engine.listSessions();
    const items = buildSessionList(
      sessions.map((s) => ({
        id: s.id,
        ...(s.title ? { title: s.title } : {}),
        ...(s.updatedAt ? { time: { updated: Date.parse(s.updatedAt) || undefined } } : {}),
        ...(s.directory ? { directory: s.directory } : {}),
      })) as Parameters<typeof buildSessionList>[0],
    );
    return items;
  }
  assertWorkspaceSessionAggregateWindow(normalized);
  if (normalized.scope === "workspace") {
    return listWorkspaceSessionsAggregated(config, workspace, normalized, input.signal);
  }
  try {
    const connection = resolveWorkspaceOpencodeConnection(config, workspace);
    if (!connection.baseUrl?.trim()) {
      return [];
    }
    const opencode = getWorkspaceOpencodeClient(
      config,
      workspace,
      normalized.directory,
    );
    const items = buildSessionList(
      unwrapOpencodeResult(
        await opencode.session.list(
          {
            roots: normalized.roots,
            start: normalized.start,
            search: normalized.search,
            limit: normalized.limit,
          },
          { signal: input.signal },
        ),
        "/session",
      ),
    );
    const durationMs = performance.now() - started;
    if (shouldLogSlowWorkspaceSessionList(durationMs)) {
      console.info(
        formatWorkspaceSessionListTiming({
          workspaceId: workspace.id,
          durationMs,
          limit: normalized.limit,
          itemCount: items.length,
          roots: normalized.roots,
          search: Boolean(normalized.search),
        }),
      );
    }
    return items;
  } catch (error) {
    remapSessionReadError(error);
  }
}

export type WorkspaceSessionAggregateSource = {
  directory: string;
  source: "workspace-root" | "expert-runtime";
  key: string;
  index: number;
};

export type WorkspaceSessionAggregateReadInput = {
  directory: string;
  roots?: boolean;
  start: number;
  search?: string;
  limit: number;
  signal?: AbortSignal;
};

/**
 * Aggregate already-authorized source directories with bounded fan-out.
 * Kept injectable so pagination, dedupe, abort, and concurrency remain unit-testable.
 */
export async function aggregateWorkspaceSessionLists(input: {
  sources: readonly WorkspaceSessionAggregateSource[];
  normalized: NormalizedWorkspaceSessionListInput;
  initialFailures?: readonly WorkspaceSessionListFailure[];
  signal?: AbortSignal;
  read: (
    source: WorkspaceSessionAggregateSource,
    request: WorkspaceSessionAggregateReadInput,
  ) => Promise<SessionInfoReadModel[]>;
}): Promise<WorkspaceSessionListPayload> {
  assertWorkspaceSessionAggregateWindow(input.normalized);
  throwIfAborted(input.signal);
  const start = input.normalized.start ?? 0;
  const window = start + input.normalized.limit;
  const results: SessionInfoReadModel[][] = [];
  const failures: WorkspaceSessionListFailure[] = [
    ...(input.initialFailures ?? []),
  ];
  let cursor = 0;

  const worker = async () => {
    while (true) {
      throwIfAborted(input.signal);
      const sourceIndex = cursor;
      cursor += 1;
      const source = input.sources[sourceIndex];
      if (!source) return;
      const started = performance.now();
      try {
        const items = await input.read(source, {
          directory: source.directory,
          roots: input.normalized.roots,
          start: 0,
          ...(input.normalized.search ? { search: input.normalized.search } : {}),
          limit: window,
          signal: input.signal,
        });
        results[sourceIndex] = items.slice(0, window);
        const durationMs = performance.now() - started;
        if (shouldLogSlowWorkspaceSessionDirectory(durationMs)) {
          console.info(
            formatWorkspaceSessionDirectoryTiming({
              source: source.source,
              key: redactSourceKey(source.key),
              index: source.index,
              durationMs,
              itemCount: results[sourceIndex].length,
            }),
          );
        }
      } catch (error) {
        if (isAbortError(error) || input.signal?.aborted) throw error;
        failures.push({
          source: source.source,
          key: redactSourceKey(source.key),
          index: source.index,
          code: "directory_read_failed",
        });
        results[sourceIndex] = [];
      }
    }
  };

  const workerCount = Math.min(WORKSPACE_SESSION_DIRECTORY_CONCURRENCY, input.sources.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  throwIfAborted(input.signal);

  const byId = new Map<string, { item: SessionInfoReadModel; sourceIndex: number }>();
  for (const [sourceIndex, items] of results.entries()) {
    for (const item of items ?? []) {
      if (!item.id) continue;
      const existing = byId.get(item.id);
      if (!existing || isNewerSession(item, existing.item, sourceIndex, existing.sourceIndex)) {
        byId.set(item.id, { item, sourceIndex });
      }
    }
  }
  const items = Array.from(byId.values())
    .sort((left, right) => compareSessions(left.item, right.item, left.sourceIndex, right.sourceIndex))
    .slice(start, window)
    .map(({ item }) => item);
  failures.sort((left, right) => left.index - right.index || left.key.localeCompare(right.key));
  return {
    scope: "workspace",
    items,
    complete: failures.length === 0,
    failures,
  };
}

export async function listWorkspaceSessionsAggregated(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  normalized: NormalizedWorkspaceSessionListInput,
  signal?: AbortSignal,
): Promise<WorkspaceSessionListPayload> {
  const inventory = await scanWorkspaceExpertSessionMarkers({
    workspace,
    signal,
    maxDirectories: MAX_WORKSPACE_SESSION_DIRECTORIES,
  });
  // Workspace scope always starts at the routed workspace root. The legacy
  // `directory` override belongs only to directory scope; honoring it here
  // could replace the root source with an arbitrary client-provided path.
  const rootDirectory = workspace.directory?.trim() || workspace.path;
  const seenDirectories = new Set<string>([rootDirectory]);
  const sources: WorkspaceSessionAggregateSource[] = [
    {
      directory: rootDirectory,
      source: "workspace-root",
      key: redactSourceKey("workspace-root"),
      index: 0,
    },
    ...inventory.entries.flatMap((entry, index) => {
      if (seenDirectories.has(entry.directory)) return [];
      seenDirectories.add(entry.directory);
      return [{
        directory: entry.directory,
        source: "expert-runtime" as const,
        key: entry.key,
        index: index + 1,
      }];
    }),
  ];
  return aggregateWorkspaceSessionLists({
    sources,
    normalized,
    initialFailures: inventory.failures,
    signal,
    read: async (source, request) => {
      const connection = resolveWorkspaceOpencodeConnection(config, workspace);
      if (!connection.baseUrl?.trim()) {
        throw new ApiError(503, "opencode_unavailable", "OpenCode base URL is not configured");
      }
      const opencode = getWorkspaceOpencodeClient(config, workspace, request.directory);
      try {
        return buildSessionList(
          unwrapOpencodeResult(
            await opencode.session.list(
              {
                roots: request.roots,
                start: request.start,
                search: request.search,
                limit: request.limit,
              },
              { signal: request.signal },
            ),
            "/session",
          ),
        );
      } catch (error) {
        remapSessionReadError(error);
      }
    },
  });
}

function isNewerSession(
  candidate: SessionInfoReadModel,
  existing: SessionInfoReadModel,
  candidateSourceIndex: number,
  existingSourceIndex: number,
): boolean {
  const candidateUpdated = sessionUpdatedAt(candidate);
  const existingUpdated = sessionUpdatedAt(existing);
  return candidateUpdated > existingUpdated ||
    (candidateUpdated === existingUpdated && candidateSourceIndex < existingSourceIndex);
}

function compareSessions(
  left: SessionInfoReadModel,
  right: SessionInfoReadModel,
  leftSourceIndex: number,
  rightSourceIndex: number,
): number {
  const byUpdated = sessionUpdatedAt(right) - sessionUpdatedAt(left);
  if (byUpdated !== 0) return byUpdated;
  const byId = left.id.localeCompare(right.id);
  return byId !== 0 ? byId : leftSourceIndex - rightSourceIndex;
}

function sessionUpdatedAt(item: SessionInfoReadModel): number {
  return typeof item.time?.updated === "number" && Number.isFinite(item.time.updated)
    ? item.time.updated
    : 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function redactSourceKey(value: string): string {
  if (value === "root" || /^[a-f0-9]{12}$/.test(value)) return value;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export async function readWorkspaceSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  directory?: string,
  signal?: AbortSignal,
) {
  try {
    const opencode = getWorkspaceOpencodeClient(config, workspace, directory);
    return buildSession(
      unwrapOpencodeResult(
        await opencode.session.get({ sessionID: sessionId }, { signal }),
        `/session/${encodeURIComponent(sessionId)}`,
      ),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

export async function readWorkspaceSessionMessages(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: { limit?: number; directory?: string; signal?: AbortSignal },
) {
  // Pi engine: messages come from the managed RPC session.
  if (resolveEngineId(config, workspace) === "pi") {
    const engine = getEngine(config, workspace);
    const messages = await engine.getMessages(sessionId);
    return buildSessionMessages(convertPiMessages(sessionId, messages) as never);
  }
  try {
    const opencode = getWorkspaceOpencodeClient(config, workspace, input.directory);
    return buildSessionMessages(
      unwrapOpencodeResult(
        await opencode.session.messages(
          {
            sessionID: sessionId,
            limit: input.limit,
          },
          { signal: input.signal },
        ),
        `/session/${encodeURIComponent(sessionId)}/message`,
      ),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

export async function readWorkspaceSessionTodos(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  signal?: AbortSignal,
) {
  try {
    const opencode = getWorkspaceOpencodeClient(config, workspace);
    return buildSessionTodos(
      unwrapOpencodeResult(
        await opencode.session.todo({ sessionID: sessionId }, { signal }),
        `/session/${encodeURIComponent(sessionId)}/todo`,
      ),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

export async function readWorkspaceSessionStatuses(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  signal?: AbortSignal,
) {
  try {
    const opencode = getWorkspaceOpencodeClient(config, workspace);
    return buildSessionStatuses(
      unwrapOpencodeResult(
        await opencode.session.status(undefined, { signal }),
        "/session/status",
      ),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

export async function readWorkspaceSessionSnapshot(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: { limit?: number; directory?: string; signal?: AbortSignal },
) {
  // Pi engine: build the snapshot from the managed RPC session.
  if (resolveEngineId(config, workspace) === "pi") {
    const engine = getEngine(config, workspace);
    const snapshot = await readWorkspaceSessionSnapshotReads(
      {
        session: () =>
          engine.getSession(sessionId).then((s) => ({ id: s.id, ...(s.title ? { title: s.title } : {}) })),
        messages: () => engine.getMessages(sessionId).then((msgs) => convertPiMessages(sessionId, msgs)),
        todos: () => Promise.resolve([]),
        statuses: () => Promise.resolve({}),
      },
      input.signal,
    );
    return buildSessionSnapshot(snapshot as never);
  }
  try {
    const opencode = getWorkspaceOpencodeClient(config, workspace, input.directory);
    const snapshot = await readWorkspaceSessionSnapshotReads(
      {
        session: (signal) =>
          opencode.session
            .get({ sessionID: sessionId }, { signal })
            .then((result) =>
              unwrapOpencodeResult(
                result,
                `/session/${encodeURIComponent(sessionId)}`,
              ),
            ),
        messages: (signal) =>
          opencode.session
            .messages(
              { sessionID: sessionId, limit: input.limit },
              { signal },
            )
            .then((result) =>
              unwrapOpencodeResult(
                result,
                `/session/${encodeURIComponent(sessionId)}/message`,
              ),
            ),
        todos: (signal) =>
          opencode.session
            .todo({ sessionID: sessionId }, { signal })
            .then((result) =>
              unwrapOpencodeResult(
                result,
                `/session/${encodeURIComponent(sessionId)}/todo`,
              ),
            ),
        statuses: (signal) =>
          opencode.session
            .status(undefined, { signal })
            .then((result) => unwrapOpencodeResult(result, "/session/status")),
      },
      input.signal,
    );
    return buildSessionSnapshot(snapshot);
  } catch (error) {
    try {
      remapSessionReadError(error);
    } catch (mapped) {
      // Terminal missing-session errors: no server-side retry of this snapshot id.
      if (
        isSessionNotFoundApiError(mapped) ||
        !shouldRetryWorkspaceSessionSnapshot(mapped)
      ) {
        throw mapped;
      }
      throw mapped;
    }
  }
}

export async function deleteWorkspaceSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  directory?: string,
): Promise<void> {
  // Pi engine: stop the process (if live) and remove the managed JSONL file.
  if (resolveEngineId(config, workspace) === "pi") {
    const engine = getEngine(config, workspace);
    await engine.deleteSession(sessionId);
    return;
  }
  const opencode = getWorkspaceOpencodeClient(config, workspace, directory);
  try {
    unwrapOpencodeResult(
      await opencode.session.delete({ sessionID: sessionId }),
      `/session/${encodeURIComponent(sessionId)}`,
    );
  } catch (error) {
    // Idempotent delete: sidebar/automation lists can retain rows whose
    // OpenCode session is already gone (snapshot 404) or engine is wedged.
    // Treat as success so "删除任务/会话" can finish local cleanup.
    if (error instanceof ApiError && error.code === "opencode_request_failed") {
      const details = error.details;
      const upstreamStatus =
        details && typeof details === "object" && "status" in details
          ? Number((details as { status?: unknown }).status)
          : NaN;
      if (
        upstreamStatus === 404 ||
        upstreamStatus === 400 ||
        upstreamStatus === 408 ||
        upstreamStatus === 410 ||
        upstreamStatus === 502 ||
        upstreamStatus === 503 ||
        upstreamStatus === 504
      ) {
        return;
      }
      const detailMessage =
        details && typeof details === "object" && "message" in details
          ? String((details as { message?: unknown }).message ?? "")
          : "";
      if (
        /not found|session_not_found|timeout|timed out|empty response/i.test(
          `${error.message} ${detailMessage}`,
        )
      ) {
        return;
      }
    }
    if (error instanceof ApiError && error.code === "opencode_empty_response") {
      // Some OpenCode builds return empty body on successful delete.
      return;
    }
    // Network / abort style failures from the OpenCode client layer.
    if (
      error instanceof Error &&
      /timeout|timed out|abort|econnrefused|econnreset|fetch failed|network/i.test(
        error.message,
      )
    ) {
      return;
    }
    throw error;
  }
}
