/**
 * ChannelStreamRelay — subscribes to agent output streams for channel-bound
 * conversations and pushes the aggregated response back to the IM channel.
 *
 * Parity with AionCore `ChannelStreamRelay` (crates/aionui-channel/stream_relay.rs):
 * - subscribes to a conversation's `AgentStreamEvent` equivalent (pushed via
 *   `pushEvent` from the dispatch site / runtime listener);
 * - accumulates `Text` deltas and tool calls;
 * - on `finish`, formats via the platform adapter and delivers a single message
 *   to the IM chat (WeChat-style platforms accumulate before sending once).
 *
 * This module is transport-agnostic: the caller supplies `sendText` (the
 * platform-specific sender, e.g. weixin/feishu `sendText`) and an optional
 * `formatResponse` (defaults to identity). It does NOT own the IM transport.
 */

export class ChannelStreamRelay {
  /**
   * @param {Object} options
   * @param {(chatId: string, text: string, platformType?: string) => Promise<void>|void} [options.sendText]
   *   Platform sender. Receives the bound chatId and aggregated text.
   * @param {(response: Object) => Object} [options.formatResponse]
   *   Optional formatter (e.g. channelMessageAdapter.formatAgentResponse).
   * @param {(...args: any[]) => void} [options.appendLog]
   */
  constructor(options = {}) {
    if (typeof options.sendText !== "function") {
      throw new Error("ChannelStreamRelay requires a sendText function");
    }
    this._sendText = options.sendText;
    this._formatResponse = typeof options.formatResponse === "function"
      ? options.formatResponse
      : (response) => response;
    this.appendLog = typeof options.appendLog === "function" ? options.appendLog : () => undefined;

    /** @type {Map<string, { chatId: string, platformType: string, buffer: string[], tools: string[], done: boolean }>} */
    this._subs = new Map();
  }

  /**
   * Subscribe a conversation to an IM chat. Repeated calls for the same
   * conversation id overwrite the chat binding (idempotent).
   * @param {string} conversationId
   * @param {Object} target - { chatId, platformType }
   */
  subscribeConversation(conversationId, target = {}) {
    const id = String(conversationId ?? "").trim();
    const chatId = String(target?.chatId ?? "").trim();
    if (!id || !chatId) {
      throw new Error("subscribeConversation requires conversationId and chatId");
    }
    const existing = this._subs.get(id);
    if (existing && !existing.done) {
      existing.chatId = chatId;
      existing.platformType = target?.platformType ?? existing.platformType;
      return;
    }
    this._subs.set(id, {
      chatId,
      platformType: target?.platformType ?? "default",
      buffer: [],
      tools: [],
      done: false,
    });
  }

  /**
   * Stop relaying a conversation.
   * @param {string} conversationId
   */
  unsubscribeConversation(conversationId) {
    const id = String(conversationId ?? "").trim();
    if (!id) return;
    this._subs.delete(id);
  }

  /**
   * Push a single agent stream event for a conversation.
   * @param {string} conversationId
   * @param {Object} event - { type, text?, name?, status? }
   */
  pushEvent(conversationId, event = {}) {
    const id = String(conversationId ?? "").trim();
    const sub = this._subs.get(id);
    if (!sub || sub.done) return;

    const type = String(event.type ?? "").toLowerCase();
    if (type === "text" || type === "delta" || type === "assistant") {
      const text = String(event.text ?? "").trimEnd();
      if (text) sub.buffer.push(text);
      return;
    }
    if (type === "tool" || type === "tool_call" || type === "acp_tool_call") {
      const name = String(event.name ?? event.function?.name ?? "").trim();
      if (name) sub.tools.push(name);
      return;
    }
    if (type === "finish" || type === "done" || type === "completed") {
      const finalText = String(event.text ?? "").trim() || sub.buffer.join("");
      const result = { content: finalText, toolCalls: sub.tools, platformType: sub.platformType };
      const formatted = this._formatResponse(result);
      const outgoing = String(formatted?.content ?? formatted?.text ?? "").trim();
      sub.done = true;
      if (outgoing) {
        Promise.resolve(this._sendText(sub.chatId, outgoing, sub.platformType)).catch((error) => {
          this.appendLog({ type: "error", text: `ChannelStreamRelay send failed: ${error?.message ?? String(error)}` });
        });
      }
    }
  }

  /**
   * Number of active subscriptions (for diagnostics).
   */
  get subscriptionCount() {
    return this._subs.size;
  }

  /**
   * Drop all subscriptions.
   */
  dispose() {
    this._subs.clear();
  }
}

export default ChannelStreamRelay;
