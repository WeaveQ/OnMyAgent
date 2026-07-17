import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createFeishuClient, FEISHU_BASE_URL } from "./client.mjs";
import { getChannelRunSnapshotState } from "./local-qr.mjs";
import { createFeishuStore, sanitizeAccount } from "./store.mjs";
import { createFeishuWebSocketClient } from "./ws-client.mjs";
import { normalizePersonalLocalAgent } from "../personal-agent-runtime/provider-registry.mjs";
import { formatAgentReply } from "../channels/AgentReplyHeader.mjs";

const RETRY_DELAY_SECONDS = 2;
const DEFAULT_TEXT_BATCH_DELAY_MS = 3_000;
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".onmyagent", "feishu-workspace");
const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_HISTORY_STORE_LIMIT = 24;
const ACTIVE_RUN_POLL_INTERVAL_MS = 1_000;
const ACTIVE_RUN_PENDING_POLL_INTERVAL_MS = 3_000;
// Minimum spacing between "agent still busy" replies for the same chat+agent.
const AGENT_BUSY_NOTICE_INTERVAL_MS = 15_000;
// Backstop ceiling for a single channel conversation lock. The personal agent
// runtime already enforces its own run timeout (max 6h), but that timer lives
// in the runtime process and is lost if the desktop app restarts.
const ACTIVE_RUN_MAX_AGE_MS = 6 * 60 * 60 * 1000 + 15 * 60 * 1000;
const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeId(value, keep = 8) {
  const raw = String(value ?? "").trim();
  if (!raw) return "?";
  return raw.length <= keep ? raw : raw.slice(0, keep);
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function splitTextForFeishu(text, maxLength = 7800) {
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

export function createFeishuService(options = {}) {
  const userDataDir = String(options.userDataDir ?? "").trim();
  if (!options.store && !userDataDir) throw new Error("userDataDir is required for Feishu service storage");
  const store = options.store ?? createFeishuStore(userDataDir);
  const client = options.client ?? createFeishuClient({ fetchFn: options.fetchFn });
  const runtime = options.personalAgentRuntime;
  const appendLog = typeof options.appendLog === "function" ? options.appendLog : () => undefined;
  const channelPairingService = options.channelPairingService ?? null;
  const channelSessionStore = options.channelSessionStore ?? null;
  const channelEventBus = options.channelEventBus ?? null;
  const dedup = new TtlSet(5 * 60_000);
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
    webhookHost: "127.0.0.1",
    webhookPort: 8765,
    webhookPath: "/feishu/webhook",
    webhookUrl: "",
    connectionMode: "websocket",
    websocketState: "closed",
    lastConnectAt: null,
    lastDisconnectAt: null,
    reconnectAttempts: 0,
    connId: "",
    serviceId: 0,
    startedAt: null,
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
    return { ...state, ...extra };
  }

  function setState(patch) {
    state = { ...state, ...patch };
    return snapshot();
  }

  function runtimeOptions(input = {}) {
    const normalized = normalizeRuntimeOptions(input);
    normalized.agentByChat = agentByChat;
    normalized.promptModeByChat = promptModeByChat;
    return normalized;
  }

  async function persistServiceConfig(input = {}) {
    const options = runtimeOptions(input);
    await store.writeConfig({
      autoStart: input.autoStart !== false,
      defaultAccountId: String(input.accountId ?? input.account_id ?? input.appId ?? input.app_id ?? "").trim(),
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
        connectionMode: options.connectionMode,
        historyLimit: options.historyLimit,
        historyStoreLimit: options.historyStoreLimit,
        webhookHost: options.webhookHost,
        webhookPort: options.webhookPort,
        webhookPath: options.webhookPath,
      },
    });
  }

  async function start(input = {}) {
    const accountId = String(input.accountId ?? input.account_id ?? input.appId ?? input.app_id ?? state.accountId ?? "").trim();
    if (!accountId) return { ok: false, error: "accountId/appId is required" };
    const optionsValue = runtimeOptions(input);
    if (active?.account?.accountId === accountId && active.options.connectionMode === optionsValue.connectionMode) {
      active.options = runtimeOptions({ ...active.options, ...input, connectionMode: active.options.connectionMode });
      setState(statePatchForStart(accountId, active.options, "running"));
      await persistServiceConfig({ ...active.options, accountId, autoStart: input.autoStart ?? true });
      return { ok: true, updated: true, status: snapshot(), account: sanitizeAccount(active.account) };
    }
    if (active) await stop({ persist: false });
    const account = await store.loadAccount(accountId);
    if (!account?.appSecret) return { ok: false, error: "Feishu app is not configured" };
    const controller = new AbortController();
    active = { controller, account, store, options: optionsValue, server: null, wsClient: null };
    if (optionsValue.connectionMode === "webhook") await startWebhookServer(active);
    else await startWebSocketClient(active);
    setState(statePatchForStart(accountId, optionsValue, "running"));
    await persistServiceConfig({ ...input, accountId, autoStart: input.autoStart ?? true });
    await resumeActiveRuns(active);
    subscribeStudioRelay();
    return { ok: true, status: snapshot(), account: sanitizeAccount(account) };
  }

  function statePatchForStart(accountId, optionsValue, status) {
    return {
      status,
      accountId,
      workspaceRoot: optionsValue.workspaceRoot,
      accessibleWorkspaceRoots: optionsValue.accessibleWorkspaceRoots,
      webhookHost: optionsValue.webhookHost,
      webhookPort: optionsValue.webhookPort,
      webhookPath: optionsValue.webhookPath,
      webhookUrl: optionsValue.connectionMode === "webhook" ? `http://${optionsValue.webhookHost}:${optionsValue.webhookPort}${optionsValue.webhookPath}` : "",
      connectionMode: optionsValue.connectionMode,
      startedAt: Date.now(),
      lastError: null,
      activeAgentId: optionsValue.agent.id,
      approvalMode: optionsValue.approvalMode,
    };
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
    current.wsClient?.stop?.();
    await closeWebhookServer(current.server);
    unsubscribeStudioRelay();
    setState({ status: "stopped", websocketState: "closed" });
    return { ok: true, status: snapshot() };
  }

  async function startWebSocketClient(session) {
    const wsClient = createFeishuWebSocketClient({
      client,
      account: session.account,
      WebSocketCtor: options.WebSocketCtor,
      reconnectIntervalMs: options.wsReconnectIntervalMs,
      endpointRetryMs: options.wsEndpointRetryMs,
      appendLog,
      onState: (patch) => setState(patch),
      onEvent: async (payload) => {
        await processWebSocketPayload(session, payload);
      },
    });
    session.wsClient = wsClient;
    await wsClient.start();
  }

  async function startWebhookServer(session) {
    const server = http.createServer((request, response) => {
      void handleWebhookRequest(session, request, response).catch((error) => {
        appendLog({ type: "error", text: `feishu webhook failed: ${error.message}` });
        setState({ lastError: error.message });
        if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: 500, msg: error.message }));
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(session.options.webhookPort, session.options.webhookHost, () => {
        server.off("error", reject);
        const address = server.address();
        if (address && typeof address === "object") session.options.webhookPort = address.port;
        resolve();
      });
    });
    session.server = server;
  }

  async function closeWebhookServer(server) {
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  async function handleWebhookRequest(session, request, response) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "POST" || url.pathname !== session.options.webhookPath) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 404, msg: "not found" }));
      return;
    }
    const body = await readRequestBody(request, WEBHOOK_MAX_BODY_BYTES);
    const payload = body ? JSON.parse(body) : {};
    if (payload?.challenge) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ challenge: payload.challenge }));
      return;
    }
    if (session.account.verificationToken && payload?.token && !safeCompare(payload.token, session.account.verificationToken)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 401, msg: "invalid verification token" }));
      return;
    }
    const event = await processWebhookPayload(session, payload);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: 0, event: event ? "accepted" : "ignored" }));
  }

  async function readRequestBody(request, maxBytes) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) throw new Error("Feishu webhook body is too large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  async function processWebhookPayload(session, payload) {
    const normalized = normalizeFeishuWebhookEvent(payload);
    if (!normalized?.text) return null;
    return processEvent(session, normalized);
  }

  async function processWebSocketPayload(session, payload) {
    const normalized = normalizeFeishuWebhookEvent(payload);
    if (!normalized?.text) return null;
    normalized.accountId = normalized.accountId || session.account.accountId;
    return processEvent(session, normalized);
  }

  async function processEvent(session, event) {
    if (!event.senderId || event.senderId === session.account.appId) return null;
    if (event.messageId && dedup.hasOrAdd(`id:${event.messageId}`)) return null;
    const contentKey = `content:${event.senderId}:${event.chatId}:${event.text}`;
    if (dedup.hasOrAdd(contentKey)) return null;
    if (!isAllowed(session.options, event, event.senderId)) {
      appendLog({ type: "warn", text: `feishu inbound dropped (policy): sender=${event.senderId} chatType=${event.chatType}` });
      return null;
    }
    if (!(await ensureChannelUserAuthorized(session, { platformType: "feishu", platformUserId: event.senderId, chatId: event.chatId, displayName: event.senderId }))) {
      appendLog({ type: "warn", text: `feishu inbound dropped (unauthorized): sender=${event.senderId} chatId=${event.chatId}` });
      return null;
    }
    setState({ lastMessageAt: Date.now(), processedCount: state.processedCount + 1 });
    if (await maybeHandleControlCommand(session, event)) return event;
    void enqueueText(session, event).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setState({ lastError: message });
      appendLog({ type: "error", text: `feishu enqueue failed: ${message}` });
      void sendText(session, event.chatId, `处理失败：${message}`).catch(() => undefined);
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
        appendLog({ type: "error", text: `feishu dispatch failed: ${message}` });
        void sendText(session, batchEvent.chatId, `处理失败：${message}\n\n请检查 Studio 中飞书通道的本地 Agent 配置。`).catch(() => undefined);
      });
    }, session.options.textBatchDelayMs);
    pendingBatches.set(key, { event: batchEvent, agent, timer });
  }

  async function dispatchToAgent(session, event) {
    if (!runtime?.runMessage && (!runtime?.startMessage || !runtime?.getRun)) throw new Error("personal agent runtime is unavailable");
    const agent = event.agentSnapshot ?? await currentAgentForChat(session, event.chatId);
    const promptMode = await currentPromptModeForChat(session, event.chatId);
    const historyKey = chatAgentHistoryKey(event.chatId, agent);
    const runKey = activeRunKey(event.chatId, agent);
    const existingRun = await store.readActiveRun(session.account.accountId, runKey).catch(() => null);
    if (existingRun?.runId) {
      // Same chat + same agent is already busy. See weixin/service.mjs.
      scheduleActiveRunPoll(session, existingRun, 0);
      const busyKey = `${session.account.accountId}:${runKey}`;
      const nowTs = Date.now();
      const lastAt = agentBusyNoticeAt.get(busyKey) ?? 0;
      if (nowTs - lastAt >= AGENT_BUSY_NOTICE_INTERVAL_MS) {
        agentBusyNoticeAt.set(busyKey, nowTs);
        await sendText(session, event.chatId, `${agentLabel(agent)} 还在处理上一条消息，请稍后再试。发送 #status 查看进度，或 #cancel 取消后再重发。`).catch(() => undefined);
      }
      return existingRun;
    }
    const runtimeAgent = scopedFeishuRuntimeAgent(agent, event);
    const channelSession = await getChannelSession(session, event, agent);
    const history = await store.readChatHistory(session.account.accountId, historyKey, session.options.historyLimit).catch(() => []);
    const prompt = buildPrompt(event, { mode: promptMode, history, agent });
    if (typeof runtime.startMessage !== "function" || typeof runtime.getRun !== "function") {
      const legacyModel = await currentModelForChat(session, event.chatId);
      const result = await runAgentTurn(runtime, {
        workspaceRoot: session.options.workspaceRoot,
        accessibleWorkspaceRoots: session.options.accessibleWorkspaceRoots,
        prompt,
        agent: runtimeAgent,
        model: legacyModel || undefined,
        approvalMode: session.options.approvalMode,
        timeoutMs: session.options.timeoutMs,
      });
      setState({ lastRunId: result?.runId ?? null });
      await handleSynchronousAgentResult(session, event, { agent, historyKey, result, channelSession });
      return result;
    }
    const chatModel = await currentModelForChat(session, event.chatId);
    const started = await runtime.startMessage({
      workspaceRoot: session.options.workspaceRoot,
      accessibleWorkspaceRoots: session.options.accessibleWorkspaceRoots,
      prompt,
      // Raw user text (without the channel transport header) so the runtime
      // records it as the user message in the run log / conversation view.
      userText: event.text,
      agent: runtimeAgent,
      model: chatModel || undefined,
      approvalMode: session.options.approvalMode,
      timeoutMs: session.options.timeoutMs,
    });
    setState({ lastRunId: started?.runId ?? null });
    if (started?.status && started.status !== "running") {
      await handleSynchronousAgentResult(session, event, { agent, historyKey, result: started, channelSession });
      return started;
    }
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
      await sendText(session, event.chatId, "需要在 Studio 中审批后继续处理。");
      return;
    }
    if (!resultState.isCompletedWithOutput) {
      await sendText(session, event.chatId, "本次处理失败，请在 Studio 查看本地 Agent 日志。");
      return;
    }
    await sendText(session, event.chatId, formatAgentReply({ agent, text: result.output }));
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
      void pollActiveRun(session, run.runKey).catch((error) => setState({ lastError: error?.message ?? String(error) }));
    }, Math.max(0, delayMs));
    activeRunPollers.set(pollKey, timer);
  }

  async function pollActiveRun(session, runKey) {
    if (session.controller.signal.aborted) return;
    const record = await store.readActiveRun(session.account.accountId, runKey).catch(() => null);
    if (!record?.runId) return;
    const pollKey = activeRunGuardKey(session.account.accountId, runKey);
    if (clearedActiveRunKeys.has(pollKey)) return;
    const result = await runtime.getRun({ runId: record.runId, workspaceRoot: record.workspaceRoot });
    if (clearedActiveRunKeys.has(pollKey)) return;
    if (!result) {
      const message = "本次本地 Agent 任务已不在运行（可能主进程重启/崩溃后遗留，或已超时中断）。已自动清除会话锁，可重新发送消息。";
      await sendText(session, record.chatId, message).catch(() => undefined);
      clearedActiveRunKeys.add(pollKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await store.deleteActiveRun(session.account.accountId, runKey).catch(() => undefined);
      return;
    }
    setState({ lastRunId: record.runId });
    const resultState = getChannelRunSnapshotState(result);
    if (resultState.isCompletedWithOutput) {
      await sendText(session, record.chatId, formatAgentReply({ agent: record.agent, text: result.output }));
      await appendAgentHistory(session, record.historyKey, record.userText, result.output, record.agent, record.historyStoreLimit ?? session.options.historyStoreLimit);
      await appendChannelSessionHistoryById(record.channelSessionId, record.userText, result.output, record.agent);
      clearedActiveRunKeys.add(pollKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await store.deleteActiveRun(session.account.accountId, runKey);
      return;
    }
    if (resultState.isTerminal) {
      const message = resultState.status === "cancelled" ? "本次本地 Agent 任务已取消。" : `本次处理失败，请在 Studio 查看本地 Agent 日志。${result?.error ? `\n${result.error}` : ""}`;
      await sendText(session, record.chatId, message);
      clearedActiveRunKeys.add(pollKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await store.deleteActiveRun(session.account.accountId, runKey);
      return;
    }
    const pendingApprovals = resultState.pendingApprovals;
    if (pendingApprovals.length && !record.pendingApprovalNotifiedAt) {
      if (clearedActiveRunKeys.has(pollKey)) return;
      const updated = await store.writeActiveRun(session.account.accountId, runKey, { status: "pending_approval", pendingApprovalNotifiedAt: Date.now(), pendingApprovals });
      await sendText(session, record.chatId, renderApprovalPrompt(updated, pendingApprovals));
      scheduleActiveRunPoll(session, updated, ACTIVE_RUN_PENDING_POLL_INTERVAL_MS);
      return;
    }
    if (pendingApprovals.length) {
      if (clearedActiveRunKeys.has(pollKey)) return;
      const updated = await store.writeActiveRun(session.account.accountId, runKey, { status: "pending_approval", pendingApprovals });
      scheduleActiveRunPoll(session, updated, ACTIVE_RUN_PENDING_POLL_INTERVAL_MS);
      return;
    }
    if (clearedActiveRunKeys.has(pollKey)) return;
    if (Date.now() - (record.startedAt ?? 0) > ACTIVE_RUN_MAX_AGE_MS) {
      const message = `本次本地 Agent 任务运行已超过上限（约 ${Math.round(ACTIVE_RUN_MAX_AGE_MS / 3_600_000)} 小时），已自动超时并清除会话锁。可重新发送消息。`;
      await sendText(session, record.chatId, message).catch(() => undefined);
      clearedActiveRunKeys.add(pollKey);
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await store.deleteActiveRun(session.account.accountId, runKey).catch(() => undefined);
      return;
    }
    const updated = await store.writeActiveRun(session.account.accountId, runKey, { status: "running", pendingApprovals: [] });
    scheduleActiveRunPoll(session, updated, ACTIVE_RUN_POLL_INTERVAL_MS);
  }

  async function sendText(session, chatId, text) {
    const chunks = splitTextForFeishu(text);
    let lastResponse = null;
    for (let index = 0; index < chunks.length; index += 1) {
      lastResponse = await client.sendText({
        baseUrl: session.account.baseUrl,
        appId: session.account.appId,
        appSecret: session.account.appSecret,
        receiveIdType: "chat_id",
        receiveId: chatId,
        text: chunks[index],
        uuid: `studio-feishu-${randomUUID()}`,
      });
      if (index < chunks.length - 1) await sleep(session.options.sendChunkDelayMs);
    }
    setState({ sentCount: state.sentCount + chunks.length });
    return lastResponse;
  }

  async function saveAccount(input = {}) {
    const account = await store.saveAccount(input);
    return { ok: true, account };
  }

  // AionUi-parity connectivity self-check: validates the saved Feishu app
  // credentials by actually exchanging appId/appSecret for a tenant_access_token.
  async function probe(input = {}) {
    const accountId = String(input.accountId ?? input.appId ?? state.accountId ?? "").trim();
    const account = accountId ? await store.loadAccount(accountId).catch(() => null) : await store.loadDefaultAccount().catch(() => null);
    if (!account?.appId || !account?.appSecret) {
      return { ok: false, hasToken: false, error: "Feishu app is not configured" };
    }
    try {
      const token = await client.getTenantAccessToken({
        baseUrl: account.baseUrl || FEISHU_BASE_URL,
        appId: account.appId,
        appSecret: account.appSecret,
      });
      if (!token) return { ok: false, hasToken: true, error: "Feishu returned empty tenant token" };
      return { ok: true, hasToken: true, botUsername: account.appId };
    } catch (error) {
      const cause = error?.cause;
      const detail = cause?.code || (cause?.hostname ? `host ${cause.hostname}` : (cause?.message ?? ""));
      const message = [error?.message, detail].filter(Boolean).join(" — ");
      return { ok: false, hasToken: true, error: message || String(error) };
    }
  }

  async function accountStatus(input = {}) {
    const accountId = String(input.accountId ?? input.appId ?? state.accountId ?? "").trim();
    const account = accountId ? await store.loadAccount(accountId).catch(() => null) : await store.loadDefaultAccount().catch(() => null);
    const config = await store.readConfig().catch(() => ({}));
    const lastStartOptions = config?.lastStartOptions && typeof config.lastStartOptions === "object" ? config.lastStartOptions : {};
    const optionsValue = runtimeOptions(lastStartOptions);
    return {
      ok: true,
      account: sanitizeAccount(account),
      status: snapshot({
        workspaceRoot: state.workspaceRoot || String(lastStartOptions.workspaceRoot ?? ""),
        accessibleWorkspaceRoots: state.accessibleWorkspaceRoots?.length ? state.accessibleWorkspaceRoots : normalizeAccessibleWorkspaceRoots(lastStartOptions.accessibleWorkspaceRoots, lastStartOptions.workspaceRoot),
        approvalMode: state.approvalMode || normalizeApprovalMode(lastStartOptions.approvalMode),
        connectionMode: state.connectionMode || normalizeConnectionMode(lastStartOptions.connectionMode),
        webhookHost: state.webhookHost || optionsValue.webhookHost,
        webhookPort: state.webhookPort || optionsValue.webhookPort,
        webhookPath: state.webhookPath || optionsValue.webhookPath,
        webhookUrl: state.webhookUrl || (optionsValue.connectionMode === "webhook" ? `http://${optionsValue.webhookHost}:${optionsValue.webhookPort}${optionsValue.webhookPath}` : ""),
      }),
      config: {
        autoStart: config.autoStart !== false,
        workspaceRoot: String(lastStartOptions.workspaceRoot ?? ""),
        accessibleWorkspaceRoots: normalizeAccessibleWorkspaceRoots(lastStartOptions.accessibleWorkspaceRoots, lastStartOptions.workspaceRoot),
        approvalMode: normalizeApprovalMode(lastStartOptions.approvalMode),
        connectionMode: normalizeConnectionMode(lastStartOptions.connectionMode),
        defaultAccountId: String(config.defaultAccountId ?? ""),
        webhookHost: optionsValue.webhookHost,
        webhookPort: optionsValue.webhookPort,
        webhookPath: optionsValue.webhookPath,
      },
    };
  }

  async function autoStart(input = {}) {
    const config = await store.readConfig();
    if (config.autoStart === false && input.force !== true) return { ok: false, skipped: true, reason: "autoStart disabled", status: snapshot() };
    const account = await store.loadDefaultAccount();
    if (!account?.appSecret) return { ok: false, skipped: true, reason: "no saved Feishu app", status: snapshot() };
    return start({ ...config.lastStartOptions, ...input, accountId: account.accountId, autoStart: true });
  }

  async function simulateInbound(input = {}) {
    const accountId = String(input.accountId ?? input.appId ?? state.accountId ?? "").trim();
    const account = active?.account?.accountId === accountId ? active.account : await store.loadAccount(accountId);
    if (!account) return { ok: false, error: "Feishu app is not configured" };
    const session = active?.account?.accountId === account.accountId ? active : { account, store, options: runtimeOptions(input), controller: new AbortController() };
    const event = await processEvent(session, {
      accountId: account.accountId,
      senderId: input.fromUserId ?? input.senderId ?? "ou_studio_test_user",
      messageId: input.messageId ?? `sim-${Date.now()}`,
      chatId: input.chatId ?? "oc_studio_test_chat",
      chatType: input.chatType ?? "dm",
      text: String(input.text ?? "ping"),
      raw: input.raw ?? null,
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
        await sendText(session, event.chatId, renderModeHelp(session, event.chatId));
        return true;
      }
      const nextMode = normalizePromptMode(modeCommand.target);
      if (nextMode !== modeCommand.target.trim().toLowerCase()) {
        await sendText(session, event.chatId, `未知飞书转发模式：${modeCommand.target}\n\n${renderModeHelp(session, event.chatId)}`);
        return true;
      }
      session.options.promptModeByChat.set(event.chatId, nextMode);
      await store.writeChatSetting(session.account.accountId, event.chatId, { promptMode: nextMode });
      await sendText(session, event.chatId, `已切换当前飞书会话的转发模式：${nextMode}`);
      return true;
    }
    const modelCommand = parseModelSwitchCommand(event.text);
    if (modelCommand) {
      const boundAgent = await currentAgentForChat(session, event.chatId);
      const currentModel = await currentModelForChat(session, event.chatId);
      const rawTarget = modelCommand.target;
      if (!rawTarget) {
        await sendText(session, event.chatId, renderModelHelp(boundAgent, currentModel)).catch((error) => {
          appendLog({ type: "error", text: `feishu model-switch help send failed: ${error?.message ?? error}` });
        });
        return true;
      }
      const lowered = rawTarget.toLowerCase();
      if (lowered === "default" || lowered === "reset" || lowered === "清除" || lowered === "重置") {
        session.options.modelByChat.set(event.chatId, "");
        await store.writeChatSetting(session.account.accountId, event.chatId, { model: "" }).catch((error) => {
          appendLog({ type: "error", text: `feishu model-switch: writeChatSetting failed: ${error?.message ?? error}` });
        });
        await sendText(session, event.chatId, `已恢复当前飞书会话的默认模型（${agentLabel(boundAgent)}）。`).catch(() => undefined);
        return true;
      }
      const resolved = resolveAgentModelId(boundAgent, rawTarget);
      if (!resolved) {
        await sendText(session, event.chatId, `未在当前 Agent 的模型列表中找到：${rawTarget}\n\n${renderModelHelp(boundAgent, currentModel)}`).catch(() => undefined);
        return true;
      }
      session.options.modelByChat.set(event.chatId, resolved);
      await store.writeChatSetting(session.account.accountId, event.chatId, { model: resolved }).catch((error) => {
        appendLog({ type: "error", text: `feishu model-switch: writeChatSetting failed: ${error?.message ?? error}` });
      });
      await sendText(session, event.chatId, `已切换当前飞书会话的模型：${resolved}`).catch(() => undefined);
      return true;
    }
    const agentCommand = parseAgentSwitchCommand(event.text);
    if (!agentCommand) return false;
    const availableIds = (session.options.availableAgents ?? []).map((a) => `${a.provider}/${a.id}`);
    appendLog({ type: "debug", text: `feishu agent-switch: raw=${JSON.stringify(event.text)} target=${JSON.stringify(agentCommand.target)} chat=${event.chatId} available=[${availableIds.join(",")}]` });
    if (!agentCommand.target) {
      appendLog({ type: "debug", text: "feishu agent-switch: empty target, sending help" });
      await sendText(session, event.chatId, renderAgentHelp(session, event.chatId)).catch((error) => {
        appendLog({ type: "error", text: `feishu agent-switch help send failed: ${error?.message ?? error}` });
      });
      return true;
    }
    const nextAgent = resolveAgentAlias(session.options.availableAgents, agentCommand.target);
    if (!nextAgent) {
      appendLog({ type: "warn", text: `feishu agent-switch: target=${agentCommand.target} did not match any available agent alias; sending not-found` });
      await sendText(session, event.chatId, `未找到可切换的本地 Agent：${agentCommand.target}\n\n${renderAgentHelp(session, event.chatId)}`).catch((error) => {
        appendLog({ type: "error", text: `feishu agent-switch not-found send failed: ${error?.message ?? error}` });
      });
      return true;
    }
    const priorAgent = session.options.agentByChat.get(event.chatId) ?? null;
    session.options.agentByChat.set(event.chatId, nextAgent);
    try {
      await store.writeChatSetting(session.account.accountId, event.chatId, { agent: nextAgent });
    } catch (error) {
      appendLog({ type: "error", text: `feishu agent-switch: writeChatSetting failed: ${error?.message ?? error}` });
    }
    setState({ activeAgentId: nextAgent.id, lastError: null });
    let priorRun = null;
    try {
      const priorRunKey = priorAgent ? activeRunKey(event.chatId, priorAgent) : null;
      if (priorRunKey) priorRun = await store.readActiveRun(session.account.accountId, priorRunKey).catch(() => null);
    } catch { /* noop */ }
    const suffix = priorRun?.runId ? `\n上一个任务（${priorAgent ? agentLabel(priorAgent) : "旧 Agent"}）仍在运行，其结果会异步返回；新消息将由新 Agent 处理。` : "";
    appendLog({ type: "debug", text: `feishu agent-switch: switched ${priorAgent ? priorAgent.id : "<none>"} -> ${nextAgent.id} priorRun=${priorRun?.runId ?? "none"}` });
    try {
      await sendText(session, event.chatId, `已切换当前飞书会话的回复 Agent：${agentLabel(nextAgent)}${suffix}`);
      appendLog({ type: "debug", text: `feishu agent-switch: ack delivered to chat=${event.chatId}` });
    } catch (error) {
      appendLog({ type: "error", text: `feishu agent-switch ack send failed: ${error?.message ?? error}` });
    }
    return true;
  }

  async function handleRunCommand(session, event, command) {
    if (command.name === "runs") {
      const runs = await store.listActiveRuns(session.account.accountId).catch(() => []);
      await sendText(session, event.chatId, renderRunsList(runs));
      return;
    }
    const agent = await currentAgentForChat(session, event.chatId);
    const runKey = activeRunKey(event.chatId, agent);
    const run = await store.readActiveRun(session.account.accountId, runKey).catch(() => null);
    if (command.name === "new") {
      if (run?.runId) {
        await sendText(session, event.chatId, "当前飞书会话和 Agent 还有运行中的任务。请等待完成，或先发送 #cancel 后再开启新会话。");
        return;
      }
      const runtimeAgent = scopedFeishuRuntimeAgent(agent, event);
      const historyKey = chatAgentHistoryKey(event.chatId, agent);
      await store.clearChatHistory?.(session.account.accountId, historyKey).catch(() => false);
      await closeChannelSessionForAgent(session, event, agent);
      const reset = typeof runtime?.resetConversation === "function"
        ? await runtime.resetConversation({ workspaceRoot: session.options.workspaceRoot, agent: runtimeAgent }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        : { ok: false, error: "runtime reset is unavailable" };
      if (reset?.ok === false) {
        await sendText(session, event.chatId, `已清空飞书侧历史，但本地 Agent 会话重置失败：${reset.error ?? "unknown error"}`);
        return;
      }
      await sendText(session, event.chatId, `已为当前飞书会话开启新的 ${agentLabel(agent)} 对话。后续消息不会带入该 Agent 之前的飞书历史或本地 provider session。`);
      return;
    }
    if (command.name === "status" || command.name === "continue") {
      if (run) scheduleActiveRunPoll(session, run, 0);
      await sendText(session, event.chatId, run ? renderRunStatus(run) : "当前飞书会话和 Agent 没有运行中的任务。");
      return;
    }
    if (command.name === "cancel") {
      if (!run?.runId) {
        await sendText(session, event.chatId, "当前飞书会话和 Agent 没有可取消的任务。");
        return;
      }
      const cancelled = typeof runtime?.cancelRun === "function" ? await runtime.cancelRun(run.runId, { reason: "feishu" }) : { ok: false, error: "runtime cancel is unavailable" };
      clearedActiveRunKeys.add(activeRunGuardKey(session.account.accountId, runKey));
      agentBusyNoticeAt.delete(`${session.account.accountId}:${runKey}`);
      await store.deleteActiveRun(session.account.accountId, runKey);
      await sendText(session, event.chatId, cancelled?.ok === false ? `已清理飞书侧任务记录，但本地取消失败：${cancelled.error ?? "unknown error"}` : "已取消当前飞书会话的本地 Agent 任务。");
    }
  }

  async function handleApprovalCommand(session, event, command) {
    if (typeof runtime?.resolveApproval !== "function") {
      await sendText(session, event.chatId, "当前本地 Agent runtime 不支持飞书内审批。请在 Studio 中处理审批。");
      return;
    }
    const pendingRuns = await pendingApprovalRunsForChat(session, event.chatId);
    if (!pendingRuns.length) {
      await sendText(session, event.chatId, "当前飞书会话没有等待审批的本地 Agent 任务。");
      return;
    }
    const targets = command.all ? pendingRuns : [pendingRuns[0]];
    let resolvedCount = 0;
    const errors = [];
    for (const run of targets) {
      const approvals = Array.isArray(run.pendingApprovals) ? run.pendingApprovals : [];
      const approvalTargets = command.all ? approvals : approvals.slice(0, 1);
      for (const approval of approvalTargets) {
        const result = await runtime.resolveApproval({ runId: run.runId, approvalId: approval.id, decision: command.decision }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
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
      await sendText(session, event.chatId, `审批处理失败：\n${errors.join("\n")}`);
      return;
    }
    const action = command.decision === "decline" ? "拒绝" : "批准";
    const suffix = errors.length ? `\n部分审批失败：\n${errors.join("\n")}` : "";
    await sendText(session, event.chatId, `已${action} ${resolvedCount} 个审批请求，Agent 将继续处理。${suffix}`);
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
      await sendText(session, input.chatId, `需要先在 Studio 本机批准配对。配对码：${code}`);
      appendLog({ type: "warn", text: `feishu pairing requested for ${input.platformUserId}, code=${code}` });
    } else {
      appendLog({ type: "warn", text: `feishu pairing request returned no code for ${input.platformUserId}` });
    }
    return false;
  }

  async function getChannelSession(session, event, agent) {
    if (!channelSessionStore) return null;
    const channelSession = await channelSessionStore.getOrCreateSession({
      platformType: "feishu",
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
    if (!channelSession.conversationId && runtime?.createConversation) {
      try {
        const created = await runtime.createConversation({
          workspaceRoot: session.options.workspaceRoot,
          agent: { provider: agent.provider, id: agent.id },
          source: "channel",
          title: `飞书 ${event.senderId}@${event.chatId}`,
          metadata: {
            channelChatId: event.chatId,
            platformType: "feishu",
            platformUserId: event.senderId,
          },
        });
        const conversationId = created?.conversation?.id ?? created?.id ?? null;
        if (conversationId) {
          await channelSessionStore.bindConversation(channelSession.id, conversationId);
        }
      } catch (error) {
        appendLog({ type: "warn", text: `feishu conversation bind failed: ${error?.message ?? String(error)}` });
      }
    }
    return channelSessionStore.getSession(channelSession.id) ?? channelSession;
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

  // Parity S4 (reverse relay): when Studio sends a message on a conversation
  // that this channel has bound to an IM chat, push it back to that chat.
  // Subscribes to the bus event emitted by channel-runtime.relayStudioMessage;
  // only acts when the target platform matches this service (feishu).
  let _studioRelayUnsub = null;
  function subscribeStudioRelay() {
    if (!channelEventBus || _studioRelayUnsub) return;
    _studioRelayUnsub = channelEventBus.subscribe("channel:conversation:message:from-studio", (event) => {
      const payload = event?.payload ?? event ?? {};
      if (String(payload?.platformType ?? "").toLowerCase() !== "feishu") return;
      const chatId = String(payload?.chatId ?? "").trim();
      const text = String(payload?.text ?? "").trim();
      if (!chatId || !text) return;
      void sendText(active, chatId, text).catch((error) => {
        appendLog({ type: "error", text: `feishu studio-relay send failed: ${error?.message ?? String(error)}` });
      });
    });
  }
  function unsubscribeStudioRelay() {
    if (_studioRelayUnsub) {
      try { _studioRelayUnsub(); } catch { /* noop */ }
      _studioRelayUnsub = null;
    }
  }

  return {
    start,
    stop,
    status: () => snapshot(),
    accountStatus,
    saveAccount,
    autoStart,
    simulateInbound,
    processWebhookPayload: (payload, input = {}) => {
      const session = active ?? { account: input.account, store, options: runtimeOptions(input), controller: new AbortController() };
      return processWebhookPayload(session, payload);
    },
    processWebSocketPayload: (payload, input = {}) => {
      const session = active ?? { account: input.account, store, options: runtimeOptions(input), controller: new AbortController() };
      return processWebSocketPayload(session, payload);
    },
  };
}

function readFeishuContent(rawContent) {
  let payload = {};
  try {
    payload = typeof rawContent === "string" ? JSON.parse(rawContent || "{}") : rawContent ?? {};
  } catch {
    payload = { text: String(rawContent ?? "") };
  }
  if (typeof payload?.text === "string") return payload.text;
  if (typeof payload?.title === "string") return payload.title;
  if (payload?.post && typeof payload.post === "object") return flattenText(payload.post);
  return flattenText(payload);
}

function flattenText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  return [value.title, value.text, value.content, value.name].map(flattenText).filter(Boolean).join(" ");
}

function normalizeFeishuWebhookEvent(payload = {}) {
  const event = payload.event ?? payload;
  const message = event.message ?? event;
  const sender = event.sender ?? {};
  const senderIdObject = sender.sender_id ?? sender.id ?? {};
  const senderId = String(senderIdObject.union_id ?? senderIdObject.open_id ?? senderIdObject.user_id ?? sender.open_id ?? sender.user_id ?? event.open_id ?? "").trim();
  const chatId = String(message.chat_id ?? message.open_chat_id ?? event.chat_id ?? senderId).trim();
  const messageId = String(message.message_id ?? event.message_id ?? "").trim();
  const chatTypeRaw = String(message.chat_type ?? event.chat_type ?? "p2p").toLowerCase();
  const text = readFeishuContent(message.content ?? event.content ?? "").trim();
  const accountId = String(payload.header?.app_id ?? payload.schema?.app_id ?? "").trim();
  return {
    accountId,
    senderId,
    messageId,
    chatId,
    chatType: chatTypeRaw === "group" ? "group" : "dm",
    text,
    raw: payload,
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
    modelByChat: new Map(),
    promptModeByChat: new Map(),
    approvalMode: normalizeApprovalMode(input.approvalMode),
    promptMode: normalizePromptMode(input.promptMode),
    connectionMode: normalizeConnectionMode(input.connectionMode),
    dmPolicy,
    allowedUsers,
    groupPolicy,
    allowedGroups,
    textBatchDelayMs: Number.isFinite(Number(input.textBatchDelayMs)) ? Math.max(0, Number(input.textBatchDelayMs)) : DEFAULT_TEXT_BATCH_DELAY_MS,
    sendChunkDelayMs: Number.isFinite(Number(input.sendChunkDelayMs)) ? Math.max(0, Number(input.sendChunkDelayMs)) : 800,
    timeoutMs: Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : undefined,
    historyLimit: Number.isFinite(Number(input.historyLimit)) ? Math.max(0, Number(input.historyLimit)) : DEFAULT_HISTORY_LIMIT,
    historyStoreLimit: Number.isFinite(Number(input.historyStoreLimit)) ? Math.max(1, Number(input.historyStoreLimit)) : DEFAULT_HISTORY_STORE_LIMIT,
    webhookHost: String(input.webhookHost ?? "127.0.0.1").trim() || "127.0.0.1",
    webhookPort: Number.isFinite(Number(input.webhookPort)) ? Number(input.webhookPort) : 8765,
    webhookPath: normalizeWebhookPath(input.webhookPath),
  };
}

function normalizeWebhookPath(value) {
  const raw = String(value ?? "/feishu/webhook").trim() || "/feishu/webhook";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function normalizeConnectionMode(value) {
  const mode = String(value ?? "websocket").trim().toLowerCase();
  if (mode === "webhook") return "webhook";
  return "websocket";
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
  return options.length === 0 ? raw : null;
}

function renderModelHelp(agent, currentModel) {
  const label = agent ? agentLabel(agent) : "unknown";
  const options = agentModelOptionsFor(agent);
  const current = currentModel ? currentModel : (agent?.defaultModel || agent?.model || "");
  const header = current
    ? `当前 ${label} 使用模型：${current}`
    : `当前 ${label} 使用默认模型`;
  if (options.length === 0) {
    return [
      header,
      "该 Agent 未提供可选模型列表。可发送 #model <模型名> 手动切换；发送 #model default 恢复默认。",
    ].join("\n");
  }
  return [
    header,
    "可用模型：",
    ...options.map((option) => `- ${option.id}${option.label && option.label !== option.id ? ` (${option.label})` : ""}`),
    "",
    "发送 #model <id> 切换当前飞书会话的模型；发送 #model default 恢复默认。",
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
  return { decision: accept ? (session ? "acceptForSession" : "accept") : "decline", all: args.includes("all") || args.includes("全部") };
}

function agentLabel(agent) {
  return `${agent.name || agent.id} (${agent.provider}${agent.id && agent.id !== agent.provider ? `/${agent.id}` : ""})`;
}

function agentAliases(agent) {
  return [agent.id, agent.provider, agent.name].map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean);
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

function scopedFeishuRuntimeAgent(agent, event) {
  const scopeHash = stableHash(`${event.accountId}\n${event.chatId}\n${agent.provider}\n${agent.id}`);
  return { ...agent, id: `${safeSegment(agent.id)}-feishu-${scopeHash}`, name: agent.name ? `${agent.name} · Feishu` : `${agent.provider} · Feishu` };
}

function renderAgentHelp(session, chatId) {
  const current = session.options.agentByChat.get(chatId) ?? session.options.agent;
  return [`当前回复 Agent：${agentLabel(current)}`, "可用 Agent：", ...session.options.availableAgents.map((agent) => `- ${agent.id}: ${agentLabel(agent)}`), "", "发送 #agent <id> 切换，例如：#agent codex"].join("\n");
}

function renderModeHelp(session, chatId) {
  const current = session.options.promptModeByChat.get(chatId) ?? session.options.promptMode;
  return [`当前转发模式：${current}`, "可用模式：raw、debug", "发送 #mode raw 使用原文直通；发送 #mode debug 使用调试上下文。"].join("\n");
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

function renderRunsList(runs) {
  const items = Array.isArray(runs) ? runs : [];
  if (!items.length) return "当前账号没有运行中的飞书本地 Agent 任务。";
  return ["当前账号运行中的任务：", ...items.map((run) => `- ${String(run.chatId ?? "?")} / ${run?.agent?.id ?? "unknown"}: ${String(run.status ?? "running")} (${safeId(run.runId, 12)})`)].join("\n");
}

function buildPrompt(event, options = {}) {
  const mode = normalizePromptMode(options.mode);
  if (mode === "raw") return String(event.text ?? "").trim();
  const history = Array.isArray(options.history) ? options.history : [];
  const historyLines = history.length ? ["", "最近对话:", ...history.map((item) => `- ${item.role || "unknown"}${item.agentId ? `/${item.agentId}` : ""}: ${String(item.text ?? "").trim()}`)] : [];
  const agent = options.agent ?? {};
  return [
    "来源: Feishu/Lark",
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
  if (typeof runtime.startMessage !== "function" || typeof runtime.getRun !== "function") return await runtime.runMessage(input);
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
  splitTextForFeishu,
  buildPrompt,
  isAllowed,
  normalizeRuntimeOptions,
  normalizePromptMode,
  normalizeConnectionMode,
  parseAgentSwitchCommand,
  parseModeCommand,
  parseModelSwitchCommand,
  parseRunCommand,
  parseApprovalCommand,
  normalizeFeishuWebhookEvent,
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
  scopedFeishuRuntimeAgent,
  runAgentTurn,
};
