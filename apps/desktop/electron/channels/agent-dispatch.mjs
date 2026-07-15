/**
 * Shared agent-dispatch core for messaging channels.
 *
 * Telegram and Discord share the same "inbound message -> personal agent
 * runtime -> outbound reply" machinery that Weixin and Feishu already use.
 * This module factors that machinery into one reusable factory so each new
 * platform only supplies transport-specific bits (how to send/edit a message
 * and how to normalize an inbound payload).
 *
 * The factory mirrors the Weixin/Feishu service API surface
 * (saveAccount / start / autoStart / stop / status / accountStatus /
 * simulateInbound / probe / processInbound) so main.mjs IPC handlers and the
 * plugin registry can treat every channel symmetrically.
 *
 * Parity with Upstream:
 *  - inbound message -> dedup -> policy -> pairing authorization
 *  - enqueue + batch -> dispatch to agent runtime (sync runMessage or
 *    async startMessage + getRun polling)
 *  - active-run polling with busy notice, #cancel, and #approve handling
 *  - channel session + Studio conversation binding
 *  - control commands (#status/#runs/#cancel/#new/#agent/#mode/#approve)
 *  - reverse relay Studio -> IM
 *  - streaming reply via sendMessage then editMessageText/message.edit patch
 */

import { createHash, randomUUID } from "node:crypto";

import { normalizePersonalLocalAgent } from "../personal-agent-runtime/provider-registry.mjs";
import { formatAgentReply } from "./AgentReplyHeader.mjs";

const DEFAULT_TEXT_BATCH_DELAY_MS = 3_000;
const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_HISTORY_STORE_LIMIT = 24;
const ACTIVE_RUN_POLL_INTERVAL_MS = 1_000;
const ACTIVE_RUN_PENDING_POLL_INTERVAL_MS = 3_000;
// Minimum spacing between "agent still busy" replies for the same chat+agent.
const AGENT_BUSY_NOTICE_INTERVAL_MS = 15_000;
const MESSAGE_DEDUP_TTL_MS = 5 * 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeId(value, keep = 8) {
  const raw = String(value ?? "").trim();
  if (!raw) return "?";
  return raw.length <= keep ? raw : raw.slice(0, keep);
}

function getChannelRunSnapshotState(snapshot) {
  const status = String(snapshot?.status ?? "");
  const pendingApprovals = Array.isArray(snapshot?.pendingApprovals) ? snapshot.pendingApprovals : [];
  return {
    status,
    pendingApprovals,
    hasPendingApprovals: pendingApprovals.length > 0,
    isCompletedWithOutput: status === "completed" && Boolean(snapshot?.output),
    isRunning: !status || status === "running",
    isTerminal: Boolean(status && status !== "running"),
  };
}

function splitTextForPlatform(text, maxLength = 2000) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  if (raw.length <= maxLength) return [raw];
  const chunks = [];
  let rest = raw;
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf("\n\n", maxLength);
    if (cut < maxLength * 0.5) cut = rest.lastIndexOf("\n", maxLength);
    if (cut < maxLength * 0.5) cut = rest.lastIndexOf("。", maxLength);
    if (cut < maxLength * 0.5) cut = maxLength;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

class TtlSet {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.items = new Map();
  }

  hasOrAdd(key) {
    const now = Date.now();
    for (const [item, at] of this.items) {
      if (now - at > this.ttlMs) this.items.delete(item);
    }
    if (this.items.has(key)) return true;
    this.items.set(key, now);
    return false;
  }
}

