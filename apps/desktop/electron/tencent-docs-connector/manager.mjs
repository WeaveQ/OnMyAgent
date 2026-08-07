/**
 * Tencent Docs connector manager: OAuth + OpenCode MCP headers + skill materialize.
 * No binary download (unlike OfficeCLI / Feishu CLI).
 */
import { randomUUID } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveLocalSkillsRoot,
  resolveTencentDocsManagedRoot,
} from "../config-profile-paths.mjs";
import {
  AUTH_TIMEOUT_MS,
  CLIENT_FILE,
  CLIENT_NAME,
  MAIN_MCP_URL,
  MANAGED_MARKER_FILE,
  MCP_SERVER_NAMES,
  OWNER,
  PLUGIN_ID,
  SKILL_ID,
  STATE_FILE,
  TOKEN_FILE,
  TOKEN_SKEW_MS,
} from "./constants.mjs";
import {
  hasManagedTencentDocsMcp,
  readGlobalOpencodeConfig,
  removeTencentDocsMcp,
  updateGlobalOpencodeConfig,
  upsertTencentDocsMcp,
} from "./mcp-config.mjs";
import {
  allocateLoopbackPort,
  buildAuthorizationUrl,
  createOAuthCallbackServer,
  discoverOAuthEndpoints,
  ensureDynamicClient,
  exchangeAuthorizationCode,
  pkceChallengeS256,
  randomHex,
  oauthError,
  refreshAccessToken,
} from "./oauth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} target
 */
async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
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

/**
 * @param {string} filePath
 */
async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Default bundled skill source (dev + packaged via resources path injection).
 * @param {string | undefined} bundledSkillsRoot
 */
export function defaultBundledSkillSource(bundledSkillsRoot) {
  if (bundledSkillsRoot) {
    return path.join(bundledSkillsRoot, SKILL_ID);
  }
  // Dev fallback: apps/desktop/resources/bundled-skills/tencent-docs
  return path.resolve(
    __dirname,
    "../../resources/bundled-skills",
    SKILL_ID,
  );
}

/**
 * @param {{
 *   homeDir?: string,
 *   globalOpencodeRoot: string | (() => string),
 *   bundledSkillSource?: string | (() => string),
 *   openExternal?: (url: string) => Promise<void> | void,
 *   refreshSkillLinks?: () => Promise<unknown> | unknown,
 *   onProgress?: (progress: import('@onmyagent/types/tencent-docs-connector').TencentDocsAuthProgress) => void,
 *   onStatus?: (status: import('@onmyagent/types/tencent-docs-connector').TencentDocsConnectionStatus) => void,
 *   now?: () => number,
 * }} options
 */
