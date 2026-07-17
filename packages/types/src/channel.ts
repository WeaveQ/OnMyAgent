import { z } from "zod";

/**
 * Messaging channel type contracts.
 *
 * Shape aligns with Upstream packages/desktop/src/common/types/channel/channel.ts
 * (kept identical at the wire level so REST/SSE payloads can be reused). Adds
 * zod schemas + an `onmyagent-extension.json` manifest schema for the local
 * Extension SDK.
 */

export const channelFieldTypeSchema = z.enum([
  "text",
  "password",
  "select",
  "number",
  "boolean",
]);
export type ChannelFieldType = z.infer<typeof channelFieldTypeSchema>;

export const channelFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  type: channelFieldTypeSchema,
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  placeholder: z.string().optional(),
  description: z.string().optional(),
});
export type ChannelField = z.infer<typeof channelFieldSchema>;

export const channelExtensionMetaSchema = z.object({
  credentialFields: z.array(channelFieldSchema).optional(),
  configFields: z.array(channelFieldSchema).optional(),
  description: z.string().optional(),
  extensionName: z.string().optional(),
  icon: z.string().optional(),
});
export type ChannelExtensionMeta = z.infer<typeof channelExtensionMetaSchema>;

export const channelPluginStatusSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  connected: z.boolean(),
  status: z.string().optional(),
  last_connected: z.number().optional(),
  error: z.string().optional(),
  activeUsers: z.number().int().nonnegative(),
  botUsername: z.string().optional(),
  hasToken: z.boolean().optional(),
  isExtension: z.boolean().optional(),
  extensionMeta: channelExtensionMetaSchema.optional(),
});
export type ChannelPluginStatus = z.infer<typeof channelPluginStatusSchema>;

export const channelPairingRequestSchema = z.object({
  code: z.string(),
  platformUserId: z.string(),
  platformType: z.string(),
  display_name: z.string().optional(),
  requestedAt: z.number(),
  expiresAt: z.number(),
});
export type ChannelPairingRequest = z.infer<typeof channelPairingRequestSchema>;

export const channelUserSchema = z.object({
  id: z.string(),
  platformUserId: z.string(),
  platformType: z.string(),
  display_name: z.string().optional(),
  authorizedAt: z.number(),
  lastActive: z.number().optional(),
  session_id: z.string().optional(),
});
export type ChannelUser = z.infer<typeof channelUserSchema>;

export const channelSessionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  agent_type: z.string(),
  conversation_id: z.string().optional(),
  workspace: z.string().optional(),
  chatId: z.string().optional(),
  created_at: z.number(),
  lastActivity: z.number(),
});
export type ChannelSession = z.infer<typeof channelSessionSchema>;

/** Assistant binding record as read from storage (may include legacy fields). */
export const channelAssistantBindingReadSchema = z.object({
  assistant_id: z.string().optional(),
  /** @deprecated Legacy assistant identity written before assistant-first migration. */
  custom_agent_id: z.string().optional(),
  /** @deprecated Legacy backend-only binding kept for read compatibility. */
  backend: z.string().optional(),
  /** @deprecated Legacy conversation type / backend marker kept for read compatibility. */
  agent_type: z.string().optional(),
  name: z.string().optional(),
});
export type ChannelAssistantBindingRead = z.infer<
  typeof channelAssistantBindingReadSchema
>;

/** New writes must use this shape (assistant-first). */
export const channelAssistantBindingWriteSchema = z.object({
  assistant_id: z.string().min(1),
});
export type ChannelAssistantBindingWrite = z.infer<
  typeof channelAssistantBindingWriteSchema
>;

export const channelDefaultModelSettingSchema = z.object({
  id: z.string(),
  use_model: z.string(),
});
export type ChannelDefaultModelSetting = z.infer<
  typeof channelDefaultModelSettingSchema
>;

export const channelPlatformSettingsSchema = z.object({
  platform: z.string(),
  assistant: channelAssistantBindingReadSchema.nullable(),
  default_model: channelDefaultModelSettingSchema.nullable(),
});
export type ChannelPlatformSettings = z.infer<
  typeof channelPlatformSettingsSchema
>;

