import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/core/errors.js";
import {
  buildRuntimeConnectorToolsResponse,
  compileGrokMcpServers,
} from "../src/services/runtime-mcp-projection.js";

describe("runtime MCP projection", () => {
  test("compiles HTTP, SSE, and stdio descriptors to the ACP wire schema", () => {
    expect(compileGrokMcpServers([
      {
        name: "docs",
        transport: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer secret" },
      },
      {
        name: "drive",
        transport: "sse",
        url: "https://example.test/sse?access_token=secret",
      },
      {
        name: "chat",
        transport: "stdio",
        command: "npx",
        args: ["-y", "chat-mcp@1"],
        env: { CLIENT_SECRET: "secret" },
      },
    ])).toEqual([
      {
        type: "http",
        name: "docs",
        url: "https://example.test/mcp",
        headers: [{ name: "Authorization", value: "Bearer secret" }],
      },
      {
        type: "sse",
        name: "drive",
        url: "https://example.test/sse?access_token=secret",
        headers: [],
      },
      {
        name: "chat",
        command: "npx",
        args: ["-y", "chat-mcp@1"],
        env: [{ name: "CLIENT_SECRET", value: "secret" }],
      },
    ]);
  });

  test.each([
    [{ name: "dup", transport: "http", url: "https://a.test" }, { name: "dup", transport: "http", url: "https://b.test" }],
    [{ name: "unsafe", transport: "http", url: "http://example.test" }],
    [{ name: "unsafe", transport: "stdio", command: "npx\nleak" }],
    [{ name: "unsafe", transport: "stdio", command: "npx", env: { "BAD NAME": "value" } }],
  ] as const)("rejects unsafe or ambiguous descriptors", (descriptors) => {
    expect(() => compileGrokMcpServers(descriptors)).toThrow(ApiError);
    try {
      compileGrokMcpServers(descriptors);
    } catch (error) {
      expect(error).toMatchObject({ code: "agent_runtime_mcp_projection_invalid" });
      expect(String(error)).not.toContain("secret");
    }
  });

  test("separates connected accounts from per-runtime tool availability without secrets", () => {
    const response = buildRuntimeConnectorToolsResponse({
      runtimeKind: "grok-build",
      workspaceId: "workspace",
      descriptors: [{
        name: "kdocs",
        transport: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer fixture-secret" },
      }],
      accounts: [
        { connectorId: "kdocs", accountConnected: true, opencodeAvailable: true },
        { connectorId: "dingtalk", accountConnected: true, opencodeAvailable: true },
      ],
    });
    expect(response.items.find((item) => item.connectorId === "kdocs")).toMatchObject({
      accountConnected: true,
      toolAvailable: true,
      reason: "available",
    });
    expect(response.items.find((item) => item.connectorId === "dingtalk")).toMatchObject({
      accountConnected: true,
      toolAvailable: false,
      reason: "runtime_projection_unavailable",
    });
    expect(JSON.stringify(response)).not.toContain("fixture-secret");
    expect(JSON.stringify(response)).not.toContain("example.test");
  });
});
