// Shared HTTP client for Electron main process.
//
// cc-switch parity (see /Users/huangchunan/cc-switch/src-tauri/src/proxy/http_client.rs):
//   - one process-wide dispatcher, reconfigurable at runtime
//   - honor user-configured proxy URL (http/https/socks5), otherwise inherit
//     from HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY environment variables
//   - connect timeout 30s, generous total timeout, mask credentials in logs
//   - single fetch call site so registry lookups match user's proxy settings

import { Agent, EnvHttpProxyAgent, ProxyAgent } from "undici";

const CONNECT_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 30_000;
const BODY_TIMEOUT_MS = 600_000;

let currentProxyUrl = null;
let currentDispatcher = buildEnvDispatcher();

function buildDirectAgent() {
  return new Agent({
    connect: { timeout: CONNECT_TIMEOUT_MS },
    headersTimeout: HEADERS_TIMEOUT_MS,
    bodyTimeout: BODY_TIMEOUT_MS,
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
  });
}

function buildEnvDispatcher() {
  try {
    return new EnvHttpProxyAgent({
      connect: { timeout: CONNECT_TIMEOUT_MS },
      headersTimeout: HEADERS_TIMEOUT_MS,
      bodyTimeout: BODY_TIMEOUT_MS,
    });
  } catch {
    return buildDirectAgent();
  }
}

function buildProxyDispatcher(proxyUrl) {
  const trimmed = String(proxyUrl ?? "").trim();
  if (!trimmed) return buildEnvDispatcher();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error(`Invalid proxy URL '${maskUrl(trimmed)}': ${err instanceof Error ? err.message : String(err)}`);
  }
  const scheme = parsed.protocol.replace(/:$/, "");
  if (!["http", "https", "socks5", "socks5h"].includes(scheme)) {
    throw new Error(`Unsupported proxy scheme '${scheme}' in URL '${maskUrl(trimmed)}'`);
  }
  return new ProxyAgent({
    uri: trimmed,
    connect: { timeout: CONNECT_TIMEOUT_MS },
    headersTimeout: HEADERS_TIMEOUT_MS,
    bodyTimeout: BODY_TIMEOUT_MS,
  });
}

/**
 * Apply a proxy URL to the shared HTTP client.
 * Passing null/empty resets to "follow environment variables".
 */
export function setHttpProxy(proxyUrl) {
  const trimmed = typeof proxyUrl === "string" ? proxyUrl.trim() : "";
  if (!trimmed) {
    currentProxyUrl = null;
    currentDispatcher = buildEnvDispatcher();
    return { proxyUrl: null };
  }
  currentDispatcher = buildProxyDispatcher(trimmed);
  currentProxyUrl = trimmed;
  return { proxyUrl: trimmed };
}

export function getCurrentProxyUrl() {
  return currentProxyUrl;
}

export function getDispatcher() {
  return currentDispatcher;
}

/**
 * fetch wrapper that always uses the shared dispatcher and sets a request
 * signal so callers do not have to spell out proxy plumbing at every site.
 */
export async function httpFetch(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), init.timeoutMs ?? BODY_TIMEOUT_MS);
  try {
    // Node's undici fetch honors a non-standard 'dispatcher' option; TypeScript
    // lib.dom RequestInit does not know about it, so pass through as unknown.
    const req = /** @type {RequestInit} */ ({
      ...init,
      signal: init.signal ?? controller.signal,
      dispatcher: currentDispatcher,
      headers: {
        "user-agent": "OnMyAgent-AgentManager/1.0",
        ...(init.headers ?? {}),
      },
    });
    return await fetch(url, req);
  } finally {
    clearTimeout(timer);
  }
}

export function maskUrl(value) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const host = parsed.host || parsed.hostname || "?";
    return `${parsed.protocol}//${host}`;
  } catch {
    return value.length > 20 ? `${value.slice(0, 20)}...` : value;
  }
}
