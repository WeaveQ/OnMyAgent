import { ProxyAgent, fetch as undiciFetch } from "undici";

// Env vars that may carry an upstream proxy (common behind corporate networks
// or region firewalls, e.g. Clash/V2Ray HTTP proxies on macOS).
const PROXY_ENV_KEYS = [
  "HTTPS_PROXY", "https_proxy",
  "HTTP_PROXY", "http_proxy",
  "ALL_PROXY", "all_proxy",
];

function resolveProxyUrl() {
  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key];
    if (value && /^https?:\/\//i.test(value)) return value.trim();
  }
  return null;
}

let cachedAgent = null;
function getAgent(url) {
  if (!cachedAgent) cachedAgent = new ProxyAgent(url);
  return cachedAgent;
}

/**
 * Opt-in, proxy-aware fetch for channel transports.
 *
 * When an HTTP/HTTPS proxy is configured via env, requests are tunneled
 * through it (so Telegram/Discord etc. work behind a region firewall). When no
 * proxy is set, it delegates to Node's built-in global fetch and behaves
 * identically to before.
 *
 * Note: undici's ProxyAgent only supports http/https proxies, not SOCKS.
 */
export async function proxyFetch(input, init = {}) {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) return globalThis.fetch(input, init);
  return undiciFetch(input, { ...init, dispatcher: getAgent(proxyUrl) });
}

export function resolveActiveProxy() {
  return resolveProxyUrl();
}
