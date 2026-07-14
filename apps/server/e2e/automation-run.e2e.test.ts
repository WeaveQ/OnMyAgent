import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { ServerConfig } from "@onmyagent/types/server";
import { startServer } from "../src/server.js";
import { createAutomation } from "../src/services/automations.js";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) {
    await stops.pop()?.();
  }
  while (roots.length) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

describe("automation run", () => {
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
          return new Response(null, { status: 204 });
        }
        if (
          request.method === "POST" &&
          url.pathname === "/session/ses_automation_204/command"
        ) {
          const commandDirectory = directory ? decodeURIComponent(directory) : "";
          await writeFile(join(commandDirectory, "执行结果.md"), "Command artifact.\n");
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
          return Response.json({});
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
    const server = await startServer(config) as Served;
    stops.push(() => server.stop(true));
    const task = await createAutomation(workspaceRoot, {
      scene: "office",
      title: "Empty response success",
      prompt: "Write a result.",
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
      sessionId: "ses_automation_204",
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
    const promptRequest = requests.find(
      (request) => request.pathname === "/session/ses_automation_204/prompt_async",
    );
    expect(promptRequest).toMatchObject({
      method: "POST",
      directory: outputDirectory,
      body: {
        model: { providerID: "test-provider", modelID: "test-model" },
      },
    });

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
    const commandRequest = requests.find(
      (request) => request.pathname === "/session/ses_automation_204/command",
    );
    expect(commandRequest).toMatchObject({
      method: "POST",
      directory: commandOutputDirectory,
      body: {
        command: "review",
        model: "test-provider/test-model",
      },
    });
    expect(commandRequest?.body).toMatchObject({
      arguments: expect.stringContaining("inspect the latest changes"),
    });
  });
});
