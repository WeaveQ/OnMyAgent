/**
 * Kingsoft Docs connector: access token + OpenCode remote MCP (Bearer).
 * Official MCP: https://mcp-center.wps.cn/skill_hub/mcp
 */
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveLocalManagedToolsRoot } from "../config-profile-paths.mjs";
import {
  readGlobalOpencodeConfig,
  updateOpencodeConfigs,
} from "../tencent-docs-connector/mcp-config.mjs";
import {
  MCP_SERVER_NAME,
  MCP_URL,
  OWNER,
  PLUGIN_ID,
  STATE_FILE,
  TOKEN_FILE,
} from "./constants.mjs";

/**
 * @param {string | undefined} homeDir
 */
export function resolveKdocsManagedRoot(homeDir) {
  return path.join(resolveLocalManagedToolsRoot(homeDir), PLUGIN_ID);
}

/**
 * @param {string} accessToken
 */
export function buildKdocsMcpEntry(accessToken) {
  const token = String(accessToken ?? "").trim();
  return {
    type: "remote",
    url: MCP_URL,
    enabled: true,
    headers: {
      Authorization: `Bearer ${token}`,
    },
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
export function upsertKdocsMcp(config, accessToken) {
  const next = { ...config };
  if (!next.$schema) next.$schema = "https://opencode.ai/config.json";
  const existing =
    next.mcp && typeof next.mcp === "object" && !Array.isArray(next.mcp)
      ? { .../** @type {Record<string, unknown>} */ (next.mcp) }
      : {};
  existing[MCP_SERVER_NAME] = buildKdocsMcpEntry(accessToken);
  next.mcp = existing;
  return next;
}

/**
 * @param {Record<string, unknown>} config
 */
export function removeKdocsMcp(config) {
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
        marker.pluginId === PLUGIN_ID) ||
      url.startsWith("https://mcp-center.wps.cn/")
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
export function hasManagedKdocsMcp(config) {
  const mcp =
    config.mcp && typeof config.mcp === "object" && !Array.isArray(config.mcp)
      ? /** @type {Record<string, unknown>} */ (config.mcp)
      : null;
  if (!mcp) return false;
  const entry = mcp[MCP_SERVER_NAME];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const rec = /** @type {Record<string, unknown>} */ (entry);
  if (rec.enabled === false) return false;
  return typeof rec.url === "string" && rec.url.includes("mcp-center.wps.cn");
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

/**
 * @param {{
 *   homeDir?: string,
 *   globalOpencodeRoot: string | (() => string),
 *   resolveOpencodeConfigDirs?: () => string[],
 *   onProgress?: (progress: import('@onmyagent/types/kdocs-connector').KdocsAuthProgress) => void,
 *   onStatus?: (status: import('@onmyagent/types/kdocs-connector').KdocsConnectionStatus) => void,
 *   now?: () => number,
 * }} options
 */
export function createKdocsConnectorManager(options) {
  if (!options?.globalOpencodeRoot) {
    throw new Error("createKdocsConnectorManager requires globalOpencodeRoot");
  }

  const homeDir = options.homeDir;
  const now = options.now ?? (() => Date.now());
  let busy = false;

  function managedRoot() {
    return resolveKdocsManagedRoot(homeDir);
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

  async function applyMcpConfig(accessToken) {
    const { results, errors } = await updateOpencodeConfigs(
      { roots: opencodeConfigRoots(), pathExists },
      (config) => upsertKdocsMcp(config, accessToken),
    );
    if (results.length === 0) {
      throw errors[0] ?? new Error("Failed to write kdocs MCP config");
    }
    return results;
  }

  async function clearMcpConfig() {
    await updateOpencodeConfigs(
      { roots: opencodeConfigRoots(), pathExists },
      (config) => removeKdocsMcp(config),
    );
  }

  async function mcpConfiguredAnywhere() {
    for (const root of opencodeConfigRoots()) {
      try {
        const { config } = await readGlobalOpencodeConfig({
          globalOpencodeRoot: root,
          pathExists,
        });
        if (hasManagedKdocsMcp(config)) return true;
      } catch {
        // continue
      }
    }
    return false;
  }

  async function getStatus() {
    let tokens = await readTokens();
    let authorized = Boolean(tokens?.access_token);

    if (authorized && tokens?.access_token) {
      try {
        if (!(await mcpConfiguredAnywhere())) {
          await applyMcpConfig(String(tokens.access_token));
        }
      } catch (error) {
        console.warn("[kdocs] heal applyMcpConfig failed:", error);
      }
    }

    const mcpConfigured = await mcpConfiguredAnywhere();
    tokens = await readTokens();
    authorized = Boolean(tokens?.access_token);

    /** @type {import('@onmyagent/types/kdocs-connector').KdocsConnectionPhase} */
    let phase = "disconnected";
    if (busy) phase = "busy";
    else if (authorized && mcpConfigured) phase = "connected";
    else if (authorized && !mcpConfigured) phase = "error";
    else phase = "disconnected";

    /** @type {import('@onmyagent/types/kdocs-connector').KdocsConnectionStatus} */
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
    };
    emitStatus(status);
    return status;
  }

  /**
   * @param {{ accessToken: string }} input
   */
  async function connectWithToken(input) {
    const accessToken = String(input?.accessToken ?? "").trim();
    if (!accessToken) {
      const err = new Error("Access token is required");
      // @ts-expect-error coded
      err.code = "missing_token";
      throw err;
    }
    busy = true;
    try {
      emitProgress({
        operation: "connect",
        phase: "materializing",
        message: "Writing Kingsoft Docs MCP config",
      });
      await writeTokens({
        access_token: accessToken,
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
    } finally {
      busy = false;
    }
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
    connectWithToken,
    disconnect,
  };
}
