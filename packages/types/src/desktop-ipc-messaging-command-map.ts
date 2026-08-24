import type {
  ChannelAgentPromptInput,
  ChannelAgentPromptResult,
  ChannelProbeResult,
  DesktopChannelAuthorizedUser,
  DesktopChannelEventHistoryEntry,
  DesktopChannelPairingRequest,
  DesktopChannelSession,
  DesktopChannelTranscriptInput,
  DesktopChannelTranscriptPage,
  DesktopChannelTranscriptThread,
  DiscordAccountStatus,
  DiscordAccountStatusInput,
  DiscordSaveAccountInput,
  DiscordServiceStartInput,
  DiscordSimulateInboundInput,
  FeishuAccountStatus,
  FeishuAccountStatusInput,
  FeishuSaveAccountInput,
  FeishuServiceStartInput,
  FeishuSimulateInboundInput,
  MessagingAccessibleRootProbe,
  MessagingChannelStatus,
  TelegramAccountStatus,
  TelegramAccountStatusInput,
  TelegramSaveAccountInput,
  TelegramServiceStartInput,
  TelegramSimulateInboundInput,
  WeixinAccountStatus,
  WeixinAccountStatusInput,
  WeixinLoginPollInput,
  WeixinLoginStartInput,
  WeixinSaveAccountInput,
  WeixinServiceStartInput,
  WeixinSimulateInboundInput,
} from "./desktop-ipc.js";

type Contract<Args extends readonly unknown[] = readonly unknown[], Result = unknown> = {
  args: Args;
  result: Result;
};

type OkResult = { ok: boolean; error?: string };

/** Messaging transports and canonical chat transcript IPC contracts. */
export type DesktopMessagingCommandMap = {
  weixinLoginStart: Contract<[WeixinLoginStartInput?], MessagingChannelStatus>;
  weixinLoginPoll: Contract<[WeixinLoginPollInput], MessagingChannelStatus>;
  weixinSaveAccount: Contract<[WeixinSaveAccountInput], WeixinAccountStatus>;
  weixinAccountStatus: Contract<[WeixinAccountStatusInput?], WeixinAccountStatus>;
  weixinStart: Contract<[WeixinServiceStartInput], MessagingChannelStatus>;
  weixinAutoStart: Contract<[WeixinServiceStartInput?], MessagingChannelStatus>;
  weixinStop: Contract<[], MessagingChannelStatus>;
  weixinStatus: Contract<[], MessagingChannelStatus>;
  weixinSimulateInbound: Contract<[WeixinSimulateInboundInput], MessagingChannelStatus>;
  weixinProbeAccessibleRoot: Contract<[{ root: string } | { folderPath: string }], MessagingAccessibleRootProbe>;

  feishuSaveAccount: Contract<[FeishuSaveAccountInput], FeishuAccountStatus>;
  feishuAccountStatus: Contract<[FeishuAccountStatusInput?], FeishuAccountStatus>;
  feishuStart: Contract<[FeishuServiceStartInput], MessagingChannelStatus>;
  feishuAutoStart: Contract<[FeishuServiceStartInput?], MessagingChannelStatus>;
  feishuStop: Contract<[], MessagingChannelStatus>;
  feishuStatus: Contract<[], MessagingChannelStatus>;
  feishuSimulateInbound: Contract<[FeishuSimulateInboundInput], MessagingChannelStatus>;
  feishuProbeAccessibleRoot: Contract<[{ root: string } | { folderPath: string }], MessagingAccessibleRootProbe>;

  telegramSaveAccount: Contract<[TelegramSaveAccountInput], TelegramAccountStatus>;
  telegramAccountStatus: Contract<[TelegramAccountStatusInput?], TelegramAccountStatus>;
  telegramStart: Contract<[TelegramServiceStartInput], MessagingChannelStatus>;
  telegramAutoStart: Contract<[TelegramServiceStartInput?], MessagingChannelStatus>;
  telegramStop: Contract<[], MessagingChannelStatus>;
  telegramStatus: Contract<[], MessagingChannelStatus>;
  telegramSimulateInbound: Contract<[TelegramSimulateInboundInput], MessagingChannelStatus>;

  discordSaveAccount: Contract<[DiscordSaveAccountInput], DiscordAccountStatus>;
  discordAccountStatus: Contract<[DiscordAccountStatusInput?], DiscordAccountStatus>;
  discordStart: Contract<[DiscordServiceStartInput], MessagingChannelStatus>;
  discordAutoStart: Contract<[DiscordServiceStartInput?], MessagingChannelStatus>;
  discordStop: Contract<[], MessagingChannelStatus>;
  discordStatus: Contract<[], MessagingChannelStatus>;
  discordSimulateInbound: Contract<[DiscordSimulateInboundInput], MessagingChannelStatus>;

  channelTestPlugin: Contract<[{ pluginId: string; accountId?: string }], ChannelProbeResult>;
  channelGetPendingPairingRequests: Contract<[], DesktopChannelPairingRequest[]>;
  channelApprovePairing: Contract<[{ code: string }], OkResult & { user?: DesktopChannelAuthorizedUser }>;
  channelDenyPairing: Contract<[{ code: string }], OkResult>;
  channelGetAuthorizedUsers: Contract<[], DesktopChannelAuthorizedUser[]>;
  channelIsUserAuthorized: Contract<[{ platformType: string; platformUserId: string }], boolean>;
  channelRevokeUserAuthorization: Contract<[{ platformType: string; platformUserId: string }], OkResult>;
  channelGetOrCreateSession: Contract<[
    {
      platformType: string;
      accountId?: string;
      platformUserId: string;
      agentType: string;
      workspace?: string;
      chatId?: string;
    },
  ], OkResult & { session?: DesktopChannelSession }>;
  channelGetSession: Contract<[{ sessionId: string }], OkResult & { session?: DesktopChannelSession }>;
  channelGetSessionsByPlatform: Contract<[{ platformType: string }], DesktopChannelSession[]>;
  channelGetSessionsByUser: Contract<[{ platformType: string; platformUserId: string }], DesktopChannelSession[]>;
  channelGetTranscriptThreads: Contract<[{ platformType: string; accountId?: string }], DesktopChannelTranscriptThread[]>;
  channelGetTranscript: Contract<[DesktopChannelTranscriptInput], DesktopChannelTranscriptPage>;
  channelRunAgentPrompt: Contract<[ChannelAgentPromptInput], ChannelAgentPromptResult>;
  channelCloseSession: Contract<[{ sessionId: string }], OkResult>;
  channelUpdateSessionMetadata: Contract<[{ sessionId: string; metadata: Record<string, unknown> }], OkResult>;
  channelGetEventHistory: Contract<[{ limit?: number; filterEvent?: string }?], DesktopChannelEventHistoryEntry[]>;
};
