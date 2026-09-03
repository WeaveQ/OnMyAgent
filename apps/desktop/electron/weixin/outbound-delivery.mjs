import { randomUUID } from "node:crypto";

import { formatAgentReply } from "../channels/AgentReplyHeader.mjs";
import { createStoppedWeixinDeliveryError, deliverOutboundFiles } from "./outbound-files.mjs";
import {
  isStaleSessionRet,
  SESSION_EXPIRED_ERRCODE,
  sleep,
  splitTextForWeixin,
} from "./helpers.mjs";

export const WEIXIN_STUDIO_PROMPT_MIRROR_PREFIX = "你（Studio）：";

export function formatWeixinStudioPromptMirror(text) {
  const cleanText = String(text ?? "").trim();
  return cleanText ? `${WEIXIN_STUDIO_PROMPT_MIRROR_PREFIX}${cleanText}` : "";
}

export function createOutboundDelivery({
  client,
  store,
  setState,
  getSentCount,
  appendLog,
  channelTranscriptStore,
}) {
  function assertIlinkOk(response, operation) {
    const ret = response?.ret ?? 0;
    const errcode = response?.errcode ?? 0;
    if (ret === 0 && errcode === 0) return;
    const errmsg = String(response?.errmsg ?? response?.message ?? "").trim();
    if (
      ret === SESSION_EXPIRED_ERRCODE
      || errcode === SESSION_EXPIRED_ERRCODE
      || isStaleSessionRet(ret, errcode, errmsg)
    ) {
      setState({
        status: "needs_login",
        lastError: `Weixin iLink session expired during ${operation}`,
      });
      throw new Error(`Weixin iLink session expired during ${operation}`);
    }
    const message = `Weixin iLink ${operation} failed ret=${ret} errcode=${errcode}${errmsg ? `: ${errmsg}` : ""}`;
    setState({ lastError: message });
    throw new Error(message);
  }

  async function sendText(
    session,
    chatId,
    text,
    peerId = chatId,
    beforeFirstTransport = null,
    agent = null,
    options = {},
  ) {
    const recordTranscript = options.recordTranscript !== false;
    const contextToken = await store.readContextToken(session.account.accountId, peerId || chatId);
    const chunks = splitTextForWeixin(text);
    let lastResponse = null;
    let attemptedTransports = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      if (session.controller.signal.aborted) {
        throw createStoppedWeixinDeliveryError(attemptedTransports);
      }
      if (attemptedTransports === 0 && beforeFirstTransport) {
        await beforeFirstTransport();
        if (session.controller.signal.aborted) {
          throw createStoppedWeixinDeliveryError(attemptedTransports);
        }
      }
      attemptedTransports += 1;
      const transportDedupeKey = `studio-weixin-${randomUUID()}`;
      lastResponse = await client.sendMessage({
        baseUrl: session.account.baseUrl,
        token: session.account.token,
        to: chatId,
        text: chunks[index],
        contextToken,
        clientId: transportDedupeKey,
      }).catch((error) => {
        throw Object.assign(error, { attemptedTransports });
      });
      assertIlinkOk(lastResponse, "sendmessage");
      if (recordTranscript) {
        await channelTranscriptStore?.recordOutbound?.({
          platformType: "wechat",
          accountId: session.account.accountId,
          chatId,
          platformUserId: peerId,
          content: chunks[index],
          externalId: lastResponse?.message_id ?? lastResponse?.msg_id,
          dedupeKey: lastResponse?.message_id
            ?? lastResponse?.msg_id
            ?? transportDedupeKey,
          agentId: String(agent?.id ?? "").trim() || undefined,
          agentName: String(agent?.name ?? agent?.id ?? "").trim() || undefined,
          metadata: { transportAction: "send", chunkIndex: index },
        }).catch(() => undefined);
      }
      if (session.controller.signal.aborted) {
        throw createStoppedWeixinDeliveryError(attemptedTransports);
      }
      if (index < chunks.length - 1) await sleep(session.options.sendChunkDelayMs);
    }
    setState({ sentCount: getSentCount() + chunks.length });
    return lastResponse;
  }

  async function sendStudioPromptMirror(
    session,
    { chatId, peerId = chatId, text },
  ) {
    const mirrorText = formatWeixinStudioPromptMirror(text);
    if (!mirrorText) throw new Error("Weixin Studio prompt mirror text must not be empty");
    try {
      return await sendText(
        session,
        chatId,
        mirrorText,
        peerId,
        null,
        null,
        { recordTranscript: false },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Weixin Studio prompt mirror failed: ${detail}`, { cause: error });
    }
  }

  async function deliverAgentOutput(
    session,
    { chatId, peerId, agent, result, beforeFirstTransport = null },
  ) {
    return deliverOutboundFiles({
      output: result.output,
      artifacts: result.artifacts,
      allowedRoots: [session.options.workspaceRoot, ...session.options.accessibleWorkspaceRoots],
      client,
      account: session.account,
      chatId,
      peerId,
      agent,
      readContextToken: (peer) => store.readContextToken(session.account.accountId, peer),
      setSentCount: () => setState({ sentCount: getSentCount() + 1 }),
      appendLog,
      assertResponse: assertIlinkOk,
      sendText: (text, targetPeer, beforeTransport) => sendText(
        session,
        chatId,
        text,
        targetPeer,
        beforeTransport,
        agent,
      ),
      formatReply: formatAgentReply,
      signal: session.controller.signal,
      beforeFirstTransport,
    });
  }

  async function maybeSendTyping(session, chatId, status) {
    const contextToken = await store.readContextToken(session.account.accountId, chatId);
    try {
      const config = await client.getConfig({
        baseUrl: session.account.baseUrl,
        token: session.account.token,
        userId: chatId,
        contextToken,
      });
      const typingTicket = String(config?.typing_ticket ?? "").trim();
      if (!typingTicket) return;
      await client.sendTyping({
        baseUrl: session.account.baseUrl,
        token: session.account.token,
        toUserId: chatId,
        typingTicket,
        status,
      });
    } catch {
      // Typing indicators are opportunistic; message delivery should continue.
    }
  }

  return {
    assertIlinkOk,
    sendText,
    sendStudioPromptMirror,
    deliverAgentOutput,
    maybeSendTyping,
  };
}
