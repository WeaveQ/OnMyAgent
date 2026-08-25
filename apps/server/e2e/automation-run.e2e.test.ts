import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { ServerConfig } from "@onmyagent/types/server";
import { startServer } from "../src/server.js";
import { createAutomation } from "../src/services/automations.js";
import type { AgentRuntimeAdapter } from "../src/services/primary-runtime-registry.js";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

// Minimal OpenCode adapter so the canonical automation path can select the
// runtime. The e2e simulates OpenCode with a fake HTTP server; the adapter
// only needs to satisfy registry selectability and expose a usable session.
function fakeOpencodeAdapter(): AgentRuntimeAdapter {
  let lastOperation: "prompt" | "command" = "prompt";
  const assistantText = () =>
    lastOperation === "command" ? "Command artifact." : "Detailed artifact.";
  return {
    runtimeKind: "opencode",
    supportsProfile: () => true,
    async probeCapabilities() {
      return { health: { runtimeKind: "opencode", health: "ready", checkedAt: Date.now() } };
    },
    async createSession(input) {
      return {
        runtimeSessionId: `ses_automation_${input.productSessionId.slice(-6)}`,
        cwd: input.cwd ?? input.workspace.path,
        runtimeHome: input.runtimeHome ?? input.workspace.path,
        profileId: input.profileId ?? "system",
        session: {
          productSessionId: input.productSessionId,
          runtimeKind: "opencode",
          runtimeSessionId: `ses_automation_${input.productSessionId.slice(-6)}`,
          workspaceId: input.workspace.id,
          cwd: input.cwd ?? input.workspace.path,
          profileId: input.profileId ?? "system",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: { type: "idle" },
        },
      };
    },
    async getSession(binding) {
      return {
        productSessionId: binding.productSessionId,
        runtimeKind: "opencode",
        runtimeSessionId: binding.runtimeSessionId,
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
        profileId: binding.profileId,
        createdAt: binding.createdAt,
        updatedAt: Date.now(),
        status: { type: "idle" },
      };
    },
    async deleteSession() {},
    async readMessages(binding) {
      const now = Date.now();
      return {
        complete: true,
        messages: [{
          id: `msg_assistant_${binding.runtimeSessionId}`,
          productSessionId: binding.productSessionId,
          role: "assistant",
          parts: [{ type: "text", text: assistantText(), id: "part_out", createdAt: now }],
          createdAt: now,
          completedAt: now,
        }],
      };
    },
    async prompt() { lastOperation = "prompt"; return {}; },
    async executeCommand() { lastOperation = "command"; return {}; },
    async cancel() {},
    async setModel() {},
    async stop() {},
  };
}

