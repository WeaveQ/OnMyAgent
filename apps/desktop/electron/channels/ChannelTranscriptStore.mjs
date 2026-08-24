/**
 * Canonical, userData-only transcript for messaging channels.
 *
 * ChannelSessionStore remains the provider/session context owner. This store
 * is the product-facing conversation timeline: it is keyed by the real
 * platform/account/chat tuple and is therefore safe to read across Agent
 * switches without merging two remote chats accidentally.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { channelEventBus, CHANNEL_EVENTS } from "./ChannelEventBus.mjs";

export const CHANNEL_TRANSCRIPT_VERSION = 1;

const PLATFORM_ALIASES = new Map([
  ["weixin", "wechat"],
  ["wechat", "wechat"],
  ["feishu", "feishu"],
  ["lark", "feishu"],
  ["telegram", "telegram"],
  ["discord", "discord"],
]);

const SENSITIVE_KEY = /(token|secret|password|credential|authorization|cookie|api[-_]?key|private[-_]?key)/i;

export function normalizeChannelPlatform(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return PLATFORM_ALIASES.get(normalized) ?? normalized;
}

function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      result[key] = item;
    }
  }
  return result;
}

function clean(value) {
  return String(value ?? "").trim();
}

function stableDedupeKey(input) {
  const explicit = clean(input.dedupeKey || input.externalId);
  // Provider message ids are only unique within a platform/account/chat and
  // can also be reused by the inbound and outbound sides of a transport.
  // Always scope an explicit id before using it as the canonical key.
  if (explicit) {
    const scoped = [
      normalizeChannelPlatform(input.platformType),
      clean(input.accountId),
      clean(input.chatId),
      clean(input.direction),
      clean(input.source),
      explicit,
    ].join("\u0000");
    return crypto.createHash("sha256").update(scoped).digest("hex");
  }
  const raw = [
    normalizeChannelPlatform(input.platformType),
    clean(input.accountId),
    clean(input.chatId),
    clean(input.direction),
    clean(input.source),
    clean(input.role),
    clean(input.content),
    String(Number(input.timestamp) || 0),
  ].join("\u0000");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function compareMessages(a, b) {
  const timestamp = Number(a.timestamp) - Number(b.timestamp);
  if (timestamp !== 0) return timestamp;
  return String(a.id).localeCompare(String(b.id));
}

export class ChannelTranscriptStore {
  constructor(options = {}) {
    this.userDataDir = String(options.userDataDir ?? "").trim();
    if (!this.userDataDir) throw new Error("userDataDir is required");
    this.eventBus = options.eventBus ?? channelEventBus;
    this.sessionStore = options.sessionStore ?? null;
    this._storagePath = path.join(this.userDataDir, "channel-transcript", "messages.json");
    this._messages = new Map();
    this._dedupe = new Map();
    this._activeAgents = new Map();
    this._writeQueue = Promise.resolve();
    this._initialized = false;
  }

  async initialize(options = {}) {
    if (this._initialized) return;
    if (options.sessionStore) this.sessionStore = options.sessionStore;
    await fs.mkdir(path.dirname(this._storagePath), { recursive: true });
    await this._load();
    await this._backfillLegacySessions();
    this._initialized = true;
  }

  async _load() {
    try {
      const raw = JSON.parse(await fs.readFile(this._storagePath, "utf8"));
      const messages = Array.isArray(raw) ? raw : raw?.messages;
      if (!Array.isArray(messages)) return;
      for (const message of messages) this._hydrate(message);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn(`[ChannelTranscriptStore] Failed to load transcript: ${error?.message ?? error}`);
      }
    }
  }

  _hydrate(input) {
    const platformType = normalizeChannelPlatform(input?.platformType);
    const accountId = clean(input?.accountId);
    const chatId = clean(input?.chatId);
    const content = String(input?.content ?? "");
    if (!platformType || !accountId || !chatId || !content) return null;
    const timestamp = Number(input?.timestamp) || Date.now();
    const id = clean(input?.id) || crypto.randomUUID();
    const message = {
      id,
      platformType,
      accountId,
      chatId,
      platformUserId: clean(input?.platformUserId) || undefined,
      direction: input?.direction === "local" ? "local" : input?.direction === "outbound" ? "outbound" : "inbound",
      role: clean(input?.role) || "user",
      source: clean(input?.source) || "external",
      timestamp,
      externalId: clean(input?.externalId) || undefined,
      agentId: clean(input?.agentId) || undefined,
      agentName: clean(input?.agentName) || undefined,
      content,
      metadata: safeMetadata(input?.metadata),
    };
    const dedupeKey = stableDedupeKey({ ...message, dedupeKey: input?.dedupeKey });
    if (this._dedupe.has(dedupeKey)) return this._messages.get(this._dedupe.get(dedupeKey));
    this._messages.set(id, message);
    this._dedupe.set(dedupeKey, id);
    return message;
  }

  async _backfillLegacySessions() {
    if (!this.sessionStore || typeof this.sessionStore.getAllSessions !== "function") return;
    let changed = false;
    for (const session of this.sessionStore.getAllSessions()) {
      const platformType = normalizeChannelPlatform(session.platformType);
      // Older ChannelSessionStore records did not have a reliable bot
      // account identity. Keep those messages under an explicit sentinel so
      // later account-aware records cannot be mislabeled or merged into the
      // legacy history merely because the peer id was available.
      const accountId = clean(session.accountId || session.metadata?.accountId) || "legacy-unknown-account";
      const chatId = clean(session.chatId || session.platformUserId);
      if (!platformType || !accountId || !chatId) continue;
      for (const legacy of Array.isArray(session.messages) ? session.messages : []) {
        const beforeSize = this._messages.size;
        const message = this._hydrate({
          id: `legacy-${session.id}-${clean(legacy.id) || crypto.createHash("sha1").update(JSON.stringify(legacy)).digest("hex")}`,
          platformType,
          accountId,
          chatId,
          platformUserId: session.platformUserId,
          direction: legacy.role === "assistant" ? "outbound" : "inbound",
          role: legacy.role === "assistant" ? "assistant" : "user",
          source: "legacy",
          timestamp: legacy.timestamp,
          agentId: legacy.metadata?.agentId || session.agentType,
          agentName: legacy.metadata?.agentName,
          content: legacy.content,
          metadata: { legacySessionId: session.id, accountIdentity: accountId === "legacy-unknown-account" ? "legacy-unknown" : "known", ...legacy.metadata },
        });
        if (message && this._messages.size > beforeSize) changed = true;
      }
    }
    if (changed) await this._persist();
  }

  setActiveAgent(input = {}) {
    const key = this._threadKey(input);
    const agentId = clean(input.agentId);
    if (!key || !agentId) return;
    this._activeAgents.set(key, {
      agentId,
      agentName: clean(input.agentName) || undefined,
    });
  }

  async record(input = {}) {
    if (!this._initialized) await this.initialize();
    const platformType = normalizeChannelPlatform(input.platformType);
    const accountId = clean(input.accountId);
    const chatId = clean(input.chatId);
    const content = String(input.content ?? "");
    if (!platformType || !accountId || !chatId || !content) return null;
    const active = this._activeAgents.get(this._threadKey({ platformType, accountId, chatId }));
    const candidate = {
      ...input,
      platformType,
      accountId,
      chatId,
      timestamp: Number(input.timestamp) || Date.now(),
      externalId: input.externalId,
      agentId: input.agentId || active?.agentId,
      agentName: input.agentName || active?.agentName,
      metadata: input.metadata,
    };
    if (input.replaceExisting && clean(candidate.externalId)) {
      const existingId = this._dedupe.get(stableDedupeKey(candidate));
      const existing = existingId ? this._messages.get(existingId) : null;
      if (existing) {
        const message = {
          ...existing,
          content,
          agentId: clean(candidate.agentId) || existing.agentId,
          agentName: clean(candidate.agentName) || existing.agentName,
          metadata: { ...existing.metadata, ...safeMetadata(candidate.metadata) },
        };
        this._messages.set(existing.id, message);
        await this._persist();
        this.eventBus?.publish?.(CHANNEL_EVENTS.TRANSCRIPT_UPDATED, { platformType, accountId, chatId, message });
        return message;
      }
    }
    const previousSize = this._messages.size;
    const message = this._hydrate(candidate);
    if (!message) return null;
    // A replayed provider id resolves to the existing canonical message. Do
    // not rewrite the file or emit a second live event for that duplicate.
    if (this._messages.size === previousSize) return message;
    await this._persist();
    this.eventBus?.publish?.(CHANNEL_EVENTS.TRANSCRIPT_UPDATED, {
      platformType,
      accountId,
      chatId,
      message,
    });
    return message;
  }

  recordInbound(input = {}) {
    return this.record({
      ...input,
      direction: "inbound",
      source: input.source || "external",
      role: input.role || (String(input.content ?? "").trim().startsWith("#") ? "command" : "user"),
    });
  }

  recordOutbound(input = {}) {
    return this.record({
      ...input,
      direction: "outbound",
      source: input.source || "channel",
      role: input.role || "assistant",
    });
  }

  recordOperatorPrompt(input = {}) {
    return this.record({
      ...input,
      direction: "local",
      source: "operator",
      role: "operator",
    });
  }

  recordLocalNotice(input = {}) {
    return this.record({
      ...input,
      direction: "local",
      source: "studio",
      role: input.role || "system",
    });
  }

  _threadKey(input) {
    const platformType = normalizeChannelPlatform(input.platformType);
    const accountId = clean(input.accountId);
    const chatId = clean(input.chatId);
    if (!platformType || !accountId || !chatId) return "";
    return `${platformType}\u0000${accountId}\u0000${chatId}`;
  }

  listThreads(platformType, options = {}) {
    const normalizedPlatform = platformType ? normalizeChannelPlatform(platformType) : "";
    const accountFilter = clean(options.accountId);
    const grouped = new Map();
    for (const message of this._messages.values()) {
      if (normalizedPlatform && message.platformType !== normalizedPlatform) continue;
      if (accountFilter && message.accountId !== accountFilter) continue;
      const key = this._threadKey(message);
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, {
          platformType: message.platformType,
          accountId: message.accountId,
          chatId: message.chatId,
          platformUserId: message.platformUserId,
          messageCount: 1,
          lastMessageAt: message.timestamp,
          lastMessage: message.content,
          lastMessageDirection: message.direction,
          agentId: message.agentId,
        });
      } else {
        current.messageCount += 1;
        if (message.timestamp >= current.lastMessageAt) {
          current.lastMessageAt = message.timestamp;
          current.lastMessage = message.content;
          current.lastMessageDirection = message.direction;
          current.agentId = message.agentId || current.agentId;
          current.platformUserId = message.platformUserId || current.platformUserId;
        }
      }
    }
    return [...grouped.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  read(input = {}) {
    const platformType = normalizeChannelPlatform(input.platformType);
    const accountId = clean(input.accountId);
    const chatId = clean(input.chatId);
    const before = Number(input.before);
    const beforeId = clean(input.beforeId);
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    const messages = [...this._messages.values()]
      .filter((message) => message.platformType === platformType && message.accountId === accountId && message.chatId === chatId)
      .filter((message) => (
        !Number.isFinite(before)
        || message.timestamp < before
        || (Boolean(beforeId) && message.timestamp === before && String(message.id).localeCompare(beforeId) < 0)
      ))
      .sort(compareMessages);
    const page = messages.slice(Math.max(0, messages.length - limit));
    return {
      messages: page,
      hasMore: messages.length > page.length,
      nextBefore: page[0]?.timestamp ?? null,
      nextBeforeId: page[0]?.id ?? null,
    };
  }

  async _persist() {
    const payload = JSON.stringify({ version: CHANNEL_TRANSCRIPT_VERSION, messages: [...this._messages.values()].sort(compareMessages) }, null, 2);
    // Keep later writes usable after one filesystem failure. Each caller still
    // observes its own write error, while the queue itself is healed for the
    // next append/dispose attempt instead of remaining permanently rejected.
    const write = this._writeQueue.catch(() => undefined).then(async () => {
      const tempPath = `${this._storagePath}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(tempPath, payload, { encoding: "utf8", mode: 0o600 });
        const attempts = process.platform === "win32" ? 12 : 3;
        let lastError = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            await fs.rename(tempPath, this._storagePath);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            const code = error && typeof error === "object" ? error.code : undefined;
            if (!["EPERM", "EACCES", "EBUSY", "EEXIST", "ENOENT"].includes(code) || attempt === attempts - 1) break;
            await new Promise((resolve) => setTimeout(resolve, 8 * (attempt + 1)));
          }
        }
        if (lastError) throw lastError;
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    });
    this._writeQueue = write.catch(() => undefined);
    await write;
  }

  async dispose() {
    if (this._initialized) await this._persist();
  }
}

export default ChannelTranscriptStore;
