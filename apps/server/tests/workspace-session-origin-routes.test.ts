import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../src/core/errors.js";
import { readJsonBody } from "../src/core/request-body.js";
import { registerWorkspaceSessionOriginRoutes } from "../src/routes/workspace-session-origin-routes.js";
import { registerWorkspaceSessionRoutes } from "../src/routes/workspace-session-routes.js";
import type { RequestContext, Route } from "../src/routes/route-core.js";
import { listSessionOrigins, upsertSessionOrigin } from "../src/services/session-origins.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("workspace session origin routes", () => {
  test("uses the resolved workspace identity and requires collaborator writes", async () => {
    const workspace = await createWorkspace();
    const routes = createRoutes(workspace);

    const created = await call(routes, workspace, "PUT", "session-1", {
      kind: "expert",
      workspaceId: "forged-workspace",
      agentId: "expert-a",
      packageName: "expert-package",
      directory: "/external/runtime/session-1",
    });
    expect(created).toMatchObject({
      item: { workspaceId: workspace.id, sessionId: "session-1", kind: "expert", agentId: "expert-a" },
    });

    expect(await call(routes, workspace, "GET")).toMatchObject({
      items: [{ workspaceId: workspace.id, sessionId: "session-1" }],
    });
    expect(await call(routes, workspace, "DELETE", "session-1")).toMatchObject({ ok: true, revision: 2 });
    expect(await call(routes, workspace, "GET")).toMatchObject({ items: [], complete: true, version: 2 });

    await expect(call(routes, workspace, "PUT", "session-2", { kind: "assistant" }, "viewer"))
      .rejects.toMatchObject({ status: 403 });
    await expect(call(routes, workspace, "GET", undefined, undefined, "viewer"))
      .rejects.toMatchObject({ status: 403 });
  });

  test("removes the origin after an idempotent workspace session delete", async () => {
    const workspace = await createWorkspace();
    await upsertSessionOrigin(workspace, "already-gone", { kind: "assistant" });
    const routes: Route[] = [];
    const config = createConfig(workspace);
    registerWorkspaceSessionRoutes({
      routes,
      config,
      ensureWritable: () => undefined,
      requireClientScope: () => undefined,
      resolveWorkspace: async () => workspace,
      readJsonBody: async () => ({}),
      listWorkspaceSessions: async () => [],
      readWorkspaceSession: async () => ({}),
      readWorkspaceSessionMessages: async () => [],
      readWorkspaceSessionSnapshot: async () => ({}),
      deleteWorkspaceSession: async () => undefined,
    });

    expect(await callWorkspaceSessionDelete(routes, workspace, "already-gone")).toEqual({ ok: true });
    expect((await listSessionOrigins(workspace)).items).toEqual([]);
  });

  test("preserves the origin when the upstream session delete fails", async () => {
    const workspace = await createWorkspace();
    await upsertSessionOrigin(workspace, "still-present", {
      kind: "expert",
      agentId: "expert-a",
      packageName: "expert-package",
      directory: "/external/runtime/still-present",
    });
    const routes: Route[] = [];
    registerWorkspaceSessionRoutes({
      routes,
      config: createConfig(workspace),
      ensureWritable: () => undefined,
      requireClientScope: () => undefined,
      resolveWorkspace: async () => workspace,
      readJsonBody: async () => ({}),
      listWorkspaceSessions: async () => [],
      readWorkspaceSession: async () => ({}),
      readWorkspaceSessionMessages: async () => [],
      readWorkspaceSessionSnapshot: async () => ({}),
      deleteWorkspaceSession: async () => { throw new ApiError(502, "upstream_failed", "Upstream failed"); },
    });

    await expect(callWorkspaceSessionDelete(routes, workspace, "still-present"))
      .rejects.toMatchObject({ code: "upstream_failed" });
    expect((await listSessionOrigins(workspace)).items).toHaveLength(1);
  });
});

async function createWorkspace(): Promise<WorkspaceInfo> {
  const path = await mkdtemp(join(tmpdir(), "onmyagent-session-origin-route-"));
  roots.push(path);
  return { id: "resolved-workspace", name: "Resolved", path, preset: "starter", workspaceType: "local" };
}

function createRoutes(workspace: WorkspaceInfo): Route[] {
  const routes: Route[] = [];
  const config = createConfig(workspace);
  registerWorkspaceSessionOriginRoutes({
    routes,
    config,
    ensureWritable: (current) => {
      if (current.readOnly) throw new ApiError(403, "read_only", "Read-only");
    },
    requireClientScope: (ctx, required) => {
      if (required === "collaborator" && ctx.actor?.scope !== "collaborator") {
        throw new ApiError(403, "forbidden", "Collaborator required");
      }
    },
    resolveWorkspace: async () => workspace,
    readJsonBody,
  });
  return routes;
}

async function call(
  routes: Route[],
  workspace: WorkspaceInfo,
  method: "GET" | "PUT" | "DELETE",
  sessionId?: string,
  body?: unknown,
  scope: "viewer" | "collaborator" = "collaborator",
): Promise<unknown> {
  const path = sessionId
    ? `/workspace/${workspace.id}/session-origins/${sessionId}`
    : `/workspace/${workspace.id}/session-origins`;
  const url = new URL(`http://localhost${path}`);
  const route = routes.find((item) => item.method === method && item.regex.test(url.pathname));
  if (!route) throw new Error(`Missing ${method} route`);
  const response = await route.handler({
    request: new Request(url, body === undefined ? { method } : {
      method,
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    url,
    params: { id: workspace.id, ...(sessionId ? { sessionId } : {}) },
    config: createConfig(workspace),
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope },
  } satisfies RequestContext);
  expect(response.status).toBe(200);
  return response.json();
}

async function callWorkspaceSessionDelete(
  routes: Route[],
  workspace: WorkspaceInfo,
  sessionId: string,
): Promise<unknown> {
  const url = new URL(`http://localhost/workspace/${workspace.id}/sessions/${sessionId}`);
  const route = routes.find((item) => item.method === "DELETE" && item.regex.test(url.pathname));
  if (!route) throw new Error("Missing workspace session DELETE route");
  const response = await route.handler({
    request: new Request(url, { method: "DELETE" }),
    url,
    params: { id: workspace.id, sessionId },
    config: createConfig(workspace),
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: "collaborator" },
  } satisfies RequestContext);
  expect(response.status).toBe(200);
  return response.json();
}

function createConfig(workspace: WorkspaceInfo): ServerConfig {
  return {
    host: "127.0.0.1", port: 0, token: "token", hostToken: "host-token",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace],
    authorizedRoots: [workspace.path], readOnly: false, startedAt: Date.now(),
    tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
}
