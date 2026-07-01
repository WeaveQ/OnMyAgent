import { basename, resolve } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { recordAudit } from "../services/audit.js";
import { ApiError } from "../core/errors.js";
import { inheritWorkspaceOpencodeConnection, resolveWorkspaceOpencodeConnection } from "../services/opencode-connection.js";
import { addRoute, systemJsonResponse, type Route } from "./route-core.js";
import { ensureDir, shortId } from "../core/utils.js";
import { ensureWorkspaceFiles } from "../workspace/workspace-init.js";
import { workspaceIdForPath } from "../workspace/workspaces.js";

export function registerWorkspaceRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  serializeWorkspace: (workspace: ServerConfig["workspaces"][number]) => unknown;
  persistServerWorkspaceState: (config: ServerConfig) => Promise<boolean>;
  onWorkspacesChanged: () => void;
  reloadOpencodeEngine: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
  ) => Promise<void>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const {
    routes,
    config,
    ensureWritable,
    resolveWorkspace,
    serializeWorkspace,
    persistServerWorkspaceState,
    onWorkspacesChanged,
    reloadOpencodeEngine,
    readJsonBody,
  } = input;

  addRoute(routes, "GET", "/workspaces", "client", async () => {
    const active = config.workspaces[0] ?? null;
    const items = config.workspaces.map(serializeWorkspace);
    return systemJsonResponse({
      items,
      workspaces: items,
      activeId: active?.id ?? null,
    });
  });

  addRoute(routes, "POST", "/workspaces/local", "host", async (ctx) => {
    ensureWritable(config);
    const body = await readJsonBody(ctx.request);
    const folderPath =
      typeof body.folderPath === "string" ? body.folderPath.trim() : "";
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : basename(folderPath || "Workspace");
    const preset =
      typeof body.preset === "string" && body.preset.trim()
        ? body.preset.trim()
        : "starter";

    if (!folderPath) {
      throw new ApiError(400, "invalid_payload", "folderPath is required");
    }

    const workspacePath = resolve(folderPath);
    await ensureDir(workspacePath);
    await ensureWorkspaceFiles(workspacePath, preset);

    const workspace: WorkspaceInfo = {
      id: workspaceIdForPath(workspacePath),
      name,
      path: workspacePath,
      preset,
      workspaceType: "local",
      ...inheritWorkspaceOpencodeConnection(config),
    };

    config.workspaces = [
      workspace,
      ...config.workspaces.filter((entry) => entry.id !== workspace.id),
    ];
    if (
      !config.authorizedRoots.some((root) => resolve(root) === workspacePath)
    ) {
      config.authorizedRoots = [...config.authorizedRoots, workspacePath];
    }
    const persisted = await persistServerWorkspaceState(config);
    onWorkspacesChanged();

    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "host" },
      action: "workspace.create",
      target: workspace.path,
      summary: `Created workspace ${name}`,
      timestamp: Date.now(),
    });

    return systemJsonResponse(
      {
        activeId: workspace.id,
        workspaces: config.workspaces.map(serializeWorkspace),
        persisted,
      },
      201,
    );
  });

  addRoute(
    routes,
    "PATCH",
    "/workspaces/:id/display-name",
    "host",
    async (ctx) => {
      ensureWritable(config);
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const body = await readJsonBody(ctx.request);
      const nextDisplayName =
        typeof body.displayName === "string" && body.displayName.trim()
          ? body.displayName.trim()
          : undefined;

      config.workspaces = config.workspaces.map((entry) =>
        entry.id === workspace.id
          ? {
              ...entry,
              displayName: nextDisplayName,
              name: nextDisplayName ?? entry.name,
            }
          : entry,
      );

      const persisted = await persistServerWorkspaceState(config);
      onWorkspacesChanged();

      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "host" },
        action: "workspace.rename",
        target: workspace.path,
        summary: `Updated workspace display name${nextDisplayName ? ` to ${nextDisplayName}` : ""}`,
        timestamp: Date.now(),
      });

      return systemJsonResponse({
        activeId: config.workspaces[0]?.id ?? null,
        workspaces: config.workspaces.map(serializeWorkspace),
        persisted,
      });
    },
  );

  addRoute(routes, "POST", "/workspaces/:id/activate", "host", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    config.workspaces = [
      workspace,
      ...config.workspaces.filter((entry) => entry.id !== workspace.id),
    ];
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "host" },
      action: "workspace.activate",
      target: "workspace",
      summary: "Switched active workspace",
      timestamp: Date.now(),
    });
    const connection = resolveWorkspaceOpencodeConnection(config, workspace);
    if (connection.baseUrl?.trim()) {
      await reloadOpencodeEngine(config, workspace);
    }
    return systemJsonResponse({
      activeId: workspace.id,
      workspace: serializeWorkspace(workspace),
      persisted: false,
    });
  });

  addRoute(routes, "DELETE", "/workspaces/:id", "host", async (ctx) => {
    ensureWritable(config);

    const workspace = await resolveWorkspace(config, ctx.params.id);

    const before = config.workspaces.length;
    config.workspaces = config.workspaces.filter(
      (entry) => entry.id !== workspace.id,
    );
    const deleted = before !== config.workspaces.length;

    if (deleted) {
      config.authorizedRoots = config.authorizedRoots.filter(
        (root) => resolve(root) !== resolve(workspace.path),
      );
    }
    const persisted = await persistServerWorkspaceState(config);
    onWorkspacesChanged();

    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "host" },
      action: "workspace.delete",
      target: "workspace",
      summary: "Deleted workspace from OnMyAgent server",
      timestamp: Date.now(),
    });

    const active = config.workspaces[0] ?? null;
    return systemJsonResponse({
      ok: true,
      deleted,
      persisted,
      activeId: active?.id ?? null,
      items: config.workspaces.map(serializeWorkspace),
      workspaces: config.workspaces.map(serializeWorkspace),
    });
  });
}
