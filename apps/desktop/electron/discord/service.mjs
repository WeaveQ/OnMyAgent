/**
 * Discord channel service (parity-lite vs Hermes discord adapter).
 *
 * Connects via the discord.js Gateway and delegates all agent-routing
 * machinery to the shared channel dispatcher (channels/agent-dispatch.mjs).
 * Threads are preserved (replies stay in the same thread), and replies stream
 * via sendMessage then message.edit patches (2000-char limit).
 *
 * Exposes the same API surface as the Weixin / Feishu / Telegram services so
 * main.mjs IPC handlers stay symmetric.
 */

import os from "node:os";
import path from "node:path";

import {
  createChannelAgentDispatcher,
} from "../channels/agent-dispatch.mjs";
import {
  createDiscordStore,
} from "./store.mjs";
import {
  createDiscordGateway,
  DISCORD_MESSAGE_LIMIT,
} from "./client.mjs";

const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".onmyagent", "discord-workspace");

function safeSplitList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function createDiscordService(options = {}) {
  const userDataDir = String(options.userDataDir ?? "").trim();
  if (!userDataDir) throw new Error("userDataDir is required for Discord service");
  const store = options.store ?? createDiscordStore(userDataDir);
  const runtime = options.personalAgentRuntime;
  const appendLog = typeof options.appendLog === "function" ? options.appendLog : () => undefined;
  const channelPairingService = options.channelPairingService ?? null;
  const channelSessionStore = options.channelSessionStore ?? null;
  const channelEventBus = options.channelEventBus ?? null;
  const channelMessageAdapter = options.channelMessageAdapter ?? null;
  const channelAssistantBindingStore = options.channelAssistantBindingStore ?? null;
  // Injected transport (tests) or real discord.js gateway.
  const injectedClient = options.client ?? null;

  let gateway = null;
  let activeToken = null;

  const dispatcher = createChannelAgentDispatcher({
    platformType: "discord",
    platformName: "Discord",
    runtime,
    store,
    channelPairingService,
    channelSessionStore,
    channelEventBus,
    channelMessageAdapter,
    channelAssistantBindingStore,
    appendLog,
    defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT,
    maxMessageLength: DISCORD_MESSAGE_LIMIT,
    sendTextTo: async (chatId, text) => {
      if (!gateway) return { ok: false, error: "Discord not started" };
      return gateway.sendMessage(chatId, text);
    },
    editMessageTo: async (chatId, messageId, text) => {
      if (!gateway) return { ok: false, error: "Discord not started" };
      return gateway.editMessage(chatId, messageId, text);
    },
    normalizeInbound: (raw) => raw,
    buildSimulatedInbound: (input) => ({
      senderId: input.fromUserId ?? input.senderId ?? "discord_studio_test_user",
      messageId: input.messageId ?? `sim-${Date.now()}`,
      chatId: input.chatId ?? "discord_studio_test_chat",
      chatType: input.chatType ?? "dm",
      text: String(input.text ?? "ping"),
      raw: null,
    }),
    probeTransport: async ({ account }) => ({ botUsername: account?.botUsername ?? undefined }),
  });

  async function resolveActiveToken(accountId) {
    const id = String(accountId ?? "").trim();
    const account = id ? await store.loadAccount(id) : await store.loadDefaultAccount();
    if (!account?.token) return null;
    return account.token;
  }

  async function start(input = {}) {
    const result = await dispatcher.start(input);
    if (result.ok === false) return result;
    const token = await resolveActiveToken(input.accountId ?? result?.account?.accountId);
    if (!token) return { ok: false, error: "Discord account token missing" };
    activeToken = token;

    const allowedUserIds = safeSplitList(input.allowedUserIds ?? input.allowedUsers);
    const allowAllUsers = Boolean(input.allowAllUsers ?? process.env.DISCORD_ALLOW_ALL_USERS === "true");

    gateway = await createDiscordGateway({
      token,
      allowedUserIds,
      allowAllUsers,
      client: injectedClient,
      onMessage: (event) => {
        console.log(`[discord-diag] onMessage -> processInbound | sender=${event.senderId} chat=${event.chatId} chatType=${event.chatType}`);
        void dispatcher.processInbound(event, {}).catch((error) => {
          appendLog({ type: "error", text: `discord inbound failed: ${error?.message ?? error}` });
        });
      },
      onReady: (user) => {
        if (user?.username) {
          const id = String(input.accountId ?? result?.account?.accountId ?? "").trim();
          if (id) {
            store.saveAccount({ accountId: id, token, botUsername: user.username, allowedUserIds, homeChannelId: String(input.homeChannelId ?? "").trim() || undefined }).catch(() => undefined);
          }
        }
      },
      onError: (error) => appendLog({ type: "error", text: `discord gateway error: ${error?.message ?? error}` }),
    });
    return result;
  }

  async function stop(input = {}) {
    if (gateway) {
      await gateway.destroy().catch(() => undefined);
      gateway = null;
    }
    activeToken = null;
    return dispatcher.stop(input);
  }

  async function saveAccount(input = {}) {
    return dispatcher.saveAccount(input);
  }

  async function autoStart(input = {}) {
    // Must call this service's own `start()` (which connects the discord.js
    // gateway), NOT `dispatcher.autoStart()` — the latter only flips dispatcher
    // state to "running" without ever starting the gateway transport.
    const config = await store.readConfig().catch(() => ({}));
    if (config.autoStart === false && input.force !== true) {
      return { ok: false, skipped: true, reason: "autoStart disabled", status: dispatcher.status() };
    }
    const account = await store.loadDefaultAccount().catch(() => null);
    if (!account?.token) {
      return { ok: false, skipped: true, reason: "no saved Discord account", status: dispatcher.status() };
    }
    return start({ ...(config.lastStartOptions ?? {}), ...input, accountId: account.accountId, autoStart: true });
  }

  async function accountStatus(input = {}) {
    return dispatcher.accountStatus(input);
  }

  async function simulateInbound(input = {}) {
    return dispatcher.simulateInbound(input);
  }

  async function probe(input = {}) {
    return dispatcher.probe(input);
  }

  return {
    start,
    stop,
    status: () => dispatcher.status(),
    accountStatus,
    saveAccount,
    autoStart,
    simulateInbound,
    probe,
    processInbound: (raw, input) => dispatcher.processInbound(raw, input),
    get botUsername() { return dispatcher.botUsername; },
    get hasToken() { return dispatcher.hasToken; },
  };
}

export default createDiscordService;
