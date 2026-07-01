import type { ServerConfig, TokenScope, WorkspaceInfo } from "@onmyagent/types/server";
import { recordAudit } from "../services/audit.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import { shortId } from "../core/utils.js";

export type BlueprintMaterializeResult = {
  ok: boolean;
  created: Array<{ templateId: string; sessionId: string; title: string }>;
  existing: Array<{ templateId: string; sessionId: string }>;
  openSessionId: string | null;
};

export function registerWorkspaceBlueprintRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  materializeBlueprintSessions: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
  ) => Promise<BlueprintMaterializeResult>;
}) {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    materializeBlueprintSessions,
  } = input;

  addRoute(
    routes,
    "POST",
    "/workspace/:id/blueprint/sessions/materialize",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const result = await materializeBlueprintSessions(config, workspace);
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "blueprint.sessions.materialize",
        target: "workspace",
        summary: result.created.length
          ? `Materialized ${result.created.length} template starter session${result.created.length === 1 ? "" : "s"}`
          : "Checked template starter sessions",
        timestamp: Date.now(),
      });
      return systemJsonResponse(result);
    },
  );
}