/**
 * REST request/response shapes for /api/channel/*.
 * Endpoint list mirrors Upstream ipcBridge.ts channel section.
 */

export const channelEnablePluginRequestSchema = z.object({
  plugin_id: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type ChannelEnablePluginRequest = z.infer<
  typeof channelEnablePluginRequestSchema
>;

export const channelDisablePluginRequestSchema = z.object({
  plugin_id: z.string().min(1),
});
export type ChannelDisablePluginRequest = z.infer<
  typeof channelDisablePluginRequestSchema
>;

export const channelTestPluginRequestSchema = z.object({
  plugin_id: z.string().min(1),
  credentials: z.record(z.string(), z.unknown()),
});
export type ChannelTestPluginRequest = z.infer<
  typeof channelTestPluginRequestSchema
>;

export const channelTestPluginResponseSchema = z.object({
  ok: z.boolean(),
  botUsername: z.string().optional(),
  message: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type ChannelTestPluginResponse = z.infer<
  typeof channelTestPluginResponseSchema
>;

export const channelPairingActionRequestSchema = z.object({
  code: z.string().min(1),
});
export type ChannelPairingActionRequest = z.infer<
  typeof channelPairingActionRequestSchema
>;

export const channelRevokeUserRequestSchema = z.object({
  user_id: z.string().min(1),
});
export type ChannelRevokeUserRequest = z.infer<
  typeof channelRevokeUserRequestSchema
>;

/** SSE event names emitted by apps/server for the channel surface. */
export const CHANNEL_SSE_EVENTS = {
  pairingRequested: "channel.pairing-requested",
  pluginStatusChanged: "channel.plugin-status-changed",
  userAuthorized: "channel.user-authorized",
} as const;
export type ChannelSseEventName =
  (typeof CHANNEL_SSE_EVENTS)[keyof typeof CHANNEL_SSE_EVENTS];

/**
 * Built-in platforms this project targets for parity with Upstream.
 * Extension plugins register additional ids at runtime; keep this list purely
 * informational (renderer must not gate on it).
 */
export const BUILT_IN_CHANNEL_PLUGIN_IDS = [
  "weixin",
  "feishu",
  "lark",
  "wecom",
  "dingtalk",
  "telegram",
] as const;
export type BuiltInChannelPluginId = (typeof BUILT_IN_CHANNEL_PLUGIN_IDS)[number];

/**
 * onmyagent-extension.json manifest schema (Phase D Extension SDK).
 * Mirrors Upstream upstream-extension.json contributes.channelPlugins[] + webui.
 */
export const channelExtensionApiRouteSchema = z.object({
  path: z.string().min(1),
  entryPoint: z.string().min(1),
  description: z.string().optional(),
  auth: z.boolean().optional(),
});
export type ChannelExtensionApiRoute = z.infer<
  typeof channelExtensionApiRouteSchema
>;

export const channelExtensionStaticAssetSchema = z.object({
  urlPrefix: z.string().min(1),
  directory: z.string().min(1),
  description: z.string().optional(),
});
export type ChannelExtensionStaticAsset = z.infer<
  typeof channelExtensionStaticAssetSchema
>;

export const channelExtensionPluginContributionSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  entryPoint: z.string().min(1),
  credentialFields: z.array(channelFieldSchema).optional(),
  configFields: z.array(channelFieldSchema).optional(),
});
export type ChannelExtensionPluginContribution = z.infer<
  typeof channelExtensionPluginContributionSchema
>;

export const onmyagentExtensionManifestSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional(),
  version: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  icon: z.string().optional(),
  i18n: z
    .object({
      localesDir: z.string().optional(),
      defaultLocale: z.string().optional(),
    })
    .optional(),
  contributes: z.object({
    channelPlugins: z.array(channelExtensionPluginContributionSchema).optional(),
    webui: z
      .object({
        apiRoutes: z.array(channelExtensionApiRouteSchema).optional(),
        staticAssets: z.array(channelExtensionStaticAssetSchema).optional(),
      })
      .optional(),
  }),
});
export type OnMyAgentExtensionManifest = z.infer<
  typeof onmyagentExtensionManifestSchema
>;
