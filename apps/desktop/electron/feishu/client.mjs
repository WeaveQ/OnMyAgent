export const FEISHU_BASE_URL = "https://open.feishu.cn";
export const LARK_BASE_URL = "https://open.larksuite.com";

function cleanBaseUrl(value) {
  const raw = String(value ?? FEISHU_BASE_URL).trim().replace(/\/+$/, "");
  return raw || FEISHU_BASE_URL;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function assertFetch(fetchFn) {
  if (typeof fetchFn !== "function") throw new Error("Feishu client requires fetch support");
}

export function createFeishuClient(options = {}) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const tokenCache = new Map();

  async function requestJson({ baseUrl, path, method = "GET", token = "", body, headers = {} }) {
    assertFetch(fetchFn);
    const response = await fetchFn(`${cleanBaseUrl(baseUrl)}${path}`, {
      method,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const message = String(payload?.msg ?? payload?.message ?? response.statusText ?? "request failed");
      throw new Error(`Feishu HTTP ${response.status}: ${message}`);
    }
    return payload;
  }

  async function getTenantAccessToken({ baseUrl = FEISHU_BASE_URL, appId, appSecret, force = false }) {
    const id = String(appId ?? "").trim();
    const secret = String(appSecret ?? "").trim();
    if (!id) throw new Error("Feishu appId is required");
    if (!secret) throw new Error("Feishu appSecret is required");
    const cacheKey = `${cleanBaseUrl(baseUrl)}:${id}`;
    const cached = tokenCache.get(cacheKey);
    if (!force && cached?.token && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const payload = await requestJson({
      baseUrl,
      path: "/open-apis/auth/v3/tenant_access_token/internal",
      method: "POST",
      body: { app_id: id, app_secret: secret },
    });
    const code = Number(payload?.code ?? 0);
    if (code !== 0) throw new Error(`Feishu tenant token failed code=${code}: ${payload?.msg ?? payload?.message ?? "unknown error"}`);
    const token = String(payload?.tenant_access_token ?? "").trim();
    if (!token) throw new Error("Feishu tenant token response is missing tenant_access_token");
    const expireSeconds = Number(payload?.expire ?? 7200);
    tokenCache.set(cacheKey, { token, expiresAt: Date.now() + Math.max(60, expireSeconds) * 1000 });
    return token;
  }

  async function sendText({ baseUrl = FEISHU_BASE_URL, appId, appSecret, receiveIdType = "chat_id", receiveId, text, uuid }) {
    const cleanText = String(text ?? "").trim();
    if (!cleanText) return { skipped: true };
    const idType = String(receiveIdType ?? "chat_id").trim() || "chat_id";
    const target = String(receiveId ?? "").trim();
    if (!target) throw new Error("Feishu receiveId is required");
    const token = await getTenantAccessToken({ baseUrl, appId, appSecret });
    const payload = await requestJson({
      baseUrl,
      token,
      path: `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(idType)}`,
      method: "POST",
      body: {
        receive_id: target,
        msg_type: "text",
        content: JSON.stringify({ text: cleanText }),
        uuid: uuid || undefined,
      },
    });
    const code = Number(payload?.code ?? 0);
    if (code !== 0) throw new Error(`Feishu send failed code=${code}: ${payload?.msg ?? payload?.message ?? "unknown error"}`);
    return payload;
  }

  async function getWebSocketEndpoint({ baseUrl = FEISHU_BASE_URL, appId, appSecret }) {
    const id = String(appId ?? "").trim();
    const secret = String(appSecret ?? "").trim();
    if (!id) throw new Error("Feishu appId is required");
    if (!secret) throw new Error("Feishu appSecret is required");
    const payload = await requestJson({
      baseUrl,
      path: "/callback/ws/endpoint",
      method: "POST",
      headers: { locale: "zh" },
      body: { AppID: id, AppSecret: secret },
    });
    const code = Number(payload?.code ?? 0);
    if (code !== 0) throw new Error(`Feishu websocket endpoint failed code=${code}: ${payload?.msg ?? payload?.message ?? "unknown error"}`);
    const url = String(payload?.data?.URL ?? payload?.data?.url ?? "").trim();
    if (!url) throw new Error("Feishu websocket endpoint response is missing URL");
    return {
      url,
      clientConfig: payload?.data?.ClientConfig ?? payload?.data?.client_config ?? null,
      raw: payload,
    };
  }

  return {
    getTenantAccessToken,
    getWebSocketEndpoint,
    sendText,
    requestJson,
  };
}
