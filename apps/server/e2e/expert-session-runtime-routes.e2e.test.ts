import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "@onmyagent/types/server";

import { startServer } from "../src/server.js";

let tempRoot = "";
let server: Awaited<ReturnType<typeof startServer>> | null = null;
let previousRuntimeRoot: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-expert-session-route-"));
  previousRuntimeRoot = process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT;
  process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = join(tempRoot, "user-data", "expert-sessions");
  server = await startServer(baseConfig());
});

afterEach(async () => {
  server?.stop(true);
  server = null;
  if (previousRuntimeRoot === undefined) delete process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT;
  else process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT = previousRuntimeRoot;
  await rm(tempRoot, { recursive: true, force: true });
});

describe("expert session runtime route", () => {
  test("allocates authenticated expert sessions outside the project", async () => {
    const response = await fetch(
      `http://127.0.0.1:${server?.port ?? 0}/workspace/ws_test/expert-session-directory`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer owt_expert_session_client",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentName: "高级开发工程师",
          agentId: "senior-developer",
          sessionKey: "1753456789000",
        }),
      },
    );
    expect(response.status).toBe(201);
    const body = await response.json() as { directory: string };
    expect(body.directory.startsWith(join(tempRoot, "user-data"))).toBe(true);
    expect(body.directory.startsWith(join(tempRoot, "project"))).toBe(false);
    expect(await readFile(join(body.directory, "onmyagent-session.json"), "utf8"))
      .toContain('"runtime": true');
  });
});

function baseConfig(): ServerConfig {
  const workspaceRoot = join(tempRoot, "project");
  return {
    host: "127.0.0.1",
    port: 0,
    token: "owt_expert_session_client",
    hostToken: "owt_expert_session_host",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{
      id: "ws_test",
      name: "Test",
      path: workspaceRoot,
      preset: "starter",
      workspaceType: "local",
    }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
}
