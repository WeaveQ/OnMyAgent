/** Shared leaf contracts kept out of the large method inventory. */

export type ServerClientMethodContract<
  Args extends readonly unknown[] = readonly unknown[],
  Result = unknown,
> = {
  args: Args;
  result: Result;
};
type WorkspaceFileMutationOptions = { root?: string };

export type WorkspaceFileMethodMap = {
  deleteWorkspaceFile: ServerClientMethodContract<
    [workspaceId: string, filePath: string, options?: WorkspaceFileMutationOptions & { recursive?: boolean }],
    void
  >;
  mkdirWorkspaceDirectory: ServerClientMethodContract<
    [workspaceId: string, dirPath: string, options?: WorkspaceFileMutationOptions],
    void
  >;
  renameWorkspaceFile: ServerClientMethodContract<
    [workspaceId: string, fromPath: string, toPath: string, options?: WorkspaceFileMutationOptions],
    void
  >;
};

type OpenCodeRouterHealthSnapshot = {
  ok: boolean;
  opencode: Record<string, unknown>;
  channels: Record<string, unknown>;
  config: Record<string, unknown>;
  activity?: {
    inboundToday?: number;
    outboundToday?: number;
    lastMessageAt?: number | null;
    [key: string]: unknown;
  };
  agent?: {
    loaded?: boolean;
    selected?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type OpenCodeRouterTelegramConfig = {
  ok: boolean;
  telegram?: {
    bot?: { username?: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  bot?: { username?: string; [key: string]: unknown };
  [key: string]: unknown;
};

type OpenCodeRouterIdentityItem = {
  id: string;
  channel?: string;
  enabled?: boolean;
  peerId?: string;
  [key: string]: unknown;
};

type OpenCodeRouterIdentityListResult = {
  ok: boolean;
  items: OpenCodeRouterIdentityItem[];
};

type OpenCodeRouterSendResult = {
  ok: boolean;
  sent: number;
  attempted: number;
  failures?: Array<{ identityId: string; peerId: string; error: string }>;
  reason?: string;
  [key: string]: unknown;
};

type OpenCodeRouterIdentityWriteResult = {
  ok: boolean;
  applied?: boolean;
  applyError?: string;
  pairingCode?: string;
  telegram?: OpenCodeRouterTelegramConfig["telegram"];
  [key: string]: unknown;
};

export type OpenCodeRouterMethodMap = {
  getOpenCodeRouterHealth: ServerClientMethodContract<[workspaceId: string], OpenCodeRouterHealthSnapshot>;
  getOpenCodeRouterTelegram: ServerClientMethodContract<[workspaceId: string], OpenCodeRouterTelegramConfig>;
  getOpenCodeRouterTelegramIdentities: ServerClientMethodContract<[workspaceId: string], OpenCodeRouterIdentityListResult>;
  getOpenCodeRouterSlackIdentities: ServerClientMethodContract<[workspaceId: string], OpenCodeRouterIdentityListResult>;
  sendOpenCodeRouterMessage: ServerClientMethodContract<
    [workspaceId: string, payload: { channel: "telegram" | "slack"; text: string; directory?: string; peerId?: string; autoBind?: boolean }],
    OpenCodeRouterSendResult
  >;
  upsertOpenCodeRouterTelegramIdentity: ServerClientMethodContract<
    [workspaceId: string, payload: { token: string; access: "private" | "public"; enabled: boolean; pairingCode?: string }],
    OpenCodeRouterIdentityWriteResult
  >;
  deleteOpenCodeRouterTelegramIdentity: ServerClientMethodContract<[workspaceId: string, identityId: string], OpenCodeRouterIdentityWriteResult>;
  upsertOpenCodeRouterSlackIdentity: ServerClientMethodContract<
    [workspaceId: string, payload: { botToken: string; appToken: string; enabled: boolean }],
    OpenCodeRouterIdentityWriteResult
  >;
  deleteOpenCodeRouterSlackIdentity: ServerClientMethodContract<[workspaceId: string, identityId: string], OpenCodeRouterIdentityWriteResult>;
};
