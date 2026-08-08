import { z } from "zod";

/** Product connection phase for the DingTalk (钉钉) connector card. */
export const dingtalkConnectionPhaseSchema = z.enum([
  "disconnected",
  "authorizing",
  "connected",
  "busy",
  "error",
]);

export type DingtalkConnectionPhase = z.infer<
  typeof dingtalkConnectionPhaseSchema
>;

export type DingtalkConnectionStatus = {
  phase: DingtalkConnectionPhase;
  mcpConfigured: boolean;
  authorized: boolean;
  serverNames: string[];
  message: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastCheckedAt: number;
  /** Active dingtalk-mcp profiles (comma-separated ids). */
  activeProfiles?: string | null;
};

export type DingtalkAuthProgress = {
  operation: "connect" | "disconnect" | "refresh";
  phase: "starting" | "materializing" | "complete" | "error" | "cancelled";
  message?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type DingtalkConnectInput = {
  clientId: string;
  clientSecret: string;
  /** Comma-separated ACTIVE_PROFILES; defaults to product set. */
  activeProfiles?: string;
};

export const DINGTALK_MCP_SERVER_NAME = "dingtalk";
export const DINGTALK_PLUGIN_ID = "dingtalk";
export const DINGTALK_MCP_PACKAGE = "dingtalk-mcp@latest";
/** Default capability set for personal/org automation. */
export const DINGTALK_DEFAULT_PROFILES =
  "dingtalk-contacts,dingtalk-calendar,dingtalk-tasks,dingtalk-robot-send-message";
