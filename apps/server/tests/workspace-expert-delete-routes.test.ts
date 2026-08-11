import { describe, expect, test } from "bun:test";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../src/core/errors.js";
import { registerWorkspaceExpertDeleteRoutes } from "../src/routes/workspace-expert-delete-routes.js";
import type { RequestContext, Route } from "../src/routes/route-core.js";

const workspace: WorkspaceInfo = {
  id: "delete-route-workspace",
  name: "Delete route",
  path: "/tmp/delete-route-workspace",
  preset: "default",
  workspaceType: "local",
};
const config: ServerConfig = {
  host: "127.0.0.1", port: 0, token: "token", hostToken: "host-token",
  approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace],
  authorizedRoots: [workspace.path], readOnly: false, startedAt: Date.now(),
  tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
};

function setup() {
  const routes: Route[] = [];
  let requiredScope = "";
  registerWorkspaceExpertDeleteRoutes({
    routes,
    config,
    ensureWritable: () => undefined,
    requireClientScope: (_ctx, required) => { requiredScope = required; },
    resolveWorkspace: async () => workspace,
    readJsonBody: async (request) => await request.json() as Record<string, unknown>,
    deleteExpertSessions: async (_config, _workspace, request) => ({
      operationId: request.operationId,
      workspaceId: workspace.id,
      agentId: request.agentId,
      packageName: request.packageName,
      revision: 2,
      state: "completed" as const,
      steps: [],
    }),
  });
  return { routes, get requiredScope() { return requiredScope; } };
}

async function invoke(routes: Route[], body: unknown): Promise<Response> {
  const url = new URL(`http://localhost/workspace/${workspace.id}/expert-delete`);
  const route = routes.find((candidate) => candidate.method === "POST" && candidate.regex.test(url.pathname));
  if (!route) throw new Error("missing route");
  return route.handler({
    request: new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    url,
    params: { id: workspace.id },
    config,
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: "collaborator" },
  } satisfies RequestContext);
}

describe("workspace Expert delete route", () => {
  test("requires collaborator and returns typed operation result", async () => {
    const setupResult = setup();
    const response = await invoke(setupResult.routes, {
      operationId: "operation-1", agentId: "agent-1", packageName: "package-1", marketplace: "my-experts",
    });
    expect(setupResult.requiredScope).toBe("collaborator");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ operationId: "operation-1", state: "completed" });
  });

  test("rejects malformed payload before invoking saga", async () => {
    const setupResult = setup();
    await expect(invoke(setupResult.routes, { agentId: "agent-1", packageName: "package-1" })).rejects.toMatchObject({
      status: 400,
      code: "invalid_payload",
    } satisfies Partial<ApiError>);
  });
});
