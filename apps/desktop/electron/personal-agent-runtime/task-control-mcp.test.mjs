import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { createPersonalAgentRuntime } from "./index.mjs";
import { configurePersonalAgentRuntimeState } from "./runtime-state.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Personal runtime Task Center control injection", () => {
  it("passes capability-scoped MCP servers/tools to the provider adapter and preserves depth", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "task-v2-personal-workspace-"));
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "task-v2-personal-userdata-"));
    roots.push(workspaceRoot, runtimeRoot);
    configurePersonalAgentRuntimeState({ runtimeStateRoot: path.join(runtimeRoot, "runtime-state") });
    const seen = [];
    const runtime = createPersonalAgentRuntime({
      userDataDir: runtimeRoot,
      legacy: {
        listAgents: async () => ({ agents: [] }),
        normalizeAgent: async (input) => ({ id: input.id ?? "codex", name: "Fake ACP", provider: "codex", ...input }),
        detectAgent: async (agent) => ({ ...agent, status: "online" }),
        start: async () => ({ status: "legacy-start" }),
        run: async () => ({ status: "legacy-run" }),
        status: () => ({ status: "missing" }),
        cancel: async () => ({ ok: true }),
      },
      adapters: {
        codex: (factoryContext) => ({
          sendMessage: async (sendContext) => {
            seen.push({ factoryContext, sendContext });
            return { output: "fake ACP completed", providerSessionId: "fake-session", resumeKey: "fake-session" };
          },
        }),
      },
    });
    const conversation = await runtime.createConversation({ workspaceRoot, agent: { provider: "codex", id: "codex" }, title: "Task v2" });
    const mcpServers = [{ name: "onmyagent-task-control", command: process.execPath, args: ["bridge", "root", "token"], env: [] }];
    const started = await runtime.startMessage({
      workspaceRoot,
      conversationId: conversation.conversation.id,
      agent: { provider: "codex", id: "codex" },
      prompt: "fake ACP task",
      taskTools: ["list_agents"],
      mcpServers,
      taskDepth: 1,
      taskPermissionMode: "restricted",
    });
    for (let index = 0; index < 40 && runtime.getRun({ runId: started.runId, workspaceRoot }).status === "running"; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].factoryContext.mcpServers, mcpServers);
    assert.deepEqual(seen[0].factoryContext.taskTools, ["list_agents"]);
    assert.deepEqual(seen[0].sendContext.mcpServers, mcpServers);
    assert.deepEqual(seen[0].sendContext.taskTools, ["list_agents"]);
    assert.equal(seen[0].sendContext.taskDepth, 1);
    assert.equal(seen[0].sendContext.taskControlPlane ?? null, null);
    assert.equal(runtime.getRun({ runId: started.runId, workspaceRoot }).status, "completed");
  });
});
