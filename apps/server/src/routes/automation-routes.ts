import { join } from "node:path";
import type {
  ApprovalRequest,
  AutomationTaskItem,
  ServerConfig,
  TokenScope,
  WorkspaceInfo,
} from "@onmyagent/types/server";
import {
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  runAutomationManually,
  updateAutomation,
} from "../services/automations.js";
import { recordAudit } from "../services/audit.js";
import { ApiError } from "../core/errors.js";
import { shortId } from "../core/utils.js";
import { addRoute, systemJsonResponse, type RequestContext, type Route } from "./route-core.js";

export function registerAutomationRoutes(input: {
  routes: Route[];
  config: ServerConfig;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  runAutomationTask: (
    workspace: WorkspaceInfo,
    task: Pick<AutomationTaskItem, "title" | "prompt" | "workspaceDirectory" | "model" | "agent" | "accessMode">,
    onStarted: (execution: {
      sessionId: string;
      groupName: string;
      outputDirectory: string;
    }) => Promise<void>,
  ) => Promise<{ sessionId: string; groupName: string; outputDirectory: string }>;
  reconcileAutomationRuns?: (workspace: WorkspaceInfo) => Promise<void>;
  requireApproval: (
    ctx: RequestContext,
    input: Omit<ApprovalRequest, "id" | "createdAt" | "actor">,
  ) => Promise<void>;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const {
    routes,
    config,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    runAutomationTask,
    reconcileAutomationRuns = async () => {},
    requireApproval,
    readJsonBody,
  } = input;

  addRoute(routes, "GET", "/workspace/:id/automations", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    await reconcileAutomationRuns(workspace);
    const items = await listAutomations(workspace.path);
    return systemJsonResponse({ items });
  });

  addRoute(routes, "GET", "/workspace/:id/automations/:automationId/runs", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const automationId = ctx.params.automationId ?? "";
    return systemJsonResponse(await listAutomationRuns(workspace.path, automationId));
  });

  addRoute(routes, "POST", "/workspace/:id/automations", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "automations.create",
      summary: `Create automation ${String(body.title ?? "")}`,
      paths: [automationStoreAuditPath(workspace.path)],
    });
    const item = await createAutomation(workspace.path, body);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "automations.create",
      target: item.id,
      summary: `Created automation ${item.title}`,
      timestamp: Date.now(),
    });
    const items = await listAutomations(workspace.path);
    return systemJsonResponse({ item, items }, 201);
  });

  addRoute(routes, "PATCH", "/workspace/:id/automations/:automationId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const automationId = ctx.params.automationId ?? "";
    const body = await readJsonBody(ctx.request);
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "automations.update",
      summary: `Update automation ${automationId}`,
      paths: [automationStoreAuditPath(workspace.path)],
    });
    const item = await updateAutomation(workspace.path, automationId, body);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "automations.update",
      target: item.id,
      summary: `Updated automation ${item.title}`,
      timestamp: Date.now(),
    });
    const items = await listAutomations(workspace.path);
    return systemJsonResponse({ item, items });
  });

  addRoute(routes, "POST", "/workspace/:id/automations/:automationId/run", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const automationId = ctx.params.automationId ?? "";
    const task = (await listAutomations(workspace.path)).find((item) => item.id === automationId);
    if (!task) {
      throw new ApiError(404, "automation_not_found", "Automation task not found");
    }
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "automations.run",
      summary: `Run automation ${automationId}`,
      paths: [automationStoreAuditPath(workspace.path)],
    });

    const result = await runAutomationManually(workspace.path, task.id, (automation, onStarted) => (
      runAutomationTask(workspace, automation, onStarted)
    ));
    if (result.ok) {
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "automations.run",
        target: result.task.id,
        summary: `Ran automation ${result.task.title}`,
        timestamp: Date.now(),
      });
    } else {
      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "automations.run.failed",
        target: result.task.id,
        summary: `Failed to run automation ${result.task.title}: ${result.message}`,
        timestamp: Date.now(),
      });
      throw result.error;
    }
    const items = await listAutomations(workspace.path);
    return systemJsonResponse({ item: result.item, items });
  });

  addRoute(routes, "DELETE", "/workspace/:id/automations/:automationId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const automationId = ctx.params.automationId ?? "";
    await requireApproval(ctx, {
      workspaceId: workspace.id,
      action: "automations.delete",
      summary: `Delete automation ${automationId}`,
      paths: [automationStoreAuditPath(workspace.path)],
    });
    await deleteAutomation(workspace.path, automationId);
    await recordAudit(workspace.path, {
      id: shortId(),
      workspaceId: workspace.id,
      actor: ctx.actor ?? { type: "remote" },
      action: "automations.delete",
      target: automationId,
      summary: `Deleted automation ${automationId}`,
      timestamp: Date.now(),
    });
    const items = await listAutomations(workspace.path);
    return systemJsonResponse({ ok: true, items });
  });
}

function automationStoreAuditPath(workspaceRoot: string) {
  return join(workspaceRoot, ".opencode", "onmyagent", "automations.json");
}
