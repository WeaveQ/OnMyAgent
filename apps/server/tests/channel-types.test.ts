import { describe, expect, test } from "bun:test";

import {
  BUILT_IN_CHANNEL_PLUGIN_IDS,
  CHANNEL_SSE_EVENTS,
  channelAssistantBindingReadSchema,
  channelAssistantBindingWriteSchema,
  channelEnablePluginRequestSchema,
  channelPairingActionRequestSchema,
  channelPairingRequestSchema,
  channelPlatformSettingsSchema,
  channelPluginStatusSchema,
  channelSessionSchema,
  channelTestPluginRequestSchema,
  channelTestPluginResponseSchema,
  channelUserSchema,
  onmyagentExtensionManifestSchema,
} from "@onmyagent/types/channel";

describe("channel type contracts", () => {
  test("plugin status parses AionUi-shaped payload", () => {
    const parsed = channelPluginStatusSchema.parse({
      id: "weixin",
      type: "weixin",
      name: "微信",
      enabled: true,
      connected: false,
      activeUsers: 0,
      status: "starting",
      isExtension: false,
    });
    expect(parsed.id).toBe("weixin");
  });

  test("plugin status accepts extension meta with typed fields", () => {
    const parsed = channelPluginStatusSchema.parse({
      id: "ext-sample",
      type: "ext-sample",
      name: "Sample",
      enabled: false,
      connected: false,
      activeUsers: 0,
      isExtension: true,
      extensionMeta: {
        credentialFields: [
          { key: "token", label: "Token", type: "password", required: true },
        ],
        configFields: [{ key: "verbose", label: "Verbose", type: "boolean", default: false }],
      },
    });
    expect(parsed.extensionMeta?.credentialFields?.[0]?.type).toBe("password");
  });

  test("pairing / user / session shapes", () => {
    expect(
      channelPairingRequestSchema.parse({
        code: "AB12",
        platformUserId: "u1",
        platformType: "telegram",
        requestedAt: 1,
        expiresAt: 2,
      }).code,
    ).toBe("AB12");
    expect(
      channelUserSchema.parse({
        id: "u",
        platformUserId: "p",
        platformType: "wecom",
        authorizedAt: 0,
      }).platformType,
    ).toBe("wecom");
    expect(
      channelSessionSchema.parse({
        id: "s",
        user_id: "u",
        agent_type: "onmyagent",
        created_at: 0,
        lastActivity: 0,
      }).agent_type,
    ).toBe("onmyagent");
  });

  test("assistant binding read tolerates legacy fields, write demands assistant_id", () => {
    expect(
      channelAssistantBindingReadSchema.parse({
        custom_agent_id: "legacy",
        backend: "codex",
        agent_type: "codex",
      }).custom_agent_id,
    ).toBe("legacy");
    expect(() => channelAssistantBindingWriteSchema.parse({})).toThrow();
    expect(channelAssistantBindingWriteSchema.parse({ assistant_id: "a1" }).assistant_id).toBe("a1");
  });

  test("platform settings, request shapes, sse names", () => {
    channelPlatformSettingsSchema.parse({ platform: "lark", assistant: null, default_model: null });
    channelEnablePluginRequestSchema.parse({ plugin_id: "telegram", config: { credentials: { token: "x" } } });
    channelPairingActionRequestSchema.parse({ code: "AB12" });
    channelTestPluginRequestSchema.parse({ plugin_id: "wecom", credentials: { bot_id: "b", secret: "s" } });
    channelTestPluginResponseSchema.parse({ ok: true, botUsername: "@bot" });
    expect(CHANNEL_SSE_EVENTS.pairingRequested).toBe("channel.pairing-requested");
    expect(BUILT_IN_CHANNEL_PLUGIN_IDS).toContain("telegram");
  });

  test("onmyagent-extension.json manifest schema", () => {
    const manifest = onmyagentExtensionManifestSchema.parse({
      name: "ext-sample",
      version: "0.1.0",
      contributes: {
        channelPlugins: [
          {
            type: "ext-sample",
            name: "Sample Channel",
            entryPoint: "channels/sample.js",
            credentialFields: [{ key: "token", label: "Token", type: "password", required: true }],
          },
        ],
        webui: {
          apiRoutes: [{ path: "/ext-sample/collect", entryPoint: "webui/collector.js", auth: true }],
          staticAssets: [{ urlPrefix: "/ext-sample/assets", directory: "assets" }],
        },
      },
    });
    expect(manifest.contributes.channelPlugins?.[0]?.type).toBe("ext-sample");
  });
});
