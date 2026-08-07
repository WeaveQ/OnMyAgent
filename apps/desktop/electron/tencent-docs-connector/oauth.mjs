/**
 * Tencent Docs MCP OAuth 2.1 + PKCE + dynamic client registration.
 * Node built-ins only (no extra package).
 */
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { createServer as createNetServer } from "node:net";

import {
  AUTH_TIMEOUT_MS,
  CLIENT_NAME,
  OAUTH_AUTHORIZATION_SERVER_METADATA_URL,
  OAUTH_CALLBACK_PREFERRED_PORTS,
  OAUTH_RESOURCE_METADATA_URL,
} from "./constants.mjs";

/**
 * @param {string} message
 * @param {string} [code]
 * @returns {Error & { code?: string, status?: number, body?: unknown }}
 */
export function oauthError(message, code) {
  /** @type {Error & { code?: string, status?: number, body?: unknown }} */
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

/**
 * @param {number} [bytes]
 */
export function randomHex(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

/**
 * @param {string} verifier
 */
export function pkceChallengeS256(verifier) {
  return createHash("sha256")
    .update(verifier)
    .digest("base64url");
}

/**
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<number>}
 */
function tryListenPort(port, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", (err) => {
      server.close(() => undefined);
      reject(err);
    });
    server.listen(port, host, () => {
      const address = server.address();
      const bound =
        address && typeof address === "object" ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else if (!bound) reject(new Error("failed to allocate port"));
        else resolve(bound);
      });
    });
  });
}

/**
 * Prefer stable MCP callback ports so registered redirect_uri stays valid.
 * @param {string} [host]
 * @returns {Promise<number>}
 */
export async function allocateLoopbackPort(host = "127.0.0.1") {
  for (const preferred of OAUTH_CALLBACK_PREFERRED_PORTS) {
    try {
      return await tryListenPort(preferred, host);
    } catch {
      // port busy — try next
    }
  }
  return tryListenPort(0, host);
}

/**
 * Whether a stored dynamic client can be reused for this redirect_uri.
 * Tencent (and OAuth in general) requires exact redirect_uri match.
 * @param {{ client_id?: string, redirect_uris?: string[] } | null | undefined} existing
 * @param {string} redirectUri
 */
export function canReuseDynamicClient(existing, redirectUri) {
  if (!existing?.client_id) return false;
  const uris = Array.isArray(existing.redirect_uris)
    ? existing.redirect_uris.map(String)
    : [];
  return uris.includes(redirectUri);
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error_description" in body
        ? String(body.error_description)
        : body && typeof body === "object" && "error" in body
          ? String(body.error)
          : `HTTP ${res.status}`;
    const err = oauthError(msg, "oauth_http_error");
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * @returns {Promise<{
 *   authorizationEndpoint: string,
 *   tokenEndpoint: string,
 *   registrationEndpoint: string,
 *   resource: string,
 * }>}
 */
export async function discoverOAuthEndpoints() {
  const resourceMeta = await fetchJson(OAUTH_RESOURCE_METADATA_URL);
  const resource =
    typeof resourceMeta?.resource === "string"
      ? resourceMeta.resource
      : "https://docs.qq.com/openapi/mcp";
  const authServers = Array.isArray(resourceMeta?.authorization_servers)
    ? resourceMeta.authorization_servers
    : [];
  const issuer =
    typeof authServers[0] === "string"
      ? authServers[0]
      : "https://docs.qq.com";

  let asMeta;
  try {
    asMeta = await fetchJson(OAUTH_AUTHORIZATION_SERVER_METADATA_URL);
  } catch {
    asMeta = await fetchJson(
      `${issuer.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`,
    );
  }

  const authorizationEndpoint = String(asMeta?.authorization_endpoint ?? "");
  const tokenEndpoint = String(asMeta?.token_endpoint ?? "");
  const registrationEndpoint = String(asMeta?.registration_endpoint ?? "");
  if (!authorizationEndpoint || !tokenEndpoint || !registrationEndpoint) {
    throw oauthError(
      "OAuth metadata missing required endpoints",
      "oauth_metadata_invalid",
    );
  }

  return {
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    resource,
  };
}

/**
 * @param {{
 *   registrationEndpoint: string,
 *   redirectUri: string,
 *   clientName?: string,
 *   existing?: {
 *     client_id?: string,
 *     client_id_issued_at?: number | null,
 *     redirect_uris?: string[],
 *   } | null,
 * }} input
 */
export async function ensureDynamicClient(input) {
  // Critical: never reuse a client_id registered for a different redirect_uri
  // (e.g. previous random port). That makes Tencent consent page fail with
  // generic "授权失败，请稍后重试".
  if (canReuseDynamicClient(input.existing, input.redirectUri)) {
    return {
      client_id: String(input.existing.client_id),
      client_id_issued_at: input.existing.client_id_issued_at ?? null,
      redirect_uris: input.existing.redirect_uris ?? [input.redirectUri],
    };
  }

  const body = await fetchJson(input.registrationEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      redirect_uris: [input.redirectUri],
      client_name: input.clientName ?? CLIENT_NAME,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });

  if (!body?.client_id) {
    throw oauthError(
      "Dynamic client registration returned no client_id",
      "oauth_register_failed",
    );
  }

  return {
    client_id: String(body.client_id),
    client_id_issued_at: body.client_id_issued_at ?? Date.now(),
    // Always persist the redirect we actually registered — not only server echo.
    redirect_uris: [input.redirectUri],
  };
}

