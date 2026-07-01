import { join } from "node:path";
import type {
  ApprovalRequest,
  ReloadTrigger,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import { deleteCommand, listCommands, upsertCommand } from "../services/commands.js";
import { recordAudit } from "../services/audit.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";
import type { TokenService } from "../services/tokens.js";
import { shortId } from "../core/utils.js";
import { sanitizeCommandName } from "../core/validators.js";

export function registerCommandRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  tokens: TokenService;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  requireHost: (
    request: Request,
    config: ServerConfig,
    tokens: TokenService,
  ) => Promise<unknown>;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  requireApproval: (
    ctx: RequestContext,
    input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  ) => Promise<void>;
  emitReloadEvent: (
    reloadEvents: RequestContext["reloadEvents"],
    workspace: WorkspaceInfo,
    reason: "commands",
    trigger?: ReloadTrigger,
  ) => void;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const {
    routes,
    config,
    tokens,
    ensureWritable,
    requireClientScope,
    requireHost,
    resolveWorkspace,
    requireApproval,
    emitReloadEvent,
    readJsonBody,
  } = input;

  addRoute(routes, "GET", "/workspace/:id/commands", "client", async (ctx) => {
    const scope =
      ctx.url.searchParams.get("scope") === "global" ? "global" : "workspace";
    if (scope === "global") {
      await requireHost(ctx.request, config, tokens);
    }
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const items = await listCommands(workspace.path, scope);
    return systemJsonResponse({ items });
  });

  addRoute(routes, "POST", "/workspace/:id/commands", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const name = String(body.name ?? "");
    const template = String(body.template ?? "");
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "commands.upsert",
      summary: `Upsert command ${name}`,
      paths: [
        join(
          workspace.path,
          ".opencode",
          "commands",
          `${sanitizeCommandName(name)}.md`,
        ),
      ],
    });
    const path = await upsertCommand(workspace.path, {
      name,
      description: body.description ? String(body.description) : undefined,
      template,
      agent: body.agent ? String(body.agent) : undefined,
      model: body.model ? String(body.model) : undefined,
      subtask: typeof body.subtask === "boolean" ? body.subtask : undefined,
    });
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "commands.upsert",
      target: path,
      summary: `Upserted command ${name}`,
      timestamp: Date.now(),
    });

    emitReloadEvent(ctx.reloadEvents, workspace, "commands", {
      type: "command",
      name: sanitizeCommandName(name),
      action: "updated",
      path,
    });
    const items = await listCommands(workspace.path, "workspace");
    return systemJsonResponse({ items });
  });

  addRoute(
    routes,
    "DELETE",
    "/workspace/:id/commands/:name",
    "client",
    async (ctx) => {
      ensureWritable(config);
      requireClientScope(ctx, "collaborator");
      const workspace = await resolveWorkspace(config, ctx.params.id);
      const name = ctx.params.name ?? "";
      await requireApproval(ctx, {
        workspaceId: workspace.id,
        action: "commands.delete",
        summary: `Delete command ${name}`,
        paths: [
          join(
            workspace.path,
            ".opencode",
            "commands",
            `${sanitizeCommandName(name)}.md`,
          ),
        ],
      });
      await deleteCommand(workspace.path, name);
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "commands.delete",
        target: join(workspace.path, ".opencode", "commands"),
        summary: `Deleted command ${name}`,
        timestamp: Date.now(),
      });

      emitReloadEvent(ctx.reloadEvents, workspace, "commands", {
        type: "command",
        name: sanitizeCommandName(name),
        action: "removed",
        path: join(
          workspace.path,
          ".opencode",
          "commands",
          `${sanitizeCommandName(name)}.md`,
        ),
      });
      return systemJsonResponse({ ok: true });
    },
  );
}
