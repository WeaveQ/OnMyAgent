import { describe, expect, test } from "bun:test";

import { opencodeBrowserNodeReplToolSource } from "../src/browser-tool-source";

describe("managed Browser Node REPL tool", () => {
  test("binds Browser RPC context to OpenCode hidden execution context", () => {
    const source = opencodeBrowserNodeReplToolSource();
    expect(source).toContain("context.sessionID");
    expect(source).toContain("context.messageID");
    expect(source).toContain("ONMYAGENT_BROWSER_RPC_ENDPOINT");
    expect(source).toContain('method: "getCapability"');
    expect(source).toContain('method: "nodeReplWrite"');
    expect(source).not.toContain("sessionId: tool.schema");
    expect(source).not.toContain("workspaceId: tool.schema");
  });
});
