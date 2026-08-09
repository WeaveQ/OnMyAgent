import type { ServerConfig, SessionOriginUpsertPayload, TokenScope, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import { deleteSessionOrigin, listSessionOrigins, upsertSessionOrigin } from "../services/session-origins.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";

export function registerWorkspaceSessionOriginRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const { routes, config, ensureWritable, requireClientScope, resolveWorkspace, readJsonBody } = input;

  addRoute(routes, "GET", "/workspace/:id/session-origins", "client", async (ctx) => {
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return systemJsonResponse(await listSessionOrigins(workspace));
  });

  addRoute(routes, "PUT", "/workspace/:id/session-origins/:sessionId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = readSessionId(ctx);
    const payload = parseUpsertPayload(await readJsonBody(ctx.request));
    return systemJsonResponse({ item: await upsertSessionOrigin(workspace, sessionId, payload) });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-origins/:sessionId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    await deleteSessionOrigin(workspace, readSessionId(ctx));
    return systemJsonResponse({ ok: true });
  });
}

function readSessionId(ctx: RequestContext): string {
  const value = (ctx.params.sessionId ?? "").trim();
  if (!value) throw new ApiError(400, "invalid_payload", "sessionId is required");
  return value;
}

function parseUpsertPayload(body: Record<string, unknown>): SessionOriginUpsertPayload {
  const kind = body.kind;
  if (kind !== "assistant" && kind !== "expert" && kind !== "automation") {
    throw new ApiError(400, "invalid_payload", "kind must be assistant, expert, or automation");
  }
  return {
    kind,
    ...(typeof body.agentId === "string" ? { agentId: body.agentId } : {}),
    ...(typeof body.directory === "string" ? { directory: body.directory } : {}),
  };
}
