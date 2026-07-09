import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { createIlinkClient, ILINK_BASE_URL, LONG_POLL_TIMEOUT_MS, TYPING_START, TYPING_STOP } from "./ilink-client.mjs";
import { createQrSvgDataUrl, getChannelRunSnapshotState } from "./local-qr.mjs";
import { downloadAndDecryptMedia, mediaReference, mediaUrlFromReference } from "./media.mjs";
import { createWeixinStore, sanitizeAccount } from "./store.mjs";
import { normalizePersonalLocalAgent } from "../personal-agent-runtime/provider-registry.mjs";
import { formatAgentReply } from "../channels/AgentReplyHeader.mjs";

const SESSION_EXPIRED_ERRCODE = -14;
const RATE_LIMIT_ERRCODE = -2;
const RETRY_DELAY_SECONDS = 2;
const BACKOFF_DELAY_SECONDS = 30;
const MESSAGE_DEDUP_TTL_MS = 5 * 60_000;
const DEFAULT_TEXT_BATCH_DELAY_MS = 3_000;
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".onmyagent", "weixin-workspace");
const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_HISTORY_STORE_LIMIT = 24;
const ACTIVE_RUN_POLL_INTERVAL_MS = 1_000;
const ACTIVE_RUN_PENDING_POLL_INTERVAL_MS = 3_000;
// Minimum spacing between "agent still busy" replies for the same chat+agent,
// so quickly re-sending messages does not flood the IM chat with duplicates.
const AGENT_BUSY_NOTICE_INTERVAL_MS = 15_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeId(value, keep = 8) {
  const raw = String(value ?? "").trim();
  if (!raw) return "?";
  return raw.length <= keep ? raw : raw.slice(0, keep);
}

function isStaleSessionRet(ret, errcode, errmsg) {
  if (ret !== RATE_LIMIT_ERRCODE && errcode !== RATE_LIMIT_ERRCODE) return false;
  return String(errmsg ?? "").toLowerCase() === "unknown error";
}

function createQrImageDataUrl(scanData) {
  const cleanData = String(scanData ?? "").trim();
  if (!cleanData) return { dataUrl: "", error: "missing QR scan data" };
  if (cleanData.startsWith("data:image/")) return { dataUrl: cleanData, error: null };
  try {
    return { dataUrl: createQrSvgDataUrl(cleanData), error: null };
  } catch (error) {
    return { dataUrl: "", error: error instanceof Error ? error.message : String(error) };
  }
}

function extractText(itemList = []) {
  for (const item of itemList) {
    if (item?.type === 1) {
      const text = String(item?.text_item?.text ?? "");
      const refItem = item?.ref_msg?.message_item;
      if (refItem?.type) {
        const refText = extractText([refItem]);
        const title = item?.ref_msg?.title ? String(item.ref_msg.title) : "";
        if (refText || title) return `[引用: ${[title, refText].filter(Boolean).join(" | ")}]\n${text}`.trim();
      }
      return text;
    }
  }
  for (const item of itemList) {
    if (item?.type === 3) {
      const voiceText = String(item?.voice_item?.text ?? "");
      if (voiceText) return voiceText;
    }
  }
  return "";
}

function guessChatType(message, accountId) {
  const roomId = String(message?.room_id ?? message?.chat_room_id ?? "").trim();
  const toUserId = String(message?.to_user_id ?? "").trim();
  const isGroup = Boolean(roomId) || (toUserId && accountId && toUserId !== accountId && message?.msg_type === 1);
  if (isGroup) return { chatType: "group", chatId: roomId || toUserId || String(message?.from_user_id ?? "") };
  return { chatType: "dm", chatId: String(message?.from_user_id ?? "") };
}

