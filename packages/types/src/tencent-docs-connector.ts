import { z } from "zod";

/** Product connection phase for the Tencent Docs connector card. */
export const tencentDocsConnectionPhaseSchema = z.enum([
  "disconnected",
  "authorizing",
  "connected",
  "busy",
  "error",
]);

export type TencentDocsConnectionPhase = z.infer<
  typeof tencentDocsConnectionPhaseSchema
>;

export type TencentDocsConnectionStatus = {
  phase: TencentDocsConnectionPhase;
  /** MCP entries written to OpenCode config. */
  mcpConfigured: boolean;
  /** Managed skill present under user skills root. */
  skillInstalled: boolean;
  /** Access token present and not known-expired. */
  authorized: boolean;
  /** Server names managed by this product (main + fine-edit endpoints). */
  serverNames: string[];
  message: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastCheckedAt: number;
};

export type TencentDocsAuthProgress = {
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

export type TencentDocsStartConnectResult = {
  sessionId: string;
  authorizationUrl: string;
  /** True when already authorized — no browser flow. */
  alreadyConnected?: boolean;
};

export const TENCENT_DOCS_MCP_SERVER_MAIN = "tencent-docs";
export const TENCENT_DOCS_MCP_SERVER_DOC = "tencent-docs-doc";
export const TENCENT_DOCS_MCP_SERVER_SHEET = "tencent-docs-sheet";
export const TENCENT_DOCS_MCP_SERVER_SLIDE = "tencent-docs-slide";

export const TENCENT_DOCS_MCP_URL_MAIN = "https://docs.qq.com/openapi/mcp";
export const TENCENT_DOCS_MCP_URL_DOC = "https://docs.qq.com/api/v6/doc/mcp";
export const TENCENT_DOCS_MCP_URL_SHEET = "https://docs.qq.com/api/v6/sheet/mcp";
export const TENCENT_DOCS_MCP_URL_SLIDE = "https://docs.qq.com/api/v6/slide/mcp";

export const TENCENT_DOCS_SKILL_ID = "tencent-docs";
export const TENCENT_DOCS_PLUGIN_ID = "tencent-docs";
