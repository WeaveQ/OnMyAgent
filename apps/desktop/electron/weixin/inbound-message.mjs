import { isAllowed } from "./chat-policy.mjs";
import {
  parseAgentSwitchCommand,
  parseApprovalCommand,
  parseModeCommand,
  parseModelSwitchCommand,
  parseRunCommand,
} from "./commands.mjs";
import { extractText, guessChatType } from "./helpers.mjs";
import { MSG_TYPE_BOT } from "./ilink-client.mjs";

export function createWeixinInboundProcessor({
  messagingTasks,
  dedup,
  channelTranscriptStore,
  channelPairingService,
  store,
  collectMediaFiles,
  sendText,
  maybeHandleControlCommand,
  enqueueText,
  appendLog,
  setState,
  getProcessedCount,
}) {
  async function ensureChannelUserAuthorized(session, input) {
    if (!channelPairingService) return true;
    if (channelPairingService.isUserAuthorized(input.platformType, input.platformUserId)) {
      channelPairingService.updateUserActivity(input.platformType, input.platformUserId);
      return true;
    }

    const result = await channelPairingService.requestPairing(input);
    const code = result?.pairingRequest?.code;
    if (!code) {
      appendLog({
        type: "warn",
        text: `weixin pairing request returned no code for ${input.platformUserId}`,
      });
      return false;
    }

    await sendText(
      session,
      input.chatId,
      `需要先在 Studio 本机批准配对。配对码：${code}`,
      input.platformUserId,
    ).catch(() => undefined);
    appendLog({
      type: "warn",
      text: `weixin pairing requested for ${input.platformUserId}, code=${code}`,
    });
    return false;
  }

  return async function processMessage(session, message) {
    const senderId = String(message?.from_user_id ?? "").trim();
    if (!senderId || senderId === session.account.accountId) return null;
    if (Number(message?.message_type ?? message?.msg_type) === MSG_TYPE_BOT) return null;

    const messageId = String(message?.message_id ?? "").trim();
    const itemList = Array.isArray(message?.item_list) ? message.item_list : [];
    const text = extractText(itemList).trim();
    const chat = guessChatType(message, session.account.accountId);
    if (!text) return null;

    const contextToken = String(message?.context_token ?? "").trim();
    const isControlCommand = Boolean(
      messagingTasks.canRoute(text)
      || parseApprovalCommand(text)
      || parseRunCommand(text)
      || parseModeCommand(text)
      || parseModelSwitchCommand(text)
      || parseAgentSwitchCommand(text),
    );
    const recordInbound = () => channelTranscriptStore?.recordInbound?.({
      platformType: "wechat",
      accountId: session.account.accountId,
      chatId: chat.chatId,
      platformUserId: senderId,
      externalId: messageId,
      content: text,
      role: isControlCommand ? "command" : "user",
      metadata: { chatType: chat.chatType },
    }).catch(() => undefined);

    if (!isAllowed(session.options, chat, senderId)) {
      await recordInbound();
      appendLog({
        type: "warn",
        text: `weixin inbound dropped (policy): sender=${senderId} chatType=${chat.chatType}`,
      });
      return null;
    }

    // iLink sends the routing context with the first inbound message. Save it
    // after channel policy succeeds but before pairing can return, so approval
    // makes the chat immediately sendable without waiting for another inbound.
    if (contextToken) {
      await store.writeContextToken(session.account.accountId, senderId, contextToken);
    }

    const authorized = await ensureChannelUserAuthorized(session, {
      platformType: "wechat",
      platformUserId: senderId,
      chatId: chat.chatId,
      displayName: senderId,
    });
    if (!authorized) {
      await recordInbound();
      appendLog({
        type: "warn",
        text: `weixin inbound dropped (unauthorized): sender=${senderId} chatId=${chat.chatId}`,
      });
      return null;
    }

    // Only authorized messages enter execution dedupe. A first delivery that
    // created a pairing request must remain eligible when the provider retries
    // that same message ID after the operator approves it.
    if (messageId) {
      if (dedup.hasOrAdd(`id:${messageId}`)) return null;
    } else if (!isControlCommand) {
      // Provider message IDs are the primary replay identity. ID-less messages
      // use the short content fallback only after authorization.
      const contentKey = `content:${senderId}:${chat.chatId}:${text}`;
      if (dedup.hasOrAdd(contentKey)) return null;
    }

    await recordInbound();
    const mediaFiles = await collectMediaFiles(session, itemList);
    const event = {
      accountId: session.account.accountId,
      senderId,
      messageId,
      text,
      mediaFiles,
      raw: message,
      ...chat,
    };
    setState({
      lastMessageAt: Date.now(),
      processedCount: getProcessedCount() + 1,
    });

    const taskRoute = await messagingTasks.route(event, {
      appendLog,
      reply: (replyText) => sendText(session, event.chatId, replyText, event.senderId),
    });
    if (taskRoute.handled) return event;
    if (await maybeHandleControlCommand(session, event)) return event;

    void enqueueText(session, event).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setState({ lastError: errorMessage });
      appendLog({ type: "error", text: `weixin enqueue failed: ${errorMessage}` });
      void sendText(
        session,
        event.chatId,
        `处理失败：${errorMessage}`,
        event.senderId,
      ).catch(() => undefined);
    });
    return event;
  };
}
