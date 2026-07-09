/**
 * ChannelEventBus - Centralized event routing for messaging channels
 * 
 * Provides unified event routing across all channels:
 * - Message routing to personal agent runtime
 * - State change events
 * - Pairing request events
 * - Approval/denial events
 * - Error reporting
 */

import { EventEmitter } from "node:events";

export const CHANNEL_EVENTS = {
  // Channel lifecycle
  CHANNEL_INITIALIZED: "channel:initialized",
  CHANNEL_STARTED: "channel:started",
  CHANNEL_STOPPED: "channel:stopped",
  CHANNEL_STATE_CHANGED: "channel:state:changed",

  // Message events
  MESSAGE_RECEIVED: "channel:message:received",
  MESSAGE_SENT: "channel:message:sent",
  MESSAGE_EDITED: "channel:message:edited",

  // Pairing events
  PAIRING_REQUESTED: "channel:pairing:requested",
  PAIRING_APPROVED: "channel:pairing:approved",
  PAIRING_DENIED: "channel:pairing:denied",
  PAIRING_EXPIRED: "channel:pairing:expired",

  // User events
  USER_AUTHORIZED: "channel:user:authorized",
  USER_REVOKED: "channel:user:revoked",

  // Session events
  SESSION_CREATED: "channel:session:created",
  SESSION_UPDATED: "channel:session:updated",
  SESSION_CLOSED: "channel:session:closed",

  // Agent events
  AGENT_RESPONSE_START: "channel:agent:response:start",
  AGENT_RESPONSE_DELTA: "channel:agent:response:delta",
  AGENT_RESPONSE_DONE: "channel:agent:response:done",
  AGENT_TOOL_CALL: "channel:agent:tool:call",
  AGENT_APPROVAL_REQUEST: "channel:agent:approval:request",

  // Errors
  ERROR: "channel:error",

  // Reverse relay: Studio -> IM (parity S4)
  CONVERSATION_MESSAGE_FROM_STUDIO: "channel:conversation:message:from-studio",
};

class ChannelEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
    this._eventHistory = [];
    this._maxHistorySize = 1000;
  }

  /**
   * Publish an event
   * @param {string} eventName - Event name
   * @param {Object} payload - Event payload
   */
  publish(eventName, payload = {}) {
    const event = {
      id: this._generateEventId(),
      name: eventName,
      payload,
      timestamp: Date.now(),
    };

    this._eventHistory.push(event);
    if (this._eventHistory.length > this._maxHistorySize) {
      this._eventHistory.shift();
    }

    this.emit(eventName, event);
    // Also emit wildcard event for global listeners
    this.emit("*", event);
  }

  /**
   * Subscribe to an event
   * @param {string} eventName - Event name or "*" for all events
   * @param {(...args: any[]) => void} handler - Event handler
   * @returns {Function} Unsubscribe function
   */
  subscribe(eventName, handler) {
    this.on(eventName, handler);
    return () => this.off(eventName, handler);
  }

  /**
   * Get recent event history
   * @param {number} limit - Maximum number of events to return
   * @param {string} [filterEvent] - Optional event name filter
   * @returns {Array} Recent events
   */
  getHistory(limit = 100, filterEvent = null) {
    let history = [...this._eventHistory];
    if (filterEvent) {
      history = history.filter((e) => e.name === filterEvent);
    }
    return history.slice(-limit);
  }

  /**
   * Clear event history
   */
  clearHistory() {
    this._eventHistory = [];
  }

  /**
   * Generate unique event ID
   * @returns {string} Event ID
   */
  _generateEventId() {
    return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// Singleton instance
export const channelEventBus = new ChannelEventBus();

export default ChannelEventBus;
