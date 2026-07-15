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

export const DISCORD_MESSAGE_LIMIT = 2000;

const REQUIRED_INTENTS = ["Guilds", "GuildMessages", "DirectMessages", "MessageContent"];

async function loadDiscordJs() {
  // Use a variable specifier so TypeScript does not statically resolve the
  // optional `discord.js` dependency (it may be absent in some environments;
  // the runtime still loads it normally when present).
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
  });

  const allowed = new Set(allowedUserIds.map(String));

  client.on("messageCreate", (message) => {
    if (message?.author?.bot) return;
    const userId = String(message?.author?.id ?? "").trim();
    if (!userId) return;
    if (!allowAllUsers && allowed.size > 0 && !allowed.has(userId)) return;
    const channel = message?.channel ?? {};
    const chatId = String(channel?.id ?? "").trim();
    if (!chatId) return;
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
