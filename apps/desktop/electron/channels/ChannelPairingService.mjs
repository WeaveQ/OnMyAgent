/**
 * ChannelPairingService - Secure pairing and user authorization
 * 
 * Provides local-first pairing mechanism:
 * - 6-digit pairing code with 10-minute expiry
 * - Local-only approval/denial (never approve via IM)
 * - Persistent authorized user whitelist
 * - User authorization checking
 * 
 * Security principle: All pairing decisions happen locally in the Studio UI.
 * Remote IM users can only request pairing, not approve it.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { channelEventBus, CHANNEL_EVENTS } from "./ChannelEventBus.mjs";

export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export class ChannelPairingService {
  /**
   * @param {Object} options
   * @param {string} [options.userDataDir] - User data directory for persistence
   */
  constructor(options = {}) {
    this.userDataDir = options.userDataDir;
    this._pairingRequests = new Map(); // code -> request
    this._authorizedUsers = new Map(); // platformType:userId -> user
    this._cleanupTimer = null;
    this._storagePath = null;
    this._initialized = false;
  }

  /**
   * Initialize the pairing service
   */
  async initialize() {
    if (this._initialized) return;

    this._storagePath = path.join(this.userDataDir, "channel-pairing");
    await fs.mkdir(this._storagePath, { recursive: true });

    // Load authorized users from disk
    await this._loadAuthorizedUsers();

    // Start cleanup timer for expired pairing requests
    this._cleanupTimer = setInterval(
      () => this._cleanupExpiredRequests(),
      60 * 1000 // Check every minute
    );
    this._cleanupTimer.unref?.();

    this._initialized = true;
    console.log("[ChannelPairingService] Initialized");
  }

  /**
   * Generate a new pairing request
   * @param {Object} options
   * @param {string} [options.platformType] - Platform type (wechat, feishu)
   * @param {string} [options.platformUserId] - User ID on the platform
   * @param {string} [options.displayName] - User display name
   * @returns {Promise<Object>} Pairing request
   */
  async requestPairing(options = {}) {
    const { platformType, platformUserId, displayName } = options;

    if (!platformType || !platformUserId) {
      throw new Error("platformType and platformUserId are required");
    }

    // Check if already authorized
    const userKey = this._getUserKey(platformType, platformUserId);
    if (this._authorizedUsers.has(userKey)) {
      return {
        alreadyAuthorized: true,
        user: this._authorizedUsers.get(userKey),
      };
    }

    const existing = Array.from(this._pairingRequests.values()).find(
      (request) => request.platformType === platformType
        && request.platformUserId === platformUserId
        && request.status === "pending"
        && request.expiresAt > Date.now()
    );
    if (existing) return { pairingRequest: existing, alreadyPending: true };

    // Generate unique pairing code
    const code = await this._generateUniquePairingCode();

    const request = {
      code,
      platformType,
      platformUserId,
      displayName: displayName || platformUserId,
      requestedAt: Date.now(),
      expiresAt: Date.now() + PAIRING_EXPIRY_MS,
      status: "pending",
    };

    this._pairingRequests.set(code, request);

    // Publish event for UI to show
    channelEventBus.publish(CHANNEL_EVENTS.PAIRING_REQUESTED, {
      pairingRequest: request,
    });

    console.log(`[ChannelPairingService] Pairing requested: ${platformType}/${platformUserId} -> code: ${code}`);

    return { pairingRequest: request };
  }

  /**
   * Approve a pairing request (LOCAL ONLY - must be called from UI)
   * @param {string} code - Pairing code
   * @returns {Promise<Object>} Authorized user
   */
  async approvePairing(code) {
    const request = this._pairingRequests.get(code);
    if (!request) {
      throw new Error("Pairing request not found or expired");
    }

    if (request.status !== "pending") {
      throw new Error(`Pairing request is ${request.status}`);
    }

    // Create authorized user record
    const userKey = this._getUserKey(request.platformType, request.platformUserId);
    const user = {
      id: crypto.randomUUID(),
      platformType: request.platformType,
      platformUserId: request.platformUserId,
      displayName: request.displayName,
      authorizedAt: Date.now(),
      lastActive: Date.now(),
    };

    this._authorizedUsers.set(userKey, user);
    this._pairingRequests.delete(code);

    // Persist to disk
    await this._saveAuthorizedUsers();

    channelEventBus.publish(CHANNEL_EVENTS.PAIRING_APPROVED, {
      pairingRequest: request,
      user,
    });

    channelEventBus.publish(CHANNEL_EVENTS.USER_AUTHORIZED, { user });

    console.log(`[ChannelPairingService] Pairing approved: ${user.platformType}/${user.platformUserId}`);

    return { user };
  }

  /**
   * Deny a pairing request (LOCAL ONLY)
   * @param {string} code - Pairing code
   */
  async denyPairing(code) {
    const request = this._pairingRequests.get(code);
    if (!request) {
      throw new Error("Pairing request not found or expired");
    }

    this._pairingRequests.delete(code);

    channelEventBus.publish(CHANNEL_EVENTS.PAIRING_DENIED, {
      pairingRequest: request,
    });

    console.log(`[ChannelPairingService] Pairing denied: ${request.platformType}/${request.platformUserId}`);

    return { ok: true };
  }

  /**
   * Check if a user is authorized
   * @param {string} platformType - Platform type
   * @param {string} platformUserId - Platform user ID
   * @returns {boolean} True if authorized
   */
  isUserAuthorized(platformType, platformUserId) {
    const userKey = this._getUserKey(platformType, platformUserId);
    return this._authorizedUsers.has(userKey);
  }

  /**
   * Get authorized user record
   * @param {string} platformType - Platform type
   * @param {string} platformUserId - Platform user ID
   * @returns {Object|null} User record or null
   */
  getAuthorizedUser(platformType, platformUserId) {
    const userKey = this._getUserKey(platformType, platformUserId);
    const user = this._authorizedUsers.get(userKey);
    return user || null;
  }

  /**
   * Update user last active timestamp
   * @param {string} platformType - Platform type
   * @param {string} platformUserId - Platform user ID
   */
  updateUserActivity(platformType, platformUserId) {
    const userKey = this._getUserKey(platformType, platformUserId);
    const user = this._authorizedUsers.get(userKey);
    if (user) {
      user.lastActive = Date.now();
      // No need to persist every activity update; will save periodically or on shutdown
    }
  }

  /**
   * Revoke user authorization
   * @param {string} platformType - Platform type
   * @param {string} platformUserId - Platform user ID
   */
  async revokeAuthorization(platformType, platformUserId) {
    const userKey = this._getUserKey(platformType, platformUserId);
    const user = this._authorizedUsers.get(userKey);

    if (user) {
      this._authorizedUsers.delete(userKey);
      await this._saveAuthorizedUsers();

      channelEventBus.publish(CHANNEL_EVENTS.USER_REVOKED, { user });

      console.log(`[ChannelPairingService] Authorization revoked: ${platformType}/${platformUserId}`);
    }

    return { ok: true };
  }

  /**
   * Get all pending pairing requests
   * @returns {Array} Pending requests
   */
  getPendingRequests() {
    return Array.from(this._pairingRequests.values()).filter(
      (r) => r.status === "pending" && r.expiresAt > Date.now()
    );
  }

  /**
   * Get all authorized users
   * @returns {Array} Authorized users
   */
  getAuthorizedUsers() {
    return Array.from(this._authorizedUsers.values());
  }

  /**
   * Get user key for map storage
   */
  _getUserKey(platformType, platformUserId) {
    return `${platformType}:${platformUserId}`;
  }

  /**
   * Generate unique pairing code
   */
  async _generateUniquePairingCode() {
    let code;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      code = this._generatePairingCode();
      attempts++;
    } while (this._pairingRequests.has(code) && attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      throw new Error("Failed to generate unique pairing code");
    }

    return code;
  }

  /**
   * Generate random 6-digit pairing code
   */
  _generatePairingCode() {
    const bytes = crypto.randomBytes(3);
    const number = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
    return String(number % 1000000).padStart(PAIRING_CODE_LENGTH, "0");
  }

  /**
   * Clean up expired pairing requests
   */
  _cleanupExpiredRequests() {
    const now = Date.now();
    const expired = [];

    for (const [code, request] of this._pairingRequests) {
      if (request.expiresAt < now) {
        expired.push(code);
        channelEventBus.publish(CHANNEL_EVENTS.PAIRING_EXPIRED, {
          pairingRequest: request,
        });
      }
    }

    for (const code of expired) {
      this._pairingRequests.delete(code);
      console.log(`[ChannelPairingService] Pairing request expired: ${code}`);
    }
  }

  /**
   * Load authorized users from disk
   */
  async _loadAuthorizedUsers() {
    const filePath = path.join(this._storagePath, "authorized-users.json");
    try {
      const data = await fs.readFile(filePath, "utf8");
      const users = JSON.parse(data);

      for (const user of users) {
        const userKey = this._getUserKey(user.platformType, user.platformUserId);
        this._authorizedUsers.set(userKey, user);
      }

      console.log(`[ChannelPairingService] Loaded ${users.length} authorized users`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("[ChannelPairingService] Failed to load authorized users:", error);
      }
      // File doesn't exist yet - start fresh
    }
  }

  /**
   * Save authorized users to disk
   */
  async _saveAuthorizedUsers() {
    const filePath = path.join(this._storagePath, "authorized-users.json");
    const users = Array.from(this._authorizedUsers.values());

    try {
      await fs.writeFile(filePath, JSON.stringify(users, null, 2), "utf8");
    } catch (error) {
      console.error("[ChannelPairingService] Failed to save authorized users:", error);
    }
  }

  /**
   * Dispose the pairing service
   */
  async dispose() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    await this._saveAuthorizedUsers();
    this._pairingRequests.clear();
  }
}

export default ChannelPairingService;
