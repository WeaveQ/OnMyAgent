import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLocalAgentBrowserMcpResolver } from "./local-agent-browser-mcp-resolver.mjs";

function createController({ enabled = true, rpc = true } = {}) {
  return {
    async isAutomationEnabled() { return enabled; },
    browserEnvironment() {
      return rpc
        ? {
            ONMYAGENT_BROWSER_RPC_ENDPOINT: "/tmp/browser.sock",
            ONMYAGENT_BROWSER_RPC_BOOTSTRAP: "bootstrap-secret",
          }
        : {};
    },
  };
}

describe("Local Agent Browser MCP resolver", () => {
  it("builds a conversation-scoped descriptor for Codex and Claude", async () => {
    for (const provider of ["codex", "claude"]) {
      const resolver = createLocalAgentBrowserMcpResolver({
        browserController: createController(),
        execPath: "/Applications/OnMyAgent",
        electronRuntime: true,
        workspaceIdFor: () => "ws_test",
        nonce: () => "nonce",
      });
      const descriptor = await resolver({
        workspaceRoot: "/tmp/workspace",
        conversationId: `conversation-${provider}`,
        agent: { provider, id: `${provider}-agent` },
      });
      const environment = Object.fromEntries(descriptor.env.map((entry) => [entry.name, entry.value]));

      assert.equal(descriptor.command, "/Applications/OnMyAgent");
      assert.equal(
        environment.ONMYAGENT_BROWSER_SESSION_ID,
        `localAgent:ws_test:conversation-${provider}`,
      );
      assert.equal(environment.ONMYAGENT_BROWSER_AGENT_ID, `${provider}-agent`);
      assert.equal(environment.ELECTRON_RUN_AS_NODE, "1");
    }
  });

  it("does not inject when the plugin is disabled or the provider is unsupported", async () => {
    const disabled = createLocalAgentBrowserMcpResolver({
      browserController: createController({ enabled: false }),
    });
    const unsupported = createLocalAgentBrowserMcpResolver({
      browserController: createController(),
    });

    assert.equal(await disabled({
      workspaceRoot: "/tmp/workspace",
      conversationId: "conversation-1",
      agent: { provider: "codex" },
    }), null);
    assert.equal(await unsupported({
      workspaceRoot: "/tmp/workspace",
      conversationId: "conversation-1",
      agent: { provider: "hermes" },
    }), null);
  });

  it("preserves Local Agent chat when Browser RPC is unavailable", async () => {
    const warnings = [];
    const resolver = createLocalAgentBrowserMcpResolver({
      browserController: createController({ rpc: false }),
      warn: (message) => warnings.push(message),
    });

    assert.equal(await resolver({
      workspaceRoot: "/tmp/workspace",
      conversationId: "conversation-1",
      agent: { provider: "claude" },
    }), null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Browser RPC is unavailable/);
  });
});
