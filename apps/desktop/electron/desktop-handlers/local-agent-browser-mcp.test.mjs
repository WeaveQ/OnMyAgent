import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLocalAgentsDomainHandlers } from "./local-agents.mjs";

function createHarness(resolveLocalAgentBrowserMcpServer) {
  const starts = [];
  const runs = [];
  const handlers = createLocalAgentsDomainHandlers({
    personalAgentRuntime: {
      startMessage: async (input) => {
        starts.push(input);
        return { runId: "run-start", conversationId: input.conversationId };
      },
      runMessage: async (input) => {
        runs.push(input);
        return { runId: "run-legacy", conversationId: input.conversationId };
      },
    },
    resolveLocalAgentBrowserMcpServer,
  });
  return { handlers, starts, runs };
}

describe("Local Agent Browser MCP injection", () => {
  it("adds the resolved in-app Browser MCP to ACP sends without dropping existing servers", async () => {
    const browserServer = {
      name: "onmyagent-in-app-browser",
      command: process.execPath,
      args: ["browser-mcp.mjs"],
      env: [],
    };
    const seen = [];
    const harness = createHarness(async (input) => {
      seen.push(input);
      return browserServer;
    });
    const taskServer = {
      name: "onmyagent-task-control",
      command: process.execPath,
      args: ["task-mcp.mjs"],
      env: [],
    };
    const input = {
      workspaceRoot: "/tmp/workspace",
      conversationId: "conversation-1",
      agent: { provider: "codex", id: "codex" },
      prompt: "Use the in-app browser",
      mcpServers: [taskServer],
    };

    await harness.handlers.personalLocalAgentAcpSend(null, [input]);

    assert.equal(seen.length, 1);
    assert.equal(harness.starts.length, 1);
    assert.deepEqual(harness.starts[0].mcpServers, [taskServer, browserServer]);
    assert.deepEqual(input.mcpServers, [taskServer]);
  });

  it("keeps Browser disabled or unsupported sends unchanged when the resolver returns null", async () => {
    const harness = createHarness(async () => null);
    const input = {
      workspaceRoot: "/tmp/workspace",
      conversationId: "conversation-2",
      agent: { provider: "hermes", id: "hermes" },
      prompt: "Do not inject Browser MCP",
    };

    await harness.handlers.personalLocalAgentAcpSend(null, [input]);

    assert.strictEqual(harness.starts[0], input);
    assert.equal(harness.starts[0].mcpServers, undefined);
  });

  it("replaces a stale Browser descriptor and applies the same policy to legacy run spelling", async () => {
    const browserServer = {
      name: "onmyagent-in-app-browser",
      command: process.execPath,
      args: ["browser-mcp.mjs", "fresh"],
      env: [],
    };
    const harness = createHarness(async () => browserServer);
    await harness.handlers.personalLocalAgentRun(null, [{
      workspaceRoot: "/tmp/workspace",
      conversationId: "conversation-3",
      agent: { provider: "claude", id: "claude" },
      prompt: "Use Browser",
      mcpServers: [{ ...browserServer, args: ["browser-mcp.mjs", "stale"] }],
    }]);

    assert.equal(harness.runs.length, 1);
    assert.deepEqual(harness.runs[0].mcpServers, [browserServer]);
  });
});
