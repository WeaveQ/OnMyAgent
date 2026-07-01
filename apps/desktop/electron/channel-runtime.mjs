import path from "node:path";
import { readdir, stat } from "node:fs/promises";

import { createFeishuService } from "./feishu/service.mjs";
import { createWeixinService } from "./weixin/service.mjs";

// Import new channel infrastructure
import {
  channelEventBus,
  CHANNEL_EVENTS,
  ChannelPairingService,
  ChannelSessionStore,
  channelMessageAdapter,
} from "./channels/index.mjs";

/**
 * Create unified messaging channel infrastructure
 *
 * Phase 1 - Core infrastructure: Base infrastructure is created here
 * Phase 2-5 - Platform services will migrate to use BaseChannelPlugin
 *
 * Current status: Hybrid mode. New infrastructure is available alongside
 * the existing weixin/feishu services. Platform services will be migrated
 * incrementally in later phases.
 */
export function createMessagingChannelServices(options = {}) {
  const userDataDir = options.userDataDir;
  const personalAgentRuntime = options.personalAgentRuntime;
  const infrastructure = createChannelInfrastructure({ userDataDir });
  const platformServiceOptions = createPlatformServiceOptions({
    userDataDir,
    personalAgentRuntime,
    infrastructure,
  });

  const weixinService = createWeixinService(platformServiceOptions.weixin);
  const feishuService = createFeishuService(platformServiceOptions.feishu);

  const services = {
    weixinService,
    feishuService,
    channelEventBus: infrastructure.eventBus,
    pairingService: infrastructure.pairingService,
    sessionStore: infrastructure.sessionStore,
    messageAdapter: infrastructure.messageAdapter,
  };

  // Create public API wrapper
  const channelInfrastructureApi = createChannelInfrastructureApi(services);

  return {
    // Platform channel services (existing)
    weixinService,
    feishuService,

    // Shared infrastructure (new AionUi-style)
    channelEventBus: infrastructure.eventBus,
    pairingService: infrastructure.pairingService,
    sessionStore: infrastructure.sessionStore,
    messageAdapter: infrastructure.messageAdapter,

    // Public API for IPC exposure
    channelInfrastructureApi,

    // Lifecycle management
    async initialize() {
      await Promise.all([
        infrastructure.pairingService.initialize(),
        infrastructure.sessionStore.initialize(),
      ]);
      console.log("[channel-runtime] All channel infrastructure initialized");
    },

    async dispose() {
      await Promise.all([
        infrastructure.pairingService.dispose(),
        infrastructure.sessionStore.dispose(),
        infrastructure.messageAdapter.dispose(),
      ]);
      console.log("[channel-runtime] All channel infrastructure disposed");
    },
  };
}

function createChannelInfrastructure({ userDataDir }) {
  return {
    eventBus: channelEventBus,
    pairingService: new ChannelPairingService({ userDataDir }),
    sessionStore: new ChannelSessionStore({ userDataDir }),
    messageAdapter: channelMessageAdapter,
  };
}

function createPlatformServiceOptions({ userDataDir, personalAgentRuntime, infrastructure }) {
  const common = {
    userDataDir,
    personalAgentRuntime,
    channelEventBus: infrastructure.eventBus,
    channelMessageAdapter: infrastructure.messageAdapter,
    channelPairingService: infrastructure.pairingService,
    channelSessionStore: infrastructure.sessionStore,
  };

  return {
    weixin: { ...common, appendLog: createChannelLogFn("weixin") },
    feishu: { ...common, appendLog: createChannelLogFn("feishu") },
  };
}

function createChannelLogFn(channelName) {
  return (event) => {
    const text = String(event?.text ?? "").trim();
    if (text) console.warn(`[${channelName}] ${text}`);
  };
}

export async function probeAccessibleRoot(input = {}) {
  const root = String(input?.root ?? input?.folderPath ?? "").trim();
  if (!root) return { ok: false, root, error: "root is required" };
  const resolved = path.resolve(root);
  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) return { ok: false, root: resolved, error: "not a directory" };
    const entries = await readdir(resolved, { withFileTypes: true });
    return { ok: true, root: resolved, readable: true, entryCount: entries.length };
  } catch (error) {
    return { ok: false, root: resolved, readable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Export events for external listeners
export { CHANNEL_EVENTS };


/**
 * Channel Infrastructure Public API
 * These methods are exposed via IPC to the renderer process
 * All security-sensitive operations (approve/deny) can only be called locally
 */
export function createChannelInfrastructureApi(services) {
  const { pairingService, sessionStore, channelEventBus } = services;

  return {
    // --- Pairing Service API ---

    /**
     * Get all pending pairing requests
     * Security: Safe to call - only shows pending requests
     */
    async getPendingPairingRequests() {
      return pairingService.getPendingRequests();
    },

    /**
     * Approve a pairing request
     * Security: This can ONLY be called from local UI, never from remote IM
     */
    async approvePairing(code) {
      if (typeof code !== "string" || code.length !== 6) {
        return { ok: false, error: "Invalid pairing code format" };
      }
      try {
        const result = await pairingService.approvePairing(code);
        return { ok: true, ...result };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /**
     * Deny a pairing request
     * Security: This can ONLY be called from local UI, never from remote IM
     */
    async denyPairing(code) {
      if (typeof code !== "string" || code.length !== 6) {
        return { ok: false, error: "Invalid pairing code format" };
      }
      try {
        await pairingService.denyPairing(code);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    // --- Authorized Users Management API ---

    /**
     * Get all authorized users
     */
    async getAuthorizedUsers() {
      return pairingService.getAuthorizedUsers();
    },

    /**
     * Check if a user is authorized
     */
    async isUserAuthorized(platformType, platformUserId) {
      return pairingService.isUserAuthorized(platformType, platformUserId);
    },

    /**
     * Revoke user authorization
     * Security: This can ONLY be called from local UI
     */
    async revokeUserAuthorization(platformType, platformUserId) {
      try {
        await pairingService.revokeAuthorization(platformType, platformUserId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    // --- Session Store API ---

    /**
     * Get or create a session for a user + agent combination
     */
    async getOrCreateSession(options) {
      try {
        const session = await sessionStore.getOrCreateSession(options);
        return { ok: true, session };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /**
     * Get session by ID
     */
    async getSession(sessionId) {
      const session = sessionStore.getSession(sessionId);
      return session ? { ok: true, session } : { ok: false, error: "Session not found" };
    },

    /**
     * Get all sessions for a platform
     */
    async getSessionsByPlatform(platformType) {
      return sessionStore.getSessionsByPlatform(platformType);
    },

    /**
     * Get all sessions for a user on a platform
     */
    async getSessionsByUser(platformType, platformUserId) {
      return sessionStore.getSessionsByUser(platformType, platformUserId);
    },

    /**
     * Close (archive) a session
     */
    async closeSession(sessionId) {
      try {
        await sessionStore.closeSession(sessionId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /**
     * Update session metadata
     */
    async updateSessionMetadata(sessionId, metadata) {
      try {
        await sessionStore.updateSessionMetadata(sessionId, metadata);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    // --- Event Bus API ---

    /**
     * Subscribe to channel events
     * Returns unsubscribe function
     */
    subscribeToChannelEvents(eventName, handler) {
      return channelEventBus.subscribe(eventName, handler);
    },

    /**
     * Get recent event history
     */
    async getChannelEventHistory(limit, filterEvent) {
      return channelEventBus.getHistory(limit, filterEvent);
    },
  };
}
