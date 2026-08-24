import { randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createFeishuClient, FEISHU_BASE_URL } from "./client.mjs";
import { getChannelRunSnapshotState } from "./local-qr.mjs";
import {
  activeRunGuardKey, activeRunKey, agentLabel, buildPrompt, chatAgentHistoryKey,
  normalizePromptMode, parseAgentSwitchCommand, parseApprovalCommand,
  parseModeCommand, parseModelSwitchCommand, parseRunCommand, renderAgentHelp,
  renderApprovalPrompt, renderModeHelp, renderRunsList, renderRunStatus,
  resolveAgentAlias, runAgentTurn, safeId, scopedFeishuRuntimeAgent, sleep,
  splitTextForFeishu,
} from "./service-helpers.mjs";
import { createFeishuStore, sanitizeAccount } from "./store.mjs";
import { createFeishuWebSocketClient } from "./ws-client.mjs";
import {
  ONMYAGENT_ASSISTANT_AGENT_ID,
  ONMYAGENT_ASSISTANT_PROVIDER,
  createOnMyAgentAssistantAgent,
  normalizeChannelAgent,
  runAssistantBridgeTurn,
} from "../channels/assistant-bridge.mjs";
import { formatAgentReply, formatAgentResultOutput } from "../channels/AgentReplyHeader.mjs";
import { createMessagingTaskAdapter } from "../channels/messaging-task-adapter.mjs";

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
// runtime already enforces its own run timeout (max 12h), but that timer lives
// in the runtime process and is lost if the desktop app restarts.
const ACTIVE_RUN_MAX_AGE_MS = 12 * 60 * 60 * 1000 + 15 * 60 * 1000;
const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