/**
 * @param {{
 *   authorizationEndpoint: string,
 *   clientId: string,
 *   redirectUri: string,
 *   codeChallenge: string,
 *   state: string,
 *   resource?: string,
 *   scopes?: string[],
 * }} input
 */
export function buildAuthorizationUrl(input) {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  if (input.resource) {
    url.searchParams.set("resource", input.resource);
  }
  const scopes = input.scopes ?? ["docs:read", "docs:write", "docs:manage"];
  if (scopes.length) {
    url.searchParams.set("scope", scopes.join(" "));
  }
  return url.toString();
}

/**
 * @param {{
 *   tokenEndpoint: string,
 *   clientId: string,
 *   redirectUri: string,
 *   code: string,
 *   codeVerifier: string,
 *   resource?: string,
 * }} input
 */
export async function exchangeAuthorizationCode(input) {
  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("code", input.code);
  params.set("redirect_uri", input.redirectUri);
  params.set("client_id", input.clientId);
  params.set("code_verifier", input.codeVerifier);
  if (input.resource) {
    params.set("resource", input.resource);
  }

  const body = await fetchJson(input.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: params.toString(),
  });

  return normalizeTokenSet(body);
}

/**
 * @param {{
 *   tokenEndpoint: string,
 *   clientId: string,
 *   refreshToken: string,
 *   resource?: string,
 * }} input
 */
export async function refreshAccessToken(input) {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", input.refreshToken);
  params.set("client_id", input.clientId);
  if (input.resource) {
    params.set("resource", input.resource);
  }

  const body = await fetchJson(input.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: params.toString(),
  });

  return normalizeTokenSet(body, input.refreshToken);
}

/**
 * @param {Record<string, unknown>} body
 * @param {string} [fallbackRefresh]
 */
function normalizeTokenSet(body, fallbackRefresh) {
  const accessToken = String(body?.access_token ?? "");
  if (!accessToken) {
    throw oauthError("Token response missing access_token", "oauth_token_invalid");
  }
  const expiresIn = Number(body?.expires_in);
  const obtainedAt = Date.now();
  return {
    access_token: accessToken,
    refresh_token:
      typeof body?.refresh_token === "string" && body.refresh_token
        ? body.refresh_token
        : fallbackRefresh ?? null,
    token_type: typeof body?.token_type === "string" ? body.token_type : "Bearer",
    expires_in: Number.isFinite(expiresIn) ? expiresIn : 3600,
    obtained_at: obtainedAt,
    expires_at:
      obtainedAt +
      (Number.isFinite(expiresIn) ? expiresIn * 1000 : 3600 * 1000),
    scope: typeof body?.scope === "string" ? body.scope : null,
  };
}

/**
 * Start a one-shot loopback callback server.
 * @param {{
 *   port: number,
 *   expectedState: string,
 *   timeoutMs?: number,
 *   host?: string,
 *   path?: string,
 * }} input
 * @returns {{
 *   redirectUri: string,
 *   waitForCode: () => Promise<{ code: string, state: string }>,
 *   close: () => Promise<void>,
 * }}
 */
export function createOAuthCallbackServer(input) {
  const host = input.host ?? "127.0.0.1";
  const callbackPath = input.path ?? "/mcp/oauth/callback";
  const timeoutMs = input.timeoutMs ?? AUTH_TIMEOUT_MS;
  const redirectUri = `http://${host}:${input.port}${callbackPath}`;

  /** @type {((value: { code: string, state: string }) => void) | null} */
  let resolveCode = null;
  /** @type {((err: Error) => void) | null} */
  let rejectCode = null;
  /** @type {Promise<{ code: string, state: string }>} */
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  let settled = false;
  /** @type {import('node:http').Server | null} */
  let server = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  const finish = (err, value) => {
    if (settled) return;
    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (err) rejectCode?.(err);
    else if (value) resolveCode?.(value);
  };

  server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${input.port}`);
      if (url.pathname !== callbackPath) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") ?? error;
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(renderResultPage(false, desc));
        finish(oauthError(desc, "oauth_denied"));
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(renderResultPage(false, "Missing code or state"));
        finish(oauthError("Missing authorization code", "oauth_callback_invalid"));
        return;
      }
      if (state !== input.expectedState) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(renderResultPage(false, "Invalid state"));
        finish(oauthError("OAuth state mismatch", "oauth_state_mismatch"));
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderResultPage(true));
      finish(null, { code, state });
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Internal error");
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });

  const listenPromise = new Promise((resolve, reject) => {
    server.listen(input.port, host, () => resolve(undefined));
    server.on("error", reject);
  });

  timer = setTimeout(() => {
    finish(oauthError("Authorization timed out", "oauth_timeout"));
  }, timeoutMs);
  if (typeof timer.unref === "function") timer.unref();

  return {
    redirectUri,
    async waitForCode() {
      await listenPromise;
      return codePromise;
    },
    async close() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await new Promise((resolve) => {
        if (!server) {
          resolve(undefined);
          return;
        }
        server.close(() => resolve(undefined));
        server = null;
      });
    },
  };
}

/**
 * @param {boolean} ok
 * @param {string} [detail]
 */
function renderResultPage(ok, detail) {
  const title = ok ? "Authorization successful" : "Authorization failed";
  const body = ok
    ? "You can close this window and return to OnMyAgent."
    : detail
      ? `Something went wrong: ${escapeHtml(detail)}`
      : "Something went wrong. You can close this window and try again in OnMyAgent.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 48px 24px; text-align: center; color: #111; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #555; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${body}</p>
</body>
</html>`;
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
