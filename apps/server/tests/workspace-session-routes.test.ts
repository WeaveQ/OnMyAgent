import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";

import { startServer } from "../src/server.js";
import { registerWorkspaceSessionRoutes } from "../src/routes/workspace-session-routes.js";
import type { RequestContext, Route } from "../src/routes/route-core.js";
import { readWorkspaceSessionSnapshotReads } from "../src/services/workspace-sessions.js";

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
        return input.scope === "workspace"
          ? { scope: "workspace", items: [], complete: true, failures: [] }
          : [];
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
    const workspaceResponse = await callRoute(
      routes,
      workspace,
      "GET",
      "/workspace/workspace-route-signal/sessions?scope=workspace",
      controller.signal,
    );
    expect(await workspaceResponse.json()).toEqual({
      scope: "workspace",
      items: [],
      complete: true,
      failures: [],
    });
    await expect(
      callRoute(
        routes,
        workspace,
        "GET",
        "/workspace/workspace-route-signal/sessions?scope=not-a-scope",
        controller.signal,
      ),
    ).rejects.toMatchObject({ status: 400, code: "invalid_query" });
    await callRoute(routes, workspace, "GET", "/workspace/workspace-route-signal/sessions/session-1", controller.signal, "session-1");
    await callRoute(routes, workspace, "GET", "/workspace/workspace-route-signal/sessions/session-1/messages", controller.signal, "session-1");
    await callRoute(routes, workspace, "GET", "/workspace/workspace-route-signal/sessions/session-1/snapshot", controller.signal, "session-1");

    expect(signals).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
  });

  test("aborts all snapshot reads without converting the abort into an OpenCode failure", async () => {
    const started = new Set<string>();
    const aborted = new Set<string>();
    const signals: AbortSignal[] = [];
    let notifyAllStarted: (() => void) | undefined;
    let notifyAllAborted: (() => void) | undefined;
    const allStarted = new Promise<void>((resolve) => {
      notifyAllStarted = resolve;
    });
    const allAborted = new Promise<void>((resolve) => {
      notifyAllAborted = resolve;
    });
    const controller = new AbortController();
    const createRead = (name: string) => (signal?: AbortSignal) => {
      if (!signal) throw new Error("Expected snapshot read signal");
      started.add(name);
      signals.push(signal);
      if (started.size === 4) notifyAllStarted?.();
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted.add(name);
            if (aborted.size === 4) notifyAllAborted?.();
            reject(new DOMException("Cancelled", "AbortError"));
          },
          { once: true },
        );
      });
    };
    const snapshot = readWorkspaceSessionSnapshotReads(
      {
        session: createRead("session"),
        messages: createRead("messages"),
        todos: createRead("todos"),
        statuses: createRead("statuses"),
      },
      controller.signal,
    );

    try {
      await Promise.race([
        allStarted,
        Bun.sleep(1_000).then(() => {
          throw new Error("Snapshot reads did not all start");
        }),
      ]);
      controller.abort();

      await Promise.race([
        allAborted,
        Bun.sleep(1_000).then(() => {
          throw new Error("Snapshot reads did not all abort");
        }),
      ]);
      await expect(snapshot).rejects.toMatchObject({ name: "AbortError" });
      expect(started).toEqual(new Set(["session", "messages", "todos", "statuses"]));
      expect(signals).toEqual([controller.signal, controller.signal, controller.signal, controller.signal]);
      expect(aborted).toEqual(started);
    } finally {
      controller.abort();
      await snapshot.catch(() => undefined);
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
  return route.handler({
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
