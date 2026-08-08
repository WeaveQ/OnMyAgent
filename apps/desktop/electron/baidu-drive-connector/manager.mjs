/**
 * Baidu Netdisk connector: OAuth / access_token + OpenCode remote MCP (SSE).
 * Official MCP: https://mcp-pan.baidu.com/sse?access_token=...
 */
import { randomUUID, randomBytes } from "node:crypto";
import http from "node:http";
import { createServer as createNetServer } from "node:net";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveLocalManagedToolsRoot } from "../config-profile-paths.mjs";
import {
  readGlobalOpencodeConfig,
  updateOpencodeConfigs,
} from "../tencent-docs-connector/mcp-config.mjs";
import {
  AUTH_TIMEOUT_MS,
  MCP_SERVER_NAME,
  MCP_SSE_BASE,
  OAUTH_AUTHORIZE_URL,
  OAUTH_CALLBACK_PREFERRED_PORTS,
  OAUTH_SCOPE,
  OAUTH_TOKEN_URL,
  OWNER,
  PLUGIN_ID,
  STATE_FILE,
  TOKEN_FILE,
  TOKEN_SKEW_MS,
} from "./constants.mjs";

/**
 * @param {string | undefined} homeDir
 */
export function resolveBaiduDriveManagedRoot(homeDir) {
  return path.join(resolveLocalManagedToolsRoot(homeDir), PLUGIN_ID);
}

/**
 * @param {string} accessToken
 */
export function buildBaiduDriveMcpUrl(accessToken) {
  const token = String(accessToken ?? "").trim();
  return `${MCP_SSE_BASE}?access_token=${encodeURIComponent(token)}`;
}

/**
 * @param {string} accessToken
 */
export function buildBaiduDriveMcpEntry(accessToken) {
  return {
    type: "remote",
    url: buildBaiduDriveMcpUrl(accessToken),
    enabled: true,
    _onmyagent: {
      owner: OWNER,
      pluginId: PLUGIN_ID,
      role: "main",
    },
  };
}

/**
 * @param {Record<string, unknown>} config
 * @param {string} accessToken
 */
export function upsertBaiduDriveMcp(config, accessToken) {
  const next = { ...config };
  if (!next.$schema) next.$schema = "https://opencode.ai/config.json";
  const existing =
    next.mcp && typeof next.mcp === "object" && !Array.isArray(next.mcp)
      ? { .../** @type {Record<string, unknown>} */ (next.mcp) }
      : {};
  existing[MCP_SERVER_NAME] = buildBaiduDriveMcpEntry(accessToken);
  next.mcp = existing;
  return next;
}

/**
 * @param {Record<string, unknown>} config
 */
export function removeBaiduDriveMcp(config) {
  const next = { ...config };
  const existing =
    next.mcp && typeof next.mcp === "object" && !Array.isArray(next.mcp)
      ? { .../** @type {Record<string, unknown>} */ (next.mcp) }
      : {};
  const entry = existing[MCP_SERVER_NAME];
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const marker = /** @type {Record<string, unknown>} */ (entry)._onmyagent;
    const url =
      typeof /** @type {Record<string, unknown>} */ (entry).url === "string"
        ? /** @type {Record<string, unknown>} */ (entry).url
        : "";
    if (
      (marker &&
        typeof marker === "object" &&
        !Array.isArray(marker) &&
        /** @type {Record<string, unknown>} */ (marker).pluginId === PLUGIN_ID) ||
      url.startsWith(MCP_SSE_BASE)
    ) {
      delete existing[MCP_SERVER_NAME];
    }
  }
  next.mcp = existing;
  return next;
}

/**
 * @param {Record<string, unknown>} config
 */
