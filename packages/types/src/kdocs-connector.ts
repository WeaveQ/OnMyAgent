import { z } from "zod";

/** Product connection phase for the Kingsoft Docs (金山文档) connector card. */
export const kdocsConnectionPhaseSchema = z.enum([
  "disconnected",
  "authorizing",
  "connected",
  "busy",
  "error",
]);

export type KdocsConnectionPhase = z.infer<typeof kdocsConnectionPhaseSchema>;

export type KdocsConnectionStatus = {
  phase: KdocsConnectionPhase;
  mcpConfigured: boolean;
  authorized: boolean;
  serverNames: string[];
  message: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastCheckedAt: number;
};

export type KdocsAuthProgress = {
  operation: "connect" | "disconnect" | "refresh";
  phase:
    | "starting"
    | "materializing"
    | "complete"
    | "error"
    | "cancelled";
  message?: string;
  errorCode?: string;
  errorMessage?: string;
};

export const KDOCS_MCP_SERVER_NAME = "kdocs";
/** Official Skill Hub MCP (Bearer token). */
export const KDOCS_MCP_URL = "https://mcp-center.wps.cn/skill_hub/mcp";
export const KDOCS_PLUGIN_ID = "kdocs";