export function createTencentDocsConnectorManager(options) {
  if (!options?.globalOpencodeRoot) {
    throw new Error("createTencentDocsConnectorManager requires globalOpencodeRoot");
  }

  const homeDir = options.homeDir;
  const now = options.now ?? (() => Date.now());

  function managedRoot() {
    return resolveTencentDocsManagedRoot(homeDir);
  }

  function skillsRoot() {
    return resolveLocalSkillsRoot(homeDir);
  }

  function skillPath() {
    return path.join(skillsRoot(), SKILL_ID);
  }

  function globalOpencodeRoot() {
    return typeof options.globalOpencodeRoot === "function"
      ? options.globalOpencodeRoot()
      : options.globalOpencodeRoot;
  }

  function bundledSkillSource() {
    if (typeof options.bundledSkillSource === "function") {
      return options.bundledSkillSource();
    }
    if (options.bundledSkillSource) return options.bundledSkillSource;
    return defaultBundledSkillSource(undefined);
  }

  /** @type {Map<string, any>} */
  const sessions = new Map();
  let busy = false;

  /**
   * @param {import('@onmyagent/types/tencent-docs-connector').TencentDocsAuthProgress} progress
   */
  function emitProgress(progress) {
    try {
      options.onProgress?.(progress);
    } catch {
      // ignore listener errors
    }
  }

  /**
   * @param {import('@onmyagent/types/tencent-docs-connector').TencentDocsConnectionStatus} status
   */
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

  async function readClientInfo() {
    return readJson(path.join(managedRoot(), CLIENT_FILE));
  }

  async function writeClientInfo(info) {
    await writeJsonAtomic(path.join(managedRoot(), CLIENT_FILE), info);
  }

  async function writeState(patch) {
    const prev = (await readJson(path.join(managedRoot(), STATE_FILE))) ?? {};
    const next = {
      ...prev,
      ...patch,
      pluginId: PLUGIN_ID,
      updatedAt: now(),
    };
    await writeJsonAtomic(path.join(managedRoot(), STATE_FILE), next);
    return next;
  }

  /**
   * @param {any} tokens
   */
  function tokenUsable(tokens) {
    if (!tokens?.access_token) return false;
    if (typeof tokens.expires_at === "number") {
      return tokens.expires_at - TOKEN_SKEW_MS > now();
    }
    return true;
  }

  async function ensureFreshTokens() {
    let tokens = await readTokens();
    if (!tokens?.access_token) return null;
    if (tokenUsable(tokens)) return tokens;

    if (!tokens.refresh_token) return null;
    const client = await readClientInfo();
    if (!client?.client_id) return null;

    try {
      emitProgress({
        operation: "refresh",
        phase: "starting",
        message: "Refreshing Tencent Docs token",
      });
      const endpoints = await discoverOAuthEndpoints();
      const refreshed = await refreshAccessToken({
        tokenEndpoint: endpoints.tokenEndpoint,
        clientId: String(client.client_id),
        refreshToken: String(tokens.refresh_token),
        resource: endpoints.resource || MAIN_MCP_URL,
      });
      // Keep previous refresh_token if provider omitted a new one.
      if (!refreshed.refresh_token && tokens.refresh_token) {
        refreshed.refresh_token = tokens.refresh_token;
      }
      await writeTokens(refreshed);
      await applyMcpConfig(refreshed.access_token);
      emitProgress({ operation: "refresh", phase: "complete" });
      return refreshed;
    } catch (error) {
      emitProgress({
        operation: "refresh",
        phase: "error",
        errorCode:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "oauth_refresh_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * @param {string} accessToken
   */
  async function applyMcpConfig(accessToken) {
    await updateGlobalOpencodeConfig(
      { globalOpencodeRoot: globalOpencodeRoot(), pathExists },
      (config) => upsertTencentDocsMcp(config, accessToken),
    );
  }

  async function clearMcpConfig() {
    await updateGlobalOpencodeConfig(
      { globalOpencodeRoot: globalOpencodeRoot(), pathExists },
      (config) => removeTencentDocsMcp(config, MCP_SERVER_NAMES),
    );
  }

  async function readOwnership(dir) {
    try {
      const marker = JSON.parse(
        await readFile(path.join(dir, MANAGED_MARKER_FILE), "utf8"),
      );
      return marker?.owner === OWNER && marker?.pluginId === PLUGIN_ID;
    } catch {
      return false;
    }
  }

  /**
   * Foreign managed skill (another OnMyAgent plugin) must not be clobbered.
   * Unmarked / legacy marketplace copies of tencent-docs are upgraded in place.
   * @param {string} dir
   */
  async function readForeignManagedPluginId(dir) {
    try {
      const marker = JSON.parse(
        await readFile(path.join(dir, MANAGED_MARKER_FILE), "utf8"),
      );
      if (
        marker &&
        typeof marker === "object" &&
        marker.owner === OWNER &&
        typeof marker.pluginId === "string" &&
        marker.pluginId !== PLUGIN_ID
      ) {
        return marker.pluginId;
      }
    } catch {
      // no marker
    }
    return null;
  }

  /**
   * True when dest is the product tencent-docs skill (or empty enough to claim).
   * Legacy installs often have no managed marker but frontmatter name: tencent-docs.
   * @param {string} dir
   */
  async function isUpgradeableTencentDocsSkill(dir) {
    if (await readOwnership(dir)) return true;
    if (await readForeignManagedPluginId(dir)) return false;
    try {
      const skillMd = await readFile(path.join(dir, "SKILL.md"), "utf8");
      // YAML frontmatter name: tencent-docs (with optional quotes)
      if (/^name:\s*["']?tencent-docs["']?\s*$/m.test(skillMd)) {
        return true;
      }
      // Directory is our product id and has a skill entry file.
      return true;
    } catch {
      return true;
    }
  }

  async function materializeSkill() {
    const source = bundledSkillSource();
    const dest = skillPath();
    if (!(await pathExists(path.join(source, "SKILL.md")))) {
      throw oauthError(
        `Bundled tencent-docs skill missing at ${source}`,
        "skill_source_missing",
      );
    }
    if (await pathExists(dest)) {
      const foreign = await readForeignManagedPluginId(dest);
      if (foreign) {
        throw oauthError(
          `Skill path is owned by another managed plugin: ${foreign}`,
          "skill_conflict",
        );
      }
      if (!(await isUpgradeableTencentDocsSkill(dest))) {
        throw oauthError(
          "An existing user-owned tencent-docs skill was not overwritten",
          "skill_conflict",
        );
      }
      // Upgrade legacy marketplace / unmarked copies to connector-managed skill.
      await rm(dest, { recursive: true, force: true });
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(source, dest, { recursive: true });
    await writeJsonAtomic(path.join(dest, MANAGED_MARKER_FILE), {
      schemaVersion: 1,
      owner: OWNER,
      pluginId: PLUGIN_ID,
      skillId: SKILL_ID,
      installedAt: now(),
      upgradedFrom: "connector",
    });
    if (options.refreshSkillLinks) {
      await options.refreshSkillLinks();
    }
  }

  async function removeManagedSkill() {
    const dest = skillPath();
    if (!(await pathExists(dest))) return;
    // Only remove skills we marked as connector-managed.
    if (!(await readOwnership(dest))) {
      return;
    }
    await rm(dest, { recursive: true, force: true });
    if (options.refreshSkillLinks) {
      await options.refreshSkillLinks();
    }
  }

  /**
   * @returns {Promise<import('@onmyagent/types/tencent-docs-connector').TencentDocsConnectionStatus>}
   */
  async function getStatus() {
    const tokens = await ensureFreshTokens();
    const authorized = Boolean(tokens && tokenUsable(tokens));
    const skillInstalled =
      (await pathExists(path.join(skillPath(), "SKILL.md"))) &&
      (await readOwnership(skillPath()));

    let mcpConfigured = false;
    try {
      const { config } = await readGlobalOpencodeConfig({
        globalOpencodeRoot: globalOpencodeRoot(),
        pathExists,
      });
      mcpConfigured = hasManagedTencentDocsMcp(config, MCP_SERVER_NAMES);
    } catch {
      mcpConfigured = false;
    }

    /** @type {import('@onmyagent/types/tencent-docs-connector').TencentDocsConnectionPhase} */
    let phase = "disconnected";
    if (busy) phase = "busy";
    else if (authorized && mcpConfigured && skillInstalled) phase = "connected";
    else if (authorized || mcpConfigured) phase = "connected";
    else phase = "disconnected";

    /** @type {import('@onmyagent/types/tencent-docs-connector').TencentDocsConnectionStatus} */
    const status = {
      phase,
      mcpConfigured,
      skillInstalled,
      authorized,
      serverNames: [...MCP_SERVER_NAMES],
      message: null,
      errorCode: null,
      errorMessage: null,
      lastCheckedAt: now(),
    };
    emitStatus(status);
    return status;
  }

  /**
   * @returns {Promise<import('@onmyagent/types/tencent-docs-connector').TencentDocsStartConnectResult>}
   */
  async function startConnect() {
    const current = await getStatus();
    if (current.phase === "connected" && current.authorized) {
      // Re-ensure skill/mcp if half-broken.
      const tokens = await readTokens();
      if (tokens?.access_token) {
        await applyMcpConfig(tokens.access_token);
        try {
          await materializeSkill();
        } catch {
          // skill conflict surfaces on full reconnect
        }
        return {
          sessionId: "already-connected",
          authorizationUrl: "",
          alreadyConnected: true,
        };
      }
    }

    if (busy) {
      throw oauthError("Another Tencent Docs connect is in progress", "busy");
    }

    busy = true;
    const sessionId = randomUUID();

    try {
      emitProgress({
        operation: "connect",
        phase: "starting",
        message: "Starting Tencent Docs authorization",
      });

      const endpoints = await discoverOAuthEndpoints();
      // Stable preferred ports keep DCR redirect_uri aligned across retries.
      const port = await allocateLoopbackPort();
      const state = randomHex(16);
      // RFC 7636: code_verifier 43–128 chars; 64 hex is fine.
      const codeVerifier = randomHex(32);
      const codeChallenge = pkceChallengeS256(codeVerifier);
      const callback = createOAuthCallbackServer({
        port,
        expectedState: state,
        timeoutMs: AUTH_TIMEOUT_MS,
      });

      const existingClient = await readClientInfo();
      const client = await ensureDynamicClient({
        registrationEndpoint: endpoints.registrationEndpoint,
        redirectUri: callback.redirectUri,
        clientName: CLIENT_NAME,
        existing: existingClient,
      });
      await writeClientInfo(client);

      const authorizationUrl = buildAuthorizationUrl({
        authorizationEndpoint: endpoints.authorizationEndpoint,
        clientId: client.client_id,
        redirectUri: callback.redirectUri,
        codeChallenge,
        state,
        resource: endpoints.resource || MAIN_MCP_URL,
      });

      /** @type {Promise<import('@onmyagent/types/tencent-docs-connector').TencentDocsConnectionStatus>} */
      const completion = (async () => {
        try {
          emitProgress({
            operation: "connect",
            phase: "waiting_user",
            authorizationUrl,
            message: "Waiting for browser authorization",
          });

          if (options.openExternal) {
            await options.openExternal(authorizationUrl);
          }

          const { code } = await callback.waitForCode();
          emitProgress({
            operation: "connect",
            phase: "exchanging",
            message: "Exchanging authorization code",
          });

          const tokens = await exchangeAuthorizationCode({
            tokenEndpoint: endpoints.tokenEndpoint,
            clientId: client.client_id,
            redirectUri: callback.redirectUri,
            code,
            codeVerifier,
            resource: endpoints.resource || MAIN_MCP_URL,
          });
          await writeTokens(tokens);

          emitProgress({
            operation: "connect",
            phase: "materializing",
            message: "Writing MCP config and skill",
          });
          await applyMcpConfig(tokens.access_token);
          await materializeSkill();
          await writeState({
            connectedAt: now(),
            serverNames: [...MCP_SERVER_NAMES],
          });

          emitProgress({ operation: "connect", phase: "complete" });
          return getStatus();
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "connect_failed";
          const phase =
            code === "oauth_timeout" ? "expired" : "error";
          emitProgress({
            operation: "connect",
            phase,
            errorCode: code,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          await callback.close().catch(() => undefined);
          sessions.delete(sessionId);
          busy = false;
        }
      })();

      sessions.set(sessionId, {
        sessionId,
        authorizationUrl,
        completion,
        cancel: async () => {
          await callback.close().catch(() => undefined);
        },
      });

      return { sessionId, authorizationUrl };
    } catch (error) {
      busy = false;
      emitProgress({
        operation: "connect",
        phase: "error",
        errorCode:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "connect_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * @param {string} sessionId
   */
  async function completeConnect(sessionId) {
    if (sessionId === "already-connected") {
      return getStatus();
    }
    const session = sessions.get(sessionId);
    if (!session) {
      throw oauthError("Unknown or expired connect session", "session_not_found");
    }
    return session.completion;
  }

  async function cancelConnect() {
    for (const [id, session] of sessions) {
      await session.cancel?.();
      sessions.delete(id);
    }
    busy = false;
    emitProgress({ operation: "connect", phase: "cancelled" });
    return { ok: true };
  }

  async function disconnect() {
    busy = true;
    emitProgress({ operation: "disconnect", phase: "starting" });
    try {
      await cancelConnect().catch(() => undefined);
      await clearTokens();
      await clearMcpConfig();
      await removeManagedSkill();
      await writeState({ disconnectedAt: now(), connectedAt: null });
      emitProgress({ operation: "disconnect", phase: "complete" });
      return getStatus();
    } catch (error) {
      emitProgress({
        operation: "disconnect",
        phase: "error",
        errorCode:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "disconnect_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      busy = false;
    }
  }

  return {
    getStatus,
    startConnect,
    completeConnect,
    cancelConnect,
    disconnect,
    // test hooks
    _internals: {
      managedRoot,
      skillPath,
      materializeSkill,
      applyMcpConfig,
      readTokens,
      writeTokens,
      ensureFreshTokens,
    },
  };
}
