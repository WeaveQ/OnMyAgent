import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { buildCapabilities } from "../core/capabilities.js";
import { addRoute, systemJsonResponse, type Route } from "./route-core.js";

export function registerSystemRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  serverVersion: string;
  opencodeVersion: string;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  serializeWorkspace: (workspace: ServerConfig["workspaces"][number]) => unknown;
}) {
  const { routes, config, serverVersion, opencodeVersion, resolveWorkspace, serializeWorkspace } = input;
  const capabilities = () => buildCapabilities({ config, serverVersion, opencodeVersion });
  const statusPayload = (workspace?: WorkspaceInfo | null) => ({
    ok: true,
    version: serverVersion,
    opencodeVersion,
    uptimeMs: Date.now() - config.startedAt,
    readOnly: config.readOnly,
    approval: config.approval,
    corsOrigins: config.corsOrigins,
    workspaceCount: workspace ? 1 : config.workspaces.length,
    activeWorkspaceId: workspace ? workspace.id : (config.workspaces[0]?.id ?? null),
    workspace: workspace ? serializeWorkspace(workspace) : config.workspaces[0] ? serializeWorkspace(config.workspaces[0]) : null,
    authorizedRoots: config.authorizedRoots,
    server: {
      host: config.host,
      port: config.port,
      configPath: config.configPath ?? null,
    },
    tokenSource: {
      client: config.tokenSource,
      host: config.hostTokenSource,
    },
  });

  addRoute(routes, "GET", "/health", "none", async () => systemJsonResponse({
    ok: true,
    version: serverVersion,
    opencodeVersion,
    uptimeMs: Date.now() - config.startedAt,
  }));

  addRoute(routes, "GET", "/w/:id/health", "none", async () => systemJsonResponse({
    ok: true,
    version: serverVersion,
    opencodeVersion,
    uptimeMs: Date.now() - config.startedAt,
  }));

  addRoute(routes, "GET", "/w/:id/status", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return systemJsonResponse(statusPayload(workspace));
  });

  addRoute(routes, "GET", "/w/:id/capabilities", "client", async () => systemJsonResponse(capabilities()));

  addRoute(routes, "GET", "/w/:id/workspaces", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    return systemJsonResponse({
      items: [serializeWorkspace(workspace)],
      activeId: workspace.id,
    });
  });

  addRoute(routes, "GET", "/status", "client", async () => systemJsonResponse(statusPayload(null)));

  addRoute(routes, "GET", "/whoami", "client", async (ctx) => systemJsonResponse({ ok: true, actor: ctx.actor ?? null }));

  addRoute(routes, "GET", "/capabilities", "client", async () => systemJsonResponse(capabilities()));
}
