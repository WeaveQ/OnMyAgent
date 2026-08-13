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
import {
  ONMYAGENT_ASSISTANT_AGENT_ID,
  ONMYAGENT_ASSISTANT_PROVIDER,
  createOnMyAgentAssistantAgent,
  runAssistantBridgeTurn,
} from "./assistant-bridge.mjs";
import { formatAgentReply, formatAgentResultOutput } from "./AgentReplyHeader.mjs";
import { CHANNEL_EVENTS } from "./ChannelEventBus.mjs";
import { createMessagingTaskAdapter } from "./messaging-task-adapter.mjs";

const DEFAULT_TEXT_BATCH_DELAY_MS = 3_000;
const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_HISTORY_STORE_LIMIT = 24;
const ACTIVE_RUN_POLL_INTERVAL_MS = 1_000;
const ACTIVE_RUN_PENDING_POLL_INTERVAL_MS = 3_000;
// Minimum spacing between "agent still busy" replies for the same chat+agent.
const AGENT_BUSY_NOTICE_INTERVAL_MS = 15_000;
const MESSAGE_DEDUP_TTL_MS = 5 * 60_000;
// Backstop ceiling for a single channel conversation lock. The personal agent
// runtime already enforces its own run timeout (max 12h), but that timer lives
// in the runtime process and is lost if the desktop app restarts. This
// guarantees a conversation is never stuck behind a "running" task forever.
const ACTIVE_RUN_MAX_AGE_MS = 12 * 60 * 60 * 1000 + 15 * 60 * 1000;

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
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(2, Math.floor(Number(maxLength))) : 2000;
  if (raw.length <= limit) return [raw];
  const chunks = [];
  let rest = raw;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("。", limit);
    if (cut < limit * 0.5) cut = limit;
    // JavaScript string offsets count UTF-16 code units. Moving a fallback
    // split one unit left keeps emoji and other supplementary characters from
    // being emitted as two invalid lone surrogates across transport calls.
    if (
      cut > 0
      && cut < rest.length
      && rest.charCodeAt(cut - 1) >= 0xD800
      && rest.charCodeAt(cut - 1) <= 0xDBFF
      && rest.charCodeAt(cut) >= 0xDC00
      && rest.charCodeAt(cut) <= 0xDFFF
    ) {
      cut -= 1;
    }
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
  const messagingTaskAdapter = createMessagingTaskAdapter({
    taskMessageRouter: options.taskMessageRouter,
  });
  const defaultWorkspaceRoot = String(options.defaultWorkspaceRoot ?? "").trim();
  const maxMessageLength = Number.isFinite(Number(options.maxMessageLength))
    ? Math.max(2, Math.floor(Number(options.maxMessageLength)))
    : 2000;
  const textBatchDelayMs = Number.isFinite(Number(options.textBatchDelayMs)) ? Math.max(0, Number(options.textBatchDelayMs)) : DEFAULT_TEXT_BATCH_DELAY_MS;
  const sendChunkDelayMs = Number.isFinite(Number(options.sendChunkDelayMs)) ? Math.max(0, Number(options.sendChunkDelayMs)) : 1500;

  const dedup = new TtlSet(MESSAGE_DEDUP_TTL_MS);
  const pendingBatches = new Map();
  const agentBusyNoticeAt = new Map();
  const activeRunPollers = new Map();
  const activeRunPollTasks = new Set();
  const activeRunInFlight = new Map();
  const activeRunPendingSchedules = new Map();
  const activeRunReservations = new Map();
  const activeRunRecords = new Map();
  const activeRunGenerations = new Map();
  const terminalDeliveryClaims = new Map();
  const activeRunErrorNoticeAt = new Map();
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

  // Signature of the fields that matter to the UI. Used to avoid spamming the
  // event bus with no-op publishes (parity: AionUi only pushes on real status
  // change, not on every internal mutation).
  let lastPublishedStateSig = "";

  function publishStateChanged(next) {
    if (!channelEventBus) return;
    const sig = JSON.stringify({
      status: next.status,
      lastError: next.lastError,
      processedCount: next.processedCount,
      sentCount: next.sentCount,
      botUsername: next.botUsername,
      hasToken: next.hasToken,
      activeAgentId: next.activeAgentId,
      approvalMode: next.approvalMode,
      accountId: next.accountId,
      startedAt: next.startedAt,
      lastPollAt: next.lastPollAt,
      lastMessageAt: next.lastMessageAt,
      lastRunId: next.lastRunId,
    });
    if (sig === lastPublishedStateSig) return;
    lastPublishedStateSig = sig;
    try {
      channelEventBus.publish(CHANNEL_EVENTS.CHANNEL_STATE_CHANGED, {
        platformType,
        status: next,
      });
    } catch {
      // Publishing must never break the dispatch hot path.
    }
  }

  function setState(patch) {
    state = { ...state, ...patch };
    const next = snapshot();
    publishStateChanged(next);
    return next;
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
    activeRunPendingSchedules.clear();
    // Do not await getRun/startMessage here: provider calls may be long-lived.
    // Their guarded continuations observe the aborted session and settle
    // without transport or persistence side effects after stop returns.
    activeRunInFlight.clear();
    activeRunPollTasks.clear();
    for (const key of activeRunReservations.keys()) {
      bumpActiveRunGeneration(key);
      // A startMessage result may already be waiting for its first durable
      // write. Tombstone the optimistic overlay so that late write is removed
      // again and the caller takes the aborted-session cancel path.
      activeRunRecords.set(key, null);
    }
    activeRunReservations.clear();
    activeRunErrorNoticeAt.clear();
    unsubscribeStudioRelay();
    setState({ status: "stopped", botUsername: undefined, hasToken: false });
    return { ok: true, status: snapshot() };
  }

  async function processInbound(raw, input = {}) {
    const account = active?.account ?? null;
    if (!account) return null;
    const session = active ?? { account, store, options: runtimeOptions(input), controller: new AbortController() };
    const event = normalizeInbound(raw, account);
    try {
      return await processEvent(session, event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({ lastError: `inbound processing failed: ${message}` });
      appendLog({ type: "error", text: `${platformType} inbound processing failed: ${message}` });
      return null;
    }
  }

  async function processEvent(session, event) {
    if (!event.senderId || event.senderId === session.account.accountId) return null;
    if (event.messageId && dedup.hasOrAdd(`id:${event.messageId}`)) return null;
    const isControlCommand = messagingTaskAdapter.canRoute(event.text) || parseApprovalCommand(event.text) || parseRunCommand(event.text) || parseModeCommand(event.text) || parseModelSwitchCommand(event.text) || parseAgentSwitchCommand(event.text);
    if (!isControlCommand) {
      const contentKey = `content:${event.senderId}:${event.chatId}:${event.text}`;
      if (dedup.hasOrAdd(contentKey)) return null;
    }
    if (!isAllowed(session.options, event, event.senderId)) {
      const policyMessage = `${platformType} 消息被策略拦截（sender=${event.senderId}, chatType=${event.chatType}）`;
      appendLog({ type: "warn", text: `${platformType} inbound dropped (policy): sender=${event.senderId} chatType=${event.chatType}` });
      setState({ lastError: policyMessage });
      return null;
    }
    if (!(await ensureChannelUserAuthorized(session, { platformType, platformUserId: event.senderId, chatId: event.chatId, displayName: event.senderId }))) {
      appendLog({ type: "warn", text: `${platformType} inbound dropped (unauthorized): sender=${event.senderId} chatId=${event.chatId}` });
      return null;
    }
    setState({ lastMessageAt: Date.now(), processedCount: state.processedCount + 1 });
    const taskRoute = await messagingTaskAdapter.tryRoute({
      platform: platformType,
      accountId: event.accountId ?? session.account.accountId,
      chatId: event.chatId,
      senderId: event.senderId,
      messageId: event.messageId,
      text: event.text,
      attachments: event.attachments ?? event.mediaFiles,
    }, {
      appendLog,
      reply: (text) => deliverReply(session, event.chatId, event.senderId, text),
    });
    if (taskRoute.handled) return event;
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

  // Routes an IM chat bound to the `onmyagent` pseudo-agent to the desktop
  // assistant tab via the shared AssistantBridge helper. Pure additive path —
  // only provider `onmyagent-assistant` reaches here.
  function runChannelAssistantBridgeTurn(session, event) {
    return runAssistantBridgeTurn({
      runtime,
      store,
      session,
      event,
      platformLabel: platformType,
      appendLog,
      readChatSetting: storeSafeReadChatSetting,
      deliverReply: async (s, e, text) => {
        await deliverReply(s, e.chatId, e.senderId, text);
      },
    });
  }

  function reservationFor(accountId, runKey) {
    return activeRunReservations.get(activeRunGuardKey(accountId, runKey))?.record ?? null;
  }

  function bumpActiveRunGeneration(key) {
    const generation = (activeRunGenerations.get(key) ?? 0) + 1;
    activeRunGenerations.set(key, generation);
    return generation;
  }

  function reserveActiveRun(accountId, runKey, record) {
    const pollKey = activeRunGuardKey(accountId, runKey);
    const existing = activeRunReservations.get(pollKey);
    if (existing) return { acquired: false, record: existing.record, token: null };
    const token = Symbol("channel-active-run-reservation");
    const reserved = {
      ...record,
      accountId,
      runKey,
      status: "starting",
      startedAt: record.startedAt ?? Date.now(),
    };
    bumpActiveRunGeneration(pollKey);
    activeRunReservations.set(pollKey, { token, record: reserved });
    return { acquired: true, record: reserved, token };
  }

  function releaseActiveRunReservation(accountId, runKey, token) {
    const pollKey = activeRunGuardKey(accountId, runKey);
    const current = activeRunReservations.get(pollKey);
    if (current?.token === token) {
      bumpActiveRunGeneration(pollKey);
      activeRunReservations.delete(pollKey);
    }
  }

  async function readActiveRunWithReservation(accountId, runKey) {
    const reserved = reservationFor(accountId, runKey);
    if (reserved) return reserved;
    const key = activeRunGuardKey(accountId, runKey);
    if (activeRunRecords.has(key)) return activeRunRecords.get(key);
    const generation = activeRunGenerations.get(key) ?? 0;
    const stored = await store.readActiveRun(accountId, runKey).catch(() => null);
    if ((activeRunGenerations.get(key) ?? 0) !== generation) {
      return activeRunRecords.get(key) ?? null;
    }
    if (stored) activeRunRecords.set(key, stored);
    return stored;
  }

  async function listActiveRunsSafely(accountId) {
    const stored = await store.listActiveRuns(accountId).catch(() => []);
    const combined = new Map(stored.map((record) => [String(record?.runKey ?? ""), record]));
    const prefix = `${String(accountId)}:`;
    for (const [key, record] of activeRunRecords) {
      if (!key.startsWith(prefix)) continue;
      const runKey = key.slice(prefix.length);
      if (record) combined.set(runKey, record);
      else combined.delete(runKey);
    }
    return [...combined.values()].filter(Boolean);
  }

  async function writeActiveRunSafely(accountId, runKey, value, fallback = undefined, required = false) {
    const key = activeRunGuardKey(accountId, runKey);
    const generation = activeRunGenerations.get(key) ?? 0;
    const prior = activeRunRecords.get(key);
    const base = prior && typeof prior === "object" ? prior : fallback && typeof fallback === "object" ? fallback : {};
    const record = { ...base, ...value, accountId: String(accountId), runKey: String(runKey) };
    delete record.reservationToken;
    activeRunRecords.set(key, record);
    try {
      const stored = await store.writeActiveRun(accountId, runKey, record);
      if ((activeRunGenerations.get(key) ?? 0) !== generation) {
        const current = activeRunRecords.get(key);
        if (current === null || current === undefined) await store.deleteActiveRun(accountId, runKey).catch(() => undefined);
        return current;
      }
      const durable = stored && typeof stored === "object" ? { ...record, ...stored } : record;
      activeRunRecords.set(key, durable);
      return durable;
    } catch (error) {
      if ((activeRunGenerations.get(key) ?? 0) !== generation) return activeRunRecords.get(key);
      appendLog({ type: "error", text: `${platformType} active run persistence failed: ${error instanceof Error ? error.message : String(error)}` });
      if (required) {
        if (prior === undefined) activeRunRecords.delete(key);
        else activeRunRecords.set(key, prior);
        throw error;
      }
      activeRunRecords.set(key, record);
      return record;
    }
  }

  async function deleteActiveRunSafely(accountId, runKey) {
    const key = activeRunGuardKey(accountId, runKey);
    bumpActiveRunGeneration(key);
    activeRunRecords.set(key, null);
    try {
      const deleted = await store.deleteActiveRun(accountId, runKey);
      if (activeRunRecords.get(key) === null) activeRunRecords.delete(key);
      return deleted;
    } catch (error) {
      appendLog({ type: "error", text: `${platformType} active run cleanup failed: ${error instanceof Error ? error.message : String(error)}` });
      return false;
    }
  }

  async function notifyAgentBusy(session, event, agent, runKey) {
    const busyKey = activeRunGuardKey(session.account.accountId, runKey);
    const nowTs = Date.now();
    const lastAt = agentBusyNoticeAt.get(busyKey) ?? 0;
    if (nowTs - lastAt < AGENT_BUSY_NOTICE_INTERVAL_MS) return;
    agentBusyNoticeAt.set(busyKey, nowTs);
    await deliverReply(
      session,
      event.chatId,
      event.senderId,
      `${agentLabel(agent)} 还在处理上一条消息，请稍后再试。发送 #status 查看进度，或 #cancel 取消后再重发。`,
    ).catch(() => undefined);
  }

  async function dispatchToAgent(session, event) {
    if (session.controller?.signal.aborted) return null;
    if (!runtime?.runMessage && (!runtime?.startMessage || !runtime?.getRun)) {
      throw new Error("personal agent runtime is unavailable");
    }
    const agent = event.agentSnapshot ?? await currentAgentForChat(platformType, session, event.chatId);
    if (session.controller?.signal.aborted) return null;
    if (agent.provider === ONMYAGENT_ASSISTANT_PROVIDER) {
      return await runChannelAssistantBridgeTurn(session, event);
    }
    const promptMode = await currentPromptModeForChat(session, event.chatId);
    if (session.controller?.signal.aborted) return null;
    const historyKey = chatAgentHistoryKey(event.chatId, agent);
    const runKey = activeRunKey(event.chatId, agent);
    const accountId = session.account.accountId;
    const existingRun = await readActiveRunWithReservation(accountId, runKey);
    if (session.controller?.signal.aborted) return null;
    if (existingRun) {
      if (existingRun.runId) scheduleActiveRunPoll(session, existingRun, 0);
      await notifyAgentBusy(session, event, agent, runKey);
      return existingRun;
    }
    const reservation = reserveActiveRun(accountId, runKey, {
      chatId: event.chatId,
      senderId: event.senderId,
      agent,
      historyKey,
      userText: event.text,
      startedAt: Date.now(),
    });
    if (!reservation.acquired) {
      if (reservation.record?.runId) scheduleActiveRunPoll(session, reservation.record, 0);
      await notifyAgentBusy(session, event, agent, runKey);
      return reservation.record;
    }
    try {
      const runtimeAgent = scopedRuntimeAgent(platformType, platformName, agent, event);
      const channelSession = await getChannelSession(session, event, agent);
      if (session.controller?.signal.aborted) return null;
      const history = await store.readChatHistory(accountId, historyKey, session.options.historyLimit).catch(() => []);
      if (session.controller?.signal.aborted) return null;
      const prompt = buildPrompt(platformName, event, { mode: promptMode, history, agent });
      if (typeof runtime.startMessage !== "function" || typeof runtime.getRun !== "function") {
        const legacyModel = await currentModelForChat(session, event.chatId);
        if (session.controller?.signal.aborted) return null;
        const result = await runAgentTurn(runtime, {
          workspaceRoot: session.options.workspaceRoot,
          accessibleWorkspaceRoots: session.options.accessibleWorkspaceRoots,
          prompt,
          agent: runtimeAgent,
          model: legacyModel || undefined,
          approvalMode: session.options.approvalMode,
          timeoutMs: session.options.timeoutMs,
        });
        if (session.controller?.signal.aborted) return result;
        setState({ lastRunId: result?.runId ?? null });
        await handleSynchronousAgentResult(session, event, { agent, historyKey, result, channelSession });
        return result;
      }
      const chatModel = await currentModelForChat(session, event.chatId);
      if (session.controller?.signal.aborted) return null;
      const started = await runtime.startMessage({
        workspaceRoot: session.options.workspaceRoot,
        accessibleWorkspaceRoots: session.options.accessibleWorkspaceRoots,
        prompt,
        // Raw user text (without the channel transport header) so the runtime can
        // record it as the user message in the run log / conversation view.
        userText: event.text,
        agent: runtimeAgent,
        model: chatModel || undefined,
        approvalMode: session.options.approvalMode,
        timeoutMs: session.options.timeoutMs,
      });
      if (session.controller?.signal.aborted) {
        if (started?.runId && typeof runtime.cancelRun === "function") {
          await runtime.cancelRun(started.runId, { reason: `${platformType}_stopped` }).catch((error) => {
            appendLog({ type: "error", text: `${platformType} late-start cleanup failed: ${error instanceof Error ? error.message : String(error)}` });
          });
        }
        return started;
      }
      setState({ lastRunId: started?.runId ?? null });
      if (!started?.runId) {
        await handleSynchronousAgentResult(session, event, { agent, historyKey, result: started, channelSession });
        return started;
      }
      if (session.controller?.signal.aborted) return started;
      const pollKey = activeRunGuardKey(accountId, runKey);
      terminalDeliveryClaims.delete(pollKey);
      const trackedRun = await writeActiveRunSafely(accountId, runKey, {
        status: started.status ?? "running",
        accountId,
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
        terminalDeliveryClaimedRunId: null,
        terminalDeliveryClaimedAt: null,
        startedAt: Date.now(),
      }, reservation.record);
      if (!trackedRun?.runId) {
        if (session.controller?.signal.aborted && typeof runtime.cancelRun === "function") {
          await runtime.cancelRun(started.runId, { reason: `${platformType}_stopped` }).catch(() => undefined);
        }
        return trackedRun;
      }
      if (session.controller?.signal.aborted) {
        const current = activeRunRecords.get(pollKey);
        const replacement = reservationFor(accountId, runKey);
        if (!replacement && (!current || String(current.runId ?? "") === String(trackedRun.runId))) {
          activeRunRecords.set(pollKey, trackedRun);
        }
        return trackedRun;
      }
      clearedActiveRunKeys.delete(pollKey);
      scheduleActiveRunPoll(session, trackedRun, 0);
      return trackedRun;
    } finally {
      releaseActiveRunReservation(accountId, runKey, reservation.token);
    }
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
    const deliveredOutput = formatAgentResultOutput(result);
    const delivery = await deliverReply(session, event.chatId, event.senderId, formatAgentReply({ agent, text: deliveredOutput }));
    if (delivery?.ok === false) return;
    await appendAgentHistory(session, historyKey, event.text, deliveredOutput, agent, session.options.historyStoreLimit);
    await appendChannelSessionHistory(channelSession, event.text, deliveredOutput, agent);
  }

  async function appendAgentHistory(session, historyKey, userText, output, agent, limit) {
    await store.appendChatHistory(session.account.accountId, historyKey, [
      { role: "user", text: userText, at: Date.now() },
      { role: "assistant", text: output, at: Date.now(), agentId: agent.id, agentProvider: agent.provider },
    ], limit).catch(() => undefined);
  }

  async function resumeActiveRuns(session) {
    const runs = await listActiveRunsSafely(session.account.accountId);
    for (const run of runs) {
      // clearActiveRunPoll is scoped to a service session. A durable run that
      // survives stop must be eligible again when the same dispatcher starts.
      clearedActiveRunKeys.delete(activeRunGuardKey(session.account.accountId, run.runKey));
      scheduleActiveRunPoll(session, run, 0);
    }
  }

  async function releaseUnattemptedTerminalClaim(session, runKey, record) {
    const pollKey = activeRunGuardKey(session.account.accountId, runKey);
    try {
      return await writeActiveRunSafely(session.account.accountId, runKey, {
        status: record?.status === "terminal_delivery_claimed" ? "running" : (record?.status ?? "running"),
        terminalDeliveryClaimedRunId: null,
        terminalDeliveryClaimedAt: null,
        terminalDeliveryAttemptedTransports: null,
      }, record, true);
    } finally {
      terminalDeliveryClaims.delete(pollKey);
      clearedActiveRunKeys.delete(pollKey);
    }
  }

  async function claimTerminalDelivery(session, runKey, record, trackTransportAttempts = false) {
    const pollKey = activeRunGuardKey(session.account.accountId, runKey);
    const runId = String(record?.runId ?? "").trim();
    if (!runId || clearedActiveRunKeys.has(pollKey)) return { shouldDeliver: false, shouldCleanup: false };
    clearActiveRunPoll(session.account.accountId, runKey);
    if (terminalDeliveryClaims.get(pollKey) === runId) {
      return { shouldDeliver: false, shouldCleanup: true };
    }
    if (String(record?.terminalDeliveryClaimedRunId ?? "").trim() === runId) {
      terminalDeliveryClaims.set(pollKey, runId);
      return {
        shouldDeliver: trackTransportAttempts && record?.terminalDeliveryAttemptedTransports === 0,
        shouldCleanup: true,
      };
    }
    try {
      const claimed = await writeActiveRunSafely(session.account.accountId, runKey, {
        status: "terminal_delivery_claimed",
        terminalDeliveryClaimedRunId: runId,
        terminalDeliveryClaimedAt: Date.now(),
        ...(trackTransportAttempts ? { terminalDeliveryAttemptedTransports: 0 } : {}),
      }, record, true);
      if (String(claimed?.terminalDeliveryClaimedRunId ?? "").trim() !== runId) {
        return { shouldDeliver: false, shouldCleanup: false };
      }
      terminalDeliveryClaims.set(pollKey, runId);
      return { shouldDeliver: true, shouldCleanup: true };
    } catch (error) {
      if (terminalDeliveryClaims.get(pollKey) === runId) terminalDeliveryClaims.delete(pollKey);
      clearedActiveRunKeys.delete(pollKey);
      appendLog({
        type: "error",
        text: `${platformType} terminal delivery claim persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
  }

  async function markTerminalDeliveryAttempted(session, runKey, record) {
    try {
      const updated = await writeActiveRunSafely(session.account.accountId, runKey, {
        terminalDeliveryAttemptedTransports: 1,
      }, record, true);
      if (updated?.terminalDeliveryAttemptedTransports !== 1) throw new Error("terminal delivery attempt marker lost its run");
      return updated;
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        retryTerminalDelivery: true,
        attemptedTransports: 0,
      });
    }
  }

  async function finalizeActiveRun(session, runKey, record) {
    const pollKey = activeRunGuardKey(session.account.accountId, runKey);
    const runId = String(record?.runId ?? "").trim();
    const reserved = reservationFor(session.account.accountId, runKey);
    const current = activeRunRecords.get(pollKey);
    if (
      (reserved && String(reserved?.runId ?? "").trim() !== runId)
      || (current && String(current?.runId ?? "").trim() !== runId)
    ) {
      return false;
    }
    clearActiveRunPoll(session.account.accountId, runKey);
    agentBusyNoticeAt.delete(pollKey);
    await deleteActiveRunSafely(session.account.accountId, runKey);
    if (terminalDeliveryClaims.get(pollKey) === runId) terminalDeliveryClaims.delete(pollKey);
    return true;
  }

  function scheduleActiveRunPoll(session, run, delayMs = ACTIVE_RUN_POLL_INTERVAL_MS) {
    if (session.controller?.signal.aborted || !run?.runKey || !run?.runId || !runtime?.getRun) return;
    const pollKey = activeRunGuardKey(session.account.accountId, run.runKey);
    if (clearedActiveRunKeys.has(pollKey)) return;
    if (activeRunInFlight.has(pollKey)) {
      const priorPending = activeRunPendingSchedules.get(pollKey);
      const normalizedDelay = Math.max(0, delayMs);
      if (!priorPending || normalizedDelay < priorPending.delayMs) {
        activeRunPendingSchedules.set(pollKey, { session, run, delayMs: normalizedDelay });
      }
      return;
    }
    const prior = activeRunPollers.get(pollKey);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      activeRunPollers.delete(pollKey);
      let task;
      task = pollActiveRun(session, run.runKey).catch((error) => {
        if (session.controller?.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({ lastError: message });
        appendLog({ type: "error", text: `${platformType} active run poll failed: ${message}` });
        const nowTs = Date.now();
        const lastNoticeAt = activeRunErrorNoticeAt.get(pollKey) ?? 0;
        if (!clearedActiveRunKeys.has(pollKey) && nowTs - lastNoticeAt >= 30_000) {
          activeRunErrorNoticeAt.set(pollKey, nowTs);
          void deliverReply(session, run.chatId, run.senderId, `任务状态查询失败：${message}`).catch(() => undefined);
        }
        if (clearedActiveRunKeys.has(pollKey)) return;
        scheduleActiveRunPoll(session, run, ACTIVE_RUN_POLL_INTERVAL_MS);
      }).finally(() => {
        activeRunPollTasks.delete(task);
        if (activeRunInFlight.get(pollKey) === task) activeRunInFlight.delete(pollKey);
        const pending = activeRunPendingSchedules.get(pollKey);
        activeRunPendingSchedules.delete(pollKey);
        if (pending && !clearedActiveRunKeys.has(pollKey)) {
          scheduleActiveRunPoll(pending.session, pending.run, pending.delayMs);
        }
      });
      activeRunPollTasks.add(task);
      activeRunInFlight.set(pollKey, task);
    }, Math.max(0, delayMs));
    activeRunPollers.set(pollKey, timer);
  }

  function clearActiveRunPoll(accountId, runKey) {
    const pollKey = activeRunGuardKey(accountId, runKey);
    clearedActiveRunKeys.add(pollKey);
    const prior = activeRunPollers.get(pollKey);
    if (prior) clearTimeout(prior);
    activeRunPollers.delete(pollKey);
    activeRunPendingSchedules.delete(pollKey);
    activeRunErrorNoticeAt.delete(pollKey);
  }

  async function pollActiveRun(session, runKey) {
    if (!session.controller || session.controller.signal.aborted) return;
    const pollKey = activeRunGuardKey(session.account.accountId, runKey);
    const record = await readActiveRunWithReservation(session.account.accountId, runKey);
    if (!record?.runId) return;
    if (clearedActiveRunKeys.has(pollKey)) return;
    const result = await runtime.getRun(
      { runId: record.runId, workspaceRoot: record.workspaceRoot },
      { eventLimit: 200, conversationMessageEventLimit: 200 },
    );
    if (session.controller.signal.aborted || clearedActiveRunKeys.has(pollKey)) return;
    activeRunErrorNoticeAt.delete(pollKey);
    // The runtime no longer tracks this run (process restarted, orphaned, or
    // already finalized as failed). Treat it as dead so the conversation lock
    // is released — otherwise getChannelRunSnapshotState maps a `null` snapshot
    // to "running" and the poll loops forever, locking the chat behind a
    // phantom task.
    if (!result) {
      const message = "本次本地 Agent 任务已不在运行（可能主进程重启/崩溃后遗留，或已超时中断）。已自动清除会话锁，可重新发送消息。";
      const claim = await claimTerminalDelivery(session, runKey, record);
      if (claim.shouldDeliver) await deliverReply(session, record.chatId, record.senderId, message).catch(() => undefined);
      if (claim.shouldCleanup) await finalizeActiveRun(session, runKey, record);
      return;
    }
    setState({ lastRunId: record.runId });
    const resultState = getChannelRunSnapshotState(result);
    if (resultState.isCompletedWithOutput) {
      const claim = await claimTerminalDelivery(session, runKey, record, true);
      if (!claim.shouldDeliver) {
        if (claim.shouldCleanup) await finalizeActiveRun(session, runKey, record);
        return;
      }
      const deliveredOutput = formatAgentResultOutput(result);
      let preserveForResume = false;
      try {
        const delivery = await deliverReply(
          session,
          record.chatId,
          record.senderId,
          formatAgentReply({ agent: record.agent, text: deliveredOutput }),
          { beforeFirstTransport: () => markTerminalDeliveryAttempted(session, runKey, record) },
        );
        if (delivery?.cancelled === true && delivery.attemptedTransports === 0) {
          preserveForResume = true;
          await releaseUnattemptedTerminalClaim(session, runKey, record);
          return;
        }
        if (delivery?.ok !== false) {
          await appendAgentHistory(session, record.historyKey, record.userText, deliveredOutput, record.agent, record.historyStoreLimit ?? session.options.historyStoreLimit);
          await appendChannelSessionHistoryById(record.channelSessionId, record.userText, deliveredOutput, record.agent);
        }
      } catch (error) {
        if (error?.retryTerminalDelivery === true) {
          preserveForResume = true;
          terminalDeliveryClaims.delete(pollKey);
          clearedActiveRunKeys.delete(pollKey);
        }
        throw error;
      } finally {
        // A transport may accept an earlier chunk before a later send/edit
        // fails. Claim and clear instead of replaying a completed snapshot.
        if (!preserveForResume) await finalizeActiveRun(session, runKey, record);
      }
      return;
    }
    if (resultState.isTerminal) {
      const message = resultState.status === "cancelled" ? "本次本地 Agent 任务已取消。" : `本次处理失败，请在 Studio 查看本地 Agent 日志。${result?.error ? `\n${result.error}` : ""}`;
      const claim = await claimTerminalDelivery(session, runKey, record);
      try {
        if (claim.shouldDeliver) await deliverReply(session, record.chatId, record.senderId, message);
      } finally {
        if (claim.shouldCleanup) await finalizeActiveRun(session, runKey, record);
      }
      return;
    }
    // Apply the backstop to every non-terminal state, including approval
    // waits, so a stale pending snapshot cannot hold the chat lock forever.
    if (Date.now() - (record.startedAt ?? 0) > ACTIVE_RUN_MAX_AGE_MS) {
      const message = `本次本地 Agent 任务运行已超过上限（约 ${Math.round(ACTIVE_RUN_MAX_AGE_MS / 3_600_000)} 小时），已自动超时并清除会话锁。可重新发送消息。`;
      const claim = await claimTerminalDelivery(session, runKey, record);
      if (claim.shouldDeliver) await deliverReply(session, record.chatId, record.senderId, message).catch(() => undefined);
      if (claim.shouldCleanup) await finalizeActiveRun(session, runKey, record);
      return;
    }
    const pendingApprovals = resultState.pendingApprovals;
    if (pendingApprovals.length && !record.pendingApprovalNotifiedAt) {
      if (clearedActiveRunKeys.has(pollKey)) return;
      const updated = await writeActiveRunSafely(session.account.accountId, runKey, {
        status: "pending_approval",
        pendingApprovalNotifiedAt: Date.now(),
        pendingApprovals,
      }, record);
      if (!updated || clearedActiveRunKeys.has(pollKey)) return;
      await deliverReply(session, record.chatId, record.senderId, renderApprovalPrompt(updated, pendingApprovals));
      scheduleActiveRunPoll(session, updated, ACTIVE_RUN_PENDING_POLL_INTERVAL_MS);
      return;
    }
    if (pendingApprovals.length) {
      if (clearedActiveRunKeys.has(pollKey)) return;
      const updated = await writeActiveRunSafely(session.account.accountId, runKey, { status: "pending_approval", pendingApprovals }, record);
      if (!updated || clearedActiveRunKeys.has(pollKey)) return;
      scheduleActiveRunPoll(session, updated, ACTIVE_RUN_PENDING_POLL_INTERVAL_MS);
      return;
    }
    if (resultState.isRunning) {
      if (clearedActiveRunKeys.has(pollKey)) return;
      const updated = await writeActiveRunSafely(session.account.accountId, runKey, { status: "running", pendingApprovals: [] }, record);
      if (!updated || clearedActiveRunKeys.has(pollKey)) return;
      scheduleActiveRunPoll(session, updated, ACTIVE_RUN_POLL_INTERVAL_MS);
      return;
    }
  }

  /**
   * Deliver a reply to an IM chat. When an edit-capable transport is available
   * (Telegram editMessageText / Discord message.edit), short adjacent chunks
   * may patch the current message. Once the accumulated body would cross the
   * platform limit, delivery rolls over to a new message instead.
   */
  async function deliverReply(session, chatId, peerId, text, { beforeFirstTransport = null } = {}) {
    const chunks = splitTextForPlatform(text, maxMessageLength);
    if (chunks.length === 0) return null;
    let messageId = null;
    let currentMessageText = "";
    let successfulSends = 0;
    let attemptedTransports = 0;

    function cancelledResult() {
      setState({ sentCount: state.sentCount + successfulSends });
      successfulSends = 0;
      return { ok: false, cancelled: true, attemptedTransports, error: "channel stopped" };
    }

    function failureResult(action, result) {
      const error = result?.error ?? "unknown error";
      const message = `reply ${action} failed: ${error}`;
      setState({
        lastError: message,
        sentCount: state.sentCount + successfulSends,
      });
      successfulSends = 0;
      appendLog({ type: "error", text: `${platformType} ${message}` });
      return { ok: false, error: message };
    }

    for (let index = 0; index < chunks.length; index += 1) {
      if (session.controller?.signal.aborted) return cancelledResult();
      const chunk = chunks[index];
      const editedText = currentMessageText ? `${currentMessageText}\n${chunk}` : chunk;
      const canEditCurrent = Boolean(editMessageTo && messageId && editedText.length <= maxMessageLength);
      if (attemptedTransports === 0 && beforeFirstTransport) await beforeFirstTransport();
      if (session.controller?.signal.aborted) return cancelledResult();
      if (canEditCurrent) {
        attemptedTransports += 1;
        const edited = await editMessageTo(chatId, messageId, editedText)
          .catch((error) => ({ ok: false, error: error?.message ?? String(error) }));
        if (edited?.ok === false) return failureResult("edit", edited);
        currentMessageText = editedText;
      } else {
        attemptedTransports += 1;
        const sent = await sendTextTo(chatId, chunk, peerId)
          .catch((error) => ({ ok: false, error: error?.message ?? String(error) }));
        if (sent?.ok === false) return failureResult("send", sent);
        successfulSends += 1;
        messageId = sent?.messageId ?? null;
        currentMessageText = chunk;
      }
      if (session.controller?.signal.aborted) return cancelledResult();
      if (index < chunks.length - 1) {
        await sleep(sendChunkDelayMs);
        if (session.controller?.signal.aborted) return cancelledResult();
      }
    }
    setState({ sentCount: state.sentCount + successfulSends });
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
      const pairingMessage = `${platformType} pairing request returned no code for ${input.platformUserId}`;
      appendLog({ type: "warn", text: pairingMessage });
      setState({ lastError: pairingMessage });
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
    // A test-only timestamp is not a valid idempotency key for Task mutations.
    // Preserve a missing messageId for explicit Task commands so the adapter's
    // production fail-closed rule is exercised by simulation as well.
    const simulatedInput = messagingTaskAdapter.canRoute(input.text) && input.messageId == null
      ? { ...input, messageId: "" }
      : input;
    const raw = buildSimulatedInbound
      ? buildSimulatedInbound(simulatedInput, account)
      : { senderId: simulatedInput.fromUserId ?? simulatedInput.senderId ?? "studio-test-user", messageId: simulatedInput.messageId ?? `sim-${Date.now()}`, chatId: simulatedInput.chatId ?? "studio-test-chat", chatType: simulatedInput.chatType ?? "dm", text: String(simulatedInput.text ?? "ping"), raw: null };
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
      const cause = error?.cause;
      const detail = cause?.code || (cause?.hostname ? `host ${cause.hostname}` : (cause?.message ?? ""));
      const message = [error?.message, detail].filter(Boolean).join(" — ");
      return { ok: false, error: message || String(error) };
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
    const modelCommand = parseModelSwitchCommand(event.text);
    if (modelCommand) {
      const boundAgent = await currentAgentForChat(platformType, session, event.chatId);
      // If the bound agent snapshot was persisted without modelOptions (older
      // service configs, or a UI that didn't forward them), refresh live from
      // the runtime so `#model` sees the same choices the local chat UI does.
      const enrichedAgent = await enrichAgentModelOptions(runtime, session, boundAgent).catch(() => boundAgent);
      const currentModel = await currentModelForChat(session, event.chatId);
      const rawTarget = modelCommand.target;
      if (!rawTarget) {
        await deliverReply(session, event.chatId, event.senderId, renderModelHelp(platformName, enrichedAgent, currentModel)).catch((error) => {
          appendLog({ type: "error", text: `${platformType} model-switch help send failed: ${error?.message ?? error}` });
        });
        return true;
      }
      const lowered = rawTarget.toLowerCase();
      if (lowered === "default" || lowered === "reset" || lowered === "清除" || lowered === "重置") {
        session.options.modelByChat.set(event.chatId, "");
        await store.writeChatSetting(session.account.accountId, event.chatId, { model: "" }).catch((error) => {
          appendLog({ type: "error", text: `${platformType} model-switch: writeChatSetting failed: ${error?.message ?? error}` });
        });
        await deliverReply(session, event.chatId, event.senderId, `已恢复当前${platformName}会话的默认模型（${agentLabel(enrichedAgent)}）。`).catch(() => undefined);
        return true;
      }
      const resolved = resolveAgentModelId(enrichedAgent, rawTarget);
      if (!resolved) {
        await deliverReply(session, event.chatId, event.senderId, `未在当前 Agent 的模型列表中找到：${rawTarget}\n\n${renderModelHelp(platformName, enrichedAgent, currentModel)}`).catch(() => undefined);
        return true;
      }
      session.options.modelByChat.set(event.chatId, resolved);
      await store.writeChatSetting(session.account.accountId, event.chatId, { model: resolved }).catch((error) => {
        appendLog({ type: "error", text: `${platformType} model-switch: writeChatSetting failed: ${error?.message ?? error}` });
      });
      await deliverReply(session, event.chatId, event.senderId, `已切换当前${platformName}会话的模型：${resolved}`).catch(() => undefined);
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
      if (priorRunKey) priorRun = await readActiveRunWithReservation(session.account.accountId, priorRunKey);
    } catch { /* noop */ }
    const suffix = priorRun?.runId ? `\n上一个任务（${priorAgent ? agentLabel(priorAgent) : "旧 Agent"}）仍在运行，其结果会异步返回；新消息将由新 Agent 处理。` : "";
    await deliverReply(session, event.chatId, event.senderId, `已切换当前${platformName}会话的回复 Agent：${agentLabel(nextAgent)}${suffix}`).catch((error) => {
      appendLog({ type: "error", text: `${platformType} agent-switch ack send failed: ${error?.message ?? error}` });
    });
    return true;
  }

  async function handleRunCommand(session, event, command) {
    if (command.name === "runs") {
      const runs = await listActiveRunsSafely(session.account.accountId);
      await deliverReply(session, event.chatId, event.senderId, renderRunsList(platformName, runs));
      return;
    }
    const agent = await currentAgentForChat(platformType, session, event.chatId);
    const runKey = activeRunKey(event.chatId, agent);
    const run = await readActiveRunWithReservation(session.account.accountId, runKey);
    if (command.name === "new") {
      if (run) {
        const message = run.runId
          ? `当前${platformName}会话和 Agent 还有运行中的任务。请等待完成，或先发送 #cancel 后再开启新会话。`
          : `当前${platformName}会话和 Agent 的任务正在启动。请稍后再发送 #cancel 或 #new。`;
        await deliverReply(session, event.chatId, event.senderId, message);
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
      if (run && !run.runId) {
        await deliverReply(session, event.chatId, event.senderId, `当前${platformName}会话和 Agent 的任务正在启动，暂时无法取消。请稍后重试 #cancel。`);
        return;
      }
      if (!run) {
        await deliverReply(session, event.chatId, event.senderId, `当前${platformName}会话和 Agent 没有可取消的任务。`);
        return;
      }
      clearActiveRunPoll(session.account.accountId, runKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      // Establish the local cancellation tombstone before awaiting the
      // provider. A completed poll may already be waiting on its durable
      // terminal claim; bumping the generation here makes that late claim lose
      // ownership, even when cancelRun itself is slow.
      const deleteTask = deleteActiveRunSafely(session.account.accountId, runKey);
      const cancelTask = typeof runtime?.cancelRun === "function"
        ? Promise.resolve().then(() => runtime.cancelRun(run.runId, { reason: platformType })).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        : Promise.resolve({ ok: false, error: "runtime cancel is unavailable" });
      const [deleted, cancelled] = await Promise.all([deleteTask, cancelTask]);
      const cleanupSuffix = deleted === false ? "（持久记录清理将在重启后重试）" : "";
      await deliverReply(session, event.chatId, event.senderId, cancelled?.ok === false ? `已清理${platformName}侧任务记录，但本地取消失败：${cancelled.error ?? "unknown error"}${cleanupSuffix}` : `已取消当前${platformName}会话的本地 Agent 任务。${cleanupSuffix}`);
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
      const updated = await writeActiveRunSafely(session.account.accountId, run.runKey, {
        status: remaining.length ? "pending_approval" : "running",
        pendingApprovals: remaining,
        pendingApprovalNotifiedAt: remaining.length ? run.pendingApprovalNotifiedAt : null,
      }, run);
      if (updated) scheduleActiveRunPoll(session, updated, 0);
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
    const runs = await listActiveRunsSafely(session.account.accountId);
    return runs
      .filter((run) => String(run.chatId ?? "") === String(chatId ?? ""))
      .filter((run) => Array.isArray(run.pendingApprovals) && run.pendingApprovals.length > 0)
      .sort((a, b) => Number(a.startedAt ?? a.createdAt ?? 0) - Number(b.startedAt ?? a.createdAt ?? 0));
  }

  async function probeTransportHook() {
    return { ok: true };
  }

  async function sendTaskDelivery(input = {}) {
    const accountId = String(input.accountId ?? "").trim();
    const chatId = String(input.chatId ?? "").trim();
    const text = String(input.text ?? "").trim();
    if (!active || state.status !== "running") return { ok: false, error: `${platformName} is not running` };
    if (accountId && accountId !== String(active.account?.accountId ?? state.accountId)) return { ok: false, error: `${platformName} account is not active` };
    if (!chatId || !text) return { ok: false, error: "chatId and text are required" };
    return sendTextTo(chatId, text);
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
    sendTaskDelivery,
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
    modelByChat: new Map(),
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
  if (!byId.has(ONMYAGENT_ASSISTANT_AGENT_ID)) {
    byId.set(ONMYAGENT_ASSISTANT_AGENT_ID, createOnMyAgentAssistantAgent());
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

async function currentModelForChat(session, chatId) {
  const memory = session.options.modelByChat.get(chatId);
  if (memory !== undefined) return memory;
  const setting = await storeSafeReadChatSetting(session, chatId);
  const stored = typeof setting?.model === "string" ? setting.model.trim() : "";
  session.options.modelByChat.set(chatId, stored);
  return stored;
}

async function enrichAgentModelOptions(runtime, session, agent) {
  if (!agent) return agent;
  const existing = agentModelOptionsFor(agent);
  if (existing.length > 0) return agent;
  if (!runtime || typeof runtime.listAgents !== "function") return agent;
  try {
    const workspaceRoot = session?.options?.workspaceRoot ?? "";
    const listed = await runtime.listAgents({ workspaceRoot, includeModels: true });
    const list = Array.isArray(listed?.agents) ? listed.agents : [];
    const match = list.find((item) => item?.id === agent.id)
      || list.find((item) => item?.provider === agent.provider);
    if (!match) return agent;
    const options = Array.isArray(match.modelOptions) ? match.modelOptions : [];
    const defaultModel = typeof match.defaultModel === "string" ? match.defaultModel : agent.defaultModel;
    return { ...agent, modelOptions: options, defaultModel };
  } catch {
    return agent;
  }
}

function agentModelOptionsFor(agent) {
  if (!agent) return [];
  const options = Array.isArray(agent.modelOptions) ? agent.modelOptions : [];
  return options
    .map((option) => {
      if (option && typeof option === "object") {
        const id = String(option.id ?? option.value ?? option.name ?? "").trim();
        if (!id) return null;
        const label = String(option.label ?? option.name ?? id).trim() || id;
        return { id, label };
      }
      const id = String(option ?? "").trim();
      return id ? { id, label: id } : null;
    })
    .filter(Boolean);
}

function resolveAgentModelId(agent, target) {
  const raw = String(target ?? "").trim();
  if (!raw) return null;
  const options = agentModelOptionsFor(agent);
  const exact = options.find((option) => option.id === raw);
  if (exact) return exact.id;
  const lower = raw.toLowerCase();
  const ci = options.find((option) => option.id.toLowerCase() === lower || option.label.toLowerCase() === lower);
  if (ci) return ci.id;
  // Refuse arbitrary model ids when the advertised list is empty. Accepting
  // any string here (the old behavior) let an unverifiable value get persisted
  // as the chat's current model during the window when a custom ACP agent's
  // handshake hadn't been hydrated yet (e.g. WeChat before the global handshake
  // cache landed), leaving a permanently invalid "使用模型: <garbage>" label.
  // When the list is genuinely empty the caller should surface "model list not
  // loaded yet" instead of silently storing an unverifiable id.
  return null;
}

function renderModelHelp(platformName, agent, currentModel) {
  const label = agent ? agentLabel(agent) : "unknown";
  const options = agentModelOptionsFor(agent);
  const current = currentModel ? currentModel : (agent?.defaultModel || agent?.model || "");
  const header = current
    ? `当前 ${label} 使用模型：${current}`
    : `当前 ${label} 使用默认模型`;
  if (options.length === 0) {
    return [
      header,
      "该 Agent 未提供可选模型列表。可尝试发送 #model <模型名> 手动切换；发送 #model default 恢复默认。",
    ].join("\n");
  }
  const currentInvalid = current && !options.some((option) => option.id === current);
  const warn = currentInvalid
    ? [`⚠️ 当前模型「${current}」不在上方可选列表中（可能是历史残留值），发送 #model <id> 切换到下列有效模型之一。`, ""]
    : [];
  return [
    header,
    ...warn,
    "可用模型：",
    ...options.map((option) => `- ${option.id}${option.label && option.label !== option.id ? ` (${option.label})` : ""}`),
    "",
    `发送 #model <id> 切换当前${platformName}会话的模型；发送 #model default 恢复默认。`,
  ].join("\n");
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

function parseModelSwitchCommand(text) {
  const raw = String(text ?? "").trim();
  const match = raw.match(/^(?:#model|\/model|切换模型)(?:\s+(.+))?$/i);
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
    "发送 #agent <id> 切换，例如：#agent codex 或 #agent onmyagent（连接本地助理）",
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
  normalizeAvailableAgents,
  parseAgentSwitchCommand,
  parseModeCommand,
  parseModelSwitchCommand,
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
  createOnMyAgentAssistantAgent,
  ONMYAGENT_ASSISTANT_AGENT_ID,
  ONMYAGENT_ASSISTANT_PROVIDER,
};
