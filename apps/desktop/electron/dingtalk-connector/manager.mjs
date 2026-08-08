/**
 * DingTalk connector: Client ID/Secret + OpenCode local MCP (npx dingtalk-mcp).
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
  CREDENTIALS_FILE,
  DEFAULT_PROFILES,
  MCP_PACKAGE,
  MCP_SERVER_NAME,
  OWNER,
  PLUGIN_ID,
  STATE_FILE,
} from "./constants.mjs";

/**
 * @param {string | undefined} homeDir
 */
export function resolveDingtalkManagedRoot(homeDir) {
  return path.join(resolveLocalManagedToolsRoot(homeDir), PLUGIN_ID);
}

/**
 * @param {{ clientId: string, clientSecret: string, activeProfiles?: string }} creds
 */
export function buildDingtalkMcpEntry(creds) {
  const clientId = String(creds?.clientId ?? "").trim();
  const clientSecret = String(creds?.clientSecret ?? "").trim();
  const activeProfiles =
    String(creds?.activeProfiles ?? "").trim() || DEFAULT_PROFILES;
  return {
    type: "local",
    command: ["npx", "-y", MCP_PACKAGE],
    enabled: true,
    environment: {
      DINGTALK_Client_ID: clientId,
      DINGTALK_Client_Secret: clientSecret,
      ACTIVE_PROFILES: activeProfiles,
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
 * @param {{ clientId: string, clientSecret: string, activeProfiles?: string }} creds
 */
export function upsertDingtalkMcp(config, creds) {
  const next = { ...config };
  if (!next.$schema) next.$schema = "https://opencode.ai/config.json";
  const existing =
    next.mcp && typeof next.mcp === "object" && !Array.isArray(next.mcp)
      ? { .../** @type {Record<string, unknown>} */ (next.mcp) }
      : {};
  existing[MCP_SERVER_NAME] = buildDingtalkMcpEntry(creds);
  next.mcp = existing;
  return next;
}

/**
 * @param {Record<string, unknown>} config
 */
export function removeDingtalkMcp(config) {
  const next = { ...config };
  const existing =
    next.mcp && typeof next.mcp === "object" && !Array.isArray(next.mcp)
      ? { .../** @type {Record<string, unknown>} */ (next.mcp) }
      : {};
  const entry = existing[MCP_SERVER_NAME];
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const marker = /** @type {Record<string, unknown>} */ (entry)._onmyagent;
    const command = /** @type {Record<string, unknown>} */ (entry).command;
    const cmdStr = Array.isArray(command)
      ? command.join(" ")
      : typeof command === "string"
        ? command
        : "";
    if (
      (marker &&
        typeof marker === "object" &&
        !Array.isArray(marker) &&
        /** @type {Record<string, unknown>} */ (marker).pluginId === PLUGIN_ID) ||
      cmdStr.includes("dingtalk-mcp")
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
export function hasManagedDingtalkMcp(config) {
  const mcp =
    config.mcp && typeof config.mcp === "object" && !Array.isArray(config.mcp)
      ? /** @type {Record<string, unknown>} */ (config.mcp)
      : null;
  if (!mcp) return false;
  const entry = mcp[MCP_SERVER_NAME];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const rec = /** @type {Record<string, unknown>} */ (entry);
  if (rec.enabled === false) return false;
  const marker = rec._onmyagent;
  if (
    marker &&
    typeof marker === "object" &&
    !Array.isArray(marker) &&
    /** @type {Record<string, unknown>} */ (marker).pluginId === PLUGIN_ID
  ) {
    return true;
  }
  const command = rec.command;
  const cmdStr = Array.isArray(command)
    ? command.join(" ")
    : typeof command === "string"
      ? command
      : "";
  return cmdStr.includes("dingtalk-mcp");
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
 *   onProgress?: (progress: import('@onmyagent/types/dingtalk-connector').DingtalkAuthProgress) => void,
 *   onStatus?: (status: import('@onmyagent/types/dingtalk-connector').DingtalkConnectionStatus) => void,
 *   now?: () => number,
 * }} options
 */
export function createDingtalkConnectorManager(options) {
  if (!options?.globalOpencodeRoot) {
    throw new Error("createDingtalkConnectorManager requires globalOpencodeRoot");
  }

  const homeDir = options.homeDir;
  const now = options.now ?? (() => Date.now());
  let busy = false;

  function managedRoot() {
    return resolveDingtalkManagedRoot(homeDir);
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

  async function readCredentials() {
    return readJson(path.join(managedRoot(), CREDENTIALS_FILE));
  }

  async function writeCredentials(creds) {
    await writeJsonAtomic(path.join(managedRoot(), CREDENTIALS_FILE), creds);
  }

  async function clearCredentials() {
    await rm(path.join(managedRoot(), CREDENTIALS_FILE), { force: true });
  }

  function credentialsUsable(creds) {
    return Boolean(
      creds?.client_id &&
        String(creds.client_id).trim() &&
        creds?.client_secret &&
        String(creds.client_secret).trim(),
    );
  }

  async function applyMcpConfig(creds) {
    const { results, errors } = await updateOpencodeConfigs(
      { roots: opencodeConfigRoots(), pathExists },
      (config) =>
        upsertDingtalkMcp(config, {
          clientId: String(creds.client_id),
          clientSecret: String(creds.client_secret),
          activeProfiles: creds.active_profiles
            ? String(creds.active_profiles)
            : undefined,
        }),
    );
    if (results.length === 0) {
      throw errors[0] ?? new Error("Failed to write dingtalk MCP config");
    }
    return results;
  }

  async function clearMcpConfig() {
    await updateOpencodeConfigs(
      { roots: opencodeConfigRoots(), pathExists },
      (config) => removeDingtalkMcp(config),
    );
  }

  async function mcpConfiguredAnywhere() {
    for (const root of opencodeConfigRoots()) {
      try {
        const { config } = await readGlobalOpencodeConfig({
          globalOpencodeRoot: root,
          pathExists,
        });
        if (hasManagedDingtalkMcp(config)) return true;
      } catch {
        // continue
      }
    }
    return false;
  }

  async function getStatus() {
    let creds = await readCredentials();
    let authorized = credentialsUsable(creds);

    if (authorized && creds) {
      try {
        if (!(await mcpConfiguredAnywhere())) {
          await applyMcpConfig(creds);
        }
      } catch (error) {
        console.warn("[dingtalk] heal applyMcpConfig failed:", error);
      }
    }

    const mcpConfigured = await mcpConfiguredAnywhere();
    creds = await readCredentials();
    authorized = credentialsUsable(creds);

    /** @type {import('@onmyagent/types/dingtalk-connector').DingtalkConnectionPhase} */
    let phase = "disconnected";
    if (busy) phase = "busy";
    else if (authorized && mcpConfigured) phase = "connected";
    else if (authorized && !mcpConfigured) phase = "error";
    else phase = "disconnected";

    /** @type {import('@onmyagent/types/dingtalk-connector').DingtalkConnectionStatus} */
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
      activeProfiles: creds?.active_profiles
        ? String(creds.active_profiles)
        : authorized
          ? DEFAULT_PROFILES
          : null,
    };
    emitStatus(status);
    return status;
  }

  /**
   * @param {import('@onmyagent/types/dingtalk-connector').DingtalkConnectInput} input
   */
  async function connectWithCredentials(input) {
    const clientId = String(input?.clientId ?? "").trim();
    const clientSecret = String(input?.clientSecret ?? "").trim();
    const activeProfiles =
      String(input?.activeProfiles ?? "").trim() || DEFAULT_PROFILES;
    if (!clientId || !clientSecret) {
      const err = new Error("Client ID and Client Secret are required");
      // @ts-expect-error coded
      err.code = "missing_credentials";
      throw err;
    }
    busy = true;
    try {
      emitProgress({
        operation: "connect",
        phase: "materializing",
        message: "Writing DingTalk MCP config",
      });
      const stored = {
        client_id: clientId,
        client_secret: clientSecret,
        active_profiles: activeProfiles,
        obtained_at: now(),
      };
      await writeCredentials(stored);
      await applyMcpConfig(stored);
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
      await clearCredentials();
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
    connectWithCredentials,
    disconnect,
  };
}
