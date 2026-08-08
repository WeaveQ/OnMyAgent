import { z } from "zod";

/** Product connection phase for the WeCom (企业微信) connector card. */
export const wecomConnectionPhaseSchema = z.enum([
  "disconnected",
  "authorizing",
  "connected",
  "busy",
  "error",
]);

export type WecomConnectionPhase = z.infer<typeof wecomConnectionPhaseSchema>;

export type WecomConnectionStatus = {
  phase: WecomConnectionPhase;
  /** wecom-cli bot credentials present under managed config dir. */
  authorized: boolean;
  /** Skill materialized for OpenCode / agent. */
  skillInstalled: boolean;
  /** wecom-cli binary resolvable (npx or PATH). */
  cliAvailable: boolean;
  serverNames: string[];
  message: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastCheckedAt: number;
};

export type WecomAuthProgress = {
  operation: "connect" | "disconnect" | "refresh";
  phase:
    | "starting"
    | "waiting_user"
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

export type WecomStartConnectResult = {
  sessionId: string;
  authorizationUrl: string;
  alreadyConnected?: boolean;
  /** UI should collect Bot ID + Secret instead of QR. */
  needsCredentials?: boolean;
};

export type WecomConnectCredentialsInput = {
  botId: string;
  secret: string;
};

export const WECOM_PLUGIN_ID = "wecom";
export const WECOM_CLI_PACKAGE = "@wecom/cli";
export const WECOM_SKILL_ID = "wecom";