export function hasManagedBaiduDriveMcp(config) {
  const mcp =
    config.mcp && typeof config.mcp === "object" && !Array.isArray(config.mcp)
      ? /** @type {Record<string, unknown>} */ (config.mcp)
      : null;
  if (!mcp) return false;
  const entry = mcp[MCP_SERVER_NAME];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const rec = /** @type {Record<string, unknown>} */ (entry);
  if (rec.enabled === false) return false;
  return typeof rec.url === "string" && rec.url.includes("mcp-pan.baidu.com");
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tmp, payload, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(tmp, filePath);
  } catch {
    await writeFile(filePath, payload, { encoding: "utf8", mode: 0o600 });
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function randomHex(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

/**
 * @param {number} port
 * @param {string} [host]
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

async function allocateLoopbackPort(host = "127.0.0.1") {
  for (const preferred of OAUTH_CALLBACK_PREFERRED_PORTS) {
    try {
      return await tryListenPort(preferred, host);
    } catch {
      // try next
    }
  }
  return tryListenPort(0, host);
}

/**
 * @param {{
 *   homeDir?: string,
 *   globalOpencodeRoot: string | (() => string),
 *   resolveOpencodeConfigDirs?: () => string[],
 *   clientId?: string | (() => string | undefined),
 *   clientSecret?: string | (() => string | undefined),
 *   openExternal?: (url: string) => Promise<void> | void,
 *   onProgress?: (progress: import('@onmyagent/types/baidu-drive-connector').BaiduDriveAuthProgress) => void,
 *   onStatus?: (status: import('@onmyagent/types/baidu-drive-connector').BaiduDriveConnectionStatus) => void,
 *   now?: () => number,
 * }} options
 */
export function createBaiduDriveConnectorManager(options) {
  if (!options?.globalOpencodeRoot) {
    throw new Error("createBaiduDriveConnectorManager requires globalOpencodeRoot");
  }

  const homeDir = options.homeDir;
  const now = options.now ?? (() => Date.now());
  let busy = false;
  /** @type {Map<string, { resolve: (v: any) => void, reject: (e: any) => void, server?: http.Server, timer?: NodeJS.Timeout }>} */
  const sessions = new Map();

  function managedRoot() {
    return resolveBaiduDriveManagedRoot(homeDir);
  }

  function resolveClientId() {
    const fromOpt =
      typeof options.clientId === "function"
        ? options.clientId()
        : options.clientId;
    return (
      String(fromOpt ?? "").trim() ||
      String(process.env.ONMYAGENT_BAIDU_NETDISK_CLIENT_ID ?? "").trim()
    );
  }

  function resolveClientSecret() {
    const fromOpt =
      typeof options.clientSecret === "function"
        ? options.clientSecret()
        : options.clientSecret;
    return (
      String(fromOpt ?? "").trim() ||
      String(process.env.ONMYAGENT_BAIDU_NETDISK_CLIENT_SECRET ?? "").trim()
    );
  }

  function oauthConfigured() {
    return Boolean(resolveClientId() && resolveClientSecret());
  }

  function opencodeConfigRoots() {
    if (typeof options.resolveOpencodeConfigDirs === "function") {
      return options.resolveOpencodeConfigDirs().filter(Boolean);
    }
    const root =
      typeof options.globalOpencodeRoot === "function"
        ? options.globalOpencodeRoot()
        : options.globalOpencodeRoot;
    return root ? [root] : [];
  }

  function emitProgress(progress) {
    try {
      options.onProgress?.(progress);
    } catch {
      // ignore
    }
  }

  function emitStatus(status) {
    try {
      options.onStatus?.(status);
    } catch {
      // ignore
    }
  }

  async function readTokens() {
    return readJson(path.join(managedRoot(), TOKEN_FILE));
  }

  async function writeTokens(tokens) {
    await writeJsonAtomic(path.join(managedRoot(), TOKEN_FILE), tokens);
  }

  async function clearTokens() {
    await rm(path.join(managedRoot(), TOKEN_FILE), { force: true });
  }

  function tokenUsable(tokens) {
    if (!tokens?.access_token) return false;
    if (typeof tokens.expires_at === "number") {
      return tokens.expires_at - TOKEN_SKEW_MS > now();
    }
    return true;
  }

  async function applyMcpConfig(accessToken) {
    const { results, errors } = await updateOpencodeConfigs(
      { roots: opencodeConfigRoots(), pathExists },
      (config) => upsertBaiduDriveMcp(config, accessToken),
    );
    if (results.length === 0) {
      throw errors[0] ?? new Error("Failed to write baidu-netdisk MCP config");
    }
    return results;
  }

  async function clearMcpConfig() {
    await updateOpencodeConfigs(
      { roots: opencodeConfigRoots(), pathExists },
      (config) => removeBaiduDriveMcp(config),
    );
  }

  async function mcpConfiguredAnywhere() {
    for (const root of opencodeConfigRoots()) {
      try {
        const { config } = await readGlobalOpencodeConfig({
          globalOpencodeRoot: root,
          pathExists,
        });
        if (hasManagedBaiduDriveMcp(config)) return true;
      } catch {
        // continue
      }
    }
    return false;
  }

  /**
   * @returns {Promise<import('@onmyagent/types/baidu-drive-connector').BaiduDriveConnectionStatus>}
   */
  async function getStatus() {
    let tokens = await readTokens();
    let authorized = Boolean(tokens && tokenUsable(tokens));

    if (authorized && tokens?.access_token) {
      try {
        if (!(await mcpConfiguredAnywhere())) {
          await applyMcpConfig(String(tokens.access_token));
        }
      } catch (error) {
        console.warn("[baidu-drive] heal applyMcpConfig failed:", error);
      }
    }

    const mcpConfigured = await mcpConfiguredAnywhere();
    tokens = await readTokens();
    authorized = Boolean(tokens && tokenUsable(tokens));

    /** @type {import('@onmyagent/types/baidu-drive-connector').BaiduDriveConnectionPhase} */
    let phase = "disconnected";
    if (busy) phase = "busy";
    else if (authorized && mcpConfigured) phase = "connected";
    else if (authorized && !mcpConfigured) phase = "error";
    else phase = "disconnected";

    /** @type {import('@onmyagent/types/baidu-drive-connector').BaiduDriveConnectionStatus} */
    const status = {
      phase,
      mcpConfigured,
      authorized,
      serverNames: [MCP_SERVER_NAME],
      message:
        authorized && !mcpConfigured
          ? "Authorized but MCP not registered in OpenCode config"
          : null,
      errorCode: authorized && !mcpConfigured ? "mcp_not_registered" : null,
      errorMessage:
        authorized && !mcpConfigured
          ? "Authorized but MCP not registered in OpenCode config"
          : null,
      lastCheckedAt: now(),
      oauthConfigured: oauthConfigured(),
    };
    emitStatus(status);
    return status;
  }

  /**
   * @param {{ accessToken: string, refreshToken?: string, expiresIn?: number }} input
   */
  async function connectWithToken(input) {
    const accessToken = String(input?.accessToken ?? "").trim();
    if (!accessToken) {
      const err = new Error("Access token is required");
      // @ts-expect-error coded
      err.code = "missing_token";
      throw err;
    }
    emitProgress({
      operation: "connect",
      phase: "materializing",
      message: "Writing Baidu Netdisk MCP config",
    });
    const expiresIn =
      typeof input.expiresIn === "number" && input.expiresIn > 0
        ? input.expiresIn
        : undefined;
    await writeTokens({
      access_token: accessToken,
      refresh_token: input.refreshToken
        ? String(input.refreshToken).trim()
        : undefined,
      expires_at: expiresIn ? now() + expiresIn * 1000 : undefined,
      obtained_at: now(),
    });
    await applyMcpConfig(accessToken);
    await writeJsonAtomic(path.join(managedRoot(), STATE_FILE), {
      pluginId: PLUGIN_ID,
      connectedAt: now(),
      updatedAt: now(),
    });
    emitProgress({ operation: "connect", phase: "complete" });
    return getStatus();
  }

  /**
   * @returns {Promise<import('@onmyagent/types/baidu-drive-connector').BaiduDriveStartConnectResult>}
   */
  async function startConnect() {
    const current = await getStatus();
    if (current.phase === "connected" && current.authorized) {
      const tokens = await readTokens();
      if (tokens?.access_token) {
        await applyMcpConfig(String(tokens.access_token));
        return {
          sessionId: "already-connected",
          authorizationUrl: "",
          alreadyConnected: true,
        };
      }
    }

    if (!oauthConfigured()) {
      // UI should fall back to paste-token flow.
      return {
        sessionId: "needs-token",
        authorizationUrl: "",
        needsAccessToken: true,
      };
    }

    if (busy) {
      const err = new Error("Another Baidu Drive connect is in progress");
      // @ts-expect-error coded
      err.code = "busy";
      throw err;
    }

    busy = true;
    const sessionId = randomUUID();
    const clientId = resolveClientId();
    const clientSecret = resolveClientSecret();

    try {
      emitProgress({
        operation: "connect",
        phase: "starting",
        message: "Starting Baidu Netdisk authorization",
      });

      const port = await allocateLoopbackPort();
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const state = randomHex(16);

      /** @type {{ resolve: (v: any) => void, reject: (e: any) => void, server?: http.Server, timer?: NodeJS.Timeout, promise?: Promise<any> }} */
      const sessionEntry = {
        resolve: () => undefined,
        reject: () => undefined,
      };

      /** @type {Promise<import('@onmyagent/types/baidu-drive-connector').BaiduDriveConnectionStatus>} */
      const completion = new Promise((resolve, reject) => {
        sessionEntry.resolve = resolve;
        sessionEntry.reject = reject;

        const timer = setTimeout(() => {
          try {
            sessionEntry.server?.close();
          } catch {
            // ignore
          }
          sessions.delete(sessionId);
          busy = false;
          const err = new Error("Authorization timed out");
          // @ts-expect-error coded
          err.code = "oauth_timeout";
          reject(err);
        }, AUTH_TIMEOUT_MS);
        sessionEntry.timer = timer;

        const server = http.createServer(async (req, res) => {
          try {
            const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
            if (url.pathname !== "/callback") {
              res.writeHead(404);
              res.end("Not found");
              return;
            }
            const returnedState = url.searchParams.get("state") ?? "";
            const code = url.searchParams.get("code") ?? "";
            const errParam = url.searchParams.get("error");
            if (errParam || !code || returnedState !== state) {
              res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
              res.end(
                "<html><body><p>Authorization failed. You can close this window.</p></body></html>",
              );
              clearTimeout(timer);
              server.close();
              sessions.delete(sessionId);
              busy = false;
              const err = new Error(errParam || "Invalid OAuth callback");
              // @ts-expect-error coded
              err.code = "oauth_callback_invalid";
              reject(err);
              return;
            }

            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(
              "<html><body><p>百度网盘授权成功，请返回 OnMyAgent。</p></body></html>",
            );

            emitProgress({
              operation: "connect",
              phase: "exchanging",
              message: "Exchanging authorization code",
            });

            const body = new URLSearchParams({
              grant_type: "authorization_code",
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
            });
            const tokenRes = await fetch(OAUTH_TOKEN_URL, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body,
            });
            const tokenJson = await tokenRes.json().catch(() => ({}));
            if (!tokenRes.ok || !tokenJson.access_token) {
              const msg =
                tokenJson.error_description ||
                tokenJson.error ||
                `HTTP ${tokenRes.status}`;
              throw new Error(String(msg));
            }

            clearTimeout(timer);
            server.close();
            sessions.delete(sessionId);

            const status = await connectWithToken({
              accessToken: String(tokenJson.access_token),
              refreshToken: tokenJson.refresh_token
                ? String(tokenJson.refresh_token)
                : undefined,
              expiresIn:
                typeof tokenJson.expires_in === "number"
                  ? tokenJson.expires_in
                  : undefined,
            });
            busy = false;
            resolve(status);
          } catch (error) {
            clearTimeout(timer);
            try {
              server.close();
            } catch {
              // ignore
            }
            sessions.delete(sessionId);
            busy = false;
            reject(error);
          }
        });
        sessionEntry.server = server;
        server.listen(port, "127.0.0.1");
      });

      sessionEntry.promise = completion;
      sessions.set(sessionId, sessionEntry);

      const authorizationUrl = new URL(OAUTH_AUTHORIZE_URL);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("client_id", clientId);
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("scope", OAUTH_SCOPE);
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("display", "popup");

      emitProgress({
        operation: "connect",
        phase: "waiting_user",
        authorizationUrl: authorizationUrl.toString(),
        message: "Waiting for browser authorization",
      });

      if (options.openExternal) {
        void Promise.resolve(
          options.openExternal(authorizationUrl.toString()),
        ).catch(() => undefined);
      }

      return {
        sessionId,
        authorizationUrl: authorizationUrl.toString(),
      };
    } catch (error) {
      sessions.delete(sessionId);
      busy = false;
      throw error;
    }
  }

  /**
   * @param {string} sessionId
   */
  async function completeConnect(sessionId) {
    if (sessionId === "already-connected" || sessionId === "needs-token") {
      return getStatus();
    }
    const entry = sessions.get(sessionId);
    if (!entry) {
      const status = await getStatus();
      if (status.authorized) return status;
      const err = new Error("Connect session not found");
      // @ts-expect-error coded
      err.code = "session_missing";
      throw err;
    }
    // @ts-expect-error promise
    const promise = entry.promise;
    if (!promise) {
      const err = new Error("Connect session incomplete");
      // @ts-expect-error coded
      err.code = "session_incomplete";
      throw err;
    }
    return promise;
  }

  async function cancelConnect() {
    for (const [id, entry] of sessions) {
      try {
        clearTimeout(entry.timer);
        entry.server?.close();
        entry.reject(
          Object.assign(new Error("Authorization cancelled"), {
            code: "oauth_cancelled",
          }),
        );
      } catch {
        // ignore
      }
      sessions.delete(id);
    }
    busy = false;
    return { ok: true };
  }

  async function disconnect() {
    emitProgress({ operation: "disconnect", phase: "starting" });
    try {
      await clearTokens();
      await clearMcpConfig();
      await writeJsonAtomic(path.join(managedRoot(), STATE_FILE), {
        pluginId: PLUGIN_ID,
        disconnectedAt: now(),
        updatedAt: now(),
      });
      emitProgress({ operation: "disconnect", phase: "complete" });
      return getStatus();
    } catch (error) {
      emitProgress({
        operation: "disconnect",
        phase: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  return {
    getStatus,
    startConnect,
    completeConnect,
    cancelConnect,
    disconnect,
    connectWithToken,
    oauthConfigured,
  };
}
