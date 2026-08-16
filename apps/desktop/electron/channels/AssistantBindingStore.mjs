/**
 * ChannelAssistantBindingStore
 *
 * Per-channel (optionally per-chat) assistant + default-model binding.
 * Replaces the in-memory `agentByChat` Map inside weixin/feishu services
 * with disk persistence so bindings survive restart and can be surfaced by
 * `/api/channel/settings/:platform` REST endpoints.
 *
 * Load migrates leftover `custom_agent_id` rows to `assistant_id` once, then
 * the runtime only reads `assistant_id`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { channelEventBus, CHANNEL_EVENTS } from "./ChannelEventBus.mjs";

const FILE_NAME = "assistant-bindings.json";

export class ChannelAssistantBindingStore {
  constructor(options = {}) {
    this.userDataDir = options.userDataDir;
    this._storagePath = null;
    this._data = { platforms: {} };
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) return;
    if (!this.userDataDir) throw new Error("[AssistantBindingStore] userDataDir is required");
    this._storagePath = path.join(this.userDataDir, "channel-settings");
    await fs.mkdir(this._storagePath, { recursive: true });
    await this._load();
    this._initialized = true;
  }

  async dispose() {
    await this._save().catch(() => undefined);
  }

  /** Returns the Upstream-shaped platform settings blob. */
  getPlatformSettings(platform) {
    const key = normalizePlatform(platform);
    const record = this._data.platforms[key] ?? null;
    return {
      platform: key,
      assistant: normalizeReadBinding(record?.assistant ?? null),
      default_model: record?.default_model ?? null,
    };
  }

  async setAssistant(platform, write) {
    const key = normalizePlatform(platform);
    if (!write || typeof write.assistant_id !== "string" || !write.assistant_id.trim()) {
      throw new Error("[AssistantBindingStore] assistant_id is required");
    }
    const record = ensurePlatformRecord(this._data, key);
    record.assistant = { assistant_id: write.assistant_id, name: write.name };
    await this._save();
    channelEventBus.publish(CHANNEL_EVENTS.SESSION_UPDATED, {
      platform: key,
      assistant: record.assistant,
    });
    return this.getPlatformSettings(key);
  }

  async clearAssistant(platform) {
    const key = normalizePlatform(platform);
    const record = ensurePlatformRecord(this._data, key);
    record.assistant = null;
    await this._save();
    return this.getPlatformSettings(key);
  }

  async setDefaultModel(platform, setting) {
    const key = normalizePlatform(platform);
    if (!setting || typeof setting.id !== "string" || typeof setting.use_model !== "string") {
      throw new Error("[AssistantBindingStore] default model requires id + use_model");
    }
    const record = ensurePlatformRecord(this._data, key);
    record.default_model = { id: setting.id, use_model: setting.use_model };
    await this._save();
    return this.getPlatformSettings(key);
  }

  async setChatAssistant(platform, chatId, write) {
    const key = normalizePlatform(platform);
    const chatKey = String(chatId ?? "").trim();
    if (!chatKey) throw new Error("[AssistantBindingStore] chatId is required");
    if (!write || typeof write.assistant_id !== "string" || !write.assistant_id.trim()) {
      throw new Error("[AssistantBindingStore] assistant_id is required");
    }
    const record = ensurePlatformRecord(this._data, key);
    record.byChat = record.byChat || {};
    record.byChat[chatKey] = { assistant_id: write.assistant_id };
    await this._save();
    return record.byChat[chatKey];
  }

  getChatAssistant(platform, chatId) {
    const key = normalizePlatform(platform);
    const chatKey = String(chatId ?? "").trim();
    const byChat = this._data.platforms?.[key]?.byChat ?? {};
    return normalizeReadBinding(byChat[chatKey] ?? null);
  }

  listPlatforms() {
    return Object.keys(this._data.platforms ?? {});
  }

  async _load() {
    const filePath = path.join(this._storagePath, FILE_NAME);
    try {
      const text = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && parsed.platforms) {
        const migrated = migrateBindingsFile(parsed);
        this._data = migrated.data;
        if (migrated.changed) await this._save();
      }
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        console.warn("[AssistantBindingStore] failed to load:", error?.message ?? error);
      }
    }
  }

  async _save() {
    if (!this._storagePath) return;
    const filePath = path.join(this._storagePath, FILE_NAME);
    await fs.writeFile(filePath, JSON.stringify(this._data, null, 2), "utf8");
  }
}

function normalizePlatform(platform) {
  const key = String(platform ?? "").trim().toLowerCase();
  if (!key) throw new Error("[AssistantBindingStore] platform is required");
  return key;
}

function ensurePlatformRecord(data, key) {
  data.platforms = data.platforms ?? {};
  data.platforms[key] = data.platforms[key] ?? {
    assistant: null,
    default_model: null,
    byChat: {},
  };
  return data.platforms[key];
}

function normalizeReadBinding(raw) {
  if (!raw || typeof raw !== "object") return null;
  const assistantId =
    typeof raw.assistant_id === "string" && raw.assistant_id.trim()
      ? raw.assistant_id.trim()
      : typeof raw.custom_agent_id === "string" && raw.custom_agent_id.trim()
        ? raw.custom_agent_id.trim()
        : "";
  if (!assistantId) return null;
  const out = { assistant_id: assistantId };
  if (typeof raw.name === "string") out.name = raw.name;
  return out;
}

function migrateBindingsFile(parsed) {
  const platforms = parsed.platforms && typeof parsed.platforms === "object" ? parsed.platforms : {};
  let changed = false;
  const nextPlatforms = {};
  for (const [key, record] of Object.entries(platforms)) {
    if (!record || typeof record !== "object") {
      nextPlatforms[key] = record;
      continue;
    }
    const assistant = normalizeReadBinding(record.assistant ?? null);
    const byChat = {};
    for (const [chatId, binding] of Object.entries(record.byChat ?? {})) {
      const next = normalizeReadBinding(binding);
      if (next) byChat[chatId] = next;
    }
    if (
      JSON.stringify(assistant) !== JSON.stringify(record.assistant ?? null) ||
      JSON.stringify(byChat) !== JSON.stringify(record.byChat ?? {})
    ) {
      changed = true;
    }
    nextPlatforms[key] = {
      ...record,
      assistant,
      byChat,
    };
  }
  return { data: { ...parsed, platforms: nextPlatforms }, changed };
}
