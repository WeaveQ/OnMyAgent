import path from "node:path";
import { readdir, stat } from "node:fs/promises";

import { createFeishuService } from "./feishu/service.mjs";
import { createWeixinService } from "./weixin/service.mjs";

import {
  channelEventBus,
  CHANNEL_EVENTS,
  ChannelPairingService,
  ChannelSessionStore,
  channelMessageAdapter,
  ChannelPluginRegistry,
  createLegacyServicePlugin,
  createStubPlugin,
  ChannelAssistantBindingStore,
} from "./channels/index.mjs";

/**
 * Messaging channel runtime.
 *
 * Owns:
 * - shared infrastructure (event bus, pairing, sessions, message adapter,
 *   assistant binding store);
 * - a ChannelPluginRegistry that hosts every messaging platform plugin.
 *
 * Built-in platforms this build ships:
 *   weixin, feishu       -> legacy service adapter (transport ready)
 *   lark, wecom,
 *   dingtalk, telegram   -> stub plugin (transport lands in Phase C)
 *
 * Extension-contributed plugins can be registered later via
 * `services.registry.register(...)` at boot time.
 */
export function createMessagingChannelServices(options = {}) {
  const userDataDir = options.userDataDir;
  const personalAgentRuntime = options.personalAgentRuntime;
  const infrastructure = createChannelInfrastructure({ userDataDir });
  const platformServiceOptions = createPlatformServiceOptions({
    userDataDir,
    personalAgentRuntime,
    infrastructure,
  });

  const weixinService = createWeixinService(platformServiceOptions.weixin);
  const feishuService = createFeishuService(platformServiceOptions.feishu);

  const registry = new ChannelPluginRegistry();
  registry.register(createLegacyServicePlugin({
    id: "weixin",
    type: "weixin",
    name: "微信",
    service: weixinService,
  }));
  registry.register(createLegacyServicePlugin({
    id: "feishu",
    type: "feishu",
    name: "飞书",
    service: feishuService,
  }));
  for (const stub of BUILT_IN_STUB_PLUGINS) {
    registry.register(createStubPlugin(stub));
  }

  const services = {
    weixinService,
    feishuService,
    channelEventBus: infrastructure.eventBus,
    pairingService: infrastructure.pairingService,
    sessionStore: infrastructure.sessionStore,
    messageAdapter: infrastructure.messageAdapter,
    assistantBindingStore: infrastructure.assistantBindingStore,
    registry,
  };

  const channelInfrastructureApi = createChannelInfrastructureApi(services);

  return {
    // Platform channel services (legacy accessors kept for main.mjs).
    weixinService,
    feishuService,

    // Shared infrastructure.
    channelEventBus: infrastructure.eventBus,
    pairingService: infrastructure.pairingService,
    sessionStore: infrastructure.sessionStore,
    messageAdapter: infrastructure.messageAdapter,
    assistantBindingStore: infrastructure.assistantBindingStore,

    // Plugin registry (new source of truth).
    registry,

    // Public API for IPC / HTTP exposure.
    channelInfrastructureApi,

    async initialize() {
      await Promise.all([
        infrastructure.pairingService.initialize(),
        infrastructure.sessionStore.initialize(),
        infrastructure.assistantBindingStore.initialize(),
      ]);
      await registry.initializeAll();
      console.log("[channel-runtime] channel infrastructure initialized (plugins=" + registry.size() + ")");
    },

    async dispose() {
      await registry.disposeAll();
      await Promise.all([
        infrastructure.pairingService.dispose(),
        infrastructure.sessionStore.dispose(),
        infrastructure.messageAdapter.dispose(),
        infrastructure.assistantBindingStore.dispose(),
      ]);
      console.log("[channel-runtime] channel infrastructure disposed");
    },
  };
}

const BUILT_IN_STUB_PLUGINS = [
  { id: "lark", type: "lark", name: "Lark" },
  { id: "wecom", type: "wecom", name: "企业微信" },
  { id: "dingtalk", type: "dingtalk", name: "钉钉" },
  { id: "telegram", type: "telegram", name: "Telegram" },
];

function createChannelInfrastructure({ userDataDir }) {
  return {
    eventBus: channelEventBus,
    pairingService: new ChannelPairingService({ userDataDir }),
    sessionStore: new ChannelSessionStore({ userDataDir }),
    messageAdapter: channelMessageAdapter,
    assistantBindingStore: new ChannelAssistantBindingStore({ userDataDir }),
  };
}

function createPlatformServiceOptions({ userDataDir, personalAgentRuntime, infrastructure }) {
  const common = {
    userDataDir,
    personalAgentRuntime,
    channelEventBus: infrastructure.eventBus,
    channelMessageAdapter: infrastructure.messageAdapter,
    channelPairingService: infrastructure.pairingService,
    channelSessionStore: infrastructure.sessionStore,
    channelAssistantBindingStore: infrastructure.assistantBindingStore,
  };

  return {
    weixin: { ...common, appendLog: createChannelLogFn("weixin") },
    feishu: { ...common, appendLog: createChannelLogFn("feishu") },
  };
}

function createChannelLogFn(channelName) {
  return (event) => {
    const text = String(event?.text ?? "").trim();
    if (text) console.warn(`[${channelName}] ${text}`);
  };
}