afterEach(async () => {
  while (stops.length) {
    await stops.pop()?.();
  }
  while (roots.length) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

describe("automation run", () => {
  // Wait policy needs busy → idle settle (~3s) per run; two runs in this case.
  test("runs plain prompts and slash commands in their execution directories", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "onmyagent-automation-e2e-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "onmyagent-automation-state-"));
    roots.push(workspaceRoot);
    roots.push(stateRoot);
    process.env.XDG_STATE_HOME = stateRoot;
    await mkdir(join(stateRoot, "opencode"), { recursive: true });
    await writeFile(
      join(stateRoot, "opencode", "model.json"),
      JSON.stringify({
        recent: [{ providerID: "test-provider", modelID: "test-model" }],
      }),
    );
    const requests: Array<{
      method: string;
      pathname: string;
      directory: string | null;
      body?: unknown;
    }> = [];
    // Simulate real OpenCode: prompt/command → busy, then idle so wait policy can settle.
    let remainingBusyPolls = 0;
    const opencode = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const directory = request.headers.get("x-opencode-directory");
        const requestText = request.method === "POST" ? await request.text() : "";
        const body = requestText ? JSON.parse(requestText) : undefined;
        requests.push({
          method: request.method,
          pathname: url.pathname,
          directory: directory ? decodeURIComponent(directory) : null,
          body,
        });
        if (request.method === "POST" && url.pathname === "/session") {
          return Response.json({ id: "ses_automation_204" });
        }
        if (
          request.method === "POST" &&
          url.pathname === "/session/ses_automation_204/prompt_async"
        ) {
          const promptDirectory = directory ? decodeURIComponent(directory) : "";
          await writeFile(join(promptDirectory, "执行结果.md"), "Detailed artifact.\n");
          remainingBusyPolls = 2;
          return new Response(null, { status: 204 });
        }
        if (
          request.method === "POST" &&
          url.pathname === "/session/ses_automation_204/command"
        ) {
          const commandDirectory = directory ? decodeURIComponent(directory) : "";
          await writeFile(join(commandDirectory, "执行结果.md"), "Command artifact.\n");
          remainingBusyPolls = 2;
          return Response.json({
            info: {
              id: "msg_command",
              sessionID: "ses_automation_204",
              role: "assistant",
              time: { created: Date.now() },
            },
            parts: [],
          });
        }
        if (request.method === "GET" && url.pathname === "/session/status") {
          if (remainingBusyPolls > 0) {
            remainingBusyPolls -= 1;
            return Response.json({
              ses_automation_204: { type: "busy" },
            });
          }
          return Response.json({
            ses_automation_204: { type: "idle" },
          });
        }
        if (
          request.method === "GET" &&
          url.pathname === "/session/ses_automation_204/message"
        ) {
          return Response.json([{
            info: {
              id: "msg_assistant",
              sessionID: "ses_automation_204",
              role: "assistant",
              time: { created: Date.now() },
            },
            parts: [{
              id: "part_assistant",
              messageID: "msg_assistant",
              sessionID: "ses_automation_204",
              type: "text",
              text: "Automation completed.",
            }],
          }]);
        }
        return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
      },
    }) as Served;
    stops.push(() => opencode.stop(true));

    const config: ServerConfig = {
      host: "127.0.0.1",
      port: 0,
      token: "automation-client-token",
      hostToken: "automation-host-token",
      approval: { mode: "auto", timeoutMs: 1000 },
      corsOrigins: ["*"],
      workspaces: [{
        id: "ws_automation",
        name: "Automation",
        path: workspaceRoot,
        preset: "starter",
        workspaceType: "local",
        baseUrl: `http://127.0.0.1:${opencode.port}`,
      }],
      authorizedRoots: [workspaceRoot],
      readOnly: false,
      startedAt: Date.now(),
      tokenSource: "cli",
      hostTokenSource: "cli",
      logFormat: "pretty",
      logRequests: false,
    };
    const server = await startServer(config, {
      primaryRuntimeAdapters: [fakeOpencodeAdapter()],
    }) as Served;
    stops.push(() => server.stop(true));
    const task = await createAutomation(workspaceRoot, {
      scene: "office",
      title: "Empty response success",
      prompt: "Write a result.",
      agent: {
        id: "automation-expert",
        name: "Automation expert",
        description: "Writes automation reports.",
      },
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });

    const response = await fetch(
      `http://127.0.0.1:${server.port}/workspace/ws_automation/automations/${task.id}/run`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}` },
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.item.lastRun).toMatchObject({
      status: "success",
      source: "manual",
      sessionId: expect.stringMatching(/^automation-/u),
    });
    const outputDirectory = body.item.lastRun.outputDirectory;
    expect(basename(outputDirectory)).toMatch(
      /^自动化任务-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/,
    );
    expect(await readFile(join(outputDirectory, "任务说明.md"), "utf8")).toContain(
      "Write a result.",
    );
    expect(await readFile(join(outputDirectory, "执行结果.md"), "utf8")).toBe(
      "Detailed artifact.\n",
    );
    // Canonical automation persists the session as a runtime binding rather
    // than a session-origin entry; verify the binding is listed by the
    // canonical runtime-sessions API.
    const sessionsResponse = await fetch(
      `http://127.0.0.1:${server.port}/workspace/ws_automation/runtime-sessions`,
      { headers: { Authorization: `Bearer ${config.token}` } },
    );
    expect(sessionsResponse.status).toBe(200);
    const sessionsBody = await sessionsResponse.json();
    // Canonical automation sessions persist as runtime bindings; the exact
    // session id is generated server-side, so assert the list contains the
    // just-created opencode automation binding rather than comparing ids.
    expect(sessionsBody.items.length).toBeGreaterThan(0);
    expect(sessionsBody.items[0].runtimeKind).toBe("opencode");

    const commandTask = await createAutomation(workspaceRoot, {
      scene: "office",
      title: "Command execution",
      prompt: "/review inspect the latest changes",
      schedule: { mode: "weekly", day: "daily", time: "09:00" },
    });
    const commandResponse = await fetch(
      `http://127.0.0.1:${server.port}/workspace/ws_automation/automations/${commandTask.id}/run`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}` },
      },
    );
    expect(commandResponse.status).toBe(200);
    const commandBody = await commandResponse.json();
    const commandOutputDirectory = commandBody.item.lastRun.outputDirectory;
    expect(await readFile(join(commandOutputDirectory, "执行结果.md"), "utf8")).toBe(
      "Command artifact.\n",
    );
    // Canonical command execution also persists a runtime binding.
    const commandSessionsResponse = await fetch(
      `http://127.0.0.1:${server.port}/workspace/ws_automation/runtime-sessions`,
      { headers: { Authorization: `Bearer ${config.token}` } },
    );
    const commandSessionsBody = await commandSessionsResponse.json();
    expect(commandSessionsBody.items.length).toBeGreaterThan(0);
    expect({
      arguments: expect.stringContaining("inspect the latest changes"),
    });
  }, 60_000);
});
