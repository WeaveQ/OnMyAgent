import type {
  ApprovalRequest,
  ReloadTrigger,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { recordAudit } from "../services/audit.js";
import {
  addPlugin,
  listPlugins,
  normalizePluginSpec,
  removePlugin,
} from "../services/plugins.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import { shortId } from "../core/utils.js";

export function registerPluginRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  requireApproval: (
    ctx: RequestContext,
    input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  ) => Promise<void>;
  emitReloadEvent: (
    reloadEvents: RequestContext["reloadEvents"],
    workspace: WorkspaceInfo,
    reason: "plugins",
    trigger?: ReloadTrigger,
  ) => void;
  opencodeConfigPath: (workspaceRoot: string) => string;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    requireApproval,
    emitReloadEvent,
    opencodeConfigPath,
    readJsonBody,
  } = input;

  addRoute(routes, "GET", "/workspace/:id/plugins", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const includeGlobal = ctx.url.searchParams.get("includeGlobal") === "true";
    const result = await listPlugins(workspace.path, includeGlobal);
    return systemJsonResponse(result);
  });

  addRoute(routes, "POST", "/workspace/:id/plugins", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const spec = String(body.spec ?? "");
    const normalized = normalizePluginSpec(spec);
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "plugins.add",
      summary: `Add plugin ${spec}`,
      paths: [opencodeConfigPath(workspace.path)],
    });
    const changed = await addPlugin(workspace.path, spec);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "plugins.add",
      target: "opencode.json",
      summary: `Added ${spec}`,
      timestamp: Date.now(),
    });
    if (changed) {
      emitReloadEvent(ctx.reloadEvents, workspace, "plugins", {
        type: "plugin",
        name: normalized,
        action: "added",
      });
    }
    const result = await listPlugins(workspace.path, false);
    return systemJsonResponse(result);
  });

  addRoute(
    routes,
    "DELETE",
    "/workspace/:id/plugins/:name",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const name = ctx.params.name ?? "";
      const normalized = normalizePluginSpec(name);
      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "plugins.remove",
        summary: `Remove plugin ${name}`,
        paths: [opencodeConfigPath(workspace.path)],
      });
      const removed = await removePlugin(workspace.path, name);
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "plugins.remove",
        target: "opencode.json",
        summary: `Removed ${name}`,
        timestamp: Date.now(),
      });
      if (removed) {
        emitReloadEvent(ctx.reloadEvents, workspace, "plugins", {
          type: "plugin",
          name: normalized,
          action: "removed",
        });
      }
      const result = await listPlugins(workspace.path, false);
      return systemJsonResponse(result);
    },
  );
}
