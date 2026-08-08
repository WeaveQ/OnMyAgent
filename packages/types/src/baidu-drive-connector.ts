import { z } from "zod";

/** Product connection phase for the Baidu Netdisk connector card. */
export const baiduDriveConnectionPhaseSchema = z.enum([
  "disconnected",
  "authorizing",
  "connected",
  "busy",
  "error",
]);

export type BaiduDriveConnectionPhase = z.infer<
  typeof baiduDriveConnectionPhaseSchema
>;

export type BaiduDriveConnectionStatus = {
  phase: BaiduDriveConnectionPhase;
  /** MCP entry written to OpenCode config. */
  mcpConfigured: boolean;
  /** Access token present. */
  authorized: boolean;
  serverNames: string[];
  message: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastCheckedAt: number;
  /** True when product OAuth client id is configured (browser connect available). */
  oauthConfigured?: boolean;
};

export type BaiduDriveAuthProgress = {
  operation: "connect" | "disconnect" | "refresh";
  phase:
    | "starting"
    | "waiting_user"
    | "exchanging"
    | "materializing"
    | "complete"
    | "error"
    | "cancelled"
    | "expired";
  authorizationUrl?: string;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type BaiduDriveStartConnectResult = {
  sessionId: string;
  authorizationUrl: string;
  alreadyConnected?: boolean;
  /** When true, UI should collect a pasted access_token instead of browser OAuth. */
  needsAccessToken?: boolean;
};

export const BAIDU_DRIVE_MCP_SERVER_NAME = "baidu-netdisk";
export const BAIDU_DRIVE_MCP_SSE_BASE = "https://mcp-pan.baidu.com/sse";
export const BAIDU_DRIVE_PLUGIN_ID = "baidu-drive";
