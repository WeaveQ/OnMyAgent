/**
 * Telegram Bot API client (long-polling transport).
 *
 * Parity target: AionCore `aionui-channel` Telegram plugin
 * (25s long-polling + getMe/getUpdates/sendMessage/editMessageText +
 * exponential backoff). No external dependencies — uses the global `fetch`
 * available in Node 20+.
 */

export const TELEGRAM_API_BASE = "https://api.telegram.org";
export const TELEGRAM_LONG_POLL_TIMEOUT = 25;
export const TELEGRAM_MAX_RECONNECT_DELAY = 60_000;
export const TELEGRAM_INITIAL_RECONNECT_DELAY = 2_000;

function apiUrl(token, method) {
  const clean = String(token ?? "").trim();
  if (!clean) throw new Error("Telegram bot token is required");
  return `${TELEGRAM_API_BASE}/bot${clean}/${method}`;
}

/**
 * @param {string} token
 * @param {string} method
 * @param {Record<string, unknown>} [payload]
 * @param {typeof fetch} [fetchFn]
 * @param {number} [timeoutMs]
 */
async function callApi(token, method, payload = {}, fetchFn = globalThis.fetch, timeoutMs) {
  const url = apiUrl(token, method);
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!data || data.ok !== true) {
      const description = String(data?.description ?? "unknown telegram api error");
      throw Object.assign(new Error(`Telegram ${method} failed: ${description}`), {
        code: data?.error_code ?? null,
      });
    }
    return data.result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fetch bot identity. Returns { id, is_bot, username, first_name }.
 * @param {string} token
 * @param {typeof fetch} [fetchFn]
 */
export async function getMe(token, fetchFn) {
  return callApi(token, "getMe", {}, fetchFn);
}

/**
 * Long-poll for updates. `timeout` should match the 25s parity value.
 * Returns an array of update objects.
 * @param {string} token
 * @param {{ offset?: number; timeout?: number; fetchFn?: typeof fetch; timeoutMs?: number }} [options]
 */
export async function getUpdates(token, { offset = 0, timeout = TELEGRAM_LONG_POLL_TIMEOUT, fetchFn, timeoutMs } = {}) {
  const result = await callApi(token, "getUpdates", { offset, timeout, allowed_updates: ["message", "callback_query"] }, fetchFn, timeoutMs ?? (timeout + 10) * 1000);
  return Array.isArray(result) ? result : [];
}

/**
 * Send a text message. Returns { message_id }.
 * @param {string} token
 * @param {{ chatId: string; text: string; replyToMessageId?: string }} payload
 * @param {typeof fetch} [fetchFn]
 */
export async function sendMessage(token, { chatId, text, replyToMessageId }, fetchFn) {
  const body = { chat_id: chatId, text: String(text ?? "").slice(0, 4096) };
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId;
  const result = await callApi(token, "sendMessage", body, fetchFn);
  return { ok: true, messageId: result?.message_id ?? null, raw: result };
}

/**
 * Edit a previously sent text message (used for streaming patch).
 * @param {string} token
 * @param {{ chatId: string; messageId: string; text: string }} payload
 * @param {typeof fetch} [fetchFn]
 */
export async function editMessageText(token, { chatId, messageId, text }, fetchFn) {
  const result = await callApi(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: String(text ?? "").slice(0, 4096),
  }, fetchFn);
  return { ok: true, messageId: result?.message_id ?? messageId, raw: result };
}

/**
 * Answer a callback query (used for inline button presses).
 * @param {string} token
 * @param {{ callbackQueryId: string }} payload
 * @param {typeof fetch} [fetchFn]
 */
export async function answerCallbackQuery(token, { callbackQueryId }, fetchFn) {
  return callApi(token, "answerCallbackQuery", { callback_query_id: callbackQueryId }, fetchFn);
}

/**
 * Build a normalized inbound event from a Telegram update.
 * Returns either { type:"message", ... } or { type:"callback", ... } or null.
 */
export function normalizeTelegramUpdate(update = {}) {
  if (update?.message?.text) {
    const msg = update.message;
    const chat = msg.chat ?? {};
    const chatType = chat.type === "group" || chat.type === "supergroup" ? "group" : "dm";
    return {
      type: "message",
      senderId: String(msg.from?.id ?? "").trim(),
      messageId: String(msg.message_id ?? "").trim(),
      chatId: String(chat.id ?? "").trim(),
      chatType,
      text: String(msg.text ?? "").trim(),
      raw: update,
    };
  }
  if (update?.callback_query) {
    const cb = update.callback_query;
    const from = cb.from ?? {};
    const chat = cb.message?.chat ?? {};
    return {
      type: "callback",
      senderId: String(from.id ?? "").trim(),
      messageId: String(cb.id ?? "").trim(),
      chatId: String(chat.id ?? "").trim(),
      chatType: chat.type === "group" || chat.type === "supergroup" ? "group" : "dm",
      text: String(cb.data ?? "").trim(),
      callbackQueryId: String(cb.id ?? "").trim(),
      raw: update,
    };
  }
  return null;
}
