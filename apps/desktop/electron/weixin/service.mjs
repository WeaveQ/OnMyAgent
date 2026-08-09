import path from "node:path";

import { createIlinkClient, ILINK_BASE_URL, LONG_POLL_TIMEOUT_MS } from "./ilink-client.mjs";
import { getChannelRunSnapshotState } from "./local-qr.mjs";
import { createWeixinActiveRunPolling } from "./active-run-polling.mjs";
import { createWeixinStore, sanitizeAccount } from "./store.mjs";
import {
  renderApprovalPrompt,
} from "./agent-context.mjs";
import {
  isAllowed,
  normalizeAccessibleWorkspaceRoots,
  normalizeApprovalMode,
  normalizePromptMode,
  normalizeRuntimeOptions,
} from "./chat-policy.mjs";
import {
  parseAgentSwitchCommand,
  parseApprovalCommand,
  parseModeCommand,
  parseModelSwitchCommand,
  parseRunCommand,
} from "./commands.mjs";
import { createWeixinChannelSessions } from "./channel-sessions.mjs";
import { createWeixinControlCommands } from "./control-commands.mjs";
import {
  ACTIVE_RUN_MAX_AGE_MS,
  ACTIVE_RUN_PENDING_POLL_INTERVAL_MS,
  ACTIVE_RUN_POLL_INTERVAL_MS,
  BACKOFF_DELAY_SECONDS,
  MESSAGE_DEDUP_TTL_MS,
  RETRY_DELAY_SECONDS,
  SESSION_EXPIRED_ERRCODE,
  TtlSet,
  createQrImageDataUrl,
  extractText,
  guessChatType,
  isStaleSessionRet,
  safeId,
  sleep,
  splitTextForWeixin,
  activeRunKey,
  activeRunGuardKey,
  mimeFromFilename,
} from "./helpers.mjs";
import { createInboundMediaCollector } from "./inbound-media.mjs";
import { createMessageDispatch } from "./message-dispatch.mjs";
import { createOutboundDelivery } from "./outbound-delivery.mjs";
import {
  buildPrompt,
  currentAgentForChat,
  currentPromptModeForChat,
  resolveAgentAlias,
  renderAgentHelp,
  renderModeHelp,
  renderRunStatus,
  renderRunsList,
  runAgentTurn,
} from "./agent-context.mjs";

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

  const {
    sendText,
    deliverAgentOutput,
    maybeSendTyping,
  } = createOutboundDelivery({
    client,
    store,
    setState,
    getSentCount: () => state.sentCount,
    appendLog,
  });

  const {
    getChannelSession,
    appendChannelSessionHistory,
    appendChannelSessionHistoryById,
    closeChannelSessionForAgent,
    subscribeStudioRelay,
    unsubscribeStudioRelay,
  } = createWeixinChannelSessions({
    runtime,
    channelSessionStore,
    channelEventBus,
    appendLog,
    getActive: () => active,
    sendText,
  });

  async function appendAgentHistory(session, historyKey, userText, output, agent, limit) {
    await store.appendChatHistory(session.account.accountId, historyKey, [
      { role: "user", text: userText, at: Date.now() },
      { role: "assistant", text: output, at: Date.now(), agentId: agent.id, agentProvider: agent.provider },
    ], limit).catch(() => undefined);
  }

  const {
    clearActiveRunPoll,
    deleteActiveRunSafely,
    listActiveRunsSafely,
    readActiveRunSafely,
    releaseActiveRunReservation,
    reserveActiveRun,
    resumeActiveRuns,
    scheduleActiveRunPoll,
    stopActiveRunPolling,
    writeActiveRunSafely,
  } = createWeixinActiveRunPolling({
    store, runtime, appendLog, clearedActiveRunKeys, agentBusyNoticeAt,
    activeRunMaxAgeMs: ACTIVE_RUN_MAX_AGE_MS,
    pollIntervalMs: ACTIVE_RUN_POLL_INTERVAL_MS,
    pendingPollIntervalMs: ACTIVE_RUN_PENDING_POLL_INTERVAL_MS,
    getRunSnapshotState: getChannelRunSnapshotState,
    deliverAgentOutput, appendAgentHistory, appendChannelSessionHistoryById,
    sendText, renderApprovalPrompt,
    setLastRunId: (runId) => setState({ lastRunId: runId }),
    setLastError: (message) => setState({ lastError: message }),
  });

  const { collectMediaFiles } = createInboundMediaCollector({
    mediaFetchFn,
    mediaCacheDir,
    appendLog,
  });

  const {
    maybeHandleControlCommand,
  } = createWeixinControlCommands({
    runtime,
    store,
    appendLog,
    setState,
    sendText,
    agentBusyNoticeAt,
    readActiveRunSafely,
    listActiveRunsSafely,
    writeActiveRunSafely,
    deleteActiveRunSafely,
    scheduleActiveRunPoll,
    clearActiveRunPoll,
    closeChannelSessionForAgent,
  });

  const { enqueueText } = createMessageDispatch({
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
  });

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
      // When the front-end panel switches the global reply agent, any
      // per-chat agent override (pinned via #agent or left over from older
      // sessions) must be cleared so every WeChat chat follows the new
      // global choice instead of silently keeping the stale agent.
      const nextAgentId = input.agent && typeof input.agent === "object" ? String(input.agent.id ?? "").trim() : "";
      const currentAgentId = active.options.agent && typeof active.options.agent === "object" ? String(active.options.agent.id ?? "").trim() : "";
      if (nextAgentId && currentAgentId && nextAgentId !== currentAgentId) {
        for (const key of [...active.options.agentByChat.keys()]) {
          if (active.options.agentByChat.get(key)?.id !== nextAgentId) active.options.agentByChat.delete(key);
        }
        await store.clearAllChatAgentOverrides(accountId).catch(() => 0);
      }
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
    await stopActiveRunPolling(current.task);
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
          signal: session.controller.signal,
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
          await sleep((failures >= 3 ? BACKOFF_DELAY_SECONDS : RETRY_DELAY_SECONDS) * 1000, session.controller.signal);
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
        await sleep((failures >= 3 ? BACKOFF_DELAY_SECONDS : RETRY_DELAY_SECONDS) * 1000, session.controller.signal);
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
    // 控制命令不应被 content dedup 吞掉；固定短文本命令可能在短时间内重复发送
    const isControlCommand = parseApprovalCommand(text) || parseRunCommand(text) || parseModeCommand(text) || parseModelSwitchCommand(text) || parseAgentSwitchCommand(text);
    if (!isControlCommand) {
      const contentKey = `content:${senderId}:${text}`;
      if (dedup.hasOrAdd(contentKey)) return null;
    }
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
        // Expose the last-started agent so the UI can restore the selected
        // agent on mount without forcing the user to re-pick it every time.
        agent: lastStartOptions.agent && typeof lastStartOptions.agent === "object" ? lastStartOptions.agent : null,
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

export const __test__ = {
  ACTIVE_RUN_MAX_AGE_MS,
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
  safeId,
  activeRunKey,
  activeRunGuardKey,
  runAgentTurn,
  createQrImageDataUrl,
};
