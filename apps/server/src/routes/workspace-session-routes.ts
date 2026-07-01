import type { ServerConfig, TokenScope, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";

type SessionListInput = {
  roots?: boolean;
  start?: number;
  search?: string;
  limit?: number;
  directory?: string;
};

type SessionMessagesInput = {
  limit?: number;
  directory?: string;
};

export function registerWorkspaceSessionRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
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
    listWorkspaceSessions,
    readWorkspaceSession,
    readWorkspaceSessionMessages,
    readWorkspaceSessionSnapshot,
    deleteWorkspaceSession,
  } = input;

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
