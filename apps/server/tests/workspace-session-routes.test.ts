import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";

import { startServer } from "../src/server.js";

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
