import { randomUUID } from "node:crypto";

import { formatAgentReply } from "../channels/AgentReplyHeader.mjs";
import { createStoppedWeixinDeliveryError, deliverOutboundFiles } from "./outbound-files.mjs";
import {
  isStaleSessionRet,
  SESSION_EXPIRED_ERRCODE,
  sleep,
  splitTextForWeixin,
} from "./helpers.mjs";

export function createOutboundDelivery({
  client,
  store,
  setState,
  getSentCount,
  appendLog,
}) {
  function assertIlinkOk(response, operation) {
    const ret = response?.ret ?? 0;
    const errcode = response?.errcode ?? 0;
    if (ret === 0 && errcode === 0) return;
    const errmsg = String(response?.errmsg ?? response?.message ?? "").trim();
    if (ret === SESSION_EXPIRED_ERRCODE || errcode === SESSION_EXPIRED_ERRCODE || isStaleSessionRet(ret, errcode, errmsg)) {
      setState({ status: "needs_login", lastError: `Weixin iLink session expired during ${operation}` });
      throw new Error(`Weixin iLink session expired during ${operation}`);
    }
    const message = `Weixin iLink ${operation} failed ret=${ret} errcode=${errcode}${errmsg ? `: ${errmsg}` : ""}`;
    setState({ lastError: message });
    throw new Error(message);
  }

  async function sendText(session, chatId, text, peerId = chatId, beforeFirstTransport = null) {
    const contextToken = await store.readContextToken(session.account.accountId, peerId || chatId);
    const chunks = splitTextForWeixin(text);
    let lastResponse = null;
    let attemptedTransports = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      if (session.controller.signal.aborted) throw createStoppedWeixinDeliveryError(attemptedTransports);
      if (attemptedTransports === 0 && beforeFirstTransport) {
        await beforeFirstTransport();
        if (session.controller.signal.aborted) throw createStoppedWeixinDeliveryError(attemptedTransports);
      }
      attemptedTransports += 1;
      lastResponse = await client.sendMessage({
        baseUrl: session.account.baseUrl,
        token: session.account.token,
        to: chatId,
        text: chunks[index],
        contextToken,
        clientId: `studio-weixin-${randomUUID()}`,
      }).catch((error) => {
        throw Object.assign(error, { attemptedTransports });
      });
      assertIlinkOk(lastResponse, "sendmessage");
      if (session.controller.signal.aborted) throw createStoppedWeixinDeliveryError(attemptedTransports);
      if (index < chunks.length - 1) await sleep(session.options.sendChunkDelayMs);
    }
    setState({ sentCount: getSentCount() + chunks.length });
    return lastResponse;
  }

  async function deliverAgentOutput(session, { chatId, peerId, agent, result, beforeFirstTransport = null }) {
    return deliverOutboundFiles({
      output: result.output, artifacts: result.artifacts,
      allowedRoots: [session.options.workspaceRoot, ...session.options.accessibleWorkspaceRoots],
      client, account: session.account, chatId, peerId, agent,
      readContextToken: (peer) => store.readContextToken(session.account.accountId, peer),
      setSentCount: () => setState({ sentCount: getSentCount() + 1 }), appendLog,
      assertResponse: assertIlinkOk,
      sendText: (text, targetPeer, beforeTransport) => sendText(session, chatId, text, targetPeer, beforeTransport),
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
    deliverAgentOutput,
    maybeSendTyping,
  };
}
