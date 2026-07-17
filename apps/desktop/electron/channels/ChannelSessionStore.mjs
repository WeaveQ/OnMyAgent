/**
 * ChannelSessionStore - Independent session persistence for messaging channels
 * 
 * Provides channel session isolation:
 * - Each agent has independent session context
 * - Switching agents does not carry over context
 * - Switching back restores the agent's context
 * - Sessions are persisted separately from local Studio sessions
 * - Session is scoped to user + agent + workspace
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { channelEventBus, CHANNEL_EVENTS } from "./ChannelEventBus.mjs";

export class ChannelSessionStore {
  /**
   * @param {Object} options
   * @param {string} [options.userDataDir] - User data directory for persistence
   */
  constructor(options = {}) {
    this.userDataDir = options.userDataDir;
    this._sessions = new Map(); // sessionId -> session
    this._userAgentMap = new Map(); // platformType:userId:agentType -> sessionId
    this._storagePath = null;
    this._initialized = false;
  }

  /**
   * Initialize the session store
   */
  async initialize() {
    if (this._initialized) return;

    this._storagePath = path.join(this.userDataDir, "channel-sessions");
    await fs.mkdir(this._storagePath, { recursive: true });

    // Load sessions from disk
    await this._loadSessions();

    this._initialized = true;
    console.log("[ChannelSessionStore] Initialized");
  }

  /**
   * Get or create a session for a user + agent + workspace combination
   * @param {Object} options
   * @param {string} [options.platformType] - Platform type (wechat, feishu)
   * @param {string} [options.platformUserId] - Platform user ID
   * @param {string} [options.agentType] - Agent type (codex, claude-code, etc.)
   * @param {string} [options.workspace] - Workspace path
   * @param {string} [options.chatId] - Platform chat ID
   * @returns {Promise<Object>} Session object
   */
  async getOrCreateSession(options = {}) {
    const { platformType, platformUserId, agentType, workspace, chatId } = options;

    if (!platformType || !platformUserId || !agentType) {
      throw new Error("platformType, platformUserId, and agentType are required");
    }

    // Check for existing active session for this user + agent
    const userAgentKey = this._getUserAgentKey(platformType, platformUserId, agentType);
    const existingSessionId = this._userAgentMap.get(userAgentKey);

    if (existingSessionId) {
      const session = this._sessions.get(existingSessionId);
      if (session) {
        // Update last activity
        session.lastActivity = Date.now();
        await this._saveSession(session);
        return session;
      }
    }

    // Create new session
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      platformType,
      platformUserId,
      agentType,
      workspace: workspace || null,
      chatId: chatId || null,
      conversationId: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      messages: [],
      metadata: {},
    };

    this._sessions.set(sessionId, session);
    this._userAgentMap.set(userAgentKey, sessionId);

    await this._saveSession(session);

    channelEventBus.publish(CHANNEL_EVENTS.SESSION_CREATED, { session });

    console.log(`[ChannelSessionStore] Created session: ${sessionId} for ${platformType}/${platformUserId}/${agentType}`);

    return session;
  }

  /**
   * Get an existing session by ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Session or null
   */
  getSession(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  /**
   * Bind a Studio conversation to this channel session (parity with
   * Upstream assistant_sessions.conversation_id). Idempotent: rebinding the
   * same conversationId is a no-op; binding a different id overwrites.
   * @param {string} sessionId - Channel session ID
   * @param {string} conversationId - Studio conversation ID
   */
  async bindConversation(sessionId, conversationId) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const next = String(conversationId ?? "").trim();
    if (!next) {
      throw new Error("conversationId is required to bind a conversation");
    }
    if (session.conversationId === next) return session;
    session.conversationId = next;
    session.lastActivity = Date.now();
    await this._saveSession(session);
    channelEventBus.publish(CHANNEL_EVENTS.SESSION_UPDATED, { session });
    return session;
  }

  /**
   * Read the bound Studio conversation ID for a channel session.
   * @param {string} sessionId - Channel session ID
   * @returns {string|null} Bound conversation ID or null
   */
  getConversationId(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    const id = String(session.conversationId ?? "").trim();
    return id || null;
  }

  /**
   * Reverse lookup: find the active channel session bound to a Studio
   * conversation. Used by the reverse relay (Studio -> IM) to resolve the
   * target chat. O(n) over in-memory sessions; session counts are small.
   * @param {string} conversationId - Studio conversation ID
   * @returns {Object|null} Session with chatId/platformType or null
   */
  findSessionByConversationId(conversationId) {
    const id = String(conversationId ?? "").trim();
    if (!id) return null;
    for (const session of this._sessions.values()) {
      if (session.closedAt) continue;
      if (String(session.conversationId ?? "").trim() === id) {
        return {
          id: session.id,
          chatId: session.chatId,
          platformType: session.platformType,
          platformUserId: session.platformUserId,
        };
      }
    }
    return null;
  }

  /**
   * Add a message to session history
   * @param {string} sessionId - Session ID
   * @param {Object} message - Message to add
   */
  async addSessionMessage(sessionId, message) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.messages.push({
      id: message.id || crypto.randomUUID(),
      role: message.role,
      content: message.content,
      timestamp: message.timestamp || Date.now(),
      metadata: message.metadata || {},
    });

    // Trim message history if it gets too large (keep last 200 messages)
    if (session.messages.length > 200) {
      session.messages = session.messages.slice(-200);
    }

    session.lastActivity = Date.now();

    await this._saveSession(session);

    channelEventBus.publish(CHANNEL_EVENTS.SESSION_UPDATED, { session });
  }

  /**
   * Update session metadata
   * @param {string} sessionId - Session ID
   * @param {Object} metadata - Metadata to merge
   */
  async updateSessionMetadata(sessionId, metadata) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.metadata = { ...session.metadata, ...metadata };
    session.lastActivity = Date.now();

    await this._saveSession(session);

    channelEventBus.publish(CHANNEL_EVENTS.SESSION_UPDATED, { session });
  }

  /**
   * Set session workspace
   * @param {string} sessionId - Session ID
   * @param {string} workspace - Workspace path
   */
  async setSessionWorkspace(sessionId, workspace) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.workspace = workspace;
    session.lastActivity = Date.now();

    await this._saveSession(session);

    channelEventBus.publish(CHANNEL_EVENTS.SESSION_UPDATED, { session });
  }

  /**
   * Get session message history
   * @param {string} sessionId - Session ID
   * @param {number} limit - Maximum messages to return
   * @returns {Array} Message history
   */
  getSessionMessages(sessionId, limit = 50) {
    const session = this._sessions.get(sessionId);
    if (!session) return [];
    return session.messages.slice(-limit);
  }

  /**
   * Close/archive a session
   * @param {string} sessionId - Session ID
   */
  async closeSession(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return;

    // Remove from active user-agent mapping
    const userAgentKey = this._getUserAgentKey(
      session.platformType,
      session.platformUserId,
      session.agentType
    );
    this._userAgentMap.delete(userAgentKey);

    // Mark session as closed but keep in storage
    session.closedAt = Date.now();
    await this._saveSession(session);

    channelEventBus.publish(CHANNEL_EVENTS.SESSION_CLOSED, { session });

    console.log(`[ChannelSessionStore] Closed session: ${sessionId}`);
  }

  /**
   * Get all active sessions for a platform
   * @param {string} platformType - Platform type
   * @returns {Array} Active sessions
   */
  getSessionsByPlatform(platformType) {
    return Array.from(this._sessions.values()).filter(
      (s) => s.platformType === platformType && !s.closedAt
    );
  }

  /**
   * Get all active sessions for a user
   * @param {string} platformType - Platform type
   * @param {string} platformUserId - Platform user ID
   * @returns {Array} User sessions
   */
  getSessionsByUser(platformType, platformUserId) {
    return Array.from(this._sessions.values()).filter(
      (s) => s.platformType === platformType && s.platformUserId === platformUserId && !s.closedAt
    );
  }

  /**
   * Get user-agent key for map storage
   */
  _getUserAgentKey(platformType, platformUserId, agentType) {
    return `${platformType}:${platformUserId}:${agentType}`;
  }

  /**
   * Get session file path
   */
  _getSessionPath(sessionId) {
    return path.join(this._storagePath, `${sessionId}.json`);
  }

  /**
   * Load all sessions from disk
   */
  async _loadSessions() {
    try {
      const files = await fs.readdir(this._storagePath);
      const sessionFiles = files.filter((f) => f.endsWith(".json"));

      for (const file of sessionFiles) {
        try {
          const data = await fs.readFile(path.join(this._storagePath, file), "utf8");
          const session = JSON.parse(data);

          this._sessions.set(session.id, session);

          // Rebuild user-agent mapping for active sessions
          if (!session.closedAt) {
            const userAgentKey = this._getUserAgentKey(
              session.platformType,
              session.platformUserId,
              session.agentType
            );
            this._userAgentMap.set(userAgentKey, session.id);
          }
        } catch (error) {
          console.error(`[ChannelSessionStore] Failed to load session ${file}:`, error);
        }
      }

      console.log(`[ChannelSessionStore] Loaded ${sessionFiles.length} sessions`);
    } catch (error) {
      console.error("[ChannelSessionStore] Failed to load sessions:", error);
    }
  }

  /**
   * Save a session to disk
   */
  async _saveSession(session) {
    const filePath = this._getSessionPath(session.id);
    try {
      await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf8");
    } catch (error) {
      console.error(`[ChannelSessionStore] Failed to save session ${session.id}:`, error);
    }
  }

  /**
   * Dispose the session store
   */
  async dispose() {
    // Save all sessions
    for (const session of this._sessions.values()) {
      await this._saveSession(session);
    }
  }
}

export default ChannelSessionStore;