export async function probeAccessibleRoot(input = {}) {
  const root = String(input?.root ?? input?.folderPath ?? "").trim();
  if (!root) return { ok: false, root, error: "root is required" };
  const resolved = path.resolve(root);
  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) return { ok: false, root: resolved, error: "not a directory" };
    const entries = await readdir(resolved, { withFileTypes: true });
    return { ok: true, root: resolved, readable: true, entryCount: entries.length };
  } catch (error) {
    return { ok: false, root: resolved, readable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export { CHANNEL_EVENTS };
export function createChannelInfrastructureApi(services) {
  const { pairingService, sessionStore, channelEventBus, registry, assistantBindingStore } = services;

  return {
    // --- Pairing Service API ---

    /**
     * Get all pending pairing requests
     * Security: Safe to call - only shows pending requests
     */
    async getPendingPairingRequests() {
      return pairingService.getPendingRequests();
    },

    /**
     * Approve a pairing request
     * Security: This can ONLY be called from local UI, never from remote IM
     */
    async approvePairing(code) {
      if (typeof code !== "string" || code.length !== 6) {
        return { ok: false, error: "Invalid pairing code format" };
      }
      try {
        const result = await pairingService.approvePairing(code);
        return { ok: true, ...result };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /**
     * Deny a pairing request
     * Security: This can ONLY be called from local UI, never from remote IM
     */
    async denyPairing(code) {
      if (typeof code !== "string" || code.length !== 6) {
        return { ok: false, error: "Invalid pairing code format" };
      }
      try {
        await pairingService.denyPairing(code);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    // --- Authorized Users Management API ---

    /**
     * Get all authorized users
     */
    async getAuthorizedUsers() {
      return pairingService.getAuthorizedUsers();
    },

    /**
     * Check if a user is authorized
     */
    async isUserAuthorized(platformType, platformUserId) {
      return pairingService.isUserAuthorized(platformType, platformUserId);
    },

    /**
     * Revoke user authorization
     * Security: This can ONLY be called from local UI
     */
    async revokeUserAuthorization(platformType, platformUserId) {
      try {
        await pairingService.revokeAuthorization(platformType, platformUserId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    // --- Session Store API ---

    /**
     * Get or create a session for a user + agent combination
     */
    async getOrCreateSession(options) {
      try {
        const session = await sessionStore.getOrCreateSession(options);
        return { ok: true, session };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /**
     * Get session by ID
     */
    async getSession(sessionId) {
      const session = sessionStore.getSession(sessionId);
      return session ? { ok: true, session } : { ok: false, error: "Session not found" };
    },

    /**
     * Get all sessions for a platform
     */
    async getSessionsByPlatform(platformType) {
      return sessionStore.getSessionsByPlatform(platformType);
    },

    /**
     * Get all sessions for a user on a platform
     */
    async getSessionsByUser(platformType, platformUserId) {
      return sessionStore.getSessionsByUser(platformType, platformUserId);
    },

    /**
     * Close (archive) a session
     */
    async closeSession(sessionId) {
      try {
        await sessionStore.closeSession(sessionId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /**
     * Update session metadata
     */
    async updateSessionMetadata(sessionId, metadata) {
      try {
        await sessionStore.updateSessionMetadata(sessionId, metadata);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    // --- Event Bus API ---

    /**
     * Subscribe to channel events
     * Returns unsubscribe function
     */
    subscribeToChannelEvents(eventName, handler) {
      return channelEventBus.subscribe(eventName, handler);
    },

    /**
     * Get recent event history
     */
    async getChannelEventHistory(limit, filterEvent) {
      return channelEventBus.getHistory(limit, filterEvent);
    },

    // --- Plugin Registry API (Phase A2/B) ---

    async listChannelPlugins() {
      if (!registry) return [];
      return registry.getPluginStatuses();
    },

    async getChannelPlugin(pluginId) {
      if (!registry) return null;
      const record = registry.get(pluginId);
      if (!record) return null;
      const [status] = await registry.getPluginStatuses();
      return status ?? null;
    },

    async enableChannelPlugin(pluginId /*, config */) {
      const record = registry?.get(pluginId);
      if (!record) return { ok: false, error: `Unknown plugin: ${pluginId}` };
      const service = record.instance?.service ?? record.instance;
      try {
        if (typeof service?.start === "function") {
          await service.start({});
        }
        return { ok: true, pluginId };
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) };
      }
    },

    async disableChannelPlugin(pluginId) {
      const record = registry?.get(pluginId);
      if (!record) return { ok: false, error: `Unknown plugin: ${pluginId}` };
      const service = record.instance?.service ?? record.instance;
      try {
        if (typeof service?.stop === "function") await service.stop();
        return { ok: true, pluginId };
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) };
      }
    },

    // --- Assistant Binding API (Phase A3) ---

    async getPlatformSettings(platform) {
      if (!assistantBindingStore) return null;
      return assistantBindingStore.getPlatformSettings(platform);
    },

    async setPlatformAssistant(platform, write) {
      if (!assistantBindingStore) return { ok: false, error: "binding store unavailable" };
      try {
        const settings = await assistantBindingStore.setAssistant(platform, write);
        return { ok: true, settings };
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) };
      }
    },

    async clearPlatformAssistant(platform) {
      if (!assistantBindingStore) return { ok: false };
      try {
        const settings = await assistantBindingStore.clearAssistant(platform);
        return { ok: true, settings };
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) };
      }
    },

    async setPlatformDefaultModel(platform, setting) {
      if (!assistantBindingStore) return { ok: false };
      try {
        const settings = await assistantBindingStore.setDefaultModel(platform, setting);
        return { ok: true, settings };
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) };
      }
    },
  };
}