function safeCompare(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function stoppedDeliveryError(attemptedTransports) {
  return Object.assign(new Error("Feishu channel stopped during delivery"), {
    name: "AbortError",
    attemptedTransports,
  });
}

function stoppedBeforeFirstTransport(error) {
  return error?.name === "AbortError" && Number(error?.attemptedTransports ?? -1) === 0;
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
  const channelTranscriptStore = options.channelTranscriptStore ?? null;
  const channelEventBus = options.channelEventBus ?? null;
  const messagingTaskAdapter = createMessagingTaskAdapter({
    taskMessageRouter: options.taskMessageRouter,
  });
  const dedup = new TtlSet(5 * 60_000);
  const pendingBatches = new Map();
  const agentBusyNoticeAt = new Map(); // busyKey -> lastNoticeAt (ms)
  const activeRunPollers = new Map();
  const activeRunPollTasks = new Set();
  const activeRunPollsInFlight = new Map();
  const activeRunPendingSchedules = new Map();
  const activeRunRecords = new Map();
  const activeRunGenerations = new Map();
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

  function activeRunRecordKey(accountId, runKey) {
    return activeRunGuardKey(accountId, runKey);
  }

  function bumpActiveRunGeneration(key) {
    const generation = (activeRunGenerations.get(key) ?? 0) + 1;
    activeRunGenerations.set(key, generation);
    return generation;
  }

  function syntheticActiveRun(accountId, runKey, value = {}, fallback = undefined) {
    const now = Date.now();
    const prior = activeRunRecords.get(activeRunRecordKey(accountId, runKey));
    const base = prior && typeof prior === "object"
      ? prior
      : fallback && typeof fallback === "object"
        ? fallback
        : {};
    const record = {
      ...base,
      ...value,
      runKey: String(runKey),
      accountId: String(accountId),
      updatedAt: now,
      createdAt: base.createdAt ?? value?.createdAt ?? now,
    };
    delete record.reservationToken;
    return record;
  }

  function reserveActiveRun(accountId, runKey, value = {}) {
    const key = activeRunRecordKey(accountId, runKey);
    const existing = activeRunRecords.get(key);
    if (existing) return { acquired: false, record: existing, token: null };
    const token = Symbol("feishu-active-run-reservation");
    const record = syntheticActiveRun(accountId, runKey, { ...value, status: "starting" });
    record.reservationToken = token;
    bumpActiveRunGeneration(key);
    activeRunRecords.set(key, record);
    return { acquired: true, record, token };
  }

  function releaseActiveRunReservation(accountId, runKey, token) {
    const key = activeRunRecordKey(accountId, runKey);
    if (activeRunRecords.get(key)?.reservationToken === token) activeRunRecords.delete(key);
  }

  async function readActiveRunSafely(accountId, runKey) {
    const key = activeRunRecordKey(accountId, runKey);
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
    const key = activeRunRecordKey(accountId, runKey);
    const generation = activeRunGenerations.get(key) ?? 0;
    const prior = activeRunRecords.get(key);
    const synthetic = syntheticActiveRun(accountId, runKey, value, fallback);
    try {
      const stored = await store.writeActiveRun(accountId, runKey, synthetic);
      const record = stored && typeof stored === "object" ? { ...synthetic, ...stored } : synthetic;
      if ((activeRunGenerations.get(key) ?? 0) !== generation) {
        const current = activeRunRecords.get(key);
        if (current === null || current === undefined) {
          // A concurrent terminal cleanup won the generation race. Remove the
          // stale write again so it cannot resurrect after an app restart.
          await store.deleteActiveRun(accountId, runKey).catch((error) => {
            appendLog({ type: "error", text: `feishu stale active run cleanup failed: ${error instanceof Error ? error.message : String(error)}` });
          });
        }
        return current;
      }
      activeRunRecords.set(key, record);
      return record;
    } catch (error) {
      appendLog({ type: "error", text: `feishu active run persistence failed: ${error instanceof Error ? error.message : String(error)}` });
      if ((activeRunGenerations.get(key) ?? 0) !== generation) {
        return activeRunRecords.get(key);
      }
      if (required) {
        if (prior === undefined) activeRunRecords.delete(key);
        else activeRunRecords.set(key, prior);
        throw error;
      }
      activeRunRecords.set(key, synthetic);
      return synthetic;
    }
  }

  async function deleteActiveRunSafely(accountId, runKey) {
    const key = activeRunRecordKey(accountId, runKey);
    bumpActiveRunGeneration(key);
    activeRunRecords.set(key, null);
    try {
      const deleted = await store.deleteActiveRun(accountId, runKey);
      if (activeRunRecords.get(key) === null) activeRunRecords.delete(key);
      return deleted;
    } catch (error) {
      appendLog({ type: "error", text: `feishu active run cleanup failed: ${error instanceof Error ? error.message : String(error)}` });
      return false;
    }
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
    if (!current) {
      agentByChat.clear();
      promptModeByChat.clear();
      return { ok: true, status: snapshot({ status: state.status === "error" ? "error" : "stopped" }) };
    }
    current.controller.abort();
    active = null;
    for (const entry of pendingBatches.values()) clearTimeout(entry.timer);
    pendingBatches.clear();
    for (const timer of activeRunPollers.values()) clearTimeout(timer);
    activeRunPollers.clear();
    activeRunPendingSchedules.clear();
    // Provider getRun calls may be long-lived. Poll continuations check the
    // aborted signal before any transport or persistence side effect.
    activeRunPollTasks.clear();
    activeRunPollsInFlight.clear();
    for (const [key, record] of activeRunRecords) {
      if (!record?.reservationToken) continue;
      bumpActiveRunGeneration(key);
      activeRunRecords.delete(key);
    }
    current.wsClient?.stop?.();
    await closeWebhookServer(current.server);
    // Account changes reuse this service instance; clear per-chat memory so
    // an old account's Agent override cannot bleed into the next account.
    agentByChat.clear();
    promptModeByChat.clear();
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
    const isControlCommand = messagingTaskAdapter.canRoute(event.text) || parseApprovalCommand(event.text) || parseRunCommand(event.text) || parseModeCommand(event.text) || parseModelSwitchCommand(event.text) || parseAgentSwitchCommand(event.text);
    if (!isControlCommand) {
      const contentKey = `content:${event.senderId}:${event.chatId}:${event.text}`;
      if (dedup.hasOrAdd(contentKey)) return null;
    }
    await channelTranscriptStore?.recordInbound?.({
      platformType: "feishu",
      accountId: event.accountId ?? session.account.accountId,
      chatId: event.chatId,
      platformUserId: event.senderId,
      externalId: event.messageId,
      content: event.text,
      role: isControlCommand ? "command" : "user",
      metadata: { chatType: event.chatType },
    }).catch(() => undefined);
    if (!isAllowed(session.options, event, event.senderId)) {
      appendLog({ type: "warn", text: `feishu inbound dropped (policy): sender=${event.senderId} chatType=${event.chatType}` });
      return null;
    }
    if (!(await ensureChannelUserAuthorized(session, {
      platformType: "feishu",
      platformUserId: event.senderId,
      chatId: event.chatId,
      displayName: event.senderId,
    }))) {
      appendLog({ type: "warn", text: `feishu inbound dropped (unauthorized): sender=${event.senderId} chatId=${event.chatId}` });
      return null;
    }
    setState({ lastMessageAt: Date.now(), processedCount: state.processedCount + 1 });
    const taskRoute = await messagingTaskAdapter.tryRoute({
      platform: "feishu",
      accountId: event.accountId ?? session.account.accountId,
      chatId: event.chatId,
      senderId: event.senderId,
      messageId: event.messageId,
      text: event.text,
      attachments: event.attachments ?? event.mediaFiles,
    }, {
      appendLog,
      reply: (replyText) => sendText(session, event.chatId, replyText),
    });
    if (taskRoute.handled) return event;
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
        void sendText(
          session,
          batchEvent.chatId,
          `处理失败：${message}\n\n请检查 Studio 中飞书通道的本地 Agent 配置。`,
        ).catch(() => undefined);
      });
    }, session.options.textBatchDelayMs);
    pendingBatches.set(key, { event: batchEvent, agent, timer });
  }

  // Routes an IM chat bound to the `onmyagent` pseudo-agent to the desktop
  // assistant tab via the shared AssistantBridge helper. Pure additive path —
  // only provider `onmyagent-assistant` reaches here.
  function runFeishuAssistantBridgeTurn(session, event) {
    return runAssistantBridgeTurn({
      runtime,
      store,
      session,
      event,
      platformLabel: "feishu",
      appendLog,
      readChatSetting: storeSafeReadChatSetting,
      deliverReply: (s, e, text) => (
        sendText(s, e.chatId, text, null, e.agentSnapshot)
      ),
      deliverLocalNotice: async (s, e, text) => {
        await sendRunNotice(s, { ...e, agent: e.agentSnapshot }, text);
      },
    });
  }

  async function reportBusyRun(session, event, agent, runKey, run) {
    if (run?.runId) scheduleActiveRunPoll(session, run, 0);
    if (event.isLocalPrompt) return run ? { ...run, existingRun: true } : null;
    const busyKey = activeRunGuardKey(session.account.accountId, runKey);
    const nowTs = Date.now();
    const lastAt = agentBusyNoticeAt.get(busyKey) ?? 0;
    if (nowTs - lastAt >= AGENT_BUSY_NOTICE_INTERVAL_MS) {
      agentBusyNoticeAt.set(busyKey, nowTs);
      await sendText(session, event.chatId, `${agentLabel(agent)} 还在处理上一条消息，请稍后再试。发送 #status 查看进度，或 #cancel 取消后再重发。`).catch(() => undefined);
    }
    return run ? { ...run, existingRun: true } : null;
  }

  async function sendRunNotice(session, record, text, role = "error") {
    if (record?.isLocalPrompt) {
      await channelTranscriptStore?.recordLocalNotice?.({
        platformType: "feishu",
        accountId: session.account.accountId,
        chatId: record.chatId,
        platformUserId: record.senderId,
        content: text,
        role,
        agentId: record.agent?.id,
        agentName: record.agent?.name ?? record.agent?.id,
      }).catch(() => undefined);
      return null;
    }
    return sendText(session, record.chatId, text, null, record.agent);
  }

  async function dispatchToAgent(session, event) {
    if (session.controller.signal.aborted) return null;
    if (!runtime?.runMessage && (!runtime?.startMessage || !runtime?.getRun)) throw new Error("personal agent runtime is unavailable");
    const agent = event.agentSnapshot ?? await currentAgentForChat(session, event.chatId);
    channelTranscriptStore?.setActiveAgent?.({
      platformType: "feishu",
      accountId: session.account.accountId,
      chatId: event.chatId,
      agentId: agent?.id,
      agentName: agent?.name ?? agent?.id,
    });
    if (session.controller.signal.aborted) return null;
    if (agent.provider === ONMYAGENT_ASSISTANT_PROVIDER) {
      if (typeof event.onAccepted === "function") await event.onAccepted({ agent, runKey: null });
      return await runFeishuAssistantBridgeTurn(session, event);
    }
    const promptMode = await currentPromptModeForChat(session, event.chatId);
    if (session.controller.signal.aborted) return null;
    const historyKey = chatAgentHistoryKey(event.chatId, agent);
    const runKey = activeRunKey(event.chatId, agent);
    const existingRun = await readActiveRunSafely(session.account.accountId, runKey);
    if (session.controller.signal.aborted) return null;
    if (existingRun) return await reportBusyRun(session, event, agent, runKey, existingRun);
    const reservation = reserveActiveRun(session.account.accountId, runKey, {
      accountId: session.account.accountId,
      chatId: event.chatId,
      senderId: event.senderId,
      agent,
      historyKey,
      startedAt: Date.now(),
    });
    if (!reservation.acquired) {
      return await reportBusyRun(session, event, agent, runKey, reservation.record);
    }
    let reservationPromoted = false;
    try {
      if (typeof event.onAccepted === "function") await event.onAccepted({ agent, runKey });
      const runtimeAgent = scopedFeishuRuntimeAgent(agent, event);
      const channelSession = await getChannelSession(session, event, agent);
      if (session.controller.signal.aborted) return null;
      const history = await store.readChatHistory(session.account.accountId, historyKey, session.options.historyLimit).catch(() => []);
      if (session.controller.signal.aborted) return null;
      const prompt = buildPrompt(event, { mode: promptMode, history, agent });
      if (typeof runtime.startMessage !== "function" || typeof runtime.getRun !== "function") {
        const legacyModel = await currentModelForChat(session, event.chatId);
        if (session.controller.signal.aborted) return null;
        const result = await runAgentTurn(runtime, {
          workspaceRoot: session.options.workspaceRoot,
          accessibleWorkspaceRoots: session.options.accessibleWorkspaceRoots,
          prompt,
          agent: runtimeAgent,
          model: legacyModel || undefined,
          approvalMode: session.options.approvalMode,
          timeoutMs: session.options.timeoutMs,
        });
        if (session.controller.signal.aborted) return result;
        setState({ lastRunId: result?.runId ?? null });
        return await handleSynchronousAgentResult(
          session,
          event,
          { agent, historyKey, result, channelSession },
        );
      }
      const chatModel = await currentModelForChat(session, event.chatId);
      if (session.controller.signal.aborted) return null;
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
      if (session.controller.signal.aborted) {
        if (started?.runId && typeof runtime.cancelRun === "function") {
          await runtime.cancelRun(started.runId, { reason: "feishu_stopped" }).catch((error) => {
            appendLog({ type: "error", text: `feishu late-start cleanup failed: ${error instanceof Error ? error.message : String(error)}` });
          });
        }
        return started;
      }
      setState({ lastRunId: started?.runId ?? null });
      if (started?.status && started.status !== "running") {
        return await handleSynchronousAgentResult(
          session,
          event,
          { agent, historyKey, result: started, channelSession },
        );
      }
      if (!started?.runId) {
        return await handleSynchronousAgentResult(
          session,
          event,
          { agent, historyKey, result: started, channelSession },
        );
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
        isLocalPrompt: Boolean(event.isLocalPrompt),
        approvalMode: session.options.approvalMode,
        historyStoreLimit: session.options.historyStoreLimit,
        channelSessionId: channelSession?.id ?? null,
        pendingApprovalNotifiedAt: null,
        startedAt: Date.now(),
      }, reservation.record);
      if (!trackedRun?.runId) {
        if (session.controller.signal.aborted && typeof runtime.cancelRun === "function") {
          await runtime.cancelRun(started.runId, { reason: "feishu_stopped" }).catch(() => undefined);
        }
        return trackedRun;
      }
      reservationPromoted = true;
      clearedActiveRunKeys.delete(activeRunGuardKey(session.account.accountId, runKey));
      scheduleActiveRunPoll(session, trackedRun, 0);
      return trackedRun;
    } finally {
      if (!reservationPromoted) {
        releaseActiveRunReservation(session.account.accountId, runKey, reservation.token);
      }
    }
  }

  async function handleSynchronousAgentResult(session, event, { agent, historyKey, result, channelSession }) {
    const resultState = getChannelRunSnapshotState(result);
    if (resultState.status === "running" && resultState.hasPendingApprovals) {
      await sendRunNotice(session, { ...event, agent }, "需要在 Studio 中审批后继续处理。", "system");
      return result;
    }
    if (!resultState.isCompletedWithOutput) {
      await sendRunNotice(session, { ...event, agent }, "本次处理失败，请在 Studio 查看本地 Agent 日志。");
      return result;
    }
    const deliveredOutput = formatAgentResultOutput(result);
    try {
      await sendText(session, event.chatId, formatAgentReply({ agent, text: deliveredOutput }), null, agent);
    } catch (error) {
      if (!event.isLocalPrompt) throw error;
      const message = error instanceof Error ? error.message : String(error);
      await sendRunNotice(
        session,
        { ...event, agent },
        `Agent 回复已生成，但发送到飞书失败：${message}`,
      );
      return { ...result, status: "failed", error: message };
    }
    await appendAgentHistory(session, historyKey, event.text, deliveredOutput, agent, session.options.historyStoreLimit);
    if (!event.isLocalPrompt) await appendChannelSessionHistory(channelSession, event.text, deliveredOutput, agent);
    return result;
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
      clearedActiveRunKeys.delete(pollKey);
    }
  }

  function scheduleActiveRunPoll(session, run, delayMs = ACTIVE_RUN_POLL_INTERVAL_MS) {
    if (session.controller.signal.aborted || !run?.runKey || !run?.runId || !runtime?.getRun) return;
    const pollKey = activeRunGuardKey(session.account.accountId, run.runKey);
    if (clearedActiveRunKeys.has(pollKey)) return;
    const normalizedDelayMs = Number.isFinite(Number(delayMs)) ? Math.max(0, Number(delayMs)) : ACTIVE_RUN_POLL_INTERVAL_MS;
    if (activeRunPollsInFlight.has(pollKey)) {
      const priorPending = activeRunPendingSchedules.get(pollKey);
      if (!priorPending || normalizedDelayMs < priorPending.delayMs) {
        activeRunPendingSchedules.set(pollKey, { session, run, delayMs: normalizedDelayMs });
      }
      return;
    }
    const prior = activeRunPollers.get(pollKey);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      activeRunPollers.delete(pollKey);
      const task = pollActiveRun(session, run.runKey, run).catch((error) => {
        if (session.controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({ lastError: message });
        appendLog({ type: "error", text: `feishu active run delivery failed: ${message}` });
        if (!clearedActiveRunKeys.has(pollKey)) {
          scheduleActiveRunPoll(session, run, ACTIVE_RUN_POLL_INTERVAL_MS);
        }
      }).finally(() => {
        activeRunPollTasks.delete(task);
        if (activeRunPollsInFlight.get(pollKey) === task) activeRunPollsInFlight.delete(pollKey);
        const pending = activeRunPendingSchedules.get(pollKey);
        activeRunPendingSchedules.delete(pollKey);
        if (pending) scheduleActiveRunPoll(pending.session, pending.run, pending.delayMs);
      });
      activeRunPollTasks.add(task);
      activeRunPollsInFlight.set(pollKey, task);
    }, normalizedDelayMs);
    activeRunPollers.set(pollKey, timer);
  }

  function claimActiveRunPoll(accountId, runKey) {
    const pollKey = activeRunGuardKey(accountId, runKey);
    if (clearedActiveRunKeys.has(pollKey)) return false;
    clearedActiveRunKeys.add(pollKey);
    const prior = activeRunPollers.get(pollKey);
    if (prior) clearTimeout(prior);
    activeRunPollers.delete(pollKey);
    activeRunPendingSchedules.delete(pollKey);
    return true;
  }

  async function claimTerminalDelivery(session, runKey, record, trackTransportAttempts = false) {
    const accountId = session.account.accountId;
    const pollKey = activeRunGuardKey(accountId, runKey);
    const runId = String(record?.runId ?? "").trim();
    if (!runId || !claimActiveRunPoll(accountId, runKey)) {
      return { shouldDeliver: false, shouldCleanup: false };
    }
    if (String(record?.terminalDeliveryClaimedRunId ?? "").trim() === runId) {
      return {
        shouldDeliver: trackTransportAttempts && record?.terminalDeliveryAttemptedTransports === 0,
        shouldCleanup: true,
      };
    }
    const key = activeRunRecordKey(accountId, runKey);
    const generation = activeRunGenerations.get(key) ?? 0;
    const claimed = syntheticActiveRun(accountId, runKey, {
      status: "terminal_delivery_claimed",
      terminalDeliveryClaimedRunId: runId,
      terminalDeliveryClaimedAt: Date.now(),
      ...(trackTransportAttempts ? { terminalDeliveryAttemptedTransports: 0 } : {}),
    }, record);
    try {
      const stored = await store.writeActiveRun(accountId, runKey, claimed);
      if ((activeRunGenerations.get(key) ?? 0) !== generation) {
        const current = activeRunRecords.get(key);
        if (current === null || current === undefined) await store.deleteActiveRun(accountId, runKey).catch(() => undefined);
        return { shouldDeliver: false, shouldCleanup: false };
      }
      activeRunRecords.set(key, stored && typeof stored === "object" ? { ...claimed, ...stored } : claimed);
      return { shouldDeliver: true, shouldCleanup: true };
    } catch (error) {
      clearedActiveRunKeys.delete(pollKey);
      appendLog({ type: "error", text: `feishu terminal delivery claim persistence failed: ${error instanceof Error ? error.message : String(error)}` });
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

  async function cleanupClaimedActiveRun(session, runKey, record) {
    const pollKey = activeRunGuardKey(session.account.accountId, runKey);
    const runId = String(record?.runId ?? "").trim();
    const current = activeRunRecords.get(activeRunRecordKey(session.account.accountId, runKey));
    if (current && String(current?.runId ?? "").trim() !== runId) return false;
    agentBusyNoticeAt.delete(pollKey);
    await deleteActiveRunSafely(session.account.accountId, runKey);
    return true;
  }

  async function pollActiveRun(session, runKey, fallbackRecord = null) {
    if (session.controller.signal.aborted) return;
    const record = await readActiveRunSafely(session.account.accountId, runKey) ?? fallbackRecord;
    if (!record?.runId) return;
    const pollKey = activeRunGuardKey(session.account.accountId, runKey);
    if (clearedActiveRunKeys.has(pollKey)) return;
    const result = await runtime.getRun({ runId: record.runId, workspaceRoot: record.workspaceRoot });
    if (session.controller.signal.aborted || clearedActiveRunKeys.has(pollKey)) return;
    if (!result) {
      const claim = await claimTerminalDelivery(session, runKey, record);
      if (!claim.shouldDeliver) {
        if (claim.shouldCleanup) await cleanupClaimedActiveRun(session, runKey, record);
        return;
      }
      const message = "本次本地 Agent 任务已不在运行（可能主进程重启/崩溃后遗留，或已超时中断）。已自动清除会话锁，可重新发送消息。";
      try {
        await sendRunNotice(session, record, message).catch(() => undefined);
      } finally {
        await cleanupClaimedActiveRun(session, runKey, record);
      }
      return;
    }
    setState({ lastRunId: record.runId });
    const resultState = getChannelRunSnapshotState(result);
    if (resultState.isCompletedWithOutput) {
      const claim = await claimTerminalDelivery(session, runKey, record, true);
      if (!claim.shouldDeliver) {
        if (claim.shouldCleanup) await cleanupClaimedActiveRun(session, runKey, record);
        return;
      }
      const deliveredOutput = formatAgentResultOutput(result);
      let preserveForResume = false;
      try {
        channelTranscriptStore?.setActiveAgent?.({
          platformType: "feishu",
          accountId: session.account.accountId,
          chatId: record.chatId,
          agentId: record.agent?.id,
          agentName: record.agent?.name ?? record.agent?.id,
        });
        await sendText(
          session,
          record.chatId,
          formatAgentReply({ agent: record.agent, text: deliveredOutput }),
          () => markTerminalDeliveryAttempted(session, runKey, record),
          record.agent,
        );
        await appendAgentHistory(session, record.historyKey, record.userText, deliveredOutput, record.agent, record.historyStoreLimit ?? session.options.historyStoreLimit);
        if (!record.isLocalPrompt) await appendChannelSessionHistoryById(record.channelSessionId, record.userText, deliveredOutput, record.agent);
      } catch (error) {
        if (stoppedBeforeFirstTransport(error)) {
          preserveForResume = true;
          await releaseUnattemptedTerminalClaim(session, runKey, record);
          return;
        }
        if (error?.retryTerminalDelivery === true) {
          preserveForResume = true;
          clearedActiveRunKeys.delete(pollKey);
        }
        if (!preserveForResume && record.isLocalPrompt) {
          await sendRunNotice(session, record, `Agent 回复已生成，但发送到飞书失败：${error instanceof Error ? error.message : String(error)}`);
        }
        throw error;
      } finally {
        // A later chunk may fail after earlier chunks were accepted. Claim and
        // clear the terminal snapshot exactly once instead of replaying it.
        if (!preserveForResume) await cleanupClaimedActiveRun(session, runKey, record);
      }
      return;
    }
    if (resultState.isTerminal) {
      const claim = await claimTerminalDelivery(session, runKey, record);
      if (!claim.shouldDeliver) {
        if (claim.shouldCleanup) await cleanupClaimedActiveRun(session, runKey, record);
        return;
      }
      const message = resultState.status === "cancelled" ? "本次本地 Agent 任务已取消。" : `本次处理失败，请在 Studio 查看本地 Agent 日志。${result?.error ? `\n${result.error}` : ""}`;
      try {
        await sendRunNotice(session, record, message, resultState.status === "cancelled" ? "system" : "error");
      } finally {
        await cleanupClaimedActiveRun(session, runKey, record);
      }
      return;
    }
    // Apply the backstop to every non-terminal state, including approval
    // waits, so a stale pending snapshot cannot hold the chat lock forever.
    if (Date.now() - (record.startedAt ?? 0) > ACTIVE_RUN_MAX_AGE_MS) {
      const claim = await claimTerminalDelivery(session, runKey, record);
      if (!claim.shouldDeliver) {
        if (claim.shouldCleanup) await cleanupClaimedActiveRun(session, runKey, record);
        return;
      }
      const message = `本次本地 Agent 任务运行已超过上限（约 ${Math.round(ACTIVE_RUN_MAX_AGE_MS / 3_600_000)} 小时），已自动超时并清除会话锁。可重新发送消息。`;
      try {
        await sendRunNotice(session, record, message).catch(() => undefined);
      } finally {
        await cleanupClaimedActiveRun(session, runKey, record);
      }
      return;
    }
    const pendingApprovals = resultState.pendingApprovals;
    if (pendingApprovals.length && !record.pendingApprovalNotifiedAt) {
      if (clearedActiveRunKeys.has(pollKey)) return;
      const updated = await writeActiveRunSafely(
        session.account.accountId,
        runKey,
        { status: "pending_approval", pendingApprovalNotifiedAt: Date.now(), pendingApprovals },
        record,
      );
      if (!updated || clearedActiveRunKeys.has(pollKey)) return;
      try {
        await sendRunNotice(session, updated, renderApprovalPrompt(updated, pendingApprovals), "system");
      } finally {
        // The prompt is advisory. Keep observing the live run even when Feishu
        // rejects this notification.
        scheduleActiveRunPoll(session, updated, ACTIVE_RUN_PENDING_POLL_INTERVAL_MS);
      }
      return;
    }
    if (pendingApprovals.length) {
      if (clearedActiveRunKeys.has(pollKey)) return;
      const updated = await writeActiveRunSafely(session.account.accountId, runKey, { status: "pending_approval", pendingApprovals }, record);
      if (!updated || clearedActiveRunKeys.has(pollKey)) return;
      scheduleActiveRunPoll(session, updated, ACTIVE_RUN_PENDING_POLL_INTERVAL_MS);
      return;
    }
    if (!resultState.isRunning || clearedActiveRunKeys.has(pollKey)) return;
    const updated = await writeActiveRunSafely(session.account.accountId, runKey, { status: "running", pendingApprovals: [] }, record);
    if (!updated || clearedActiveRunKeys.has(pollKey)) return;
    scheduleActiveRunPoll(session, updated, ACTIVE_RUN_POLL_INTERVAL_MS);
  }

  async function sendText(session, chatId, text, beforeFirstTransport = null, agent = null) {
    const chunks = splitTextForFeishu(text);
    let lastResponse = null;
    let attemptedTransports = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      if (session.controller.signal.aborted) throw stoppedDeliveryError(attemptedTransports);
      if (attemptedTransports === 0 && beforeFirstTransport) await beforeFirstTransport();
      if (session.controller.signal.aborted) throw stoppedDeliveryError(attemptedTransports);
      attemptedTransports += 1;
      try {
        const transportDedupeKey = `studio-feishu-${randomUUID()}`;
        lastResponse = await client.sendText({
          baseUrl: session.account.baseUrl,
          appId: session.account.appId,
          appSecret: session.account.appSecret,
          receiveIdType: "chat_id",
          receiveId: chatId,
          text: chunks[index],
          uuid: transportDedupeKey,
        });
        await channelTranscriptStore?.recordOutbound?.({
          platformType: "feishu",
          accountId: session.account.accountId,
          chatId,
          content: chunks[index],
          externalId: lastResponse?.data?.message_id ?? lastResponse?.message_id,
          dedupeKey: lastResponse?.data?.message_id ?? lastResponse?.message_id ?? transportDedupeKey,
          agentId: String(agent?.id ?? "").trim() || undefined,
          agentName: String(agent?.name ?? agent?.id ?? "").trim() || undefined,
          metadata: { transportAction: "send", chunkIndex: index },
        }).catch(() => undefined);
      } catch (error) {
        if (error && typeof error === "object") error.attemptedTransports = attemptedTransports;
        throw error;
      }
      if (session.controller.signal.aborted) throw stoppedDeliveryError(attemptedTransports);
      if (index < chunks.length - 1) {
        await sleep(session.options.sendChunkDelayMs);
        if (session.controller.signal.aborted) throw stoppedDeliveryError(attemptedTransports);
      }
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
    const simulatedMessageId = messagingTaskAdapter.canRoute(input.text) && input.messageId == null
      ? ""
      : (input.messageId ?? `sim-${Date.now()}`);
    const event = await processEvent(session, {
      accountId: account.accountId,
      senderId: input.fromUserId ?? input.senderId ?? "ou_studio_test_user",
      messageId: simulatedMessageId,
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
      const enrichedAgent = await enrichAgentModelOptions(runtime, session, boundAgent).catch(() => boundAgent);
      const currentModel = await currentModelForChat(session, event.chatId);
      const rawTarget = modelCommand.target;
      if (!rawTarget) {
        await sendText(session, event.chatId, renderModelHelp(enrichedAgent, currentModel)).catch((error) => {
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
        await sendText(session, event.chatId, `已恢复当前飞书会话的默认模型（${agentLabel(enrichedAgent)}）。`).catch(() => undefined);
        return true;
      }
      const resolved = resolveAgentModelId(enrichedAgent, rawTarget);
      if (!resolved) {
        await sendText(session, event.chatId, `未在当前 Agent 的模型列表中找到：${rawTarget}\n\n${renderModelHelp(enrichedAgent, currentModel)}`).catch(() => undefined);
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
      if (priorRunKey) priorRun = await readActiveRunSafely(session.account.accountId, priorRunKey);
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
      const runs = await listActiveRunsSafely(session.account.accountId);
      await sendText(session, event.chatId, renderRunsList(runs));
      return;
    }
    const agent = await currentAgentForChat(session, event.chatId);
    const runKey = activeRunKey(event.chatId, agent);
    const run = await readActiveRunSafely(session.account.accountId, runKey);
    if (command.name === "new") {
      if (run) {
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
      if (run && !run.runId) {
        await sendText(session, event.chatId, "当前飞书会话和 Agent 的任务正在启动，请稍后再发送 #cancel。");
        return;
      }
      if (!run?.runId) {
        await sendText(session, event.chatId, "当前飞书会话和 Agent 没有可取消的任务。");
        return;
      }
      if (!claimActiveRunPoll(session.account.accountId, runKey)) {
        await sendText(session, event.chatId, "当前飞书会话和 Agent 的任务已在结束处理中。");
        return;
      }
      let cancelled;
      try {
        cancelled = typeof runtime?.cancelRun === "function"
          ? await runtime.cancelRun(run.runId, { reason: "feishu" }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
          : { ok: false, error: "runtime cancel is unavailable" };
      } finally {
        await cleanupClaimedActiveRun(session, runKey, run);
      }
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
      const updated = await writeActiveRunSafely(session.account.accountId, run.runKey, {
        status: remaining.length ? "pending_approval" : "running",
        pendingApprovals: remaining,
        pendingApprovalNotifiedAt: remaining.length ? run.pendingApprovalNotifiedAt : null,
      }, run);
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
    const runs = await listActiveRunsSafely(session.account.accountId);
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
      accountId: session.account.accountId,
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

  async function sendTaskDelivery(input = {}) {
    if (!active || state.status !== "running") return { ok: false, error: "Feishu is not running" };
    if (
      input.accountId
      && String(input.accountId) !== String(active.account.appId ?? active.account.accountId)
    ) {
      return { ok: false, error: "Feishu account is not active" };
    }
    const chatId = String(input.chatId ?? "").trim();
    const text = String(input.text ?? "").trim();
    if (!chatId || !text) return { ok: false, error: "chatId and text are required" };
    await sendText(active, chatId, text);
    return { ok: true };
  }

  async function runLocalPrompt(input = {}) {
    if (!active || state.status !== "running") return { ok: false, error: "Feishu is not running" };
    const accountId = String(
      input.accountId
      ?? active.account?.accountId
      ?? active.account?.appId
      ?? state.accountId,
    ).trim();
    if (accountId !== String(active.account?.accountId ?? active.account?.appId ?? state.accountId)) {
      return { ok: false, error: "Feishu account is not active" };
    }
    const chatId = String(input.chatId ?? "").trim();
    const text = String(input.text ?? "").trim();
    if (!chatId || !text) return { ok: false, error: "chatId and text are required" };
    const senderId = String(input.platformUserId ?? input.senderId ?? chatId).trim() || chatId;
    const agent = await currentAgentForChat(active, chatId);
    const runKey = activeRunKey(chatId, agent);
    const existingRun = agent.provider === ONMYAGENT_ASSISTANT_PROVIDER
      ? null
      : await readActiveRunSafely(accountId, runKey);
    if (existingRun) {
      if (existingRun.runId) scheduleActiveRunPoll(active, existingRun, 0);
      return {
        ok: false,
        error: "当前 Agent 仍在处理上一条消息，请等待完成后再试。",
        runId: existingRun.runId ?? null,
        status: existingRun.status ?? "running",
        existingRun: true,
        chatId,
        platformType: "feishu",
      };
    }
    channelTranscriptStore?.setActiveAgent?.({
      platformType: "feishu",
      accountId,
      chatId,
      agentId: agent?.id,
      agentName: agent?.name ?? agent?.id,
    });
    const event = {
      accountId,
      senderId,
      chatId,
      messageId: `studio-${randomUUID()}`,
      text,
      chatType: "dm",
      source: "operator",
      isLocalPrompt: true,
      agentSnapshot: agent,
      onAccepted: () => channelTranscriptStore?.recordOperatorPrompt?.({
        platformType: "feishu",
        accountId,
        chatId,
        platformUserId: senderId,
        content: text,
        metadata: { visibility: "local" },
      }).catch(() => undefined),
    };
    const result = await dispatchToAgent(active, event);
    if (!result || result.existingRun) {
      return {
        ok: false,
        error: "当前 Agent 仍在处理上一条消息，请等待完成后再试。",
        runId: result?.runId ?? null,
        status: result?.status ?? "running",
        existingRun: Boolean(result?.existingRun),
        chatId,
        platformType: "feishu",
      };
    }
    const resultStatus = String(result.status ?? "");
    if (resultStatus && resultStatus !== "running" && resultStatus !== "completed") {
      return {
        ok: false,
        error: result.error ?? "Agent prompt failed before a reply was produced.",
        status: resultStatus,
        chatId,
        platformType: "feishu",
      };
    }
    return {
      ok: true,
      runId: result?.runId ?? null,
      status: result?.status ?? "queued",
      chatId,
      platformType: "feishu",
    };
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
    runLocalPrompt,
    sendTaskDelivery,
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
  const agent = normalizeChannelAgent(input.agent ?? { provider: "opencode" });
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

function normalizeAvailableAgents(value, fallbackAgent) {
  const source = Array.isArray(value) ? value : [];
  const byId = new Map();
  for (const item of [fallbackAgent, ...source]) {
    const agent = normalizeChannelAgent(item);
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

async function currentAgentForChat(session, chatId) {
  const memoryAgent = session.options.agentByChat.get(chatId);
  if (memoryAgent) return memoryAgent;
  const setting = await storeSafeReadChatSetting(session, chatId);
  const storedAgent = setting?.agent ? normalizeChannelAgent(setting.agent) : null;
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

export const __test__ = {
  ACTIVE_RUN_MAX_AGE_MS,
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
