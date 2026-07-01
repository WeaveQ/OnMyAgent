import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";

import { auditLogPath } from "../src/services/audit.js";
import { createAutomation, listAutomations, recordAutomationRun } from "../src/services/automations.js";
import { registerAutomationRoutes } from "../src/routes/automation-routes.js";
import type { RequestContext, Route } from "../src/routes/route-core.js";

describe("automation routes", () => {
  test("lists run history for one automation", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "onmyagent-automation-routes-"));
    const workspace: WorkspaceInfo = {
      id: "workspace-history",
      name: "Workspace",
      path: workspaceRoot,
      preset: "default",
      workspaceType: "local",
    };
    const config = createConfig(workspace);
    const task = await createAutomation(workspaceRoot, {
      scene: "office",
      title: "History route",
      prompt: "Read history.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    await recordAutomationRun(workspaceRoot, task.id, {
      status: "success",
      source: "manual",
      ranAt: 200,
      sessionId: "ses_history_route",
    });
    const routes: Route[] = [];

    registerAutomationRoutes({
      routes,
      config,
      ensureWritable: () => {},
      requireClientScope: () => {},
      resolveWorkspace: async () => workspace,
      runAutomationTask: async () => ({
        sessionId: "unused",
        groupName: "自动化任务-2026-06-23-09-00-00",
        outputDirectory: join(workspaceRoot, "自动化任务-2026-06-23-09-00-00"),
      }),
      requireApproval: async () => {},
      readJsonBody: async () => ({}),
    });

    const route = routes.find(
      (item) => item.method === "GET" && item.regex.test("/workspace/workspace-history/automations/automation-id/runs"),
    );
    expect(route).toBeTruthy();
    if (!route) return;

    const response = await route.handler({
      request: new Request("http://localhost/workspace/workspace-history/automations/automation-id/runs"),
      url: new URL("http://localhost/workspace/workspace-history/automations/automation-id/runs"),
      params: { id: workspace.id, automationId: task.id },
      config,
      approvals: null,
      reloadEvents: null,
      tokens: null,
      actor: { type: "remote", scope: "viewer" },
    } satisfies RequestContext);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item.id).toBe(task.id);
    expect(body.total).toBe(1);
    expect(body.runs[0]).toMatchObject({
      status: "success",
      source: "manual",
      sessionId: "ses_history_route",
    });
  });

  test("runs an automation immediately and records the session", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "onmyagent-automation-routes-"));
    const dataDir = await mkdtemp(join(tmpdir(), "onmyagent-automation-audit-"));
    process.env.ONMYAGENT_DATA_DIR = dataDir;
    const workspace: WorkspaceInfo = {
      id: "workspace-1",
      name: "Workspace",
      path: workspaceRoot,
      preset: "default",
      workspaceType: "local",
    };
    const config = createConfig(workspace);
    const task = await createAutomation(workspaceRoot, {
      scene: "office",
      title: "Run now",
      prompt: "Run immediately.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const routes: Route[] = [];

    registerAutomationRoutes({
      routes,
      config,
      ensureWritable: () => {},
      requireClientScope: () => {},
      resolveWorkspace: async () => workspace,
      runAutomationTask: async () => ({
        sessionId: "ses_route_123",
        groupName: "自动化任务-2026-06-23-09-00-00",
        outputDirectory: join(workspaceRoot, "自动化任务-2026-06-23-09-00-00"),
      }),
      requireApproval: async () => {},
      readJsonBody: async () => ({}),
    });

    const route = routes.find(
      (item) => item.method === "POST" && item.regex.test("/workspace/workspace-1/automations/automation-id/run"),
    );
    expect(route).toBeTruthy();
    if (!route) return;

    const response = await route.handler({
      request: new Request("http://localhost/workspace/workspace-1/automations/automation-id/run", { method: "POST" }),
      url: new URL("http://localhost/workspace/workspace-1/automations/automation-id/run"),
      params: { id: workspace.id, automationId: task.id },
      config,
      approvals: null,
      reloadEvents: null,
      tokens: null,
      actor: { type: "remote", scope: "collaborator" },
    } satisfies RequestContext);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item.lastRun).toMatchObject({
      status: "success",
      source: "manual",
      sessionId: "ses_route_123",
    });
    expect(body.item.runs[0]).toMatchObject({
      status: "success",
      source: "manual",
      sessionId: "ses_route_123",
    });

    const listed = await listAutomations(workspaceRoot);
    expect(listed[0]?.lastRun).toMatchObject({
      status: "success",
      source: "manual",
      sessionId: "ses_route_123",
    });
    expect(listed[0]?.runs[0]).toMatchObject({
      status: "success",
      source: "manual",
      sessionId: "ses_route_123",
    });

    const audit = await readFile(auditLogPath(workspace.id), "utf8");
    expect(audit).toContain("automations.run");
    expect(audit).toContain("Ran automation Run now");
  });

  test("records failed manual automation runs in run history and audit", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "onmyagent-automation-routes-"));
    const dataDir = await mkdtemp(join(tmpdir(), "onmyagent-automation-audit-"));
    process.env.ONMYAGENT_DATA_DIR = dataDir;
    const workspace: WorkspaceInfo = {
      id: "workspace-failed-run",
      name: "Workspace",
      path: workspaceRoot,
      preset: "default",
      workspaceType: "local",
    };
    const config = createConfig(workspace);
    const task = await createAutomation(workspaceRoot, {
      scene: "office",
      title: "Run failure",
      prompt: "Run and fail.",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const routes: Route[] = [];

    registerAutomationRoutes({
      routes,
      config,
      ensureWritable: () => {},
      requireClientScope: () => {},
      resolveWorkspace: async () => workspace,
      runAutomationTask: async () => {
        throw new Error("runner unavailable");
      },
      requireApproval: async () => {},
      readJsonBody: async () => ({}),
    });

    const route = routes.find(
      (item) => item.method === "POST" && item.regex.test("/workspace/workspace-failed-run/automations/automation-id/run"),
    );
    expect(route).toBeTruthy();
    if (!route) return;

    await expect(route.handler({
      request: new Request("http://localhost/workspace/workspace-failed-run/automations/automation-id/run", { method: "POST" }),
      url: new URL("http://localhost/workspace/workspace-failed-run/automations/automation-id/run"),
      params: { id: workspace.id, automationId: task.id },
      config,
      approvals: null,
      reloadEvents: null,
      tokens: null,
      actor: { type: "remote", scope: "collaborator" },
    } satisfies RequestContext)).rejects.toThrow("runner unavailable");

    const listed = await listAutomations(workspaceRoot);
    expect(listed[0]?.lastRun).toMatchObject({
      status: "failed",
      source: "manual",
      error: "runner unavailable",
    });
    expect(listed[0]?.runs[0]).toMatchObject({
      status: "failed",
      source: "manual",
      error: "runner unavailable",
    });

    const audit = await readFile(auditLogPath(workspace.id), "utf8");
    expect(audit).toContain("automations.run.failed");
    expect(audit).toContain("runner unavailable");
  });
});

function createConfig(workspace: WorkspaceInfo): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: [],
    workspaces: [workspace],
    authorizedRoots: [workspace.path],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}
