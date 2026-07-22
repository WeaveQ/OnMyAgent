import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
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

function remapSessionReadError(error: unknown): never {
  if (error instanceof ApiError && error.code === "opencode_request_failed") {
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
      throw new ApiError(
        404,
        "session_not_found",
        "Session not found",
        details,
      );
    }
  }
  throw error;
}

export async function listWorkspaceSessions(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  input: { roots?: boolean; start?: number; search?: string; limit?: number; directory?: string },
) {
  try {
    const connection = resolveWorkspaceOpencodeConnection(config, workspace);
    if (!connection.baseUrl?.trim()) {
      return [];
    }
    const opencode = getWorkspaceOpencodeClient(config, workspace, input.directory);
    return buildSessionList(
      unwrapOpencodeResult(
        await opencode.session.list({
          roots: input.roots,
          start: input.start,
          search: input.search,
          limit: input.limit,
        }),
        "/session",
      ),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

export async function readWorkspaceSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  directory?: string,
) {
  try {
    const opencode = getWorkspaceOpencodeClient(config, workspace, directory);
    return buildSession(
      unwrapOpencodeResult(
        await opencode.session.get({ sessionID: sessionId }),
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
  input: { limit?: number; directory?: string },
) {
  try {
    const opencode = getWorkspaceOpencodeClient(config, workspace, input.directory);
    return buildSessionMessages(
      unwrapOpencodeResult(
        await opencode.session.messages({
          sessionID: sessionId,
          limit: input.limit,
        }),
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
) {
  try {
    const opencode = getWorkspaceOpencodeClient(config, workspace);
    return buildSessionTodos(
      unwrapOpencodeResult(
        await opencode.session.todo({ sessionID: sessionId }),
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
) {
  try {
    const opencode = getWorkspaceOpencodeClient(config, workspace);
    return buildSessionStatuses(
      unwrapOpencodeResult(await opencode.session.status(), "/session/status"),
    );
  } catch (error) {
    remapSessionReadError(error);
  }
}

export async function readWorkspaceSessionSnapshot(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  input: { limit?: number; directory?: string },
) {
  try {
    const opencode = getWorkspaceOpencodeClient(config, workspace, input.directory);
    const [session, messages, todos, statuses] = await Promise.all([
      opencode.session
        .get({ sessionID: sessionId })
        .then((result) =>
          unwrapOpencodeResult(
            result,
            `/session/${encodeURIComponent(sessionId)}`,
          ),
        ),
      opencode.session
        .messages({ sessionID: sessionId, limit: input.limit })
        .then((result) =>
          unwrapOpencodeResult(
            result,
            `/session/${encodeURIComponent(sessionId)}/message`,
          ),
        ),
      opencode.session
        .todo({ sessionID: sessionId })
        .then((result) =>
          unwrapOpencodeResult(
            result,
            `/session/${encodeURIComponent(sessionId)}/todo`,
          ),
        ),
      opencode.session
        .status()
        .then((result) => unwrapOpencodeResult(result, "/session/status")),
    ]);
    return buildSessionSnapshot({ session, messages, todos, statuses });
  } catch (error) {
    remapSessionReadError(error);
  }
}

export async function deleteWorkspaceSession(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  directory?: string,
): Promise<void> {
  const opencode = getWorkspaceOpencodeClient(config, workspace, directory);
  unwrapOpencodeResult(
    await opencode.session.delete({ sessionID: sessionId }),
    `/session/${encodeURIComponent(sessionId)}`,
  );
}
