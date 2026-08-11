import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { nodeReadableToWebStream } from "../core/node-web-stream.js";
import {
  createExpertSessionRuntimeDirectory,
  ensureExpertSessionRuntimeIsolation,
  listExpertSessionRuntimeFiles,
  resolveExpertSessionRuntimeFile,
} from "../services/expert-session-runtime.js";
import { deleteSessionOrigin } from "../services/session-origins.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import {
  contentDispositionHeader,
  contentTypeForPath,
  isSupportedWorkspaceTextFilePath,
} from "../workspace/path-utils.js";

type SessionListInput = {
  roots?: boolean;
  start?: number;
  search?: string;
  limit?: number;
  directory?: string;
  signal?: AbortSignal;
};

type SessionMessagesInput = {
  limit?: number;
  directory?: string;
  signal?: AbortSignal;
};

export function registerWorkspaceSessionRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  listWorkspaceSessions: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    input: SessionListInput,
  ) => Promise<unknown>;
  readWorkspaceSession: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    sessionId: string,
    directory?: string,
    signal?: AbortSignal,
  ) => Promise<unknown>;
  readWorkspaceSessionMessages: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    sessionId: string,
    input: SessionMessagesInput,
  ) => Promise<unknown>;
  readWorkspaceSessionSnapshot: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    sessionId: string,
    input: SessionMessagesInput,
  ) => Promise<unknown>;
  deleteWorkspaceSession: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    sessionId: string,
    directory?: string,
  ) => Promise<void>;
}) {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    readJsonBody,
    listWorkspaceSessions,
    readWorkspaceSession,
    readWorkspaceSessionMessages,
    readWorkspaceSessionSnapshot,
    deleteWorkspaceSession,
  } = input;

  addRoute(
    routes,
    "POST",
    "/workspace/:id/expert-session-directory",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const body = await readJsonBody(ctx.request);
      const agentName = typeof body.agentName === "string" ? body.agentName.trim() : "";
      if (!agentName) {
        throw new ApiError(400, "expert_agent_name_required", "Expert agent name is required");
      }
      const skillNames = Array.isArray(body.skillNames)
        ? body.skillNames.filter((item: unknown): item is string => typeof item === "string")
        : undefined;
      const result = await createExpertSessionRuntimeDirectory({
        workspace,
        agentName,
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        sessionKey: typeof body.sessionKey === "string" ? body.sessionKey : undefined,
        skillNames,
      });
      return systemJsonResponse({ ok: true, ...result }, 201);
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/expert-session-isolation",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const body = await readJsonBody(ctx.request);
      const directory = typeof body.directory === "string" ? body.directory.trim() : "";
      if (!directory) {
        throw new ApiError(400, "expert_session_directory_required", "Expert session directory is required");
      }
      const skillNames = Array.isArray(body.skillNames)
        ? body.skillNames.filter((item: unknown): item is string => typeof item === "string")
        : undefined;
      const result = await ensureExpertSessionRuntimeIsolation({
        workspace,
        directory,
        skillNames,
      });
      if (!result) {
        throw new ApiError(
          403,
          "expert_session_directory_forbidden",
          "Directory is not a managed expert session for this workspace",
        );
      }
      return systemJsonResponse({ ok: true, ...result });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/expert-session-files",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const items = await listExpertSessionRuntimeFiles({ workspace });
      return systemJsonResponse({ items });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/expert-session-files/content",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const relPath = (ctx.url.searchParams.get("path") ?? "").trim();
      if (!isSupportedWorkspaceTextFilePath(relPath)) {
        throw new ApiError(400, "invalid_path", "Only supported text artifact files can be read inline");
      }
      const resolved = await resolveExpertSessionRuntimeFile({ workspace, relPath });
      if (!resolved) throw new ApiError(404, "file_not_found", "File not found");
      if (resolved.size > 8 * 1024 * 1024) {
        throw new ApiError(413, "file_too_large", "File exceeds size limit");
      }
      const content = await readFile(resolved.absPath, "utf8");
      return systemJsonResponse({
        path: relPath,
        content,
        bytes: resolved.size,
        updatedAt: resolved.mtimeMs,
      });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/expert-session-files/raw",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const relPath = (ctx.url.searchParams.get("path") ?? "").trim();
      const resolved = await resolveExpertSessionRuntimeFile({ workspace, relPath });
      if (!resolved) throw new ApiError(404, "file_not_found", "File not found");
      const headers = new Headers();
      headers.set("Content-Type", contentTypeForPath(relPath));
      headers.set("Content-Length", String(resolved.size));
      headers.set("Content-Disposition", contentDispositionHeader("inline", relPath));
      const stream = nodeReadableToWebStream(createReadStream(resolved.absPath));
      return new Response(stream, { status: 200, headers });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/expert-session-files/resolve",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const relPath = (ctx.url.searchParams.get("path") ?? "").trim();
      const resolved = await resolveExpertSessionRuntimeFile({ workspace, relPath });
      if (!resolved) throw new ApiError(404, "file_not_found", "File not found");
      return systemJsonResponse({
        absolutePath: resolved.absPath,
        size: resolved.size,
        updatedAt: resolved.mtimeMs,
      });
    },
  );

  addRoute(routes, "GET", "/workspace/:id/sessions", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const items = await listWorkspaceSessions(config, workspace, {
      roots: parseOptionalBoolean(ctx.url.searchParams.get("roots"), "roots"),
      start: parseOptionalNonNegativeInteger(
        ctx.url.searchParams.get("start"),
        "start",
      ),
      search: ctx.url.searchParams.get("search")?.trim() || undefined,
      limit: parseOptionalPositiveInteger(
        ctx.url.searchParams.get("limit"),
        "limit",
      ),
      directory: ctx.url.searchParams.get("directory")?.trim() || undefined,
      signal: ctx.request.signal,
    });
    return systemJsonResponse({ items });
  });

  addRoute(
    routes,
    "GET",
    "/workspace/:id/sessions/:sessionId",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const sessionId = readSessionId(ctx);
      const item = await readWorkspaceSession(
        config,
        workspace,
        sessionId,
        ctx.url.searchParams.get("directory")?.trim() || undefined,
        ctx.request.signal,
      );
      return systemJsonResponse({ item });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/sessions/:sessionId/messages",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const sessionId = readSessionId(ctx);
      const items = await readWorkspaceSessionMessages(
        config,
        workspace,
        sessionId,
        {
          limit: parseOptionalPositiveInteger(
            ctx.url.searchParams.get("limit"),
            "limit",
          ),
          directory: ctx.url.searchParams.get("directory")?.trim() || undefined,
          signal: ctx.request.signal,
        },
      );
      return systemJsonResponse({ items });
    },
  );

  addRoute(
    routes,
    "GET",
    "/workspace/:id/sessions/:sessionId/snapshot",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const sessionId = readSessionId(ctx);
      const item = await readWorkspaceSessionSnapshot(
        config,
        workspace,
        sessionId,
        {
          limit: parseOptionalPositiveInteger(
            ctx.url.searchParams.get("limit"),
            "limit",
          ),
          directory: ctx.url.searchParams.get("directory")?.trim() || undefined,
          signal: ctx.request.signal,
        },
      );
      return systemJsonResponse({ item });
    },
  );

  addRoute(
    routes,
    "DELETE",
    "/workspace/:id/sessions/:sessionId",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const sessionId = readSessionId(ctx);
      await deleteWorkspaceSession(
        config,
        workspace,
        sessionId,
        ctx.url.searchParams.get("directory")?.trim() || undefined,
      );
      // deleteWorkspaceSession already treats OpenCode's defined missing/empty
      // responses as idempotent success. Do not remove identity metadata when
      // an upstream delete actually failed.
      await deleteSessionOrigin(workspace, sessionId).catch((error) => {
        console.warn("[session-origin] delete cleanup failed", sessionId, error);
      });
      return systemJsonResponse({ ok: true });
    },
  );
}

function readSessionId(ctx: RequestContext): string {
  const sessionId = (ctx.params.sessionId ?? "").trim();
  if (!sessionId) {
    throw new ApiError(400, "invalid_payload", "sessionId is required");
  }
  return sessionId;
}

function parseOptionalPositiveInteger(
  value: string | null,
  name: string,
): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(400, "invalid_query", `${name} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(
  value: string | null,
  name: string,
): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(
      400,
      "invalid_query",
      `${name} must be a non-negative integer`,
    );
  }
  return parsed;
}

function parseOptionalBoolean(
  value: string | null,
  name: string,
): boolean | undefined {
  if (value == null || value.trim() === "") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ApiError(400, "invalid_query", `${name} must be a boolean`);
}
