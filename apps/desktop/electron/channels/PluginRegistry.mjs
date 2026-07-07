/**
 * ChannelPluginRegistry
 *
 * Runtime registry of messaging channel plugins. Replaces the old
 * hard-wired createFeishuService/createWeixinService factory pair in
 * channel-runtime.mjs so the surface can grow (lark/wecom/dingtalk/telegram
 * + extension-contributed plugins) without touching main.mjs.
 *
 * Two plugin shapes are supported:
 *
 *   1. Native BaseChannelPlugin subclass (preferred long-term)
 *   2. LegacyServicePlugin adapter that wraps an existing service object
 *      exposing `start/stop/status/autoStart/...`. This lets weixin/feishu
 *      keep their current bodies while participating in the registry.
 */

import { channelEventBus, CHANNEL_EVENTS } from "./ChannelEventBus.mjs";
import { CHANNEL_STATES } from "./BaseChannelPlugin.mjs";

export const PLUGIN_TRANSPORT_STATE = {
  READY: "ready",
  STUB: "stub",
};

export class ChannelPluginRegistry {
  constructor() {
    this._plugins = new Map();
    this._disposed = false;
  }

  register(entry) {
    if (this._disposed) throw new Error("[PluginRegistry] Registry disposed");
    if (!entry || typeof entry.id !== "string" || !entry.id.trim()) {
      throw new Error("[PluginRegistry] entry.id is required");
    }
    if (this._plugins.has(entry.id)) {
      throw new Error(`[PluginRegistry] plugin already registered: ${entry.id}`);
    }
    const record = {
      id: entry.id,
      type: entry.type ?? entry.id,
      name: entry.name ?? entry.id,
      isExtension: Boolean(entry.isExtension),
      transport: entry.transport ?? PLUGIN_TRANSPORT_STATE.READY,
      instance: entry.instance,
      extensionMeta: entry.extensionMeta ?? undefined,
    };
    this._plugins.set(entry.id, record);
    channelEventBus.publish(CHANNEL_EVENTS.CHANNEL_INITIALIZED, {
      channelId: record.id,
      transport: record.transport,
    });
    return record;
  }

  unregister(id) {
    return this._plugins.delete(id);
  }

  get(id) {
    return this._plugins.get(id) ?? null;
  }

  list() {
    return Array.from(this._plugins.values());
  }

  ids() {
    return Array.from(this._plugins.keys());
  }

  size() {
    return this._plugins.size;
  }

  /**
   * Aggregate status snapshot in the ChannelPluginStatus wire shape defined by
   * @onmyagent/types/channel. Consumed by /api/channel/plugins.
   */
  async getPluginStatuses() {
    const out = [];
    for (const record of this._plugins.values()) {
      const instance = record.instance;
      const raw = typeof instance?.status === "function"
        ? await Promise.resolve(instance.status()).catch(() => null)
        : null;
      out.push(normalizePluginStatus(record, raw));
    }
    return out;
  }

  async initializeAll() {
    const promises = [];
    for (const record of this._plugins.values()) {
      const instance = record.instance;
      if (typeof instance?.initialize === "function") {
        promises.push(Promise.resolve(instance.initialize()).catch((error) => {
          console.warn(`[PluginRegistry] initialize failed for ${record.id}:`, error?.message ?? error);
        }));
      }
    }
    await Promise.all(promises);
  }

  async disposeAll() {
    this._disposed = true;
    const promises = [];
    for (const record of this._plugins.values()) {
      const instance = record.instance;
      if (typeof instance?.dispose === "function") {
        promises.push(Promise.resolve(instance.dispose()).catch(() => undefined));
      } else if (typeof instance?.stop === "function") {
        promises.push(Promise.resolve(instance.stop()).catch(() => undefined));
      }
    }
    await Promise.all(promises);
    this._plugins.clear();
  }
}

function normalizePluginStatus(record, raw) {
  const status = raw && typeof raw === "object" ? raw : {};
  const running = status.status === "running" || status.websocketState === "open";
  const enabled = Boolean(status.enabled ?? (record.transport === PLUGIN_TRANSPORT_STATE.READY));
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    enabled,
    connected: Boolean(running),
    status: typeof status.status === "string" ? status.status : (running ? "running" : "stopped"),
    last_connected: typeof status.lastMessageAt === "number" ? status.lastMessageAt : undefined,
    error: typeof status.lastError === "string" ? status.lastError : (typeof status.error === "string" ? status.error : undefined),
    activeUsers: Number.isFinite(Number(status.activeUsers)) ? Number(status.activeUsers) : 0,
    botUsername: typeof status.botUsername === "string" ? status.botUsername : undefined,
    hasToken: typeof status.hasToken === "boolean" ? status.hasToken : undefined,
    isExtension: record.isExtension || undefined,
    extensionMeta: record.extensionMeta,
  };
}

/**
 * Wrap an existing service object (weixin/feishu style) into the plugin
 * interface consumed by the registry.
 */
export function createLegacyServicePlugin(options) {
  const service = options.service;
  if (!service) throw new Error("createLegacyServicePlugin: service is required");
  return {
    id: options.id,
    type: options.type ?? options.id,
    name: options.name ?? options.id,
    transport: PLUGIN_TRANSPORT_STATE.READY,
    instance: {
      service,
      status: () => (typeof service.status === "function" ? service.status() : null),
      initialize: async () => undefined,
      start: async (...args) => (typeof service.start === "function" ? service.start(...args) : undefined),
      stop: async (...args) => (typeof service.stop === "function" ? service.stop(...args) : undefined),
      dispose: async () => undefined,
    },
  };
}

/**
 * Placeholder plugin for platforms whose transport is scheduled for Phase C.
 * Reports STUB status so the UI can render the plugin card and settings form
 * without falsely claiming a live connection.
 */
export function createStubPlugin(options) {
  const state = { enabled: false, lastError: undefined };
  const instance = {
    async initialize() {
      return undefined;
    },
    async start() {
      state.enabled = true;
      state.lastError = "transport not implemented yet";
      return { ok: false, error: state.lastError };
    },
    async stop() {
      state.enabled = false;
      return { ok: true };
    },
    status() {
      return {
        status: state.enabled ? "pending_transport" : "stopped",
        enabled: state.enabled,
        activeUsers: 0,
        lastError: state.lastError,
      };
    },
    async dispose() {
      state.enabled = false;
    },
  };
  return {
    id: options.id,
    type: options.type ?? options.id,
    name: options.name ?? options.id,
    transport: PLUGIN_TRANSPORT_STATE.STUB,
    instance,
  };
}

/**
 * Convenience helper: is a channel state considered running?
 */
export function isRunningStatus(status) {
  return status === CHANNEL_STATES.RUNNING || status === "running";
}
