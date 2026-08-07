/**
 * Tencent Docs connector constants (remote MCP + OAuth, no binary download).
 */

export const PLUGIN_ID = "tencent-docs";
export const SKILL_ID = "tencent-docs";
export const OWNER = "onmyagent";

export const MCP_SERVERS = Object.freeze([
  {
    name: "tencent-docs",
    url: "https://docs.qq.com/openapi/mcp",
    role: "main",
  },
  {
    name: "tencent-docs-doc",
    url: "https://docs.qq.com/api/v6/doc/mcp",
    role: "doc",
  },
  {
    name: "tencent-docs-sheet",
    url: "https://docs.qq.com/api/v6/sheet/mcp",
    role: "sheet",
  },
  {
    name: "tencent-docs-slide",
    url: "https://docs.qq.com/api/v6/slide/mcp",
    role: "slide",
  },
]);

export const MCP_SERVER_NAMES = Object.freeze(MCP_SERVERS.map((s) => s.name));

export const MAIN_MCP_URL = MCP_SERVERS[0].url;

/** OAuth discovery (SDK also discovers; used by manual PKCE flow). */
export const OAUTH_RESOURCE_METADATA_URL =
  "https://docs.qq.com/openapi/mcp/.well-known/oauth-protected-resource";
export const OAUTH_AUTHORIZATION_SERVER_METADATA_URL =
  "https://docs.qq.com/.well-known/oauth-authorization-server";

export const CLIENT_NAME = "OnMyAgent";
export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
export const TOKEN_SKEW_MS = 60_000;

export const MANAGED_MARKER_FILE = ".onmyagent-managed.json";
export const STATE_FILE = "state.json";
export const TOKEN_FILE = "oauth-tokens.json";
export const CLIENT_FILE = "oauth-client.json";
