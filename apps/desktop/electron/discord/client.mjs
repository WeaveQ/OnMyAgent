/**
 * Discord gateway client (parity-lite vs Hermes discord adapter).
 *
 * Connects via discord.js v14 Gateway with the minimal intent set
 * (Guilds / GuildMessages / DirectMessages / MessageContent), filters inbound
 * by an allowed-user list, preserves thread ids so replies stay in-thread, and
 * exposes send/edit for the streaming-patch reply path.
 *
 * discord.js is imported dynamically so this module loads even when the package
 * is not yet installed (e.g. unit tests inject a mock client).
 */

import { createRequire } from "node:module";
import path from "node:path";
import { ProxyAgent } from "undici";
import { resolveActiveProxy } from "../proxy-fetch.mjs";

export const DISCORD_MESSAGE_LIMIT = 2000;

const REQUIRED_INTENTS = ["Guilds", "GuildMessages", "DirectMessages", "MessageContent"];

// discord.js neither reads HTTPS_PROXY nor exposes a proxy option. In Node,
// @discordjs/ws uses the `ws` package (NOT the global WebSocket) for the
// gateway and captures `ws.WebSocket` into `WebSocketConstructor` at
// module-load time; the REST API (@discordjs/rest) uses undici fetch. To route
// BOTH through the configured proxy — and ONLY discord's traffic, without
// hijacking the process-wide global dispatcher (which would force every other
// in-app HTTPS request through the proxy and cause stray TLS errors / crashes):
//   1. inject a *local* undici ProxyAgent into the Client's `rest.agent`
//      option (covers REST), and
//   2. monkey-patch `ws.WebSocket` to a subclass that injects an
//      https-proxy-agent (covers the gateway WebSocket).
// Both are applied once, before `discord.js` is imported. No-op with no proxy.
let discordProxyApplied = false;
let discordRestAgent = null;
function applyDiscordProxyOnce() {
  if (discordProxyApplied) return;
  discordProxyApplied = true;
  const proxyUrl = resolveActiveProxy();
  if (!proxyUrl) return;
  // 1) REST API (undici fetch inside @discordjs/rest) routes through a
  //    *local* dispatcher injected via the Client's `rest.agent` option — this
  //    does NOT touch the global undici dispatcher, so unrelated in-app HTTPS
  //    requests keep using their normal (direct) path.
  discordRestAgent = new ProxyAgent(proxyUrl);
  // 2) Gateway WebSocket via `ws` + https-proxy-agent. Resolve ws from
  //    discord.js' dependency tree (this app does not depend on ws directly).
  const req = createRequire(import.meta.url);
  const discordJsDir = path.dirname(req.resolve("discord.js"));
  const wsModule = req(req.resolve("ws", { paths: [discordJsDir] }));
  const { HttpsProxyAgent } = req(
    req.resolve("https-proxy-agent", { paths: [discordJsDir] })
  );
  const agent = new HttpsProxyAgent(proxyUrl);
  const OriginalWebSocket = wsModule.WebSocket;
  class ProxiedWebSocket extends OriginalWebSocket {
    constructor(address, protocols, options = {}) {
      super(address, protocols, { ...options, agent });
    }
  }
  wsModule.WebSocket = ProxiedWebSocket;
}

async function loadDiscordJs() {
  // Use a variable specifier so TypeScript does not statically resolve the
  // optional `discord.js` dependency (it may be absent in some environments;
  // the runtime still loads it normally when present).
  applyDiscordProxyOnce();
  const specifier = "discord.js";
  const mod = await import(specifier);
  return {
    Client: mod.Client,
    GatewayIntentBits: mod.GatewayIntentBits,
  };
}

/**
 * @param {Object} options
 * @param {string} [options.token] - Discord bot token (required unless a client is injected).
 * @param {string[]} [options.allowedUserIds] - allowed Discord user ids.
 * @param {boolean} [options.allowAllUsers] - dev override to accept everyone.
 * @param {(event: Object) => void} [options.onMessage] - normalized inbound.
 * @param {(user: Object) => void} [options.onReady]
 * @param {(error: Error) => void} [options.onError]
 * @param {Object} [options.client] - injected client (tests / custom transport).
 */
