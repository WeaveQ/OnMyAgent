import type {
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { ApiError } from "../core/errors.js";
import {
  buildExpertDirectory,
  healExpertDirectory,
} from "../services/expert-directory.js";
import { recordExpertLifecycleEvent } from "../services/expert-lifecycle-events.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";

type SessionListResult = {
  scope: "workspace";
  items: unknown[];
  complete: boolean;
  failures: unknown[];
};

export function registerWorkspaceExpertDirectoryRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  listWorkspaceSessions: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    input: { scope: "workspace"; start: number; limit: number; roots: boolean; signal?: AbortSignal },
  ) => Promise<unknown>;
}): void {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    readJsonBody,
    listWorkspaceSessions,
  } = input;

  const readSessions = (workspace: WorkspaceInfo, signal?: AbortSignal) =>
    readWorkspaceSessions(config, workspace, listWorkspaceSessions, signal);

  addRoute(routes, "GET", "/workspace/:id/expert-directory", "client", async (ctx) => {
    requireClientScope(ctx, "viewer");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return systemJsonResponse(await buildExpertDirectory(workspace, {
      signal: ctx.request.signal,
      readSessions: (signal) => readSessions(workspace, signal),
    }));
  });

  addRoute(routes, "POST", "/workspace/:id/expert-directory/shadow-diff", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const payload = parseShadowDiffRequest(body);
    const event = recordExpertLifecycleEvent({
      kind: "shadow_diff",
      phase: "compare",
      outcome: "succeeded",
      workspaceId: workspace.id,
      change: payload.change,
      ...(payload.changedFieldCount === undefined ? {} : { changedFieldCount: payload.changedFieldCount }),
      ...(payload.count === undefined ? {} : { count: payload.count }),
    });
    return systemJsonResponse({ ok: true, event });
  });

  addRoute(routes, "POST", "/workspace/:id/expert-directory/heal", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const request = parseHealRequest(await readJsonBody(ctx.request));
    return systemJsonResponse(await healExpertDirectory(workspace, request, {
      signal: ctx.request.signal,
      readSessions: (signal) => readSessions(workspace, signal),
    }));
  });
}

function parseShadowDiffRequest(body: Record<string, unknown>): {
  change: "added" | "removed" | "changed" | "unchanged";
  changedFieldCount?: number;
  count?: number;
} {
  const allowed = new Set(["change", "changedFieldCount", "count"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) throw new ApiError(400, "invalid_payload", "shadow diff contains unsupported fields");
  const change = body.change;
  if (change !== "added" && change !== "removed" && change !== "changed" && change !== "unchanged") {
    throw new ApiError(400, "invalid_payload", "change must be a supported shadow diff kind");
  }
  const changedFieldCount = readOptionalCount(body.changedFieldCount, "changedFieldCount");
  const count = readOptionalCount(body.count, "count");
  return {
    change,
    ...(changedFieldCount === undefined ? {} : { changedFieldCount }),
    ...(count === undefined ? {} : { count }),
  };
}

function readOptionalCount(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000) {
    throw new ApiError(400, "invalid_payload", `${field} must be a non-negative integer`);
  }
  return value as number;
}

async function readWorkspaceSessions(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  listWorkspaceSessions: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    input: { scope: "workspace"; start: number; limit: number; roots: boolean; signal?: AbortSignal },
  ) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<readonly { id: string; directory?: string }[]> {
  const result = await listWorkspaceSessions(config, workspace, {
    scope: "workspace",
    start: 0,
    limit: 80,
    roots: false,
    signal,
  });
  if (!isSessionListResult(result) || !result.complete) {
    throw new ApiError(503, "session_lookup_failed", "OpenCode session lookup is incomplete");
  }
  return result.items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.id !== "string" || !value.id.trim()) return [];
    return [{
      id: value.id.trim(),
      ...(typeof value.directory === "string" && value.directory.trim()
        ? { directory: value.directory.trim() } : {}),
    }];
  });
}

function parseHealRequest(body: Record<string, unknown>) {
  const apply = readOptionalBoolean(body.apply, "apply");
  const restoreTombstoned = readOptionalBoolean(body.restoreTombstoned, "restoreTombstoned");
  let expectedRevision: number | undefined;
  if (body.expectedRevision !== undefined && body.expectedRevision !== null && body.expectedRevision !== "") {
    const value = typeof body.expectedRevision === "number"
      ? body.expectedRevision
      : Number(body.expectedRevision);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError(400, "session_origins_revision_invalid", "expectedRevision must be a non-negative integer");
    }
    expectedRevision = value;
  }
  return {
    ...(apply !== undefined ? { apply } : {}),
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    ...(restoreTombstoned !== undefined ? { restoreTombstoned } : {}),
  };
}

function readOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new ApiError(400, "invalid_payload", `${field} must be a boolean`);
  return value;
}

function isSessionListResult(value: unknown): value is SessionListResult {
  return Boolean(value && typeof value === "object" &&
    (value as SessionListResult).scope === "workspace" &&
    Array.isArray((value as SessionListResult).items) &&
    typeof (value as SessionListResult).complete === "boolean");
}
