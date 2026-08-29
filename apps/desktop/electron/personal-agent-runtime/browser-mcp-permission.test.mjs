import assert from "node:assert/strict";
import test from "node:test";

import { __test__ } from "./adapters/acp-generic.mjs";

const browserInput = {
  server: "onmyagent-in-app-browser",
  tool: "browser_open_tab",
  arguments: { url: "https://example.com" },
};

test("trusted Local Agent Browser MCP updates render as MCP tools", () => {
  const normalized = __test__.normalizeTrustedLocalAgentBrowserMcpUpdate({
    toolCallId: "browser-call-1",
    title: "mcp.onmyagent-in-app-browser.browser_open_tab",
    kind: "execute",
    rawInput: browserInput,
    _meta: { is_mcp_tool_call: true },
  });

  assert.equal(normalized.kind, "mcp");
  assert.equal(normalized._meta.onmyagent_in_app_browser, true);
  assert.deepEqual(normalized.rawInput, browserInput);
});

test("trusted Local Agent Browser MCP permission skips the generic command approval", () => {
  const operations = new Map();
  __test__.rememberAcpToolOperation(operations, {
    toolCallId: "browser-call-1",
    title: "mcp.onmyagent-in-app-browser.browser_open_tab",
    kind: "mcp",
    rawInput: browserInput,
  });
  const params = {
    toolCall: { toolCallId: "browser-call-1", kind: "execute", status: "pending" },
    _meta: { is_mcp_tool_approval: true },
  };
  const operation = __test__.permissionOperation(
    params,
    "permission-1",
    "session/request_permission",
    "/workspace",
    operations,
  );

  assert.equal(
    __test__.shouldAutoAcceptTrustedLocalAgentBrowserMcpPermission(params, operation),
    true,
  );
  assert.equal(
    __test__.shouldAutoAcceptTrustedLocalAgentBrowserMcpPermission(params, operation, { runId: "local-run-1" }),
    true,
  );
  assert.equal(
    __test__.shouldAutoAcceptTrustedLocalAgentBrowserMcpPermission(params, operation, { taskId: "task-1" }),
    false,
  );
});

test("Browser MCP permission fast path fails closed for spoofed or unknown tools", () => {
  const params = { _meta: { is_mcp_tool_approval: true } };

  assert.equal(
    __test__.shouldAutoAcceptTrustedLocalAgentBrowserMcpPermission(params, {
      input: { ...browserInput, server: "third-party-browser" },
    }),
    false,
  );
  assert.equal(
    __test__.shouldAutoAcceptTrustedLocalAgentBrowserMcpPermission(params, {
      input: { ...browserInput, tool: "browser_eval" },
    }),
    false,
  );
  assert.equal(
    __test__.shouldAutoAcceptTrustedLocalAgentBrowserMcpPermission({}, { input: browserInput }),
    false,
  );
});
