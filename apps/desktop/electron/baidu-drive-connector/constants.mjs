/**
 * Baidu Netdisk (百度网盘) remote MCP connector constants.
 */

export const PLUGIN_ID = "baidu-drive";
export const OWNER = "onmyagent";
export const MCP_SERVER_NAME = "baidu-netdisk";
/** Official hosted MCP (SSE). access_token is appended as query param. */
export const MCP_SSE_BASE = "https://mcp-pan.baidu.com/sse";

export const OAUTH_AUTHORIZE_URL = "https://openapi.baidu.com/oauth/2.0/authorize";
export const OAUTH_TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token";
/** netdisk scope required for pan APIs / MCP. */
export const OAUTH_SCOPE = "basic,netdisk";

export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
export const TOKEN_SKEW_MS = 60_000;
export const OAUTH_CALLBACK_PREFERRED_PORTS = Object.freeze([
  19886, 19887, 19888, 19889, 19890,
]);

export const STATE_FILE = "state.json";
export const TOKEN_FILE = "oauth-tokens.json";
