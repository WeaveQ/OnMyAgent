export function createWeixinChannelSessions({
  runtime,
  channelSessionStore,
  channelEventBus,
  appendLog,
  getActive,
  sendText,
}) {
  async function getChannelSession(session, event, agent) {
    if (!channelSessionStore) return null;
    const channelSession = await channelSessionStore.getOrCreateSession({
      platformType: "wechat",
      platformUserId: event.senderId,
      agentType: `${agent.provider}/${agent.id}`,
      workspace: session.options.workspaceRoot,
      chatId: event.chatId,
    }).catch(() => null);
    if (!channelSession) return null;
    // Parity with Upstream create_conversation_for_session + bind_conversation:
    // lazily create (once) a Studio conversation tagged source:"channel" and
    // persist the mapping on the channel session so the same chat always
    // reuses the same conversation and Studio can recognize its origin.
    //
    // Self-healing guard (regression fix): a channel session may already carry
    // a non-empty conversationId that points at a missing/orphaned conversation
    // file (e.g. left behind after a runtime restart). The original
    // `!channelSession.conversationId` check would never re-bind such a stale
    // pointer, leaving the UI showing an empty, unselectable session. We now
    // also rebuild the binding when the bound conversation no longer exists.
    const needBind = await shouldBindConversation({ session, event, agent, channelSession });
    if (needBind) {
      try {
        // A chat-scoped agent can predate this binding (for example, an
        // existing Weixin task after an app restart). Reuse its active
        // conversation before creating another one, so upgrading this code
        // preserves the actual Codex context instead of starting blank.
        const listed = await runtime?.listConversations?.({
          workspaceRoot: session.options.workspaceRoot,
          agent: { provider: agent.provider, id: agent.id },
        });
        let conversationId = listed?.conversations?.find(
          (conversation) => String(conversation?.id ?? "") === String(listed?.activeConversationId ?? ""),
        )?.id ?? null;
        if (!conversationId && runtime?.createConversation) {
          const created = await runtime.createConversation({
            workspaceRoot: session.options.workspaceRoot,
            agent: { provider: agent.provider, id: agent.id },
            source: "channel",
            title: `微信 ${event.senderId}@${event.chatId}`,
            metadata: {
              channelChatId: event.chatId,
              platformType: "wechat",
              platformUserId: event.senderId,
            },
          });
          conversationId = created?.conversation?.id ?? created?.id ?? null;
        }
        if (conversationId) {
          await channelSessionStore.bindConversation(channelSession.id, conversationId);
          if (channelSession.conversationId) {
            appendLog({ type: "warn", text: `weixin healed orphaned conversationId ${channelSession.conversationId} -> ${conversationId}` });
          }
        }
      } catch (error) {
        appendLog({ type: "warn", text: `weixin conversation bind failed: ${error?.message ?? String(error)}` });
      }
    }
    return channelSessionStore.getSession(channelSession.id) ?? channelSession;

    async function shouldBindConversation({ session, event, agent, channelSession }) {
      const boundId = String(channelSession.conversationId ?? "").trim();
      if (!boundId) return true;
      // Non-empty binding: verify the conversation still exists. If the
      // runtime/facade is unavailable, fail safe to "do not rebind" (the old
      // behavior) so we never clobber a valid mapping on a transient error.
      //
      // NOTE: we must match by exact id. `getAgentConversation` falls back to
      // the active/first conversation when the id is missing, so it would
      // wrongly report a stale, orphaned id as "found". `listConversations`
      // returns the raw list and lets us test id membership strictly.
      if (!runtime?.listConversations) return false;
      try {
        const listed = await runtime.listConversations({
          workspaceRoot: session.options.workspaceRoot,
          agent: { provider: agent.provider, id: agent.id },
        });
        const conversations = listed?.conversations ?? [];
        return !conversations.some((c) => String(c?.id ?? "") === boundId);
      } catch {
        return false;
      }
    }
  }

  // Parity S4 (reverse relay): when Studio sends a message on a conversation
  // that this channel has bound to an IM chat, push it back to that chat.
  // Subscribes to the bus event emitted by channel-runtime.relayStudioMessage;
  // only acts when the target platform matches this service (wechat).
  let _studioRelayUnsub = null;
  function subscribeStudioRelay() {
    if (!channelEventBus || _studioRelayUnsub) return;
    _studioRelayUnsub = channelEventBus.subscribe("channel:conversation:message:from-studio", (event) => {
      const payload = event?.payload ?? event ?? {};
      if (String(payload?.platformType ?? "").toLowerCase() !== "wechat") return;
      const chatId = String(payload?.chatId ?? "").trim();
      const text = String(payload?.text ?? "").trim();
      if (!chatId || !text) return;
      void sendText(getActive(), chatId, text, chatId).catch((error) => {
        appendLog({ type: "error", text: `weixin studio-relay send failed: ${error?.message ?? String(error)}` });
      });
    });
  }
  function unsubscribeStudioRelay() {
    if (_studioRelayUnsub) {
      try { _studioRelayUnsub(); } catch { /* noop */ }
      _studioRelayUnsub = null;
    }
  }

  async function appendChannelSessionHistory(channelSession, userText, output, agent) {
    if (!channelSessionStore || !channelSession?.id) return;
    const at = Date.now();
    await channelSessionStore.addSessionMessage(channelSession.id, { role: "user", content: userText, timestamp: at, metadata: { agentId: agent.id, agentProvider: agent.provider } }).catch(() => undefined);
    await channelSessionStore.addSessionMessage(channelSession.id, { role: "assistant", content: output, timestamp: Date.now(), metadata: { agentId: agent.id, agentProvider: agent.provider } }).catch(() => undefined);
  }

  async function appendChannelSessionHistoryById(sessionId, userText, output, agent) {
    if (!channelSessionStore || !sessionId) return;
    const channelSession = channelSessionStore.getSession(sessionId);
    await appendChannelSessionHistory(channelSession, userText, output, agent);
  }

  async function closeChannelSessionForAgent(session, event, agent) {
    if (!channelSessionStore) return;
    const channelSession = await getChannelSession(session, event, agent);
    if (channelSession?.id) await channelSessionStore.closeSession(channelSession.id).catch(() => undefined);
  }

  return {
    getChannelSession,
    appendChannelSessionHistory,
    appendChannelSessionHistoryById,
    closeChannelSessionForAgent,
    subscribeStudioRelay,
    unsubscribeStudioRelay,
  };
}
