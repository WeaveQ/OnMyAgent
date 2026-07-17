/**
 * Domain wrappers: messaging channels (Weixin/Feishu/Telegram/Discord) Desktop IPC.
 * Public API is re-exported from `./desktop`.
 */
import { invokeDesktopCommand } from "./desktop-invoke";
import type {
  DesktopChannelAuthorizedUser,
  DesktopChannelPairingRequest,
  DesktopChannelSession,
  DiscordAccountStatusInput,
  DiscordSaveAccountInput,
  DiscordServiceStartInput,
  DiscordSimulateInboundInput,
  FeishuAccountStatusInput,
  FeishuSaveAccountInput,
  FeishuServiceStartInput,
  FeishuSimulateInboundInput,
  MessagingChannelStatus,
  TelegramAccountStatusInput,
  TelegramSaveAccountInput,
  TelegramServiceStartInput,
  TelegramSimulateInboundInput,
  WeixinAccountStatusInput,
  WeixinLoginPollInput,
  WeixinLoginStartInput,
  WeixinSaveAccountInput,
  WeixinServiceStartInput,
  WeixinSimulateInboundInput,
} from "./desktop-types";

export const weixinLoginStart = (input?: WeixinLoginStartInput) =>
  invokeDesktopCommand("weixinLoginStart", input ?? {});

export const weixinLoginPoll = (input: WeixinLoginPollInput) =>
  invokeDesktopCommand("weixinLoginPoll", input);

export const weixinSaveAccount = (input: WeixinSaveAccountInput) =>
  invokeDesktopCommand("weixinSaveAccount", input);

export const weixinAccountStatus = (input?: WeixinAccountStatusInput) =>
  invokeDesktopCommand("weixinAccountStatus", input ?? {});

export const weixinStart = (input: WeixinServiceStartInput) =>
  invokeDesktopCommand("weixinStart", input);

export const weixinAutoStart = (input?: WeixinServiceStartInput) =>
  invokeDesktopCommand("weixinAutoStart", input ?? {});

export const weixinStop = () => invokeDesktopCommand("weixinStop");
export const weixinStatus = () => invokeDesktopCommand("weixinStatus");

export const weixinSimulateInbound = (input: WeixinSimulateInboundInput) =>
  invokeDesktopCommand("weixinSimulateInbound", input);

export const weixinProbeAccessibleRoot = (
  input: { root: string } | { folderPath: string },
) => invokeDesktopCommand("weixinProbeAccessibleRoot", input);

export const feishuSaveAccount = (input: FeishuSaveAccountInput) =>
  invokeDesktopCommand("feishuSaveAccount", input);

export const feishuAccountStatus = (input?: FeishuAccountStatusInput) =>
  invokeDesktopCommand("feishuAccountStatus", input ?? {});

export const feishuStart = (input: FeishuServiceStartInput) =>
  invokeDesktopCommand("feishuStart", input);

export const feishuAutoStart = (input?: FeishuServiceStartInput) =>
  invokeDesktopCommand("feishuAutoStart", input ?? {});

export const feishuStop = () => invokeDesktopCommand("feishuStop");
export const feishuStatus = () => invokeDesktopCommand("feishuStatus");

export const feishuSimulateInbound = (input: FeishuSimulateInboundInput) =>
  invokeDesktopCommand("feishuSimulateInbound", input);

export const feishuProbeAccessibleRoot = (
  input: { root: string } | { folderPath: string },
) => invokeDesktopCommand("feishuProbeAccessibleRoot", input);

export const telegramSaveAccount = (input: TelegramSaveAccountInput) =>
  invokeDesktopCommand("telegramSaveAccount", input);

export const telegramAccountStatus = (input?: TelegramAccountStatusInput) =>
  invokeDesktopCommand("telegramAccountStatus", input ?? {});

export const telegramStart = (input: TelegramServiceStartInput) =>
  invokeDesktopCommand("telegramStart", input);

export const telegramAutoStart = (input?: TelegramServiceStartInput) =>
  invokeDesktopCommand("telegramAutoStart", input ?? {});

export const telegramStop = () => invokeDesktopCommand("telegramStop");
export const telegramStatus = () => invokeDesktopCommand("telegramStatus");

export const telegramSimulateInbound = (input: TelegramSimulateInboundInput) =>
  invokeDesktopCommand("telegramSimulateInbound", input);

export const discordSaveAccount = (input: DiscordSaveAccountInput) =>
  invokeDesktopCommand("discordSaveAccount", input);

