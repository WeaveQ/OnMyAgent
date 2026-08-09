import {
  ONMYAGENT_ASSISTANT_PROVIDER,
  runAssistantBridgeTurn,
} from "../channels/assistant-bridge.mjs";
import { formatAgentResultOutput } from "../channels/AgentReplyHeader.mjs";
import { TYPING_START, TYPING_STOP } from "./ilink-client.mjs";
import { getChannelRunSnapshotState } from "./local-qr.mjs";
import {
  agentLabel,
  buildPrompt,
  currentAgentForChat,
  currentPromptModeForChat,
  runAgentTurn,
  scopedWeixinRuntimeAgent,
  storeSafeReadChatSetting,
  validatedModelForAgent,
} from "./agent-context.mjs";
import {
  AGENT_BUSY_NOTICE_INTERVAL_MS,
  activeRunGuardKey,
  activeRunKey,
  chatAgentHistoryKey,
} from "./helpers.mjs";

export function createMessageDispatch({
  runtime,
  store,
  appendLog,
  setState,
  sendText,
  deliverAgentOutput,
  maybeSendTyping,
  agentBusyNoticeAt,
  clearedActiveRunKeys,
  pendingBatches,
  readActiveRunSafely,
  writeActiveRunSafely,
  reserveActiveRun,
  releaseActiveRunReservation,
  scheduleActiveRunPoll,
  getChannelSession,
  appendChannelSessionHistory,
}) {
  // Routes an IM chat bound to the `onmyagent` pseudo-agent to the desktop
  // assistant tab via the shared AssistantBridge helper. Pure additive path —
  // only provider `onmyagent-assistant` reaches here.
  function runWeixinAssistantBridgeTurn(session, event) {
    return runAssistantBridgeTurn({
      runtime,
      store,
      session,
      event,
      platformLabel: "weixin",
      appendLog,
      readChatSetting: storeSafeReadChatSetting,
      deliverReply: (s, e, text) => sendText(s, e.chatId, text, e.senderId),
    });
  }

  async function enqueueText(session, event) {
    const agent = await currentAgentForChat(session, event.chatId);
    const key = `${event.accountId}:${event.chatId}:${agent.provider}/${agent.id}`;
    const prior = pendingBatches.get(key);
    if (prior) {
      clearTimeout(prior.timer);
      prior.event.text = `${prior.event.text}\n${event.text}`;
      prior.event.messageId = event.messageId || prior.event.messageId;
    }
    const batchEvent = prior?.event ?? { ...event, agentSnapshot: agent };
    const timer = setTimeout(() => {
      pendingBatches.delete(key);
      void dispatchToAgent(session, batchEvent).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setState({ lastError: message });
        appendLog({ type: "error", text: `weixin dispatch failed: ${message}` });
        // Surface dispatch failures to the user instead of failing silently so
        // a broken agent runtime does not look like "the bot ignores me".
        void sendText(session, batchEvent.chatId, `处理失败：${message}\n\n请检查 Studio 中微信通道的本地 Agent 配置。`, batchEvent.senderId).catch(() => undefined);
      });
    }, session.options.textBatchDelayMs);
    pendingBatches.set(key, { event: batchEvent, agent, timer });
  }

  async function dispatchToAgent(session, event) {
    if (!runtime?.runMessage && (!runtime?.startMessage || !runtime?.getRun)) {
      throw new Error("personal agent runtime is unavailable");
    }
    await maybeSendTyping(session, event.chatId, TYPING_START);
    try {
      const agent = event.agentSnapshot ?? await currentAgentForChat(session, event.chatId);
      if (agent.provider === ONMYAGENT_ASSISTANT_PROVIDER) {
        return await runWeixinAssistantBridgeTurn(session, event);
      }
      const promptMode = await currentPromptModeForChat(session, event.chatId);
      const historyKey = chatAgentHistoryKey(event.chatId, agent);
      const runKey = activeRunKey(event.chatId, agent);
      const existingRun = await readActiveRunSafely(session.account.accountId, runKey);
      if (existingRun) {
        // Nudge the poller and rate-limit the busy notice for this chat+agent.
        if (existingRun.runId) scheduleActiveRunPoll(session, existingRun, 0);
        const busyKey = `${session.account.accountId}:${runKey}`;
        const nowTs = Date.now();
        const lastAt = agentBusyNoticeAt.get(busyKey) ?? 0;
        if (nowTs - lastAt >= AGENT_BUSY_NOTICE_INTERVAL_MS) {
          agentBusyNoticeAt.set(busyKey, nowTs);
          await sendText(session, event.chatId, `${agentLabel(agent)} 还在处理上一条消息，请稍后再试。发送 #status 查看进度，或 #cancel 取消后再重发。`, event.senderId).catch(() => undefined);
        }
        return existingRun;
      }
      const reservation = reserveActiveRun(session.account.accountId, runKey, {
        accountId: session.account.accountId,
        chatId: event.chatId,
        senderId: event.senderId,
        agent,
        historyKey,
        startedAt: Date.now(),
      });
      if (!reservation.acquired) {
        if (reservation.record?.runId) scheduleActiveRunPoll(session, reservation.record, 0);
        const busyKey = `${session.account.accountId}:${runKey}`;
        const nowTs = Date.now();
        const lastAt = agentBusyNoticeAt.get(busyKey) ?? 0;
        if (nowTs - lastAt >= AGENT_BUSY_NOTICE_INTERVAL_MS) {
          agentBusyNoticeAt.set(busyKey, nowTs);
          await sendText(session, event.chatId, `${agentLabel(agent)} 还在处理上一条消息，请稍后再试。发送 #status 查看进度，或 #cancel 取消后再重发。`, event.senderId).catch(() => undefined);
        }
        return reservation.record;
      }
      let reservationPromoted = false;
      try {
        const runtimeAgent = scopedWeixinRuntimeAgent(agent, event);
        const channelSession = await getChannelSession(session, event, runtimeAgent);
        const history = await store.readChatHistory(session.account.accountId, historyKey, session.options.historyLimit).catch(() => []);
        const prompt = buildPrompt(event, { mode: promptMode, history, agent });
        if (typeof runtime.startMessage !== "function" || typeof runtime.getRun !== "function") {
          const legacyModel = await validatedModelForAgent(session, event.chatId, agent, { store, appendLog });
          const result = await runAgentTurn(runtime, {
            workspaceRoot: session.options.workspaceRoot,
            accessibleWorkspaceRoots: session.options.accessibleWorkspaceRoots,
            prompt,
            agent: runtimeAgent,
            conversationId: channelSession?.conversationId ?? undefined,
            model: legacyModel || undefined,
            approvalMode: session.options.approvalMode,
            timeoutMs: session.options.timeoutMs,
          });
          if (session.controller.signal.aborted) return result;
          setState({ lastRunId: result?.runId ?? null });
          await handleSynchronousAgentResult(session, event, { agent, historyKey, result, channelSession });
          return result;
        }
        const chatModel = await validatedModelForAgent(session, event.chatId, agent, { store, appendLog });
        const started = await runtime.startMessage({
          workspaceRoot: session.options.workspaceRoot,
          accessibleWorkspaceRoots: session.options.accessibleWorkspaceRoots,
          prompt,
          userText: event.text,
          agent: runtimeAgent,
          conversationId: channelSession?.conversationId ?? undefined,
          model: chatModel || undefined,
          approvalMode: session.options.approvalMode,
          timeoutMs: session.options.timeoutMs,
        });
        if (session.controller.signal.aborted) {
          if (started?.runId && typeof runtime.cancelRun === "function") await runtime.cancelRun(started.runId, { reason: "weixin_stopped" }).catch(() => undefined);
          return started;
        }
        setState({ lastRunId: started?.runId ?? null });
        if (!started?.runId) {
          await handleSynchronousAgentResult(session, event, { agent, historyKey, result: started, channelSession }); return started;
        }
        const trackedRun = await writeActiveRunSafely(session.account.accountId, runKey, {
          status: started.status ?? "running",
          accountId: session.account.accountId,
          chatId: event.chatId,
          senderId: event.senderId,
          runId: started.runId,
          workspaceRoot: session.options.workspaceRoot,
          accessibleWorkspaceRoots: session.options.accessibleWorkspaceRoots,
          agent,
          runtimeAgent,
          historyKey,
          promptMode,
          prompt,
          userText: event.text,
          approvalMode: session.options.approvalMode,
          historyStoreLimit: session.options.historyStoreLimit,
          channelSessionId: channelSession?.id ?? null,
          pendingApprovalNotifiedAt: null,
          startedAt: Date.now(),
        });
        if (!trackedRun?.runId) {
          if (session.controller.signal.aborted && typeof runtime.cancelRun === "function") await runtime.cancelRun(started.runId, { reason: "weixin_stopped" }).catch(() => undefined);
          return trackedRun;
        }
        reservationPromoted = true;
        clearedActiveRunKeys.delete(activeRunGuardKey(session.account.accountId, runKey));
        scheduleActiveRunPoll(session, trackedRun, 0);
        return trackedRun;
      } finally {
        if (!reservationPromoted) releaseActiveRunReservation(session.account.accountId, runKey, reservation.token);
      }
    } finally {
      if (!session.controller.signal.aborted) await maybeSendTyping(session, event.chatId, TYPING_STOP);
    }
  }

  async function handleSynchronousAgentResult(session, event, { agent, historyKey, result, channelSession }) {
    const resultState = getChannelRunSnapshotState(result);
    if (resultState.status === "running" && resultState.hasPendingApprovals) {
      await sendText(session, event.chatId, "需要在 Studio 中审批后继续处理。", event.senderId);
      return;
    }
    if (!resultState.isCompletedWithOutput) {
      await sendText(session, event.chatId, "本次处理失败，请在 Studio 查看本地 Agent 日志。", event.senderId);
      return;
    }
    const deliveredOutput = formatAgentResultOutput(result);
    await deliverAgentOutput(session, {
      chatId: event.chatId,
      peerId: event.senderId,
      agent,
      result: { ...result, output: deliveredOutput },
    });
    await appendAgentHistory(session, historyKey, event.text, deliveredOutput, agent, session.options.historyStoreLimit);
    await appendChannelSessionHistory(channelSession, event.text, deliveredOutput, agent);
  }

  async function appendAgentHistory(session, historyKey, userText, output, agent, limit) {
    await store.appendChatHistory(session.account.accountId, historyKey, [
      { role: "user", text: userText, at: Date.now() },
      { role: "assistant", text: output, at: Date.now(), agentId: agent.id, agentProvider: agent.provider },
    ], limit).catch(() => undefined);
  }

  return {
    enqueueText,
    dispatchToAgent,
    handleSynchronousAgentResult,
    appendAgentHistory,
    runWeixinAssistantBridgeTurn,
  };
}
