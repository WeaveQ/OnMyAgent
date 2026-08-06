import { z } from "zod";

/** Product connection phase for Feishu CLI card + onboarding. */
export const larkCliConnectionPhaseSchema = z.enum([
  "not_installed",
  "installed_disconnected",
  "connected_not_logged_in",
  "connected_logged_in",
  "busy",
  "error",
]);

export type LarkCliConnectionPhase = z.infer<typeof larkCliConnectionPhaseSchema>;

export type LarkCliConnectionStatus = {
  phase: LarkCliConnectionPhase;
  installed: boolean;
  installedVersion: string | null;
  appId: string | null;
  brand: "feishu" | "lark" | null;
  userName: string | null;
  userOpenId: string | null;
  userTokenValid: boolean;
  botReady: boolean;
  /** Safe message for UI; never includes secrets. */
  message: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  lastCheckedAt: number;
};

export type LarkCliAuthProgress = {
  operation:
    | "config_init"
    | "manual_credentials"
    | "user_login"
    | "disconnect"
    | "qrcode";
  phase:
    | "starting"
    | "waiting_user"
    | "polling"
    | "complete"
    | "error"
    | "cancelled";
  verificationUrl?: string;
  qrcodeDataUrl?: string;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type LarkCliManualCredentialsInput = {
  appId: string;
  appSecret: string;
  brand?: "feishu" | "lark";
};

export type LarkCliStartUserLoginResult = {
  sessionId: string;
  verificationUrl: string;
  qrcodeDataUrl: string | null;
  /** True when a valid user token already exists — no new device flow. */
  alreadyLoggedIn?: boolean;
};

export const LARK_CLI_OPEN_PLATFORM_APP_URL = "https://open.feishu.cn/app";