export async function createDiscordGateway(options = {}) {
  const {
    token,
    allowedUserIds = [],
    allowAllUsers = false,
    onMessage,
    onReady,
    onError,
    client: injectedClient = null,
  } = options;

  let Client = null;
  let GatewayIntentBits = null;
  if (!injectedClient) {
    const loaded = await loadDiscordJs();
    Client = loaded.Client;
    GatewayIntentBits = loaded.GatewayIntentBits;
  }

  const client = injectedClient ?? new Client({
    intents: REQUIRED_INTENTS.map((name) => GatewayIntentBits[name]),
    ...(discordRestAgent ? { rest: { agent: discordRestAgent } } : {}),
  });

  const allowed = new Set(allowedUserIds.map(String));

  client.on("messageCreate", (message) => {
    const _dbg = (t) => console.log(`[discord-diag] ${t} | author=${message?.author?.id} bot=${message?.author?.bot} chanType=${message?.channel?.type} chanId=${message?.channel?.id} text=${String(message?.content ?? "").slice(0, 60)}`);
    _dbg("messageCreate");
    if (message?.author?.bot) { _dbg("skip: author is bot"); return; }
    const userId = String(message?.author?.id ?? "").trim();
    if (!userId) { _dbg("skip: no userId"); return; }
    if (!allowAllUsers && allowed.size > 0 && !allowed.has(userId)) { _dbg(`skip: not in allowedUserIds (allowed=${[...allowed].join(",")})`); return; }
    const channel = message?.channel ?? {};
    const chatId = String(channel?.id ?? "").trim();
    if (!chatId) { _dbg("skip: no chatId"); return; }
    const isThread = typeof channel.isThread === "function"
      ? channel.isThread()
      : Boolean(channel.isThread);
    const channelType = isThread ? "thread" : (channel.type === 1 ? "dm" : "group");
    const event = {
      senderId: userId,
      messageId: String(message?.id ?? "").trim(),
      chatId,
      chatType: channelType,
      text: String(message?.content ?? "").trim(),
      raw: message,
    };
    _dbg(`-> onMessage chatType=${channelType}`);
    if (onMessage) onMessage(event);
  });

  client.on("ready", () => {
    if (onReady) onReady(client.user);
  });
  client.on("error", (error) => {
    if (onError) onError(error instanceof Error ? error : new Error(String(error)));
  });

  if (!injectedClient) {
    await client.login(token);
  }

  return {
    client,
    user: client.user,
    isThread: false,
    async sendMessage(chatId, text) {
      const ch = await client.channels.fetch(chatId);
      const msg = await ch.send(String(text).slice(0, DISCORD_MESSAGE_LIMIT));
      return { ok: true, messageId: msg.id, raw: msg };
    },
    async editMessage(chatId, messageId, text) {
      const ch = await client.channels.fetch(chatId);
      const msg = await ch.messages.fetch(messageId);
      const edited = await msg.edit(String(text).slice(0, DISCORD_MESSAGE_LIMIT));
      return { ok: true, messageId: edited.id, raw: edited };
    },
    async destroy() {
      if (!injectedClient && typeof client.destroy === "function") {
        await client.destroy();
      }
    },
  };
}

export function normalizeDiscordMessage(message = {}) {
  const author = message.author ?? {};
  const channel = message.channel ?? {};
  const chatId = String(channel.id ?? "").trim();
  const isThread = typeof channel.isThread === "function"
    ? channel.isThread()
    : Boolean(channel.isThread);
  return {
    senderId: String(author.id ?? "").trim(),
    messageId: String(message.id ?? "").trim(),
    chatId,
    chatType: isThread ? "thread" : (channel.type === 1 ? "dm" : "group"),
    text: String(message.content ?? "").trim(),
    raw: message,
  };
}
