/**
 * ChannelMessageAdapter - Unified message handling for all channels
 * 
 * Provides unified handling for:
 * - Streaming output formatting
 * - Tool call rendering
 * - Approval button actions
 * - Message deduplication
 * - Rate limiting
 * 
 * Eliminates duplicate logic duplication between Weixin and Feishu services
 */

import crypto from "node:crypto";
import { channelEventBus, CHANNEL_EVENTS } from "./ChannelEventBus.mjs";

export class ChannelMessageAdapter {
  /**
   * @param {Object} options
   * @param {number} [options.maxMessageRate] - Max messages per second
   * @param {number} [options.dedupeWindowMs] - Deduplication window in ms
   */
  constructor(options = {}) {
    this.maxMessageRate = options.maxMessageRate || 10;
    this.dedupeWindowMs = options.dedupeWindowMs || 60 * 1000;

    this._messageTimestamps = new Map(); // platformType:userId -> timestamps[]
    this._seenMessageIds = new Set(); // messageId -> expiry
    this._cleanupTimer = setInterval(() => this._cleanup(), 60 * 1000);
    this._cleanupTimer.unref?.();
  }

  /**
   * Format streaming delta for platform display
   * @param {Object} delta - Stream delta
   * @param {string} platformType - Platform type
   * @returns {Object} Formatted delta
   */
  formatStreamingDelta(delta, platformType = "default") {
    const { text, toolCalls, isStreaming = false, isDone = false } = delta;

    // Base formatting
    let formattedText = text || "";

    // Handle tool calls in streaming
    if (toolCalls && toolCalls.length > 0) {
      const toolCallText = toolCalls
        .map((tc) => {
          const name = tc.name || tc.function?.name;
          const args = tc.arguments || tc.function?.arguments;
          return `\n🔧 ${name}\n${args ? "..." : ""}`;
        })
        .join("\n");

      formattedText += toolCallText;
    }

    // Platform-specific formatting
    if (platformType === "wechat") {
      // WeChat has strict line limits
      formattedText = this._truncateForWechat(formattedText);
    } else if (platformType === "feishu") {
      // Feishu supports markdown
      formattedText = this._enhanceForFeishu(formattedText);
    }

    return {
      text: formattedText,
      isStreaming,
      isDone,
      toolCalls,
    };
  }

  /**
   * Format final agent response for platform
   * @param {Object} response - Agent response
   * @param {string} platformType - Platform type
   * @returns {Object} Formatted message
   */
  formatAgentResponse(response, platformType = "default") {
    const { content, toolCalls, approvalRequests, metadata = {} } = response;

    // Format content
    let formattedContent = content || "";

    // Add tool call summaries
    if (toolCalls && toolCalls.length > 0) {
      formattedContent += "\n\n" + this._formatToolCalls(toolCalls);
    }

    // Add approval buttons
    if (approvalRequests && approvalRequests.length > 0) {
      formattedContent += "\n\n" + this._formatApprovalRequest(approvalRequests[0]);
    }

    // Platform-specific formatting
    if (platformType === "wechat") {
      formattedContent = this._truncateForWechat(formattedContent);
    } else if (platformType === "feishu") {
      formattedContent = this._enhanceForFeishu(formattedContent);
    }

    return {
      content: formattedContent,
      rawContent: content,
      toolCalls,
      approvalRequests,
      metadata,
    };
  }

  /**
   * Format tool calls for display
   */
  _formatToolCalls(toolCalls) {
    if (!toolCalls || toolCalls.length === 0) return "";

    return "**Tool Calls:**\n" + toolCalls
      .map((tc, i) => {
        const name = tc.name || tc.function?.name;
        return `${i + 1}. ${name}`;
      })
      .join("\n");
  }

  /**
   * Format approval request with buttons
   */
  _formatApprovalRequest(approval) {
    const { id, title, description } = approval;

    let text = "⚠️ **需要您的确认**\n";
    if (title) text += `${title}\n`;
    if (description) text += `${description}\n`;

    // Add button hints (actual buttons rendered by platform-specific code)
    text += `\n发送 #approve ${id} 或 #reject ${id}`;

    return text;
  }

  /**
   * Check if message should be rate limited
   * @param {string} platformType - Platform type
   * @param {string} platformUserId - User ID
   * @returns {boolean} True if rate limited
   */
  checkRateLimit(platformType, platformUserId) {
    const key = `${platformType}:${platformUserId}`;
    const now = Date.now();
    const windowStart = now - 1000;

    let timestamps = this._messageTimestamps.get(key) || [];
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxMessageRate) {
      return true;
    }

    timestamps.push(now);
    this._messageTimestamps.set(key, timestamps);
    return false;
  }

  /**
   * Check if message is duplicate
   * @param {string} messageId - Message ID
   * @returns {boolean} True if duplicate
   */
  isDuplicate(messageId) {
    return this._seenMessageIds.has(messageId);
  }

  /**
   * Mark message as seen for deduplication
   * @param {string} messageId - Message ID
   */
  markAsSeen(messageId) {
    this._seenMessageIds.add(messageId);
    // Auto-expire after deduplication window
    const timer = setTimeout(() => {
      this._seenMessageIds.delete(messageId);
    }, this.dedupeWindowMs);
    timer.unref?.();
  }

  /**
   * Parse incoming command message
   * @param {Object} message - Raw platform message
   * @param {string} platformType - Platform type
   * @returns {Object} Parsed message
   */
  parseIncomingMessage(message, platformType = "default") {
    const content = this._extractTextContent(message);
    const { command, args } = this._parseCommand(content);

    return {
      id: message.id || message.msgId || crypto.randomUUID(),
      platformType,
      platformUserId: message.userId || message.fromUserName,
      chatId: message.chatId || message.conversationId,
      content,
      command,
      commandArgs: args,
      timestamp: message.timestamp || Date.now(),
      raw: message,
    };
  }

  /**
   * Extract text content from platform message
   */
  _extractTextContent(message) {
    if (typeof message === "string") return message;
    if (message.content) return String(message.content);
    if (message.text) return String(message.text);
    return "";
  }

  /**
   * Parse command from message text
   */
  _parseCommand(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("#")) {
      return { command: null, args: null };
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    return { command, args };
  }

  /**
   * Truncate message for WeChat limits
   */
  _truncateForWechat(text) {
    // WeChat has ~2000 char limit per message
    if (text.length <= 1900) return text;
    return text.slice(0, 1900) + "\n... (消息过长，已截断)";
  }

  /**
   * Enhance message with Feishu markdown
   */
  _enhanceForFeishu(text) {
    // Pass-through for now - Feishu supports markdown natively
    return text;
  }

  /**
   * Clean up expired entries
   */
  _cleanup() {
    const now = Date.now();
    const windowStart = now - 1000;

    // Clean up rate limit timestamps
    for (const [key, timestamps] of this._messageTimestamps) {
      const filtered = timestamps.filter((t) => t > windowStart);
      if (filtered.length === 0) {
        this._messageTimestamps.delete(key);
      } else {
        this._messageTimestamps.set(key, filtered);
      }
    }
  }

  /**
   * Dispose the adapter
   */
  dispose() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._messageTimestamps.clear();
    this._seenMessageIds.clear();
  }
}

// Singleton instance
export const channelMessageAdapter = new ChannelMessageAdapter();

export default ChannelMessageAdapter;