export function createChannelAgentDispatcher(options = {}) {
  const platformType = String(options.platformType ?? "").trim();
  if (!platformType) throw new Error("createChannelAgentDispatcher: platformType is required");
  const platformName = String(options.platformName ?? platformType).trim();
  const runtime = options.runtime;
  const store = options.store;
  const sendTextTo = typeof options.sendTextTo === "function" ? options.sendTextTo : async () => ({ ok: false });
  const editMessageTo = typeof options.editMessageTo === "function" ? options.editMessageTo : null;
  const normalizeInbound = typeof options.normalizeInbound === "function" ? options.normalizeInbound : (raw) => raw;
  const isAllowedFn = typeof options.isAllowed === "function" ? options.isAllowed : null;
  const buildSimulatedInbound = typeof options.buildSimulatedInbound === "function" ? options.buildSimulatedInbound : null;
  const channelPairingService = options.channelPairingService ?? null;
  const channelSessionStore = options.channelSessionStore ?? null;
  const channelEventBus = options.channelEventBus ?? null;
  const channelMessageAdapter = options.channelMessageAdapter ?? null;
  const channelAssistantBindingStore = options.channelAssistantBindingStore ?? null;
  const appendLog = typeof options.appendLog === "function" ? options.appendLog : () => undefined;
  const defaultWorkspaceRoot = String(options.defaultWorkspaceRoot ?? "").trim();
  const maxMessageLength = Number.isFinite(Number(options.maxMessageLength)) ? Number(options.maxMessageLength) : 2000;
  const textBatchDelayMs = Number.isFinite(Number(options.textBatchDelayMs)) ? Math.max(0, Number(options.textBatchDelayMs)) : DEFAULT_TEXT_BATCH_DELAY_MS;
  const sendChunkDelayMs = Number.isFinite(Number(options.sendChunkDelayMs)) ? Math.max(0, Number(options.sendChunkDelayMs)) : 1500;

  const dedup = new TtlSet(MESSAGE_DEDUP_TTL_MS);
  const pendingBatches = new Map();
  const agentBusyNoticeAt = new Map();
  const activeRunPollers = new Map();
  const clearedActiveRunKeys = new Set();
  const agentByChat = new Map();
  const promptModeByChat = new Map();

  let state = {
    status: "stopped",
    accountId: "",
    workspaceRoot: "",
    accessibleWorkspaceRoots: [],
    startedAt: null,
    lastPollAt: null,
    lastMessageAt: null,
    lastError: null,
    lastRunId: null,
    processedCount: 0,
    sentCount: 0,
    activeAgentId: "",
    approvalMode: "",
    botUsername: undefined,
    hasToken: false,
  };
  let active = null;

  function snapshot(extra = {}) {
    return {
      ...state,
      ...extra,
      hasToken: state.hasToken,
      botUsername: state.botUsername,
    };
  }

  function setState(patch) {
    state = { ...state, ...patch };
    return snapshot();
  }

  function runtimeOptions(input = {}) {
    const normalized = normalizeRuntimeOptions(input);
    normalized.agentByChat = agentByChat;
    normalized.promptModeByChat = promptModeByChat;
    normalized.channelAssistantBindingStore = channelAssistantBindingStore;
    return normalized;
  }

  async function persistServiceConfig(input = {}) {
    const optionsValue = runtimeOptions(input);
    await store.writeConfig({
      autoStart: input.autoStart !== false,
      defaultAccountId: String(input.accountId ?? input.account_id ?? "").trim(),
      lastStartOptions: {
        workspaceRoot: optionsValue.workspaceRoot,
        accessibleWorkspaceRoots: optionsValue.accessibleWorkspaceRoots,
        agent: optionsValue.agent,
        availableAgents: optionsValue.availableAgents,
        approvalMode: optionsValue.approvalMode,
        dmPolicy: optionsValue.dmPolicy,
        allowedUsers: optionsValue.allowedUsers,
        groupPolicy: optionsValue.groupPolicy,
        allowedGroups: optionsValue.allowedGroups,
        textBatchDelayMs: optionsValue.textBatchDelayMs,
        sendChunkDelayMs: optionsValue.sendChunkDelayMs,
        timeoutMs: optionsValue.timeoutMs,
        promptMode: optionsValue.promptMode,
        historyLimit: optionsValue.historyLimit,
        historyStoreLimit: optionsValue.historyStoreLimit,
      },
    });
  }

  async function start(input = {}) {
    const accountId = String(input.accountId ?? input.account_id ?? state.accountId ?? "").trim();
    if (!accountId) return { ok: false, error: "accountId is required" };
    if (active?.account?.accountId === accountId) {
      active.options = runtimeOptions({ ...active.options, ...input });
      setState({
        status: "running",
        accountId,
        workspaceRoot: active.options.workspaceRoot,
        accessibleWorkspaceRoots: active.options.accessibleWorkspaceRoots,
        lastError: null,
        activeAgentId: active.options.agent.id,
        approvalMode: active.options.approvalMode,
      });
      await persistServiceConfig({ ...active.options, accountId, autoStart: input.autoStart ?? true });
      return { ok: true, updated: true, status: snapshot(), account: sanitizeAccount(active.account) };
    }
    if (active) await stop({ persist: false });
    const account = await store.loadAccount(accountId);
    if (!account?.token) return { ok: false, error: `${platformName} account is not configured` };
    const controller = new AbortController();
    active = { controller, account, store, options: runtimeOptions(input), task: null };
    setState({
      status: "running",
      accountId,
      workspaceRoot: active.options.workspaceRoot,
      accessibleWorkspaceRoots: active.options.accessibleWorkspaceRoots,
      startedAt: Date.now(),
      lastError: null,
      activeAgentId: active.options.agent.id,
      approvalMode: active.options.approvalMode,
      botUsername: account.botUsername ?? account.username ?? undefined,
      hasToken: true,
    });
    await persistServiceConfig({ ...input, accountId, autoStart: input.autoStart ?? true });
    subscribeStudioRelay();
    await resumeActiveRuns(active);
    return { ok: true, status: snapshot(), account: sanitizeAccount(account) };
  }

  async function stop(input = {}) {
    const current = active;
    if (input.persist !== false) await store.writeConfig({ autoStart: false });
    if (!current) return { ok: true, status: snapshot({ status: state.status === "error" ? "error" : "stopped" }) };
    current.controller.abort();
    active = null;
    for (const entry of pendingBatches.values()) clearTimeout(entry.timer);
    pendingBatches.clear();
    for (const timer of activeRunPollers.values()) clearTimeout(timer);
    activeRunPollers.clear();
    unsubscribeStudioRelay();
    setState({ status: "stopped", botUsername: undefined, hasToken: false });
    return { ok: true, status: snapshot() };
  }

  async function processInbound(raw, input = {}) {
    const account = active?.account ?? null;
    if (!account) return null;
    const session = active ?? { account, store, options: runtimeOptions(input), controller: new AbortController() };
    const event = normalizeInbound(raw, account);
    return processEvent(session, event);
  }

  async function processEvent(session, event) {
    if (!event.senderId || event.senderId === session.account.accountId) return null;
    if (event.messageId && dedup.hasOrAdd(`id:${event.messageId}`)) return null;
    const contentKey = `content:${event.senderId}:${event.chatId}:${event.text}`;
    if (dedup.hasOrAdd(contentKey)) return null;
    if (!isAllowed(session.options, event, event.senderId)) {
      appendLog({ type: "warn", text: `${platformType} inbound dropped (policy): sender=${event.senderId} chatType=${event.chatType}` });
      return null;
    }
    if (!(await ensureChannelUserAuthorized(session, { platformType, platformUserId: event.senderId, chatId: event.chatId, displayName: event.senderId }))) {
      appendLog({ type: "warn", text: `${platformType} inbound dropped (unauthorized): sender=${event.senderId} chatId=${event.chatId}` });
      return null;
    }
    setState({ lastMessageAt: Date.now(), processedCount: state.processedCount + 1 });
    if (await maybeHandleControlCommand(session, event)) return event;
    void enqueueText(session, event).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setState({ lastError: message });
      appendLog({ type: "error", text: `${platformType} enqueue failed: ${message}` });
      void deliverReply(session, event.chatId, event.senderId, `处理失败：${message}`).catch(() => undefined);
    });
    return event;
  }

  async function enqueueText(session, event) {
    const agent = await currentAgentForChat(platformType, session, event.chatId);
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
        appendLog({ type: "error", text: `${platformType} dispatch failed: ${message}` });
        void deliverReply(session, batchEvent.chatId, batchEvent.senderId, `处理失败：${message}\n\n请检查 Studio 中 ${platformName} 通道的本地 Agent 配置。`).catch(() => undefined);
      });
    }, session.options.textBatchDelayMs);
    pendingBatches.set(key, { event: batchEvent, agent, timer });
  }

  async function dispatchToAgent(session, event) {
    if (!runtime?.runMessage && (!runtime?.startMessage || !runtime?.getRun)) {
      throw new Error("personal agent runtime is unavailable");
    }
    const agent = event.agentSnapshot ?? await currentAgentForChat(platformType, session, event.chatId);
    const promptMode = await currentPromptModeForChat(session, event.chatId);
    const historyKey = chatAgentHistoryKey(event.chatId, agent);
    const runKey = activeRunKey(event.chatId, agent);
    const existingRun = await store.readActiveRun(session.account.accountId, runKey).catch(() => null);
    if (existingRun?.runId) {
      scheduleActiveRunPoll(session, existingRun, 0);
      const busyKey = `${session.account.accountId}:${runKey}`;
      const nowTs = Date.now();
      const lastAt = agentBusyNoticeAt.get(busyKey) ?? 0;
      if (nowTs - lastAt >= AGENT_BUSY_NOTICE_INTERVAL_MS) {
        agentBusyNoticeAt.set(busyKey, nowTs);
        await deliverReply(session, event.chatId, event.senderId, `${agentLabel(agent)} 还在处理上一条消息，请稍后再试。发送 #status 查看进度，或 #cancel 取消后再重发。`).catch(() => undefined);
      }
      return existingRun;
    }
    const runtimeAgent = scopedRuntimeAgent(platformType, platformName, agent, event);
    const channelSession = await getChannelSession(session, event, agent);
    const history = await store.readChatHistory(session.account.accountId, historyKey, session.options.historyLimit).catch(() => []);
    const prompt = buildPrompt(platformName, event, { mode: promptMode, history, agent });
    if (typeof runtime.startMessage !== "function" || typeof runtime.getRun !== "function") {
      const result = await runAgentTurn(runtime, {
        workspaceRoot: session.options.workspaceRoot,
        accessibleWorkspaceRoots: session.options.accessibleWorkspaceRoots,
        prompt,
        agent: runtimeAgent,
        approvalMode: session.options.approvalMode,
        timeoutMs: session.options.timeoutMs,
      });
      setState({ lastRunId: result?.runId ?? null });
      await handleSynchronousAgentResult(session, event, { agent, historyKey, result, channelSession });
      return result;
    }
    const started = await runtime.startMessage({
      workspaceRoot: session.options.workspaceRoot,
      accessibleWorkspaceRoots: session.options.accessibleWorkspaceRoots,
      prompt,
      agent: runtimeAgent,
      approvalMode: session.options.approvalMode,
      timeoutMs: session.options.timeoutMs,
    });
    setState({ lastRunId: started?.runId ?? null });
    if (!started?.runId) {
      await handleSynchronousAgentResult(session, event, { agent, historyKey, result: started, channelSession });
      return started;
    }
    const trackedRun = await store.writeActiveRun(session.account.accountId, runKey, {
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
    clearedActiveRunKeys.delete(activeRunGuardKey(session.account.accountId, runKey));
    scheduleActiveRunPoll(session, trackedRun, 0);
    return trackedRun;
  }

  async function handleSynchronousAgentResult(session, event, { agent, historyKey, result, channelSession }) {
    const resultState = getChannelRunSnapshotState(result);
    if (resultState.status === "running" && resultState.hasPendingApprovals) {
      await deliverReply(session, event.chatId, event.senderId, "需要在 Studio 中审批后继续处理。");
      return;
    }
    if (!resultState.isCompletedWithOutput) {
      await deliverReply(session, event.chatId, event.senderId, "本次处理失败，请在 Studio 查看本地 Agent 日志。");
      return;
    }
    await deliverReply(session, event.chatId, event.senderId, formatAgentReply({ agent, text: result.output }));
    await appendAgentHistory(session, historyKey, event.text, result.output, agent, session.options.historyStoreLimit);
    await appendChannelSessionHistory(channelSession, event.text, result.output, agent);
  }

  async function appendAgentHistory(session, historyKey, userText, output, agent, limit) {
    await store.appendChatHistory(session.account.accountId, historyKey, [
      { role: "user", text: userText, at: Date.now() },
      { role: "assistant", text: output, at: Date.now(), agentId: agent.id, agentProvider: agent.provider },
    ], limit).catch(() => undefined);
  }

  async function resumeActiveRuns(session) {
    const runs = await store.listActiveRuns(session.account.accountId).catch(() => []);
    for (const run of runs) scheduleActiveRunPoll(session, run, 0);
  }

  function scheduleActiveRunPoll(session, run, delayMs = ACTIVE_RUN_POLL_INTERVAL_MS) {
    if (!run?.runKey || !run?.runId || !runtime?.getRun) return;
    const pollKey = `${session.account.accountId}:${run.runKey}`;
    if (clearedActiveRunKeys.has(pollKey)) return;
    const prior = activeRunPollers.get(pollKey);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      activeRunPollers.delete(pollKey);
      void pollActiveRun(session, run.runKey).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setState({ lastError: message });
        void deliverReply(session, run.chatId, run.senderId, `任务状态查询失败：${message}`).catch(() => undefined);
      });
    }, Math.max(0, delayMs));
    activeRunPollers.set(pollKey, timer);
  }

  function clearActiveRunPoll(accountId, runKey) {
    const pollKey = activeRunGuardKey(accountId, runKey);
    clearedActiveRunKeys.add(pollKey);
    const prior = activeRunPollers.get(pollKey);
    if (prior) clearTimeout(prior);
    activeRunPollers.delete(pollKey);
  }

  async function pollActiveRun(session, runKey) {
    if (!session.controller || session.controller.signal.aborted) return;
    const pollKey = activeRunGuardKey(session.account.accountId, runKey);
    const record = await store.readActiveRun(session.account.accountId, runKey).catch(() => null);
    if (!record?.runId) return;
    if (clearedActiveRunKeys.has(pollKey)) return;
    const result = await runtime.getRun({ runId: record.runId, workspaceRoot: record.workspaceRoot });
    if (clearedActiveRunKeys.has(pollKey)) return;
    setState({ lastRunId: record.runId });
    const resultState = getChannelRunSnapshotState(result);
    if (resultState.isCompletedWithOutput) {
      await deliverReply(session, record.chatId, record.senderId, formatAgentReply({ agent: record.agent, text: result.output }));
      await appendAgentHistory(session, record.historyKey, record.userText, result.output, record.agent, record.historyStoreLimit ?? session.options.historyStoreLimit);
      await appendChannelSessionHistoryById(record.channelSessionId, record.userText, result.output, record.agent);
      clearActiveRunPoll(session.account.accountId, runKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await store.deleteActiveRun(session.account.accountId, runKey);
      return;
    }
    if (resultState.isTerminal) {
      const message = resultState.status === "cancelled" ? "本次本地 Agent 任务已取消。" : `本次处理失败，请在 Studio 查看本地 Agent 日志。${result?.error ? `\n${result.error}` : ""}`;
      await deliverReply(session, record.chatId, record.senderId, message);
      clearActiveRunPoll(session.account.accountId, runKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await store.deleteActiveRun(session.account.accountId, runKey);
      return;
    }
    const pendingApprovals = resultState.pendingApprovals;
    if (pendingApprovals.length && !record.pendingApprovalNotifiedAt) {
      if (clearedActiveRunKeys.has(pollKey)) return;
      const updated = await store.writeActiveRun(session.account.accountId, runKey, {
        status: "pending_approval",
        pendingApprovalNotifiedAt: Date.now(),
        pendingApprovals,
      });
      await deliverReply(session, record.chatId, record.senderId, renderApprovalPrompt(updated, pendingApprovals));
      scheduleActiveRunPoll(session, updated, ACTIVE_RUN_PENDING_POLL_INTERVAL_MS);
      return;
    }
    if (pendingApprovals.length) {
      if (clearedActiveRunKeys.has(pollKey)) return;
      const updated = await store.writeActiveRun(session.account.accountId, runKey, { status: "pending_approval", pendingApprovals });
      scheduleActiveRunPoll(session, updated, ACTIVE_RUN_PENDING_POLL_INTERVAL_MS);
      return;
    }
    if (resultState.isRunning) {
      if (clearedActiveRunKeys.has(pollKey)) return;
      const updated = await store.writeActiveRun(session.account.accountId, runKey, { status: "running", pendingApprovals: [] });
      scheduleActiveRunPoll(session, updated, ACTIVE_RUN_POLL_INTERVAL_MS);
      return;
    }
  }

  /**
   * Deliver a reply to an IM chat. When an edit-capable transport is available
   * (Telegram editMessageText / Discord message.edit) the reply streams by
   * sending the first chunk and then patching that same message with the
   * accumulated text (parity: streaming patch via ChannelStreamRelay.edit).
   */
  async function deliverReply(session, chatId, peerId, text) {
    const chunks = splitTextForPlatform(text, maxMessageLength);
    if (chunks.length === 0) return null;
    if (chunks.length === 1) {
      const result = await sendTextTo(chatId, chunks[0], peerId).catch((error) => ({ ok: false, error: error?.message ?? String(error) }));
      setState({ sentCount: state.sentCount + 1 });
      return result;
    }
    let messageId = null;
    let accumulated = "";
    for (let index = 0; index < chunks.length; index += 1) {
      if (index === 0) {
        const result = await sendTextTo(chatId, chunks[0], peerId).catch(() => null);
        messageId = result?.messageId ?? null;
        accumulated = chunks[0];
      } else if (editMessageTo && messageId) {
        accumulated += (index > 0 ? "\n" : "") + chunks[index];
        await editMessageTo(chatId, messageId, accumulated).catch(() => undefined);
      } else {
        await sendTextTo(chatId, chunks[index], peerId).catch(() => undefined);
      }
      if (index < chunks.length - 1) await sleep(sendChunkDelayMs);
    }
    setState({ sentCount: state.sentCount + chunks.length });
    return { ok: true, messageId };
  }

  async function ensureChannelUserAuthorized(session, input) {
    if (!channelPairingService) return true;
    if (channelPairingService.isUserAuthorized(input.platformType, input.platformUserId)) {
      channelPairingService.updateUserActivity(input.platformType, input.platformUserId);
      return true;
    }
    const result = await channelPairingService.requestPairing(input);
    const code = result?.pairingRequest?.code;
    if (code) {
      await deliverReply(session, input.chatId, input.platformUserId, `需要先在 Studio 本机批准配对。配对码：${code}`).catch(() => undefined);
      appendLog({ type: "warn", text: `${platformType} pairing requested for ${input.platformUserId}, code=${code}` });
    } else {
      appendLog({ type: "warn", text: `${platformType} pairing request returned no code for ${input.platformUserId}` });
    }
    return false;
  }

  async function getChannelSession(session, event, agent) {
    if (!channelSessionStore) return null;
    const channelSession = await channelSessionStore.getOrCreateSession({
      platformType,
      platformUserId: event.senderId,
      agentType: `${agent.provider}/${agent.id}`,
      workspace: session.options.workspaceRoot,
      chatId: event.chatId,
    }).catch(() => null);
    if (!channelSession) return null;
    const needBind = await shouldBindConversation({ session, event, agent, channelSession });
    if (needBind && runtime?.createConversation) {
      try {
        const created = await runtime.createConversation({
          workspaceRoot: session.options.workspaceRoot,
          agent: { provider: agent.provider, id: agent.id },
          source: "channel",
          title: `${platformName} ${event.senderId}@${event.chatId}`,
          metadata: {
            channelChatId: event.chatId,
            platformType,
            platformUserId: event.senderId,
          },
        });
        const conversationId = created?.conversation?.id ?? created?.id ?? null;
        if (conversationId) {
          await channelSessionStore.bindConversation(channelSession.id, conversationId);
          if (channelSession.conversationId) {
            appendLog({ type: "warn", text: `${platformType} healed orphaned conversationId ${channelSession.conversationId} -> ${conversationId}` });
          }
        }
      } catch (error) {
        appendLog({ type: "warn", text: `${platformType} conversation bind failed: ${error?.message ?? String(error)}` });
      }
    }
    return channelSessionStore.getSession(channelSession.id) ?? channelSession;

    async function shouldBindConversation({ session, event, agent, channelSession }) {
      const boundId = String(channelSession.conversationId ?? "").trim();
      if (!boundId) return true;
      if (!runtime?.listAgentConversations) return false;
      try {
        const listed = await runtime.listAgentConversations({
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

  // Reverse relay: Studio -> IM.
  let _studioRelayUnsub = null;
  function subscribeStudioRelay() {
    if (!channelEventBus || _studioRelayUnsub) return;
    _studioRelayUnsub = channelEventBus.subscribe("channel:conversation:message:from-studio", (event) => {
      const payload = event?.payload ?? event ?? {};
      if (String(payload?.platformType ?? "").toLowerCase() !== platformType) return;
      const chatId = String(payload?.chatId ?? "").trim();
      const text = String(payload?.text ?? "").trim();
      if (!chatId || !text) return;
      void deliverReply(active ?? { account: { accountId: state.accountId }, options: runtimeOptions({}) }, chatId, chatId, text).catch((error) => {
        appendLog({ type: "error", text: `${platformType} studio-relay send failed: ${error?.message ?? String(error)}` });
      });
    });
  }
  function unsubscribeStudioRelay() {
    if (_studioRelayUnsub) {
      try { _studioRelayUnsub(); } catch { /* noop */ }
      _studioRelayUnsub = null;
    }
  }

  async function saveAccount(input = {}) {
    const account = await store.saveAccount(input);
    if (account?.botUsername ?? account?.username) setState({ botUsername: account.botUsername ?? account.username, hasToken: true });
    return { ok: true, account };
  }

  async function accountStatus(input = {}) {
    const accountId = String(input.accountId ?? state.accountId ?? "").trim();
    const account = accountId ? await store.loadAccount(accountId).catch(() => null) : await store.loadDefaultAccount().catch(() => null);
    const config = await store.readConfig().catch(() => ({}));
    const lastStartOptions = config?.lastStartOptions && typeof config.lastStartOptions === "object" ? config.lastStartOptions : {};
    return {
      ok: true,
      account: sanitizeAccount(account),
      status: snapshot({
        workspaceRoot: state.workspaceRoot || String(lastStartOptions.workspaceRoot ?? ""),
        accessibleWorkspaceRoots: state.accessibleWorkspaceRoots?.length ? state.accessibleWorkspaceRoots : normalizeAccessibleWorkspaceRoots(lastStartOptions.accessibleWorkspaceRoots, lastStartOptions.workspaceRoot),
        approvalMode: state.approvalMode || normalizeApprovalMode(lastStartOptions.approvalMode),
      }),
      config: {
        autoStart: config.autoStart !== false,
        workspaceRoot: String(lastStartOptions.workspaceRoot ?? ""),
        accessibleWorkspaceRoots: normalizeAccessibleWorkspaceRoots(lastStartOptions.accessibleWorkspaceRoots, lastStartOptions.workspaceRoot),
        approvalMode: normalizeApprovalMode(lastStartOptions.approvalMode),
        defaultAccountId: String(config.defaultAccountId ?? ""),
      },
    };
  }

  async function autoStart(input = {}) {
    const config = await store.readConfig();
    if (config.autoStart === false && input.force !== true) {
      return { ok: false, skipped: true, reason: "autoStart disabled", status: snapshot() };
    }
    const account = await store.loadDefaultAccount();
    if (!account?.token) return { ok: false, skipped: true, reason: `no saved ${platformName} account`, status: snapshot() };
    return start({ ...config.lastStartOptions, ...input, accountId: account.accountId, autoStart: true });
  }

  async function simulateInbound(input = {}) {
    const accountId = String(input.accountId ?? state.accountId ?? "").trim();
    const account = active?.account?.accountId === accountId ? active.account : await store.loadAccount(accountId);
    if (!account) return { ok: false, error: `${platformName} account is not configured` };
    const session = active?.account?.accountId === account.accountId
      ? active
      : { account, store, options: runtimeOptions(input), controller: new AbortController() };
    const raw = buildSimulatedInbound
      ? buildSimulatedInbound(input, account)
      : { senderId: input.fromUserId ?? input.senderId ?? "studio-test-user", messageId: input.messageId ?? `sim-${Date.now()}`, chatId: input.chatId ?? "studio-test-chat", chatType: input.chatType ?? "dm", text: String(input.text ?? "ping"), raw: null };
    const event = await processEvent(session, normalizeInbound(raw, account));
    return { ok: true, event, status: snapshot() };
  }

  async function probe(input = {}) {
    const accountId = String(input.accountId ?? state.accountId ?? "").trim();
    const account = accountId ? await store.loadAccount(accountId).catch(() => null) : await store.loadDefaultAccount().catch(() => null);
    if (!account?.token) return { ok: false, error: `no saved ${platformName} account` };
    try {
      if (typeof options.probeTransport === "function") {
        const probeResult = await options.probeTransport({ account });
        return { ok: true, botUsername: probeResult?.botUsername ?? account.botUsername ?? undefined, hasToken: true, ...probeResult };
      }
      return { ok: true, botUsername: account.botUsername ?? undefined, hasToken: true };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  async function maybeHandleControlCommand(session, event) {
    const approvalCommand = parseApprovalCommand(event.text);
    if (approvalCommand) {
      await handleApprovalCommand(session, event, approvalCommand);
      return true;
    }
    const runCommand = parseRunCommand(event.text);
    if (runCommand) {
      await handleRunCommand(session, event, runCommand);
      return true;
    }
    const modeCommand = parseModeCommand(event.text);
    if (modeCommand) {
      if (!modeCommand.target) {
        await deliverReply(session, event.chatId, event.senderId, renderModeHelp(session, event.chatId));
        return true;
      }
      const nextMode = normalizePromptMode(modeCommand.target);
      if (nextMode !== modeCommand.target.trim().toLowerCase()) {
        await deliverReply(session, event.chatId, event.senderId, `未知${platformName}转发模式：${modeCommand.target}\n\n${renderModeHelp(session, event.chatId)}`);
        return true;
      }
      session.options.promptModeByChat.set(event.chatId, nextMode);
      await store.writeChatSetting(session.account.accountId, event.chatId, { promptMode: nextMode }).catch(() => undefined);
      await deliverReply(session, event.chatId, event.senderId, `已切换当前${platformName}会话的转发模式：${nextMode}`);
      return true;
    }
    const agentCommand = parseAgentSwitchCommand(event.text);
    if (!agentCommand) return false;
    const availableIds = (session.options.availableAgents ?? []).map((a) => `${a.provider}/${a.id}`);
    appendLog({ type: "debug", text: `${platformType} agent-switch: raw=${JSON.stringify(event.text)} target=${JSON.stringify(agentCommand.target)} chat=${event.chatId} available=[${availableIds.join(",")}]` });
    if (!agentCommand.target) {
      await deliverReply(session, event.chatId, event.senderId, renderAgentHelp(session, event.chatId)).catch((error) => {
        appendLog({ type: "error", text: `${platformType} agent-switch help send failed: ${error?.message ?? error}` });
      });
      return true;
    }
    const nextAgent = resolveAgentAlias(session.options.availableAgents, agentCommand.target);
    if (!nextAgent) {
      await deliverReply(session, event.chatId, event.senderId, `未找到可切换的本地 Agent：${agentCommand.target}\n\n${renderAgentHelp(session, event.chatId)}`).catch((error) => {
        appendLog({ type: "error", text: `${platformType} agent-switch not-found send failed: ${error?.message ?? error}` });
      });
      return true;
    }
    const priorAgent = session.options.agentByChat.get(event.chatId) ?? null;
    session.options.agentByChat.set(event.chatId, nextAgent);
    await store.writeChatSetting(session.account.accountId, event.chatId, { agent: nextAgent }).catch((error) => {
      appendLog({ type: "error", text: `${platformType} agent-switch: writeChatSetting failed: ${error?.message ?? error}` });
    });
    if (session.options.channelAssistantBindingStore) {
      await session.options.channelAssistantBindingStore
        .setChatAssistant(platformType, event.chatId, { assistant_id: nextAgent.id })
        .catch((error) => appendLog({ text: `Failed to persist chat binding: ${error?.message ?? error}` }));
    }
    setState({ activeAgentId: nextAgent.id, lastError: null });
    let priorRun = null;
    try {
      const priorRunKey = priorAgent ? activeRunKey(event.chatId, priorAgent) : null;
      if (priorRunKey) priorRun = await store.readActiveRun(session.account.accountId, priorRunKey).catch(() => null);
    } catch { /* noop */ }
    const suffix = priorRun?.runId ? `\n上一个任务（${priorAgent ? agentLabel(priorAgent) : "旧 Agent"}）仍在运行，其结果会异步返回；新消息将由新 Agent 处理。` : "";
    await deliverReply(session, event.chatId, event.senderId, `已切换当前${platformName}会话的回复 Agent：${agentLabel(nextAgent)}${suffix}`).catch((error) => {
      appendLog({ type: "error", text: `${platformType} agent-switch ack send failed: ${error?.message ?? error}` });
    });
    return true;
  }

  async function handleRunCommand(session, event, command) {
    if (command.name === "runs") {
      const runs = await store.listActiveRuns(session.account.accountId).catch(() => []);
      await deliverReply(session, event.chatId, event.senderId, renderRunsList(platformName, runs));
      return;
    }
    const agent = await currentAgentForChat(platformType, session, event.chatId);
    const runKey = activeRunKey(event.chatId, agent);
    const run = await store.readActiveRun(session.account.accountId, runKey).catch(() => null);
    if (command.name === "new") {
      if (run?.runId) {
        await deliverReply(session, event.chatId, event.senderId, `当前${platformName}会话和 Agent 还有运行中的任务。请等待完成，或先发送 #cancel 后再开启新会话。`);
        return;
      }
      const runtimeAgent = scopedRuntimeAgent(platformType, platformName, agent, event);
      const historyKey = chatAgentHistoryKey(event.chatId, agent);
      await store.clearChatHistory?.(session.account.accountId, historyKey).catch(() => false);
      await closeChannelSessionForAgent(session, event, agent);
      const reset = typeof runtime?.resetConversation === "function"
        ? await runtime.resetConversation({ workspaceRoot: session.options.workspaceRoot, agent: runtimeAgent }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        : { ok: false, error: "runtime reset is unavailable" };
      if (reset?.ok === false) {
        await deliverReply(session, event.chatId, event.senderId, `已清空${platformName}侧历史，但本地 Agent 会话重置失败：${reset.error ?? "unknown error"}`);
        return;
      }
      await deliverReply(session, event.chatId, event.senderId, `已为当前${platformName}会话开启新的 ${agentLabel(agent)} 对话。后续消息不会带入该 Agent 之前的${platformName}历史或本地 provider session。`);
      return;
    }
    if (command.name === "status" || command.name === "continue") {
      if (run) scheduleActiveRunPoll(session, run, 0);
      await deliverReply(session, event.chatId, event.senderId, run ? renderRunStatus(run) : `当前${platformName}会话和 Agent 没有运行中的任务。`);
      return;
    }
    if (command.name === "cancel") {
      if (!run?.runId) {
        await deliverReply(session, event.chatId, event.senderId, `当前${platformName}会话和 Agent 没有可取消的任务。`);
        return;
      }
      const cancelled = typeof runtime?.cancelRun === "function"
        ? await runtime.cancelRun(run.runId, { reason: platformType })
        : { ok: false, error: "runtime cancel is unavailable" };
      clearActiveRunPoll(session.account.accountId, runKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await store.deleteActiveRun(session.account.accountId, runKey);
      await deliverReply(session, event.chatId, event.senderId, cancelled?.ok === false ? `已清理${platformName}侧任务记录，但本地取消失败：${cancelled.error ?? "unknown error"}` : `已取消当前${platformName}会话的本地 Agent 任务。`);
    }
  }

  async function handleApprovalCommand(session, event, command) {
    if (typeof runtime?.resolveApproval !== "function") {
      await deliverReply(session, event.chatId, event.senderId, `当前本地 Agent runtime 不支持${platformName}内审批。请在 Studio 中处理审批。`);
      return;
    }
    const pendingRuns = await pendingApprovalRunsForChat(session, event.chatId);
    if (!pendingRuns.length) {
      await deliverReply(session, event.chatId, event.senderId, `当前${platformName}会话没有等待审批的本地 Agent 任务。`);
      return;
    }
    const targets = command.all ? pendingRuns : [pendingRuns[0]];
    let resolvedCount = 0;
    const errors = [];
    for (const run of targets) {
      const approvals = Array.isArray(run.pendingApprovals) ? run.pendingApprovals : [];
      const approvalTargets = command.all ? approvals : approvals.slice(0, 1);
      for (const approval of approvalTargets) {
        const result = await runtime.resolveApproval({
          runId: run.runId,
          approvalId: approval.id,
          decision: command.decision,
        }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        if (result?.ok === false) {
          errors.push(`${safeId(run.runId, 12)}: ${result.error ?? "unknown error"}`);
          continue;
        }
        resolvedCount += 1;
      }
      const remaining = command.all ? [] : approvals.slice(1);
      const updated = await store.writeActiveRun(session.account.accountId, run.runKey, {
        status: remaining.length ? "pending_approval" : "running",
        pendingApprovals: remaining,
        pendingApprovalNotifiedAt: remaining.length ? run.pendingApprovalNotifiedAt : null,
      });
      scheduleActiveRunPoll(session, updated, 0);
    }
    if (!resolvedCount && errors.length) {
      await deliverReply(session, event.chatId, event.senderId, `审批处理失败：\n${errors.join("\n")}`);
      return;
    }
    const action = command.decision === "decline" ? "拒绝" : "批准";
    const suffix = errors.length ? `\n部分审批失败：\n${errors.join("\n")}` : "";
    await deliverReply(session, event.chatId, event.senderId, `已${action} ${resolvedCount} 个审批请求，Agent 将继续处理。${suffix}`);
  }

  async function pendingApprovalRunsForChat(session, chatId) {
    const runs = await store.listActiveRuns(session.account.accountId).catch(() => []);
    return runs
      .filter((run) => String(run.chatId ?? "") === String(chatId ?? ""))
      .filter((run) => Array.isArray(run.pendingApprovals) && run.pendingApprovals.length > 0)
      .sort((a, b) => Number(a.startedAt ?? a.createdAt ?? 0) - Number(b.startedAt ?? a.createdAt ?? 0));
  }

  async function probeTransportHook() {
    return { ok: true };
  }

  return {
    platformType,
    start,
    stop,
    status: () => snapshot(),
    accountStatus,
    saveAccount,
    autoStart,
    simulateInbound,
    probe,
    processInbound,
    deliverReply,
    // Exposed for plugin/registry status enrichment.
    get botUsername() { return state.botUsername; },
    get hasToken() { return state.hasToken; },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers (mirror weixin/feishu).
// ---------------------------------------------------------------------------

function sanitizeAccount(account) {
  if (!account) return account;
  const { token, appSecret, baseUrl, ...rest } = account;
  return { ...rest, hasToken: Boolean(token || appSecret) };
}

function normalizeRuntimeOptions(input = {}) {
  const agent = normalizePersonalLocalAgent(input.agent ?? { provider: "opencode" });
  const availableAgents = normalizeAvailableAgents(input.availableAgents ?? input.agents, agent);
  const allowedUsers = normalizeList(input.allowedUsers ?? input.allowFrom);
  const allowedGroups = normalizeList(input.allowedGroups ?? input.groupAllowFrom);
  const dmPolicy = normalizePolicy(input.dmPolicy, allowedUsers, "allowlist");
  const groupPolicy = normalizePolicy(input.groupPolicy, allowedGroups, "open");
  return {
    workspaceRoot: String(input.workspaceRoot ?? "").trim() || "",
    accessibleWorkspaceRoots: normalizeAccessibleWorkspaceRoots(input.accessibleWorkspaceRoots, input.workspaceRoot),
    agent,
    availableAgents,
    agentByChat: new Map(),
    promptModeByChat: new Map(),
    approvalMode: normalizeApprovalMode(input.approvalMode),
    promptMode: normalizePromptMode(input.promptMode),
    dmPolicy,
    allowedUsers,
    groupPolicy,
    allowedGroups,
    textBatchDelayMs: Number.isFinite(Number(input.textBatchDelayMs)) ? Math.max(0, Number(input.textBatchDelayMs)) : DEFAULT_TEXT_BATCH_DELAY_MS,
    sendChunkDelayMs: Number.isFinite(Number(input.sendChunkDelayMs)) ? Math.max(0, Number(input.sendChunkDelayMs)) : 1500,
    timeoutMs: Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : undefined,
    historyLimit: Number.isFinite(Number(input.historyLimit)) ? Math.max(0, Number(input.historyLimit)) : DEFAULT_HISTORY_LIMIT,
    historyStoreLimit: Number.isFinite(Number(input.historyStoreLimit)) ? Math.max(1, Number(input.historyStoreLimit)) : DEFAULT_HISTORY_STORE_LIMIT,
  };
}

function normalizeApprovalMode(value) {
  const mode = String(value ?? "ask").trim();
  if (mode === "auto" || mode === "ask" || mode === "read-only-auto") return mode;
  return "ask";
}

function normalizeAccessibleWorkspaceRoots(value, workspaceRoot = "") {
  const primary = String(workspaceRoot ?? "").trim();
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  const roots = [];
  for (const item of source) {
    const root = String(item ?? "").trim();
    if (!root || root === primary || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return roots;
}

function normalizePromptMode(value) {
  const mode = String(value ?? "raw").trim().toLowerCase();
  if (mode === "debug") return "debug";
  return "raw";
}

function normalizeAvailableAgents(value, fallbackAgent) {
  const source = Array.isArray(value) ? value : [];
  const byId = new Map();
  for (const item of [fallbackAgent, ...source]) {
    const agent = normalizePersonalLocalAgent(item);
    byId.set(agent.id, agent);
  }
  return [...byId.values()];
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizePolicy(value, allowlist, fallback) {
  const policy = String(value ?? fallback).trim();
  if (policy === "allowlist" && allowlist.length === 0) return "open";
  if (policy === "open" || policy === "disabled" || policy === "allowlist") return policy;
  return fallback;
}

function isAllowed(options, chat, senderId) {
  if (chat.chatType === "group") {
    if (options.groupPolicy === "disabled") return false;
    if (options.groupPolicy === "allowlist") return options.allowedGroups.includes(chat.chatId);
    return true;
  }
  if (options.dmPolicy === "disabled") return false;
  if (options.dmPolicy === "allowlist") return options.allowedUsers.includes(senderId);
  return true;
}

async function currentAgentForChat(platformType, session, chatId) {
  const memoryAgent = session.options.agentByChat.get(chatId);
  if (memoryAgent) return memoryAgent;
  const setting = await storeSafeReadChatSetting(session, chatId);
  const storedAgent = setting?.agent ? normalizePersonalLocalAgent(setting.agent) : null;
  if (storedAgent) {
    const available = resolveAgentAlias(session.options.availableAgents, storedAgent.id) ?? storedAgent;
    session.options.agentByChat.set(chatId, available);
    return available;
  }
  const bindingStore = session.options.channelAssistantBindingStore;
  if (bindingStore) {
    const chatBinding = bindingStore.getChatAssistant(platformType, chatId);
    const platformBinding = chatBinding ?? bindingStore.getPlatformSettings(platformType)?.assistant ?? null;
    const bindingId = platformBinding?.assistant_id ?? platformBinding?.custom_agent_id;
    if (bindingId) {
      const alias = resolveAgentAlias(session.options.availableAgents, bindingId);
      if (alias) {
        session.options.agentByChat.set(chatId, alias);
        return alias;
      }
    }
  }
  return session.options.agent;
}

async function currentPromptModeForChat(session, chatId) {
  const memoryMode = session.options.promptModeByChat.get(chatId);
  if (memoryMode) return memoryMode;
  const setting = await storeSafeReadChatSetting(session, chatId);
  const mode = normalizePromptMode(setting?.promptMode ?? session.options.promptMode);
  session.options.promptModeByChat.set(chatId, mode);
  return mode;
}

async function storeSafeReadChatSetting(session, chatId) {
  try {
    return await session.store.readChatSetting(session.account.accountId, chatId);
  } catch {
    return null;
  }
}

function parseAgentSwitchCommand(text) {
  const raw = String(text ?? "").trim();
  const match = raw.match(/^(?:#agent|\/agent|切换agent|切换Agent|切换代理)(?:\s+(.+))?$/i);
  if (!match) return null;
  return { target: String(match[1] ?? "").trim() };
}

function parseModeCommand(text) {
  const raw = String(text ?? "").trim();
  const match = raw.match(/^(?:#mode|\/mode|#prompt|\/prompt|切换模式)(?:\s+(.+))?$/i);
  if (!match) return null;
  return { target: String(match[1] ?? "").trim() };
}

function parseRunCommand(text) {
  const raw = String(text ?? "").trim().toLowerCase();
  if (raw === "#status" || raw === "/status" || raw === "状态") return { name: "status" };
  if (raw === "#runs" || raw === "/runs" || raw === "任务") return { name: "runs" };
  if (raw === "#cancel" || raw === "/cancel" || raw === "取消") return { name: "cancel" };
  if (raw === "#continue" || raw === "/continue" || raw === "继续") return { name: "continue" };
  if (["#new", "/new", "#new session", "/new session", "#reset", "/reset", "#reset session", "/reset session", "新会话", "重置会话"].includes(raw)) return { name: "new" };
  return null;
}

function parseApprovalCommand(text) {
  const raw = String(text ?? "").trim().toLowerCase();
  const match = raw.match(/^(?:#|\/)?(approve|allow|yes|批准|同意|通过|deny|reject|no|拒绝|不同意)(?:\s+(.+))?$/i);
  if (!match) return null;
  const verb = String(match[1] ?? "").toLowerCase();
  const args = String(match[2] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const accept = ["approve", "allow", "yes", "批准", "同意", "通过"].includes(verb);
  const session = args.some((arg) => ["session", "always", "本次", "本轮"].includes(arg));
  return {
    decision: accept ? (session ? "acceptForSession" : "accept") : "decline",
    all: args.includes("all") || args.includes("全部"),
  };
}

function agentLabel(agent) {
  return `${agent.name || agent.id} (${agent.provider}${agent.id && agent.id !== agent.provider ? `/${agent.id}` : ""})`;
}

function agentAliases(agent) {
  return [agent.id, agent.provider, agent.name]
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter(Boolean);
}

function resolveAgentAlias(agents, target) {
  const normalized = String(target ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return agents.find((agent) => agentAliases(agent).includes(normalized)) ?? null;
}

function stableHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12);
}

function safeSegment(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_.@-]/g, "_").slice(0, 48) || "default";
}

function chatAgentHistoryKey(chatId, agent) {
  return `${String(chatId ?? "").trim()}::agent:${agent.provider}/${agent.id}`;
}

function activeRunKey(chatId, agent) {
  return `${String(chatId ?? "").trim()}::agent:${agent.provider}/${agent.id}`;
}

function activeRunGuardKey(accountId, runKey) {
  return `${String(accountId ?? "").trim()}:${String(runKey ?? "").trim()}`;
}

function scopedRuntimeAgent(platformType, platformName, agent, event) {
  const scopeHash = stableHash(`${event.accountId}\n${event.chatId}\n${agent.provider}\n${agent.id}`);
  return {
    ...agent,
    id: `${safeSegment(agent.id)}-${platformType}-${scopeHash}`,
    name: agent.name ? `${agent.name} · ${platformName}` : `${agent.provider} · ${platformName}`,
  };
}

function renderAgentHelp(session, chatId) {
  const current = session.options.agentByChat.get(chatId) ?? session.options.agent;
  return [
    `当前回复 Agent：${agentLabel(current)}`,
    "可用 Agent：",
    ...session.options.availableAgents.map((agent) => `- ${agent.id}: ${agentLabel(agent)}`),
    "",
    "发送 #agent <id> 切换，例如：#agent codex",
  ].join("\n");
}

function renderModeHelp(session, chatId) {
  const current = session.options.promptModeByChat.get(chatId) ?? session.options.promptMode;
  return [
    `当前转发模式：${current}`,
    "可用模式：raw、debug",
    "发送 #mode raw 使用原文直通；发送 #mode debug 使用调试上下文。",
  ].join("\n");
}

function renderRunStatus(run) {
  const agent = run?.agent ? agentLabel(run.agent) : "unknown";
  const status = String(run?.status ?? "running");
  const runIdValue = safeId(run?.runId, 12);
  const startedAt = run?.startedAt ? new Date(run.startedAt).toISOString().replace("T", " ").slice(0, 19) : "unknown";
  const approval = Array.isArray(run?.pendingApprovals) && run.pendingApprovals.length ? `\n待审批：${run.pendingApprovals.length}` : "";
  return [`当前任务：${status}`, `Agent：${agent}`, `runId：${runIdValue}`, `开始时间：${startedAt}${approval}`].join("\n");
}

function renderApprovalPrompt(run, pendingApprovals) {
  const approvals = Array.isArray(pendingApprovals) ? pendingApprovals : [];
  const first = approvals[0] ?? {};
  return [
    "本地 Agent 请求权限审批。",
    `Agent：${run?.agent ? agentLabel(run.agent) : "unknown"}`,
    `runId：${safeId(run?.runId, 12)}`,
    first.title ? `标题：${first.title}` : null,
    first.summary ? `说明：${first.summary}` : null,
    first.command ? `命令：${first.command}` : null,
    first.cwd ? `目录：${first.cwd}` : null,
    approvals.length > 1 ? `待审批数量：${approvals.length}` : null,
    "",
    "回复 #approve 批准一次；#approve session 批准本轮；#deny 拒绝。",
    approvals.length > 1 ? "可用 #approve all 或 #deny all 处理全部。" : null,
  ].filter(Boolean).join("\n");
}

function renderRunsList(platformName, runs) {
  const items = Array.isArray(runs) ? runs : [];
  if (!items.length) return `当前账号没有运行中的${platformName}本地 Agent 任务。`;
  return [
    "当前账号运行中的任务：",
    ...items.map((run) => `- ${String(run.chatId ?? "?")} / ${run?.agent?.id ?? "unknown"}: ${String(run.status ?? "running")} (${safeId(run.runId, 12)})`),
  ].join("\n");
}

function buildPrompt(platformName, event, options = {}) {
  const mode = normalizePromptMode(options.mode);
  const history = Array.isArray(options.history) ? options.history : [];
  const historyLines = history.length
    ? ["", "最近对话:", ...history.map((item) => `- ${item.role || "unknown"}${item.agentId ? `/${item.agentId}` : ""}: ${String(item.text ?? "").trim()}`)]
    : [];
  const agent = options.agent ?? {};
  return [
    `来源: ${platformName}`,
    `chat_id: ${event.chatId}`,
    `user_id: ${event.senderId}`,
    event.messageId ? `message_id: ${event.messageId}` : null,
    agent.id ? `agent: ${agent.provider || "unknown"}/${agent.id}` : null,
    `prompt_mode: ${mode}`,
    ...historyLines,
    "",
    "用户消息:",
    event.text,
  ].filter((line) => line !== null).join("\n");
}

async function runAgentTurn(runtime, input) {
  if (typeof runtime.startMessage !== "function" || typeof runtime.getRun !== "function") {
    return await runtime.runMessage(input);
  }
  const started = await runtime.startMessage(input);
  const runId = started?.runId;
  if (!runId) return started;
  const deadline = Date.now() + Math.max(30_000, Number(input.timeoutMs ?? 15 * 60_000));
  while (Date.now() < deadline) {
    const snapshot = await runtime.getRun({ runId, workspaceRoot: input.workspaceRoot });
    const snapshotState = getChannelRunSnapshotState(snapshot);
    if (snapshotState.hasPendingApprovals) return snapshot;
    if (snapshotState.isTerminal) return snapshot;
    await sleep(250);
  }
  return await runtime.getRun({ runId, workspaceRoot: input.workspaceRoot });
}

export const __test__ = {
  splitTextForPlatform,
  buildPrompt,
  isAllowed,
  normalizeRuntimeOptions,
  normalizePromptMode,
  parseAgentSwitchCommand,
  parseModeCommand,
  parseRunCommand,
  parseApprovalCommand,
  currentAgentForChat,
  currentPromptModeForChat,
  renderAgentHelp,
  renderModeHelp,
  renderRunStatus,
  renderRunsList,
  renderApprovalPrompt,
  resolveAgentAlias,
  activeRunKey,
  activeRunGuardKey,
  runAgentTurn,
  getChannelRunSnapshotState,
  scopedRuntimeAgent,
};
