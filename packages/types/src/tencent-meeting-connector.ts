import { z } from "zod";

/** Product connection phase for the Tencent Meeting connector card. */
export const tencentMeetingConnectionPhaseSchema = z.enum([
  "disconnected",
  "authorizing",
  "connected",
  "busy",
  "error",
]);

export type TencentMeetingConnectionPhase = z.infer<
  typeof tencentMeetingConnectionPhaseSchema
>;

export type TencentMeetingConnectionStatus = {
  phase: TencentMeetingConnectionPhase;
  mcpConfigured: boolean;
  authorized: boolean;
  serverNames: string[];
  message: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastCheckedAt: number;
};

export type TencentMeetingAuthProgress = {
  operation: "connect" | "disconnect" | "refresh";
  phase: "starting" | "materializing" | "complete" | "error" | "cancelled";
  message?: string;
  errorCode?: string;
  errorMessage?: string;
};

export const TENCENT_MEETING_MCP_SERVER_NAME = "tencent-meeting";
/** Official hosted MCP (streamable HTTP). Token via X-Tencent-Meeting-Token. */
export const TENCENT_MEETING_MCP_URL =
  "https://mcp.meeting.tencent.com/mcp/wemeet-open/v1";
export const TENCENT_MEETING_PLUGIN_ID = "tencent-meeting";
/** AI Skill zone where users copy personal tokens. */
export const TENCENT_MEETING_TOKEN_PAGE =
  "https://meeting.tencent.com/ai-skill.html";
