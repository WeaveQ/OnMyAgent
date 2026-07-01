import { randomBytes } from "node:crypto";

export const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
export const WEIXIN_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
export const ILINK_APP_ID = "bot";
export const CHANNEL_VERSION = "2.2.0";
export const ILINK_APP_CLIENT_VERSION = (2 << 16) | (2 << 8) | 0;

export const EP_GET_UPDATES = "ilink/bot/getupdates";
export const EP_SEND_MESSAGE = "ilink/bot/sendmessage";
export const EP_SEND_TYPING = "ilink/bot/sendtyping";
export const EP_GET_CONFIG = "ilink/bot/getconfig";
export const EP_GET_BOT_QR = "ilink/bot/get_bot_qrcode";
export const EP_GET_QR_STATUS = "ilink/bot/get_qrcode_status";

export const LONG_POLL_TIMEOUT_MS = 35_000;
export const API_TIMEOUT_MS = 15_000;
export const CONFIG_TIMEOUT_MS = 10_000;
export const QR_TIMEOUT_MS = 35_000;

export const ITEM_TEXT = 1;
export const MSG_TYPE_BOT = 2;
export const MSG_STATE_FINISH = 2;
export const TYPING_START = 1;
export const TYPING_STOP = 2;

function jsonBody(payload) {
  return JSON.stringify({ ...payload, base_info: { channel_version: CHANNEL_VERSION } });
}

export function randomWechatUin() {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

export function ilinkHeaders(token, body = "") {
  const headers = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "Content-Length": String(Buffer.byteLength(body, "utf8")),
    "X-WECHAT-UIN": randomWechatUin(),
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function ilinkGetHeaders() {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
  };
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || ILINK_BASE_URL).trim().replace(/\/+$/, "") || ILINK_BASE_URL;
}

async function fetchWithTimeout(fetchFn, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createIlinkClient(options = {}) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("Weixin iLink client requires fetch support");
  }

  async function apiPost({ baseUrl, endpoint, payload, token, timeoutMs = API_TIMEOUT_MS }) {
    const body = jsonBody(payload ?? {});
    const url = `${normalizeBaseUrl(baseUrl)}/${endpoint}`;
    const response = await fetchWithTimeout(fetchFn, url, {
      method: "POST",
      headers: ilinkHeaders(token, body),
      body,
    }, timeoutMs);
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`iLink POST ${endpoint} HTTP ${response.status}: ${raw.slice(0, 200)}`);
    }
    return raw ? JSON.parse(raw) : {};
  }

  async function apiGet({ baseUrl, endpoint, timeoutMs = QR_TIMEOUT_MS }) {
    const url = `${normalizeBaseUrl(baseUrl)}/${endpoint}`;
    const response = await fetchWithTimeout(fetchFn, url, {
      method: "GET",
      headers: ilinkGetHeaders(),
    }, timeoutMs);
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`iLink GET ${endpoint} HTTP ${response.status}: ${raw.slice(0, 200)}`);
    }
    return raw ? JSON.parse(raw) : {};
  }

  return {
    apiPost,
    apiGet,
    getBotQr({ botType = "3", baseUrl = ILINK_BASE_URL, timeoutMs = QR_TIMEOUT_MS } = {}) {
      return apiGet({ baseUrl, endpoint: `${EP_GET_BOT_QR}?bot_type=${encodeURIComponent(botType)}`, timeoutMs });
    },
    getQrStatus({ qrcode, baseUrl = ILINK_BASE_URL, timeoutMs = QR_TIMEOUT_MS }) {
      return apiGet({ baseUrl, endpoint: `${EP_GET_QR_STATUS}?qrcode=${encodeURIComponent(String(qrcode ?? ""))}`, timeoutMs });
    },
    async getUpdates({ baseUrl, token, syncBuf = "", timeoutMs = LONG_POLL_TIMEOUT_MS }) {
      try {
        return await apiPost({
          baseUrl,
          endpoint: EP_GET_UPDATES,
          payload: { get_updates_buf: syncBuf },
          token,
          timeoutMs,
        });
      } catch (error) {
        if (error?.name === "AbortError") return { ret: 0, msgs: [], get_updates_buf: syncBuf };
        throw error;
      }
    },
    sendMessage({ baseUrl, token, to, text, contextToken, clientId, timeoutMs = API_TIMEOUT_MS }) {
      const cleanText = String(text ?? "").trim();
      if (!cleanText) throw new Error("Weixin sendMessage text must not be empty");
      const msg = {
        from_user_id: "",
        to_user_id: String(to ?? ""),
        client_id: String(clientId ?? ""),
        message_type: MSG_TYPE_BOT,
        message_state: MSG_STATE_FINISH,
        item_list: [{ type: ITEM_TEXT, text_item: { text: cleanText } }],
      };
      if (contextToken) msg.context_token = String(contextToken);
      return apiPost({ baseUrl, endpoint: EP_SEND_MESSAGE, payload: { msg }, token, timeoutMs });
    },
    getConfig({ baseUrl, token, userId, contextToken, timeoutMs = CONFIG_TIMEOUT_MS }) {
      const payload = { ilink_user_id: String(userId ?? "") };
      if (contextToken) payload.context_token = String(contextToken);
      return apiPost({ baseUrl, endpoint: EP_GET_CONFIG, payload, token, timeoutMs });
    },
    sendTyping({ baseUrl, token, toUserId, typingTicket, status, timeoutMs = CONFIG_TIMEOUT_MS }) {
      return apiPost({
        baseUrl,
        endpoint: EP_SEND_TYPING,
        payload: { ilink_user_id: String(toUserId ?? ""), typing_ticket: String(typingTicket ?? ""), status },
        token,
        timeoutMs,
      });
    },
  };
}

export const __test__ = {
  jsonBody,
  normalizeBaseUrl,
};
