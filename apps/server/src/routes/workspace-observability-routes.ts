import type { ServerConfig, TokenScope, WorkspaceInfo } from "@onmyagent/types/server";
import { readAuditEntries, recordAudit } from "../services/audit.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import { shortId } from "../core/utils.js";

export function registerWorkspaceObservabilityRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  reloadOpencodeEngine: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
  ) => Promise<void>;
}) {
  const {
    routes,
    config,
    resolveWorkspace,
    requireClientScope,
    reloadOpencodeEngine,
  } = input;

  addRoute(routes, "GET", "/workspace/:id/audit", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const limitParam = ctx.url.searchParams.get("limit");
    const parsed = limitParam ? Number(limitParam) : NaN;
    const limit =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
    const items = await readAuditEntries(workspace.path, workspace.id, limit);
    return systemJsonResponse({ items });
  });

  addRoute(routes, "GET", "/workspace/:id/events", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sinceRaw = ctx.url.searchParams.get("since");
    const since = sinceRaw ? Number(sinceRaw) : undefined;
    const items = ctx.reloadEvents.list(workspace.id, since);
    return systemJsonResponse({
      items,
      cursor: ctx.reloadEvents.cursor(),
      workspaceId: workspace.id,
      disabled: false,
    });
  });

  addRoute(
    routes,
    "POST",
    "/workspace/:id/engine/reload",
    "client",
    async (ctx) => {
      const workspace = await resolveWorkspace(config, ctx.params.id);
      requireClientScope(ctx, "collaborator");

      await reloadOpencodeEngine(config, workspace);

      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "engine.reload",
        target: workspace.baseUrl ?? "opencode",
        summary: "Reloaded workspace engine",
        timestamp: Date.now(),
      });

      return systemJsonResponse({ ok: true, reloadedAt: Date.now() });
    },
  );
}