export const discordAccountStatus = (input?: DiscordAccountStatusInput) =>
  invokeDesktopCommand("discordAccountStatus", input ?? {});

export const discordStart = (input: DiscordServiceStartInput) =>
  invokeDesktopCommand("discordStart", input);

export const discordAutoStart = (input?: DiscordServiceStartInput) =>
  invokeDesktopCommand("discordAutoStart", input ?? {});

export const discordStop = () => invokeDesktopCommand("discordStop");
export const discordStatus = () => invokeDesktopCommand("discordStatus");

export const discordSimulateInbound = (input: DiscordSimulateInboundInput) =>
  invokeDesktopCommand("discordSimulateInbound", input);

// --- Channel connectivity probe (self-check) ---
export function channelTestPlugin(
  pluginId: string,
  input?: { accountId?: string },
) {
  return invokeDesktopCommand("channelTestPlugin", {
    pluginId,
    ...(input ?? {}),
  });
}

export function testChannelConnection(
  kind: TokenChannelKindLike,
  input?: { accountId?: string },
) {
  return channelTestPlugin(kind, input);
}

type TokenChannelKindLike = "telegram" | "discord" | "weixin" | "feishu";

// --- Channel event subscriptions ---
export function onChannelStatus(
  callback: (payload: {
    platformType: string;
    status: MessagingChannelStatus;
  }) => void,
): () => void {
  const api = window.__ONMYAGENT_ELECTRON__;
  if (!api?.channels?.onStatus) return () => {};
  return api.channels.onStatus(callback);
}

export function onChannelPairing(callback: (payload: unknown) => void): () => void {
  const api = window.__ONMYAGENT_ELECTRON__;
  if (!api?.channels?.onPairing) return () => {};
  return api.channels.onPairing(callback);
}

export function onChannelUserAuthorized(
  callback: (payload: unknown) => void,
): () => void {
  const api = window.__ONMYAGENT_ELECTRON__;
  if (!api?.channels?.onUserAuthorized) return () => {};
  return api.channels.onUserAuthorized(callback);
}

// --- Channel Infrastructure API ---
export type ChannelPairingRequest = DesktopChannelPairingRequest;
export type ChannelAuthorizedUser = DesktopChannelAuthorizedUser;
export type ChannelSession = DesktopChannelSession;

export const channelGetPendingPairingRequests = () =>
  invokeDesktopCommand("channelGetPendingPairingRequests");

export const channelApprovePairing = (code: string) =>
  invokeDesktopCommand("channelApprovePairing", { code });

export const channelDenyPairing = (code: string) =>
  invokeDesktopCommand("channelDenyPairing", { code });

export const channelGetAuthorizedUsers = () =>
  invokeDesktopCommand("channelGetAuthorizedUsers");

export const channelIsUserAuthorized = (
  platformType: string,
  platformUserId: string,
) =>
  invokeDesktopCommand("channelIsUserAuthorized", {
    platformType,
    platformUserId,
  });

export const channelRevokeUserAuthorization = (
  platformType: string,
  platformUserId: string,
) =>
  invokeDesktopCommand("channelRevokeUserAuthorization", {
    platformType,
    platformUserId,
  });

export const channelGetOrCreateSession = (options: {
  platformType: string;
  platformUserId: string;
  agentType: string;
  workspace?: string;
  chatId?: string;
}) => invokeDesktopCommand("channelGetOrCreateSession", options);

export const channelGetSession = (sessionId: string) =>
  invokeDesktopCommand("channelGetSession", { sessionId });

export const channelGetSessionsByPlatform = (platformType: string) =>
  invokeDesktopCommand("channelGetSessionsByPlatform", { platformType });

export const channelGetSessionsByUser = (
  platformType: string,
  platformUserId: string,
) =>
  invokeDesktopCommand("channelGetSessionsByUser", {
    platformType,
    platformUserId,
  });

export const channelCloseSession = (sessionId: string) =>
  invokeDesktopCommand("channelCloseSession", { sessionId });

export const channelUpdateSessionMetadata = (
  sessionId: string,
  metadata: Record<string, unknown>,
) =>
  invokeDesktopCommand("channelUpdateSessionMetadata", {
    sessionId,
    metadata,
  });

export const channelGetEventHistory = (
  limit?: number,
  filterEvent?: string,
) =>
  invokeDesktopCommand("channelGetEventHistory", { limit, filterEvent });

// --- End Channel Infrastructure API ---

