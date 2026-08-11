import type {
  ExpertDeleteRequest,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import {
  deleteExpertSessions,
  type ExpertDeleteSagaOptions,
} from "../services/expert-delete-saga.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";

export function registerWorkspaceExpertDeleteRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  deleteExpertSessions?: typeof deleteExpertSessions;
  sagaOptions?: ExpertDeleteSagaOptions;
}): void {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    readJsonBody,
  } = input;
  addRoute(routes, "POST", "/workspace/:id/expert-delete", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const request = parseDeleteRequest(await readJsonBody(ctx.request));
    const result = await (input.deleteExpertSessions ?? deleteExpertSessions)(
      config,
      workspace,
      request,
      { ...input.sagaOptions, signal: ctx.request.signal },
    );
    return systemJsonResponse(result);
  });
}

function parseDeleteRequest(body: Record<string, unknown>): ExpertDeleteRequest {
  const operationId = readRequiredString(body.operationId, "operationId");
  const agentId = readRequiredString(body.agentId, "agentId");
  const packageName = readRequiredString(body.packageName, "packageName");
  const marketplace = body.marketplace;
  if (marketplace !== "my-experts" && marketplace !== "experts") {
    throw new ApiError(400, "invalid_payload", "marketplace must be my-experts or experts");
  }
  let sessionIds: string[] | undefined;
  if (body.sessionIds !== undefined) {
    if (!Array.isArray(body.sessionIds) || body.sessionIds.some((value) => typeof value !== "string")) {
      throw new ApiError(400, "invalid_payload", "sessionIds must be strings");
    }
    sessionIds = body.sessionIds.map((value) => value.trim()).filter(Boolean);
  }
  let expectedRevision: number | undefined;
  if (body.expectedRevision !== undefined && body.expectedRevision !== null && body.expectedRevision !== "") {
    const value = typeof body.expectedRevision === "number" ? body.expectedRevision : Number(body.expectedRevision);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError(400, "session_origins_revision_invalid", "expectedRevision must be a non-negative integer");
    }
    expectedRevision = value;
  }
  return {
    operationId,
    agentId,
    packageName,
    marketplace,
    ...(sessionIds !== undefined ? { sessionIds } : {}),
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
  };
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 160) {
    throw new ApiError(400, "invalid_payload", `${field} is required`);
  }
  return value.trim();
}
