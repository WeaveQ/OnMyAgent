import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ApprovalRequest,
  ReloadTrigger,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { recordAudit } from "../services/audit.js";
import { ApiError } from "../core/errors.js";
import { addMcp, listMcp, removeMcp, setMcpEnabled } from "../services/mcp.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import { shortId } from "../core/utils.js";
import { validateMcpName } from "../core/validators.js";

export function registerMcpRoutes(input: {
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
    reason: "mcp",
    trigger?: ReloadTrigger,
  ) => void;
  opencodeConfigPath: (workspaceRoot: string) => string;
  logoutMcpAuth: (workspace: WorkspaceInfo, name: string) => Promise<void>;
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
    logoutMcpAuth,
    readJsonBody,
  } = input;

  addRoute(routes, "GET", "/workspace/:id/mcp", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const items = await listMcp(workspace.path);
    return systemJsonResponse({ items });
  });

  addRoute(routes, "POST", "/workspace/:id/mcp", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const name = String(body.name ?? "");
    const configPayload = readRecord(body.config);
    if (!configPayload) {
      throw new ApiError(400, "invalid_payload", "MCP config is required");
    }
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "mcp.add",
      summary: `Add MCP ${name}`,
      paths: [opencodeConfigPath(workspace.path)],
    });
    const result = await addMcp(workspace.path, name, configPayload);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "mcp.add",
      target: "opencode.json",
      summary: `Added MCP ${name}`,
      timestamp: Date.now(),
    });
    emitReloadEvent(ctx.reloadEvents, workspace, "mcp", {
      type: "mcp",
      name,
      action: result.action,
    });
    const items = await listMcp(workspace.path);
    return systemJsonResponse({ items });
  });

  addRoute(
    routes,
    "DELETE",
    "/workspace/:id/mcp/:name",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const name = ctx.params.name ?? "";
      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "mcp.remove",
        summary: `Remove MCP ${name}`,
        paths: [opencodeConfigPath(workspace.path)],
      });
      const removed = await removeMcp(workspace.path, name);
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "mcp.remove",
        target: "opencode.json",
        summary: `Removed MCP ${name}`,
        timestamp: Date.now(),
      });
      if (removed) {
        emitReloadEvent(ctx.reloadEvents, workspace, "mcp", {
          type: "mcp",
          name,
          action: "removed",
        });
      }
      const items = await listMcp(workspace.path);
      return systemJsonResponse({ items });
    },
  );

  addRoute(
    routes,
    "POST",
    "/workspace/:id/mcp/:name/enabled",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const name = ctx.params.name ?? "";
      const body = await readJsonBody(ctx.request);
      if (typeof body.enabled !== "boolean") {
        throw new ApiError(400, "invalid_payload", "enabled must be a boolean");
      }
      const enabled = body.enabled;
      const action = enabled ? "mcp.enable" : "mcp.disable";
      const summary = `${enabled ? "Enable" : "Disable"} MCP ${name}`;
      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action,
        summary,
        paths: [opencodeConfigPath(workspace.path)],
      });
      const updated = await setMcpEnabled(workspace.path, name, enabled);
      if (!updated) {
        throw new ApiError(
          404,
          "mcp_not_found",
          `MCP ${name} not found in workspace config`,
        );
      }
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action,
        target: "opencode.json",
        summary: `${enabled ? "Enabled" : "Disabled"} MCP ${name}`,
        timestamp: Date.now(),
      });
      emitReloadEvent(ctx.reloadEvents, workspace, "mcp", {
        type: "mcp",
        name,
        action: "updated",
      });
      const items = await listMcp(workspace.path);
      return systemJsonResponse({ items });
    },
  );

  addRoute(
    routes,
    "DELETE",
    "/workspace/:id/mcp/:name/auth",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const name = String(ctx.params.name ?? "").trim();
      validateMcpName(name);

      const authStorePath = join(
        homedir(),
        ".config",
        "opencode",
        "mcp-auth.json",
      );
      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "mcp.auth.remove",
        summary: `Logout MCP ${name}`,
        paths: [authStorePath],
      });

      await logoutMcpAuth(workspace, name);

      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "mcp.auth.remove",
        target: authStorePath,
        summary: `Logged out MCP ${name}`,
        timestamp: Date.now(),
      });

      return systemJsonResponse({ ok: true });
    },
  );
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}
