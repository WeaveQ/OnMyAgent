import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";

import { startServer } from "../src/server.js";
import { registerWorkspaceSessionRoutes } from "../src/routes/workspace-session-routes.js";
import type { RequestContext, Route } from "../src/routes/route-core.js";
import { readWorkspaceSessionSnapshot } from "../src/services/workspace-sessions.js";

describe("workspace session routes", () => {
  test("returns an empty list when OpenCode base URL is not configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "studio-workspace-sessions-"));
    const workspace: WorkspaceInfo = {
      id: "workspace-sessions",
      name: "Workspace Sessions",
      path: join(root, "repo"),
      preset: "default",
      workspaceType: "local",
    };
    const server = await startServer(createConfig(workspace));

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${workspace.id}/sessions?limit=200`, {
        headers: { Authorization: "Bearer token" },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [] });
    } finally {
      await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("forwards each read request's cancellation signal to its service", async () => {
    const workspace = createWorkspace("workspace-route-signal");
    const config = createConfig(workspace);
    const routes: Route[] = [];
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    registerWorkspaceSessionRoutes({
      routes,
      config,
      ensureWritable: () => undefined,
      requireClientScope: () => undefined,
      resolveWorkspace: async () => workspace,
      readJsonBody: async () => ({}),
      listWorkspaceSessions: async (_config, _workspace, input) => {
        signals.push(input.signal);
        return [];
      },
      readWorkspaceSession: async (_config, _workspace, _sessionId, _directory, signal) => {
        signals.push(signal);
        return {};
      },
      readWorkspaceSessionMessages: async (_config, _workspace, _sessionId, input) => {
        signals.push(input.signal);
        return [];
      },
      readWorkspaceSessionSnapshot: async (_config, _workspace, _sessionId, input) => {
        signals.push(input.signal);
        return {};
      },
      deleteWorkspaceSession: async () => undefined,
    });

    await callRoute(routes, workspace, "GET", "/workspace/workspace-route-signal/sessions", controller.signal);
    await callRoute(routes, workspace, "GET", "/workspace/workspace-route-signal/sessions/session-1", controller.signal, "session-1");
    await callRoute(routes, workspace, "GET", "/workspace/workspace-route-signal/sessions/session-1/messages", controller.signal, "session-1");
    await callRoute(routes, workspace, "GET", "/workspace/workspace-route-signal/sessions/session-1/snapshot", controller.signal, "session-1");

    expect(signals).toEqual([controller.signal, controller.signal, controller.signal, controller.signal]);
  });

  test("aborts all OpenCode snapshot reads without converting the abort into an OpenCode failure", async () => {
    const requests = new Set<string>();
    const aborted = new Set<string>();
    let notifyAllStarted: (() => void) | undefined;
    const allStarted = new Promise<void>((resolve) => {
      notifyAllStarted = resolve;
    });
    const upstream = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        requests.add(path);
        if (requests.size === 4) notifyAllStarted?.();
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              aborted.add(path);
              reject(new DOMException("Cancelled", "AbortError"));
            },
            { once: true },
          );
        });
      },
    });
    const workspace = {
      ...createWorkspace(`workspace-snapshot-abort-${crypto.randomUUID()}`),
      baseUrl: upstream.url.toString(),
    };
    const controller = new AbortController();

    try {
      const snapshot = readWorkspaceSessionSnapshot(
        createConfig(workspace),
        workspace,
        "session-1",
        { signal: controller.signal },
      );
      await Promise.race([
        allStarted,
        Bun.sleep(1_000).then(() => {
          throw new Error("OpenCode snapshot requests did not all start");
        }),
      ]);
      controller.abort();

      await expect(snapshot).rejects.toMatchObject({ name: "AbortError" });
      await Bun.sleep(20);
      expect(requests).toEqual(
        new Set([
          "/session/session-1",
          "/session/session-1/message",
          "/session/session-1/todo",
          "/session/status",
        ]),
      );
      expect(aborted).toEqual(requests);
    } finally {
      upstream.stop(true);
    }
  });
});

function createWorkspace(id: string): WorkspaceInfo {
  return {
    id,
    name: "Workspace Sessions",
    path: `/tmp/${id}`,
    preset: "default",
    workspaceType: "local",
  };
}

async function callRoute(
  routes: Route[],
  workspace: WorkspaceInfo,
  method: string,
  path: string,
  signal: AbortSignal,
  sessionId?: string,
) {
  const url = new URL(`http://localhost${path}`);
  const route = routes.find(
    (candidate) => candidate.method === method && candidate.regex.test(url.pathname),
  );
  expect(route).toBeTruthy();
  if (!route) throw new Error(`Missing route ${method} ${path}`);
  await route.handler({
    request: new Request(url, { method, signal }),
    url,
    params: { id: workspace.id, ...(sessionId ? { sessionId } : {}) },
    config: createConfig(workspace),
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: "viewer" },
  } satisfies RequestContext);
}

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