function splitTextForWeixin(text, maxLength = 2000) {
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

export function createWeixinService(options = {}) {
  const userDataDir = String(options.userDataDir ?? "").trim();
  if (!options.store && !userDataDir) throw new Error("userDataDir is required for Weixin service storage");
  const store = options.store ?? createWeixinStore(userDataDir);
  const client = options.client ?? createIlinkClient({ fetchFn: options.fetchFn });
  const runtime = options.personalAgentRuntime;
  const mediaCacheDir = options.mediaCacheDir ?? path.join(userDataDir, "weixin", "media-cache");
  const mediaFetchFn = options.mediaFetchFn ?? options.fetchFn ?? globalThis.fetch;
  const appendLog = typeof options.appendLog === "function" ? options.appendLog : () => undefined;
  const channelPairingService = options.channelPairingService ?? null;
  const channelSessionStore = options.channelSessionStore ?? null;
  const channelEventBus = options.channelEventBus ?? null;
  const channelAssistantBindingStore = options.channelAssistantBindingStore ?? null;
  const dedup = new TtlSet(MESSAGE_DEDUP_TTL_MS);
  const pendingBatches = new Map();
  const agentBusyNoticeAt = new Map(); // busyKey -> lastNoticeAt (ms)
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
  };
  let active = null;

  function snapshot(extra = {}) {
    // Return the enriched status as a single object literal so the three
    // derived fields (hasToken / activeUsers / botUsername) are part of the
    // inferred return type and the desktop typecheck stays green.
    return {
      ...state,
      ...extra,
      hasToken: Boolean(state.accountId),
      activeUsers: channelPairingService
        ? channelPairingService.getAuthorizedUsers().filter((u) => u.platformType === "wechat").length
        : 0,
      botUsername: state.accountId || undefined,
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
    const options = runtimeOptions(input);
    await store.writeConfig({
      autoStart: input.autoStart !== false,
      defaultAccountId: String(input.accountId ?? input.account_id ?? "").trim(),
      lastStartOptions: {
        workspaceRoot: options.workspaceRoot,
        accessibleWorkspaceRoots: options.accessibleWorkspaceRoots,
        agent: options.agent,
        availableAgents: options.availableAgents,
        approvalMode: options.approvalMode,
        dmPolicy: options.dmPolicy,
        allowedUsers: options.allowedUsers,
        groupPolicy: options.groupPolicy,
        allowedGroups: options.allowedGroups,
        textBatchDelayMs: options.textBatchDelayMs,
        sendChunkDelayMs: options.sendChunkDelayMs,
        timeoutMs: options.timeoutMs,
        promptMode: options.promptMode,
        historyLimit: options.historyLimit,
        historyStoreLimit: options.historyStoreLimit,
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
    if (!account?.token) return { ok: false, error: "Weixin account is not configured" };
    const controller = new AbortController();
    active = { controller, account, store, options: runtimeOptions(input), task: null };
    setState({ status: "running", accountId, workspaceRoot: active.options.workspaceRoot, accessibleWorkspaceRoots: active.options.accessibleWorkspaceRoots, startedAt: Date.now(), lastError: null, activeAgentId: active.options.agent.id, approvalMode: active.options.approvalMode });
    await persistServiceConfig({ ...input, accountId, autoStart: input.autoStart ?? true });
    active.task = pollLoop(active).catch((error) => {
      if (!controller.signal.aborted) {
        setState({ status: "error", lastError: error?.message ?? String(error) });
      }
    });
    await resumeActiveRuns(active);
    subscribeStudioRelay();
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
    setState({ status: "stopped" });
    return { ok: true, status: snapshot() };
  }

  async function pollLoop(session) {
    let syncBuf = await store.readSyncBuf(session.account.accountId);
    let timeoutMs = LONG_POLL_TIMEOUT_MS;
    let failures = 0;
    while (!session.controller.signal.aborted) {
      try {
        const response = await client.getUpdates({
          baseUrl: session.account.baseUrl,
          token: session.account.token,
          syncBuf,
          timeoutMs,
        });
        setState({ lastPollAt: Date.now(), lastError: null });
        if (Number.isInteger(response?.longpolling_timeout_ms) && response.longpolling_timeout_ms > 0) {
          timeoutMs = response.longpolling_timeout_ms;
        }
        const ret = response?.ret ?? 0;
        const errcode = response?.errcode ?? 0;
        if (ret !== 0 || errcode !== 0) {
          if (ret === SESSION_EXPIRED_ERRCODE || errcode === SESSION_EXPIRED_ERRCODE || isStaleSessionRet(ret, errcode, response?.errmsg)) {
            setState({ status: "needs_login", lastError: "Weixin iLink session expired" });
            return;
          }
          failures += 1;
          await sleep((failures >= 3 ? BACKOFF_DELAY_SECONDS : RETRY_DELAY_SECONDS) * 1000);
          if (failures >= 3) failures = 0;
          continue;
        }
        failures = 0;
        const nextSync = String(response?.get_updates_buf ?? "");
        if (nextSync) {
          syncBuf = nextSync;
          await store.writeSyncBuf(session.account.accountId, syncBuf);
        }
        for (const message of response?.msgs ?? []) {
          void processMessage(session, message).catch((error) => {
            appendLog({ type: "error", text: `weixin inbound failed: ${error.message}` });
            setState({ lastError: error.message });
          });
        }
      } catch (error) {
        if (session.controller.signal.aborted) return;
        failures += 1;
        setState({ status: "backoff", lastError: error?.message ?? String(error) });
        await sleep((failures >= 3 ? BACKOFF_DELAY_SECONDS : RETRY_DELAY_SECONDS) * 1000);
        if (active === session && !session.controller.signal.aborted) setState({ status: "running" });
        if (failures >= 3) failures = 0;
      }
    }
  }

  async function processMessage(session, message) {
    const senderId = String(message?.from_user_id ?? "").trim();
    if (!senderId || senderId === session.account.accountId) return null;
    const messageId = String(message?.message_id ?? "").trim();
    if (messageId && dedup.hasOrAdd(`id:${messageId}`)) return null;
    const itemList = Array.isArray(message?.item_list) ? message.item_list : [];
    const text = extractText(itemList).trim();
    if (!text) return null;
    const contentKey = `content:${senderId}:${text}`;
    if (dedup.hasOrAdd(contentKey)) return null;
    const chat = guessChatType(message, session.account.accountId);
    if (!isAllowed(session.options, chat, senderId)) {
      appendLog({ type: "warn", text: `weixin inbound dropped (policy): sender=${senderId} chatType=${chat.chatType}` });
      return null;
    }
    if (!(await ensureChannelUserAuthorized(session, { platformType: "wechat", platformUserId: senderId, chatId: chat.chatId, displayName: senderId }))) {
      appendLog({ type: "warn", text: `weixin inbound dropped (unauthorized): sender=${senderId} chatId=${chat.chatId}` });
      return null;
    }
    const contextToken = String(message?.context_token ?? "").trim();
    if (contextToken) await store.writeContextToken(session.account.accountId, senderId, contextToken);
    const mediaFiles = await collectMediaFiles(session, itemList);
    const event = { accountId: session.account.accountId, senderId, messageId, text, mediaFiles, raw: message, ...chat };
    setState({ lastMessageAt: Date.now(), processedCount: state.processedCount + 1 });
    if (await maybeHandleControlCommand(session, event)) return event;
    void enqueueText(session, event).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setState({ lastError: message });
      appendLog({ type: "error", text: `weixin enqueue failed: ${message}` });
      void sendText(session, event.chatId, `处理失败：${message}`, event.senderId).catch(() => undefined);
    });
    return event;
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
      const promptMode = await currentPromptModeForChat(session, event.chatId);
      const historyKey = chatAgentHistoryKey(event.chatId, agent);
      const runKey = activeRunKey(event.chatId, agent);
      const existingRun = await store.readActiveRun(session.account.accountId, runKey).catch(() => null);
      if (existingRun?.runId) {
        // Same chat + same agent is already busy. Nudge the poller, then
        // reply with a short busy notice so the user knows the message
        // is not being dropped. Rate-limit so a burst of user messages
        // does not spam the chat.
        scheduleActiveRunPoll(session, existingRun, 0);
        const busyKey = `${session.account.accountId}:${runKey}`;
        const nowTs = Date.now();
        const lastAt = agentBusyNoticeAt.get(busyKey) ?? 0;
        if (nowTs - lastAt >= AGENT_BUSY_NOTICE_INTERVAL_MS) {
          agentBusyNoticeAt.set(busyKey, nowTs);
          await sendText(session, event.chatId, `${agentLabel(agent)} 还在处理上一条消息，请稍后再试。发送 #status 查看进度，或 #cancel 取消后再重发。`, event.senderId).catch(() => undefined);
        }
        return existingRun;
      }
      const runtimeAgent = scopedWeixinRuntimeAgent(agent, event);
      const channelSession = await getChannelSession(session, event, agent);
      const history = await store.readChatHistory(session.account.accountId, historyKey, session.options.historyLimit).catch(() => []);
      const prompt = buildPrompt(event, { mode: promptMode, history, agent });
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
    } finally {
      await maybeSendTyping(session, event.chatId, TYPING_STOP);
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
    await sendText(session, event.chatId, formatAgentReply({ agent, text: result.output }), event.senderId);
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
        void sendText(session, run.chatId, `任务状态查询失败：${message}`, run.senderId).catch(() => undefined);
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
    if (session.controller.signal.aborted) return;
    const pollKey = activeRunGuardKey(session.account.accountId, runKey);
    const record = await store.readActiveRun(session.account.accountId, runKey).catch(() => null);
    if (!record?.runId) return;
    if (clearedActiveRunKeys.has(pollKey)) return;
    const result = await runtime.getRun({ runId: record.runId, workspaceRoot: record.workspaceRoot });
    if (clearedActiveRunKeys.has(pollKey)) return;
    setState({ lastRunId: record.runId });
    const resultState = getChannelRunSnapshotState(result);
    if (resultState.isCompletedWithOutput) {
      await sendText(session, record.chatId, formatAgentReply({ agent: record.agent, text: result.output }), record.senderId);
      await appendAgentHistory(session, record.historyKey, record.userText, result.output, record.agent, record.historyStoreLimit ?? session.options.historyStoreLimit);
      await appendChannelSessionHistoryById(record.channelSessionId, record.userText, result.output, record.agent);
      clearActiveRunPoll(session.account.accountId, runKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await store.deleteActiveRun(session.account.accountId, runKey);
      return;
    }
    if (resultState.isTerminal) {
      const message = resultState.status === "cancelled"
        ? "本次本地 Agent 任务已取消。"
        : `本次处理失败，请在 Studio 查看本地 Agent 日志。${result?.error ? `\n${result.error}` : ""}`;
      await sendText(session, record.chatId, message, record.senderId);
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
      await sendText(session, record.chatId, renderApprovalPrompt(updated, pendingApprovals), record.senderId);
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

  async function sendText(session, chatId, text, peerId = chatId) {
    const contextToken = await store.readContextToken(session.account.accountId, peerId || chatId);
    const chunks = splitTextForWeixin(text);
    let lastResponse = null;
    for (let index = 0; index < chunks.length; index += 1) {
      lastResponse = await client.sendMessage({
        baseUrl: session.account.baseUrl,
        token: session.account.token,
        to: chatId,
        text: chunks[index],
        contextToken,
        clientId: `studio-weixin-${randomUUID()}`,
      });
      assertIlinkOk(lastResponse, "sendmessage");
      if (index < chunks.length - 1) await sleep(session.options.sendChunkDelayMs);
    }
    setState({ sentCount: state.sentCount + chunks.length });
    return lastResponse;
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

  async function collectMediaFiles(session, itemList) {
    const files = [];
    for (const item of itemList) {
      const direct = await collectMediaFile(session, item).catch((error) => {
        appendLog({ type: "error", text: `weixin media download failed: ${error.message}` });
        return null;
      });
      if (direct) files.push(direct);
      const refItem = item?.ref_msg?.message_item;
      if (refItem) {
        const ref = await collectMediaFile(session, refItem).catch(() => null);
        if (ref) files.push(ref);
      }
    }
    return files;
  }

  async function collectMediaFile(session, item) {
    if (item?.type === 1) return null;
    if (item?.type === 3 && item?.voice_item?.text) return null;
    const descriptor = mediaDescriptorForItem(session, item);
    if (!descriptor) return null;
    const outputPath = await downloadAndDecryptMedia({
      fetchFn: mediaFetchFn,
      url: descriptor.url,
      aesKey: descriptor.aesKey,
      outputDir: mediaCacheDir,
      filename: descriptor.filename,
    });
    return { path: outputPath, mimeType: descriptor.mimeType, kind: descriptor.kind };
  }

  function mediaDescriptorForItem(session, item) {
    if (item?.type === 2) {
      const media = mediaReference(item, "image_item");
      const aeskeyHex = String(item?.image_item?.aeskey ?? "").trim();
      return {
        kind: "image",
        mimeType: "image/jpeg",
        filename: `weixin-image-${Date.now()}.jpg`,
        url: mediaUrlFromReference({ cdnBaseUrl: session.account.cdnBaseUrl, media }),
        aesKey: aeskeyHex ? Buffer.from(aeskeyHex, "hex").toString("base64") : media?.aes_key,
      };
    }
    if (item?.type === 4) {
      const fileItem = item?.file_item ?? {};
      const filename = String(fileItem.file_name ?? `weixin-file-${Date.now()}.bin`);
      const media = fileItem.media ?? {};
      return {
        kind: "file",
        mimeType: mimeFromFilename(filename),
        filename,
        url: mediaUrlFromReference({ cdnBaseUrl: session.account.cdnBaseUrl, media }),
        aesKey: media?.aes_key,
      };
    }
    if (item?.type === 5) {
      const media = mediaReference(item, "video_item");
      return {
        kind: "video",
        mimeType: "video/mp4",
        filename: `weixin-video-${Date.now()}.mp4`,
        url: mediaUrlFromReference({ cdnBaseUrl: session.account.cdnBaseUrl, media }),
        aesKey: media?.aes_key,
      };
    }
    if (item?.type === 3) {
      const media = mediaReference(item, "voice_item");
      return {
        kind: "voice",
        mimeType: "audio/silk",
        filename: `weixin-voice-${Date.now()}.silk`,
        url: mediaUrlFromReference({ cdnBaseUrl: session.account.cdnBaseUrl, media }),
        aesKey: media?.aes_key,
      };
    }
    return null;
  }

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

  async function loginStart(input = {}) {
    const response = await client.getBotQr({ botType: input.botType ?? "3", baseUrl: input.baseUrl ?? ILINK_BASE_URL });
    const qrcode = String(response?.qrcode ?? "");
    const qrcodeUrl = String(response?.qrcode_img_content ?? "");
    const imageResult = createQrImageDataUrl(qrcodeUrl || qrcode);
    return {
      ok: true,
      qrcode,
      qrcodeUrl,
      qrcodeImageDataUrl: imageResult.dataUrl,
      qrcodeImageError: imageResult.error ?? null,
      rawStatus: response?.status ?? null,
    };
  }

  async function loginPoll(input = {}) {
    const pollBaseUrl = input.baseUrl ?? ILINK_BASE_URL;
    const response = await client.getQrStatus({ qrcode: input.qrcode, baseUrl: pollBaseUrl });
    const status = String(response?.status ?? "wait");
    const redirectHost = String(response?.redirect_host ?? "").trim();
    const nextBaseUrl = redirectHost ? `https://${redirectHost}` : null;
    if (status !== "confirmed") {
      return {
        ok: true,
        status,
        redirectHost: redirectHost || null,
        baseUrl: nextBaseUrl,
        pollBaseUrl,
        ret: response?.ret ?? null,
        errcode: response?.errcode ?? null,
        errmsg: response?.errmsg ?? response?.message ?? null,
      };
    }
    const account = await store.saveAccount({
      accountId: response?.ilink_bot_id,
      token: response?.bot_token,
      baseUrl: response?.baseurl ?? ILINK_BASE_URL,
      userId: response?.ilink_user_id,
    });
    // Persist the account switch immediately so the new account becomes the
    // default even if the auto start below fails. Without this, a failure in
    // `start` would leave the service running the previously configured
    // (often stale) account while the UI believed the scan succeeded.
    await persistServiceConfig({ ...input, accountId: account.accountId, autoStart: input.autoStart !== false });
    let autoStartResult;
    try {
      autoStartResult = await start({ ...input, accountId: account.accountId, autoStart: true });
    } catch (error) {
      autoStartResult = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      ok: true,
      status,
      account,
      baseUrl: account.baseUrl,
      pollBaseUrl,
      autoStart: autoStartResult,
      autoStartOk: autoStartResult?.ok !== false,
      ret: response?.ret ?? null,
      errcode: response?.errcode ?? null,
      errmsg: response?.errmsg ?? response?.message ?? null,
    };
  }

  async function saveAccount(input = {}) {
    const account = await store.saveAccount(input);
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
    // Prefer the most recently scanned account over the persisted
    // defaultAccountId. A stale default (e.g. from a previous device/session)
    // can keep the service polling an expired bot while a freshly scanned
    // account sits unused.
    const configured = await store.loadDefaultAccount();
    const latest = (await store.listAccounts())[0];
    const account = latest && latest.savedAt && configured?.savedAt && Date.parse(latest.savedAt) >= Date.parse(configured.savedAt) ? latest : configured;
    if (!account?.token) return { ok: false, skipped: true, reason: "no saved Weixin account", status: snapshot() };
    return start({ ...config.lastStartOptions, ...input, accountId: account.accountId, autoStart: true });
  }

  async function simulateInbound(input = {}) {
    const accountId = String(input.accountId ?? state.accountId ?? "").trim();
    const account = active?.account?.accountId === accountId ? active.account : await store.loadAccount(accountId);
    if (!account) return { ok: false, error: "Weixin account is not configured" };
    const session = active?.account?.accountId === account.accountId
      ? active
      : { account, store, options: runtimeOptions(input), controller: new AbortController() };
    const event = await processMessage(session, {
      from_user_id: input.fromUserId ?? input.senderId ?? "studio-test-user",
      to_user_id: account.accountId,
      message_id: input.messageId ?? `sim-${Date.now()}`,
      context_token: input.contextToken ?? "",
      item_list: [{ type: 1, text_item: { text: String(input.text ?? "ping") } }],
    });
    return { ok: true, event, status: snapshot() };
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
        await sendText(session, event.chatId, renderModeHelp(session, event.chatId), event.senderId);
        return true;
      }
      const nextMode = normalizePromptMode(modeCommand.target);
      if (nextMode !== modeCommand.target.trim().toLowerCase()) {
        await sendText(session, event.chatId, `未知微信转发模式：${modeCommand.target}\n\n${renderModeHelp(session, event.chatId)}`, event.senderId);
        return true;
      }
      session.options.promptModeByChat.set(event.chatId, nextMode);
      await store.writeChatSetting(session.account.accountId, event.chatId, { promptMode: nextMode });
      await sendText(session, event.chatId, `已切换当前微信会话的转发模式：${nextMode}`, event.senderId);
      return true;
    }

    const agentCommand = parseAgentSwitchCommand(event.text);
    if (!agentCommand) return false;
    const availableIds = (session.options.availableAgents ?? []).map((a) => `${a.provider}/${a.id}`);
    appendLog({ type: "debug", text: `weixin agent-switch: raw=${JSON.stringify(event.text)} target=${JSON.stringify(agentCommand.target)} chat=${event.chatId} available=[${availableIds.join(",")}]` });
    if (!agentCommand.target) {
      appendLog({ type: "debug", text: "weixin agent-switch: empty target, sending help" });
      await sendText(session, event.chatId, renderAgentHelp(session, event.chatId), event.senderId).catch((error) => {
        appendLog({ type: "error", text: `weixin agent-switch help send failed: ${error?.message ?? error}` });
      });
      return true;
    }
    const nextAgent = resolveAgentAlias(session.options.availableAgents, agentCommand.target);
    if (!nextAgent) {
      appendLog({ type: "warn", text: `weixin agent-switch: target=${agentCommand.target} did not match any available agent alias; sending not-found` });
      await sendText(session, event.chatId, `未找到可切换的本地 Agent：${agentCommand.target}\n\n${renderAgentHelp(session, event.chatId)}`, event.senderId).catch((error) => {
        appendLog({ type: "error", text: `weixin agent-switch not-found send failed: ${error?.message ?? error}` });
      });
      return true;
    }
    const priorAgent = session.options.agentByChat.get(event.chatId) ?? null;
    session.options.agentByChat.set(event.chatId, nextAgent);
    try {
      await store.writeChatSetting(session.account.accountId, event.chatId, { agent: nextAgent });
    } catch (error) {
      appendLog({ type: "error", text: `weixin agent-switch: writeChatSetting failed: ${error?.message ?? error}` });
    }
    if (session.options.channelAssistantBindingStore) {
      await session.options.channelAssistantBindingStore
        .setChatAssistant("wechat", event.chatId, { assistant_id: nextAgent.id })
        .catch((error) => appendLog({ text: `Failed to persist chat binding: ${error?.message ?? error}` }));
    }
    setState({ activeAgentId: nextAgent.id, lastError: null });
    let priorRun = null;
    try {
      const priorRunKey = priorAgent ? activeRunKey(event.chatId, priorAgent) : null;
      if (priorRunKey) priorRun = await store.readActiveRun(session.account.accountId, priorRunKey).catch(() => null);
    } catch { /* noop */ }
    const suffix = priorRun?.runId ? `\n上一个任务（${priorAgent ? agentLabel(priorAgent) : "旧 Agent"}）仍在运行，其结果会异步返回；新消息将由新 Agent 处理。` : "";
    appendLog({ type: "debug", text: `weixin agent-switch: switched ${priorAgent ? priorAgent.id : "<none>"} -> ${nextAgent.id} priorRun=${priorRun?.runId ?? "none"}` });
    try {
      await sendText(session, event.chatId, `已切换当前微信会话的回复 Agent：${agentLabel(nextAgent)}${suffix}`, event.senderId);
      appendLog({ type: "debug", text: `weixin agent-switch: ack delivered to chat=${event.chatId}` });
    } catch (error) {
      appendLog({ type: "error", text: `weixin agent-switch ack send failed: ${error?.message ?? error}` });
    }
    return true;
  }

  async function handleRunCommand(session, event, command) {
    if (command.name === "runs") {
      const runs = await store.listActiveRuns(session.account.accountId).catch(() => []);
      await sendText(session, event.chatId, renderRunsList(runs), event.senderId);
      return;
    }
    const agent = await currentAgentForChat(session, event.chatId);
    const runKey = activeRunKey(event.chatId, agent);
    const run = await store.readActiveRun(session.account.accountId, runKey).catch(() => null);
    if (command.name === "new") {
      if (run?.runId) {
        await sendText(session, event.chatId, "当前微信会话和 Agent 还有运行中的任务。请等待完成，或先发送 #cancel 后再开启新会话。", event.senderId);
        return;
      }
      const runtimeAgent = scopedWeixinRuntimeAgent(agent, event);
      const historyKey = chatAgentHistoryKey(event.chatId, agent);
      await store.clearChatHistory?.(session.account.accountId, historyKey).catch(() => false);
      await closeChannelSessionForAgent(session, event, agent);
      const reset = typeof runtime?.resetConversation === "function"
        ? await runtime.resetConversation({ workspaceRoot: session.options.workspaceRoot, agent: runtimeAgent }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        : { ok: false, error: "runtime reset is unavailable" };
      if (reset?.ok === false) {
        await sendText(session, event.chatId, `已清空微信侧历史，但本地 Agent 会话重置失败：${reset.error ?? "unknown error"}`, event.senderId);
        return;
      }
      await sendText(session, event.chatId, `已为当前微信会话开启新的 ${agentLabel(agent)} 对话。后续消息不会带入该 Agent 之前的微信历史或本地 provider session。`, event.senderId);
      return;
    }
    if (command.name === "status" || command.name === "continue") {
      if (run) scheduleActiveRunPoll(session, run, 0);
      await sendText(session, event.chatId, run ? renderRunStatus(run) : "当前微信会话和 Agent 没有运行中的任务。", event.senderId);
      return;
    }
    if (command.name === "cancel") {
      if (!run?.runId) {
        await sendText(session, event.chatId, "当前微信会话和 Agent 没有可取消的任务。", event.senderId);
        return;
      }
      const cancelled = typeof runtime?.cancelRun === "function"
        ? await runtime.cancelRun(run.runId, { reason: "weixin" })
        : { ok: false, error: "runtime cancel is unavailable" };
      clearActiveRunPoll(session.account.accountId, runKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await store.deleteActiveRun(session.account.accountId, runKey);
      await sendText(session, event.chatId, cancelled?.ok === false ? `已清理微信侧任务记录，但本地取消失败：${cancelled.error ?? "unknown error"}` : "已取消当前微信会话的本地 Agent 任务。", event.senderId);
    }
  }

  async function handleApprovalCommand(session, event, command) {
    if (typeof runtime?.resolveApproval !== "function") {
      await sendText(session, event.chatId, "当前本地 Agent runtime 不支持微信内审批。请在 Studio 中处理审批。", event.senderId);
      return;
    }
    const pendingRuns = await pendingApprovalRunsForChat(session, event.chatId);
    if (!pendingRuns.length) {
      await sendText(session, event.chatId, "当前微信会话没有等待审批的本地 Agent 任务。", event.senderId);
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
      await sendText(session, event.chatId, `审批处理失败：\n${errors.join("\n")}`, event.senderId);
      return;
    }
    const action = command.decision === "decline" ? "拒绝" : "批准";
    const suffix = errors.length ? `\n部分审批失败：\n${errors.join("\n")}` : "";
    await sendText(session, event.chatId, `已${action} ${resolvedCount} 个审批请求，Agent 将继续处理。${suffix}`, event.senderId);
  }

  async function pendingApprovalRunsForChat(session, chatId) {
    const runs = await store.listActiveRuns(session.account.accountId).catch(() => []);
    return runs
      .filter((run) => String(run.chatId ?? "") === String(chatId ?? ""))
      .filter((run) => Array.isArray(run.pendingApprovals) && run.pendingApprovals.length > 0)
      .sort((a, b) => Number(a.startedAt ?? a.createdAt ?? 0) - Number(b.startedAt ?? b.createdAt ?? 0));
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
      await sendText(session, input.chatId, `需要先在 Studio 本机批准配对。配对码：${code}`, input.platformUserId).catch(() => undefined);
      appendLog({ type: "warn", text: `weixin pairing requested for ${input.platformUserId}, code=${code}` });
    } else {
      appendLog({ type: "warn", text: `weixin pairing request returned no code for ${input.platformUserId}` });
    }
    return false;
  }

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
    // Parity with AionCore create_conversation_for_session + bind_conversation:
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
    if (needBind && runtime?.createConversation) {
      try {
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
        const conversationId = created?.conversation?.id ?? created?.id ?? null;
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
      // wrongly report a stale, orphaned id as "found". `listAgentConversations`
      // returns the raw list and lets us test id membership strictly.
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
      void sendText(active, chatId, text, chatId).catch((error) => {
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

  async function probe(input = {}) {
    const accountId = String(input.accountId ?? state.accountId ?? "").trim();
    const account = accountId ? await store.loadAccount(accountId).catch(() => null) : await store.loadDefaultAccount().catch(() => null);
    if (!account?.token) return { ok: false, error: "no saved Weixin account" };
    try {
      await client.getUpdates({ baseUrl: account.baseUrl, token: account.token, syncBuf: "", timeoutMs: 3000 });
      return { ok: true, botUsername: account.accountId, hasToken: true };
    } catch (error) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  return {
    start,
    stop,
    status: () => snapshot(),
    accountStatus,
    saveAccount,
    loginStart,
    loginPoll,
    autoStart,
    simulateInbound,
    probe,
    processMessage: (message, input = {}) => {
      const session = active ?? { account: input.account, store, options: runtimeOptions(input), controller: new AbortController() };
      return processMessage(session, message);
    },
  };
}

function normalizeRuntimeOptions(input = {}) {
  const agent = normalizePersonalLocalAgent(input.agent ?? { provider: "opencode" });
  const availableAgents = normalizeAvailableAgents(input.availableAgents ?? input.agents, agent);
  const allowedUsers = normalizeList(input.allowedUsers ?? input.allowFrom);
  const allowedGroups = normalizeList(input.allowedGroups ?? input.groupAllowFrom);
  const dmPolicy = normalizePolicy(input.dmPolicy, allowedUsers, "allowlist");
  const groupPolicy = normalizePolicy(input.groupPolicy, allowedGroups, "disabled");
  return {
    workspaceRoot: String(input.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT),
    accessibleWorkspaceRoots: normalizeAccessibleWorkspaceRoots(input.accessibleWorkspaceRoots, input.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT),
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

async function currentAgentForChat(session, chatId) {
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
    const chatBinding = bindingStore.getChatAssistant("wechat", chatId);
    const platformBinding = chatBinding ?? bindingStore.getPlatformSettings("wechat")?.assistant ?? null;
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

function scopedWeixinRuntimeAgent(agent, event) {
  const scopeHash = stableHash(`${event.accountId}\n${event.chatId}\n${agent.provider}\n${agent.id}`);
  return {
    ...agent,
    id: `${safeSegment(agent.id)}-weixin-${scopeHash}`,
    name: agent.name ? `${agent.name} · Weixin` : `${agent.provider} · Weixin`,
  };
}

function renderAgentHelp(session, chatId) {
  const current = session.options.agentByChat.get(chatId) ?? session.options.agent;
  const lines = [
    `当前回复 Agent：${agentLabel(current)}`,
    "可用 Agent：",
    ...session.options.availableAgents.map((agent) => `- ${agent.id}: ${agentLabel(agent)}`),
    "",
    "发送 #agent <id> 切换，例如：#agent codex",
  ];
  return lines.join("\n");
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
  const lines = [
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
  ];
  return lines.filter(Boolean).join("\n");
}

function renderRunsList(runs) {
  const items = Array.isArray(runs) ? runs : [];
  if (!items.length) return "当前账号没有运行中的微信本地 Agent 任务。";
  return [
    "当前账号运行中的任务：",
    ...items.map((run) => `- ${String(run.chatId ?? "?")} / ${run?.agent?.id ?? "unknown"}: ${String(run.status ?? "running")} (${safeId(run.runId, 12)})`),
  ].join("\n");
}

function buildPrompt(event, options = {}) {
  const mode = normalizePromptMode(options.mode);
  const mediaLines = Array.isArray(event.mediaFiles) && event.mediaFiles.length
    ? ["", "本地媒体附件:", ...event.mediaFiles.map((file) => `- ${file.kind || "file"} ${file.mimeType || "application/octet-stream"}: ${file.path}`)]
    : [];
  if (mode === "raw") {
    return [event.text, ...mediaLines].filter(Boolean).join("\n").trim();
  }
  const history = Array.isArray(options.history) ? options.history : [];
  const historyLines = history.length
    ? ["", "最近对话:", ...history.map((item) => `- ${item.role || "unknown"}${item.agentId ? `/${item.agentId}` : ""}: ${String(item.text ?? "").trim()}`)]
    : [];
  const agent = options.agent ?? {};
  return [
    `来源: Weixin/iLink`,
    `chat_id: ${event.chatId}`,
    `user_id: ${event.senderId}`,
    event.messageId ? `message_id: ${event.messageId}` : null,
    agent.id ? `agent: ${agent.provider || "unknown"}/${agent.id}` : null,
    `prompt_mode: ${mode}`,
    ...historyLines,
    "",
    "用户消息:",
    event.text,
    ...mediaLines,
  ].filter((line) => line !== null).join("\n");
}

function mimeFromFilename(filename) {
  const lower = String(filename ?? "").toLowerCase();
  if (/\.(jpe?g)$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower)) return "image/png";
  if (/\.gif$/.test(lower)) return "image/gif";
  if (/\.webp$/.test(lower)) return "image/webp";
  if (/\.mp4$/.test(lower)) return "video/mp4";
  if (/\.pdf$/.test(lower)) return "application/pdf";
  if (/\.txt$/.test(lower)) return "text/plain";
  return "application/octet-stream";
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
  extractText,
  guessChatType,
  splitTextForWeixin,
  buildPrompt,
  mimeFromFilename,
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
  safeId,
  activeRunKey,
  activeRunGuardKey,
  runAgentTurn,
  createQrImageDataUrl,
};
