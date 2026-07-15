/**
 * Telegram channel service.
 *
 * Owns the Bot API long-polling loop (25s timeout + exponential backoff) and
 * delegates all agent-routing machinery to the shared channel dispatcher
 * (channels/agent-dispatch.mjs). Exposes the same API surface as the Weixin /
 * Feishu services so main.mjs IPC handlers stay symmetric.
 */

import os from "node:os";
import path from "node:path";

import {
  createChannelAgentDispatcher,
} from "../channels/agent-dispatch.mjs";
import {
  createTelegramStore,
} from "./store.mjs";
import {
  getMe,
  getUpdates,
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  normalizeTelegramUpdate,
  TELEGRAM_LONG_POLL_TIMEOUT,
  TELEGRAM_INITIAL_RECONNECT_DELAY,
  TELEGRAM_MAX_RECONNECT_DELAY,
} from "./client.mjs";

const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".onmyagent", "telegram-workspace");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTelegramService(options = {}) {
  const userDataDir = String(options.userDataDir ?? "").trim();
  if (!userDataDir) throw new Error("userDataDir is required for Telegram service");
  const store = options.store ?? createTelegramStore(userDataDir);
  const client = options.client ?? { getMe, getUpdates, sendMessage, editMessageText, answerCallbackQuery };
  const runtime = options.personalAgentRuntime;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const appendLog = typeof options.appendLog === "function" ? options.appendLog : () => undefined;
  const channelPairingService = options.channelPairingService ?? null;
  const channelSessionStore = options.channelSessionStore ?? null;
  const channelEventBus = options.channelEventBus ?? null;
  const channelMessageAdapter = options.channelMessageAdapter ?? null;
  const channelAssistantBindingStore = options.channelAssistantBindingStore ?? null;

  let activeToken = null;
  let pollController = null;
  let pollTask = null;

  const dispatcher = createChannelAgentDispatcher({
    platformType: "telegram",
    platformName: "Telegram",
    runtime,
    store,
    channelPairingService,
    channelSessionStore,
    channelEventBus,
    channelMessageAdapter,
    channelAssistantBindingStore,
    appendLog,
    defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT,
    maxMessageLength: 4096,
    sendTextTo: async (chatId, text) => {
      if (!activeToken) return { ok: false, error: "Telegram not started" };
      return client.sendMessage(activeToken, { chatId, text }, fetchFn);
    },
    editMessageTo: async (chatId, messageId, text) => {
      if (!activeToken) return { ok: false, error: "Telegram not started" };
      return client.editMessageText(activeToken, { chatId, messageId, text }, fetchFn);
    },
    normalizeInbound: (raw) => normalizeTelegramUpdate(raw),
    buildSimulatedInbound: (input) => ({
      message: {
        message_id: input.messageId ?? `sim-${Date.now()}`,
        from: { id: input.fromUserId ?? input.senderId ?? "tg_studio_test_user" },
        chat: { id: input.chatId ?? "tg_studio_test_chat", type: input.chatType === "group" ? "group" : "private" },
        text: String(input.text ?? "ping"),
      },
    }),
    probeTransport: async ({ account }) => {
      const me = await client.getMe(account.token, fetchFn);
      return { botUsername: me?.username ?? undefined, botId: me?.id ?? undefined };
    },
  });

  async function resolveActiveToken(accountId) {
    const id = String(accountId ?? "").trim();
    const account = id ? await store.loadAccount(id) : await store.loadDefaultAccount();
    if (!account?.token) return null;
    return account.token;
  }

  async function pollLoop() {
    let offset = 0;
    let failures = 0;
    while (pollController && !pollController.signal.aborted) {
      try {
        const updates = await client.getUpdates(activeToken, {
          offset,
          timeout: TELEGRAM_LONG_POLL_TIMEOUT,
          fetchFn,
        });
        failures = 0;
        if (updates.length) {
          offset = (updates[updates.length - 1].update_id ?? offset) + 1;
        }
        for (const update of updates) {
          const norm = normalizeTelegramUpdate(update);
          if (!norm) continue;
          if (norm.type === "callback" && norm.callbackQueryId) {
            await client.answerCallbackQuery(activeToken, { callbackQueryId: norm.callbackQueryId }).catch(() => undefined);
          }
          const event = await dispatcher.processInbound(update, {}).catch((error) => {
            appendLog({ type: "error", text: `telegram inbound failed: ${error?.message ?? error}` });
            return null;
          });
          if (event && norm.type === "callback") {
            // Callback queries carry control commands (e.g. quick replies);
            // the dispatcher already routed them above.
          }
        }
      } catch (error) {
        if (pollController?.signal.aborted) return;
        failures += 1;
        const backoff = Math.min(
          TELEGRAM_INITIAL_RECONNECT_DELAY * Math.pow(2, Math.min(failures - 1, 8)),
          TELEGRAM_MAX_RECONNECT_DELAY,
        );
        appendLog({ type: "warn", text: `telegram poll error (attempt ${failures}): ${error?.message ?? error}; retrying in ${Math.round(backoff / 1000)}s` });
        await sleep(backoff);
      }
    }
  }

  async function start(input = {}) {
    const result = await dispatcher.start(input);
    if (result.ok === false) return result;
    const token = await resolveActiveToken(input.accountId ?? result?.account?.accountId);
    if (!token) return { ok: false, error: "Telegram account token missing" };
    activeToken = token;
    if (pollController) pollController.abort();
    pollController = new AbortController();
    pollTask = pollLoop().catch((error) => {
      appendLog({ type: "error", text: `telegram poll loop crashed: ${error?.message ?? error}` });
    });
    return result;
  }

  async function stop(input = {}) {
    if (pollController) pollController.abort();
    pollController = null;
    activeToken = null;
    pollTask = null;
    return dispatcher.stop(input);
  }

  async function saveAccount(input = {}) {
    const account = await dispatcher.saveAccount(input);
    // Enrich with bot identity when a real token is present.
    try {
      const me = await client.getMe(account.account.token, fetchFn);
      if (me?.username) {
        await store.saveAccount({ ...account.account, botUsername: me.username, username: me.username });
        account.account.botUsername = me.username;
      }
    } catch {
      // Token may be invalid or offline; keep what we have.
    }
    return account;
  }

  async function autoStart(input = {}) {
    return dispatcher.autoStart(input);
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

export default createTelegramService;
