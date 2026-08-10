// Messaging channel desktop IPC wire types (weixin / feishu / telegram / discord).
// Extracted from desktop-ipc.ts (re-exported for public entry compatibility).

import type {
  PersonalLocalAgent,
  PersonalLocalAgentApprovalMode,
} from "./desktop-ipc-local-agents.js";

export type MessagingChannelStatus = {
  status?: string;
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  approvalMode?: PersonalLocalAgentApprovalMode;
  lastError?: string | null;
  lastMessageAt?: number | null;
  lastRunId?: string | null;
  processedCount?: number;
  sentCount?: number;
  [key: string]: unknown;
};

export type MessagingAccessibleRootProbe = {
  ok: boolean;
  root: string;
  readable?: boolean;
  entryCount?: number;
  error?: string;
};

export type WeixinLoginStartInput = { baseUrl?: string };
export type WeixinLoginPollInput = {
  qrcode: string;
  baseUrl?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
};
export type WeixinSaveAccountInput = { accountId: string; token: string; baseUrl?: string };
export type WeixinAccountStatusInput = { accountId?: string };
export type WeixinServiceStartInput = {
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  autoStart?: boolean;
};
export type WeixinSimulateInboundInput = {
  accountId?: string;
  fromUserId?: string;
  chatId?: string;
  text: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  textBatchDelayMs?: number;
};

export type FeishuConnectionMode = "websocket" | "webhook";
export type FeishuSaveAccountInput = {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  baseUrl?: string;
};
export type FeishuAccountStatusInput = { accountId?: string };
export type FeishuServiceStartInput = {
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  connectionMode?: FeishuConnectionMode;
  dmPolicy?: string;
  allowedUsers?: string[];
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  autoStart?: boolean;
};
export type FeishuSimulateInboundInput = {
  accountId?: string;
  fromUserId?: string;
  chatId?: string;
  text: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  connectionMode?: FeishuConnectionMode;
  dmPolicy?: string;
  allowedUsers?: string[];
  textBatchDelayMs?: number;
};

export type WeixinAccountStatus = {
  ok: boolean;
  account?: {
    accountId: string;
    baseUrl: string;
    cdnBaseUrl: string;
    userId: string;
    savedAt: string | null;
    hasToken: boolean;
    tokenPreview: string;
  } | null;
  status?: MessagingChannelStatus;
  error?: string;
};

export type FeishuAccountStatus = {
  ok: boolean;
  account?: {
    accountId: string;
    appId: string;
    baseUrl: string;
    savedAt: string | null;
    hasAppSecret: boolean;
    appSecretPreview: string;
    hasVerificationToken: boolean;
    hasEncryptKey: boolean;
  } | null;
  status?: MessagingChannelStatus;
  config?: MessagingChannelStatus;
  error?: string;
};

export type TelegramSaveAccountInput = { accountId: string; token: string };
export type TelegramAccountStatusInput = { accountId?: string };
export type TelegramServiceStartInput = {
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  allowedUserIds?: string[];
  autoStart?: boolean;
};
export type TelegramSimulateInboundInput = {
  accountId?: string;
  fromUserId?: string;
  chatId?: string;
  text: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  textBatchDelayMs?: number;
};
export type TelegramAccountStatus = {
  ok: boolean;
  account?: {
    accountId: string;
    botUsername?: string;
    hasToken?: boolean;
    [key: string]: unknown;
  } | null;
  status?: MessagingChannelStatus;
  config?: MessagingChannelStatus;
  error?: string;
};

export type DiscordSaveAccountInput = {
  accountId: string;
  token: string;
  allowedUserIds?: string[];
};
export type DiscordAccountStatusInput = { accountId?: string };
export type DiscordServiceStartInput = {
  accountId?: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  allowedUserIds?: string[];
  autoStart?: boolean;
};
export type DiscordSimulateInboundInput = {
  accountId?: string;
  fromUserId?: string;
  chatId?: string;
  text: string;
  workspaceRoot?: string;
  accessibleWorkspaceRoots?: string[];
  agent?: Partial<PersonalLocalAgent>;
  availableAgents?: Array<Partial<PersonalLocalAgent>>;
  approvalMode?: PersonalLocalAgentApprovalMode;
  promptMode?: "raw" | "debug";
  dmPolicy?: string;
  allowedUsers?: string[];
  textBatchDelayMs?: number;
};
export type DiscordAccountStatus = {
  ok: boolean;
  account?: {
    accountId: string;
    botUsername?: string;
    hasToken?: boolean;
    allowedUserIds?: string[];
    [key: string]: unknown;
  } | null;
  status?: MessagingChannelStatus;
  config?: MessagingChannelStatus;
  error?: string;
};

// ---------------------------------------------------------------------------
// Messaging channel infrastructure (desktop IPC wire shapes)
// ---------------------------------------------------------------------------

export type ChannelProbeResult = {
  ok: boolean;
  botUsername?: string;
  hasToken?: boolean;
  error?: string;
};

export type DesktopChannelPairingRequest = {
  code: string;
  platformType: string;
  platformUserId: string;
  displayName?: string;
  requestedAt: number;
  expiresAt: number;
  status: string;
};

export type DesktopChannelAuthorizedUser = {
  id: string;
  platformType: string;
  platformUserId: string;
  displayName?: string;
  authorizedAt: number;
  lastActive?: number;
};

export type DesktopChannelSession = {
  id: string;
  platformType: string;
  platformUserId: string;
  agentType: string;
  workspace?: string;
  chatId?: string;
  createdAt: number;
  lastActivity: number;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
  }>;
  metadata: Record<string, unknown>;
  closedAt?: number;
};

export type DesktopChannelEventHistoryEntry = {
  id: string;
  name: string;
  payload: unknown;
  timestamp: number;
};
