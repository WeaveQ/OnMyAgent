import { afterEach, describe, expect, test } from "bun:test";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../src/core/errors.js";
import { registerWorkspaceExpertDirectoryRoutes } from "../src/routes/workspace-expert-directory-routes.js";
import type { RequestContext, Route } from "../src/routes/route-core.js";
import { getExpertLifecycleEventsSnapshot, resetExpertLifecycleEventsForTest } from "../src/services/expert-lifecycle-events.js";

function workspace(): WorkspaceInfo {
  return { id: "route-workspace", name: "Route", path: "/tmp/route-workspace", preset: "starter", workspaceType: "local" };
}

function config(current: WorkspaceInfo): ServerConfig {
  return {
    host: "127.0.0.1", port: 0, token: "token", hostToken: "host-token", approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: [], workspaces: [current], authorizedRoots: [current.path], readOnly: false, startedAt: Date.now(),
    tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
}

function routesFor(listWorkspaceSessions: (input: { complete: boolean; items: unknown[] }) => unknown): Route[] {
  const routes: Route[] = [];
  const current = workspace();
  const currentConfig = config(current);
  registerWorkspaceExpertDirectoryRoutes({
    routes,
    config: currentConfig,
    ensureWritable: () => undefined,
    requireClientScope: (ctx, required) => {
      if (required === "collaborator" && ctx.actor?.scope === "viewer") {
        throw new ApiError(403, "forbidden", "Insufficient token scope");
      }
      if (required !== "viewer") expect(required).toBe("collaborator");
    },
    resolveWorkspace: async () => current,
    readJsonBody: async (request) => await request.json() as Record<string, unknown>,
    listWorkspaceSessions: async () => listWorkspaceSessions({ complete: true, items: [] }),
  });
  return routes;
}

async function invoke(
  routes: Route[],
  method: "GET" | "POST",
  body?: unknown,
  suffix = method === "POST" ? "/heal" : "",
  actorScope: "owner" | "collaborator" | "viewer" = "collaborator",
): Promise<Response> {
  const current = workspace();
  const url = new URL(`http://localhost/workspace/${current.id}/expert-directory${suffix}`);
  const route = routes.find((candidate) => candidate.method === method && candidate.regex.test(url.pathname));
  if (!route) throw new Error("missing route");
  return route.handler({
    request: new Request(url, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    url,
    params: { id: current.id },
    config: config(current),
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: actorScope },
  } satisfies RequestContext);
}

describe("workspace expert directory routes", () => {
  afterEach(() => resetExpertLifecycleEventsForTest());

  test("GET is viewer-readable and returns typed projection shape", async () => {
    let requested = "";
    const current = workspace();
    const routes: Route[] = [];
    registerWorkspaceExpertDirectoryRoutes({
      routes,
      config: config(current),
      ensureWritable: () => undefined,
      requireClientScope: (_ctx, required) => { requested = required; },
      resolveWorkspace: async () => current,
      readJsonBody: async () => ({}),
      listWorkspaceSessions: async () => ({ scope: "workspace", items: [], complete: true, failures: [] }),
    });
    const response = await invoke(routes, "GET");
    expect(response.status).toBe(200);
    expect(requested).toBe("viewer");
    expect(await response.json()).toMatchObject({ version: 1, schema: "onmyagent.expert-directory.v1", records: [], complete: true });
  });

  test("POST rejects malformed apply payload", async () => {
    const routes = routesFor(() => ({ scope: "workspace", items: [], complete: true, failures: [] }));
    await expect(invoke(routes, "POST", { apply: "yes" })).rejects.toMatchObject({ status: 400, code: "invalid_payload" } satisfies Partial<ApiError>);
  });

  test("GET keeps an empty runtime-neutral directory complete when OpenCode aggregate is partial", async () => {
    const routes = routesFor(() => ({
      scope: "workspace",
      items: [],
      complete: false,
      failures: [{ code: "directory_read_failed" }],
    }));
    const response = await invoke(routes, "GET");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      complete: true,
      state: "missing",
      failures: [],
    });
  });

  test("collaborator-only shadow diff route records only redacted counts", async () => {
    let requested = "";
    const current = workspace();
    const routes: Route[] = [];
    registerWorkspaceExpertDirectoryRoutes({
      routes,
      config: config(current),
      ensureWritable: () => undefined,
      requireClientScope: (_ctx, required) => { requested = required; },
      resolveWorkspace: async () => current,
      readJsonBody: async (request) => await request.json() as Record<string, unknown>,
      listWorkspaceSessions: async () => ({ scope: "workspace", items: [], complete: true, failures: [] }),
    });
    const response = await invoke(routes, "POST", {
      change: "changed",
      changedFieldCount: 3,
      count: 1,
    }, "/shadow-diff");
    expect(response.status).toBe(200);
    expect(requested).toBe("collaborator");
    const payload = await response.json() as { ok: boolean; event: Record<string, unknown> };
    expect(payload).toMatchObject({ ok: true, event: { kind: "shadow_diff", change: "changed", changedFieldCount: 3, count: 1 } });
    expect(payload.event.workspaceHash).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(JSON.stringify(payload)).not.toContain(current.path);
    expect(getExpertLifecycleEventsSnapshot().events.at(-1)?.kind).toBe("shadow_diff");
  });

  test("shadow diff route rejects raw fields", async () => {
    const routes = routesFor(() => ({ scope: "workspace", items: [], complete: true, failures: [] }));
    await expect(invoke(routes, "POST", { change: "added", prompt: "private" }, "/shadow-diff"))
      .rejects.toMatchObject({ status: 400, code: "invalid_payload" } satisfies Partial<ApiError>);
  });

  test("shadow diff route rejects viewer scope", async () => {
    const routes = routesFor(() => ({ scope: "workspace", items: [], complete: true, failures: [] }));
    await expect(invoke(routes, "POST", { change: "unchanged" }, "/shadow-diff", "viewer"))
      .rejects.toMatchObject({ status: 403, code: "forbidden" } satisfies Partial<ApiError>);
  });
});
