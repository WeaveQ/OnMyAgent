/**
 * BaseChannelPlugin - Unified channel plugin abstraction
 * 
 * All messaging channels (Weixin, Feishu, etc.) extend this base class
 * to provide consistent lifecycle, state management, event routing, and error handling.
 * 
 * Design principles:
 * 1. Local-first security: all pairing/authorization decisions happen locally
 * 2. Unified lifecycle: initialize -> start -> stop -> dispose
 * 3. State machine: stopped -> starting -> running -> backoff -> error -> stopped
 * 4. Event-driven: all events routed through ChannelEventBus
 * 5. DRY: common logging, retry, error handling in base class
 */

import { EventEmitter } from "node:events";
import crypto from "node:crypto";

export const CHANNEL_STATES = {
  STOPPED: "stopped",
  STARTING: "starting",
  RUNNING: "running",
  BACKOFF: "backoff",
  ERROR: "error",
};

export class BaseChannelPlugin extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} [options.channelId] - Unique channel identifier (e.g., "wechat", "feishu")
   * @param {string} [options.channelName] - Human-readable channel name
   * @param {string} [options.userDataDir] - User data directory for persistence
   * @param {Object} [options.personalAgentRuntime] - Personal agent runtime reference
   * @param {(event: Object) => void} [options.appendLog] - Logging function
   */
  constructor(options = {}) {
    super();
    this.setMaxListeners(100);

    this.channelId = options.channelId;
    this.channelName = options.channelName;
    this.userDataDir = options.userDataDir;
    this.personalAgentRuntime = options.personalAgentRuntime;
    this.appendLog = options.appendLog || ((event) => console.warn(`[${this.channelId}]`, event?.text || event));

    // Core state
    this._state = CHANNEL_STATES.STOPPED;
    this._stateTimestamp = Date.now();
    this._lastError = null;

    // Statistics
    this._processedCount = 0;
    this._sentCount = 0;
    this._lastMessageAt = null;
    this._startTime = null;

    // Connection state
    this._connectionAttempts = 0;
    this._maxBackoffMs = 5 * 60 * 1000; // 5 minutes
    this._backoffTimer = null;
    this._disposed = false;

    // Subclass hook: implement in subclass
    this._platformSpecificInitialize = null;
    this._platformSpecificStart = null;
    this._platformSpecificStop = null;
    this._platformSpecificSendMessage = null;
    this._platformSpecificEditMessage = null;
  }

  /**
   * Get current channel state
   * @returns {Object} Current status object
   */
  getStatus() {
    return {
      channelId: this.channelId,
      channelName: this.channelName,
      status: this._state,
      stateTimestamp: this._stateTimestamp,
      websocketState: this._state === CHANNEL_STATES.RUNNING ? "open" : "closed",
      processedCount: this._processedCount,
      sentCount: this._sentCount,
      lastMessageAt: this._lastMessageAt,
      startTime: this._startTime,
      connectionAttempts: this._connectionAttempts,
      lastError: this._lastError,
      uptimeMs: this._startTime ? Date.now() - this._startTime : 0,
    };
  }

  /**
   * Get current channel state enum
   * @returns {string} Current state
   */
  get state() {
    return this._state;
  }

  /**
   * Check if channel is running
   * @returns {boolean} True if running or backoff
   */
  isRunning() {
    return this._state === CHANNEL_STATES.RUNNING || this._state === CHANNEL_STATES.BACKOFF;
  }

  /**
   * Initialize the channel plugin
   * Subclasses should override _platformSpecificInitialize
   * @returns {Promise<Object>} Initialization result
   */
  async initialize() {
    if (this._disposed) {
      throw new Error(`[${this.channelId}] Cannot initialize disposed channel`);
    }

    this.appendLog({ text: `Initializing ${this.channelName} channel...` });

    try {
      if (this._platformSpecificInitialize) {
        await this._platformSpecificInitialize();
      }

      this.appendLog({ text: `${this.channelName} channel initialized` });
      this.emit("initialized", { channelId: this.channelId });

      return { ok: true, channelId: this.channelId };
    } catch (error) {
      this._setState(CHANNEL_STATES.ERROR);
      this._lastError = error.message;
      this.appendLog({ text: `Initialization failed: ${error.message}`, error });
      this.emit("error", { error, phase: "initialize" });
      throw error;
    }
  }

  /**
   * Start the channel plugin
   * Subclasses should override _platformSpecificStart
   * @returns {Promise<Object>} Start result
   */
  async start() {
    if (this._disposed) {
      throw new Error(`[${this.channelId}] Cannot start disposed channel`);
    }

    if (this._state === CHANNEL_STATES.RUNNING) {
      this.appendLog({ text: `${this.channelName} channel already running` });
      return { ok: true, channelId: this.channelId, alreadyRunning: true };
    }

    this._setState(CHANNEL_STATES.STARTING);
    this._connectionAttempts++;
    this.appendLog({ text: `Starting ${this.channelName} channel (attempt ${this._connectionAttempts})...` });

    try {
      if (this._platformSpecificStart) {
        await this._platformSpecificStart();
      }

      this._setState(CHANNEL_STATES.RUNNING);
      this._startTime = Date.now();
      this._lastError = null;
      this._clearBackoff();

      this.appendLog({ text: `${this.channelName} channel started successfully` });
      this.emit("started", { channelId: this.channelId });

      return { ok: true, channelId: this.channelId };
    } catch (error) {
      this._setState(CHANNEL_STATES.ERROR);
      this._lastError = error.message;
      this.appendLog({ text: `Start failed: ${error.message}`, error });
      this.emit("error", { error, phase: "start" });

      // Schedule backoff retry
      this._scheduleBackoff();
      throw error;
    }
  }

  /**
   * Stop the channel plugin
   * Subclasses should override _platformSpecificStop
   * @returns {Promise<Object>} Stop result
   */
  async stop() {
    if (this._disposed) {
      return { ok: true, channelId: this.channelId, alreadyDisposed: true };
    }

    this._clearBackoff();
    this._setState(CHANNEL_STATES.STOPPED);
    this.appendLog({ text: `Stopping ${this.channelName} channel...` });

    try {
      if (this._platformSpecificStop) {
        await this._platformSpecificStop();
      }

      this.appendLog({ text: `${this.channelName} channel stopped` });
      this.emit("stopped", { channelId: this.channelId });

      return { ok: true, channelId: this.channelId };
    } catch (error) {
      this._lastError = error.message;
      this.appendLog({ text: `Stop failed: ${error.message}`, error });
      this.emit("error", { error, phase: "stop" });
      throw error;
    }
  }

  /**
   * Restart the channel
   * @returns {Promise<Object>} Restart result
   */
  async restart() {
    this.appendLog({ text: `Restarting ${this.channelName} channel...` });
    await this.stop();
    // Small delay between stop and start
    await new Promise((resolve) => setTimeout(resolve, 500));
    return this.start();
  }

  /**
   * Send a message through this channel
   * Subclasses should override _platformSpecificSendMessage
   * @param {Object} message - Message to send
   * @returns {Promise<Object>} Send result
   */
  async sendMessage(message) {
    if (!this.isRunning()) {
      throw new Error(`[${this.channelId}] Cannot send message: channel not running`);
    }

    try {
      let result;
      if (this._platformSpecificSendMessage) {
        result = await this._platformSpecificSendMessage(message);
      } else {
        result = { ok: true, messageId: this._generateMessageId() };
      }

      this._sentCount++;
      this.emit("message:sent", { message, result });

      return result;
    } catch (error) {
      this.appendLog({ text: `Send message failed: ${error.message}`, error });
      this.emit("error", { error, phase: "sendMessage" });
      throw error;
    }
  }

  /**
   * Edit an existing message
   * Subclasses should override _platformSpecificEditMessage
   * @param {string} messageId - Message to edit
   * @param {Object} updates - Message updates
   * @returns {Promise<Object>} Edit result
   */
  async editMessage(messageId, updates) {
    if (!this.isRunning()) {
      throw new Error(`[${this.channelId}] Cannot edit message: channel not running`);
    }

    try {
      if (this._platformSpecificEditMessage) {
        return await this._platformSpecificEditMessage(messageId, updates);
      }
      return { ok: true, messageId };
    } catch (error) {
      this.appendLog({ text: `Edit message failed: ${error.message}`, error });
      this.emit("error", { error, phase: "editMessage" });
      throw error;
    }
  }

  /**
   * Handle incoming message from the platform
   * Should be called by subclasses when a message is received
   * @param {Object} message - Received message
   */
  _onMessageReceived(message) {
    this._processedCount++;
    this._lastMessageAt = Date.now();
    this.emit("message:received", { channelId: this.channelId, message });
  }

  /**
   * Update channel state
   * @param {string} newState - New state
   */
  _setState(newState) {
    if (this._state !== newState) {
      const oldState = this._state;
      this._state = newState;
      this._stateTimestamp = Date.now();
      this.emit("state:changed", { channelId: this.channelId, oldState, newState });
    }
  }

  /**
   * Schedule backoff retry
   */
  _scheduleBackoff() {
    this._clearBackoff();

    const backoffMs = Math.min(
      1000 * Math.pow(2, Math.min(this._connectionAttempts - 1, 10)),
      this._maxBackoffMs
    );

    this._setState(CHANNEL_STATES.BACKOFF);
    this.appendLog({ text: `Scheduling retry in ${Math.round(backoffMs / 1000)}s...` });

    this._backoffTimer = setTimeout(() => {
      if (!this._disposed && this._state === CHANNEL_STATES.BACKOFF) {
        this.start().catch(() => {
          // Error already logged in start()
        });
      }
    }, backoffMs);
  }

  /**
   * Clear backoff timer
   */
  _clearBackoff() {
    if (this._backoffTimer) {
      clearTimeout(this._backoffTimer);
      this._backoffTimer = null;
    }
  }

  /**
   * Generate unique message ID
   * @returns {string} Message ID
   */
  _generateMessageId() {
    return `${this.channelId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }

  /**
   * Dispose the channel plugin
   */
  async dispose() {
    this._disposed = true;
    this._clearBackoff();
    await this.stop();
    this.removeAllListeners();
  }
}

export default BaseChannelPlugin;
