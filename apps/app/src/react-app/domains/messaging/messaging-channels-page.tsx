/** @jsxImportSource react */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, Inbox, MessageSquare, RefreshCw, Settings2 } from "lucide-react";

import { MenuRowButton, SessionRowButton } from "@/components/ui/action-row";
import { LIST_LANE_HEADER_CLASS } from "@/components/ui/sidebar-chrome";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SendButton } from "@/components/ui/send-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  discordAccountStatus,
  discordStart,
  discordStatus,
  discordStop,
  feishuAccountStatus,
  feishuStart,
  feishuStatus,
  feishuStop,
  onChannelStatus,
  telegramAccountStatus,
  telegramStart,
  telegramStatus,
  telegramStop,
  type MessagingChannelStatus,
  weixinAccountStatus,
  weixinStart,
  weixinStatus,
  weixinStop,
} from "../../../app/lib/desktop";
import {
  channelGetTranscript,
  channelGetTranscriptThreads,
  channelRunAgentPrompt,
  onChannelTranscript,
  type ChannelTranscriptMessage,
  type DesktopChannelTranscriptThread,
} from "../../../app/lib/desktop-messaging";
import { t } from "../../../i18n";
import {
  ChannelIcon,
  formatChannelMessageTime,
  MessagingSettingsContent,
  TranscriptMessageRow,
  type MessagingChatChannelId,
} from "./messaging-chat-components";
import { MESSAGING_CHANNELS } from "./messaging-model";

type ChannelId = MessagingChatChannelId;
type Thread = DesktopChannelTranscriptThread;

const RUNTIME_PLATFORM: Record<ChannelId, string> = {
  wechat: "wechat",
  feishu: "feishu",
  telegram: "telegram",
  discord: "discord",
};

function isChannelConnected(status: MessagingChannelStatus | null) {
  const websocketState = typeof status?.websocketState === "string" ? status.websocketState : "";
  return status?.status === "running" || status?.status === "backoff" || websocketState === "open";
}

function threadKey(thread: Pick<Thread, "platformType" | "accountId" | "chatId">) {
  return `${thread.platformType}\u0000${thread.accountId}\u0000${thread.chatId}`;
}

function platformLabel(id: ChannelId) {
  return MESSAGING_CHANNELS.find((channel) => channel.id === id)?.name ?? id;
}

async function setChannelRunning(channelId: ChannelId, enabled: boolean, accountId: string) {
  if (channelId === "wechat") {
    return enabled ? weixinStart({ accountId }) : weixinStop();
  }
  if (channelId === "feishu") {
    return enabled ? feishuStart({ accountId }) : feishuStop();
  }
  if (channelId === "telegram") {
    return enabled ? telegramStart({ accountId }) : telegramStop();
  }
  return enabled ? discordStart({ accountId }) : discordStop();
}

async function readChannelStatus(channelId: ChannelId) {
  if (channelId === "wechat") return weixinStatus();
  if (channelId === "feishu") return feishuStatus();
  if (channelId === "telegram") return telegramStatus();
  return discordStatus();
}

export function MessagingChannelsPage(props: { workspaceRoot?: string }) {
  const [selectedChannel, setSelectedChannel] = useState<ChannelId>("wechat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusByChannel, setStatusByChannel] = useState<Record<ChannelId, MessagingChannelStatus | null>>({
    wechat: null,
    feishu: null,
    telegram: null,
    discord: null,
  });
  const [enabledByChannel, setEnabledByChannel] = useState<Record<ChannelId, boolean>>({
    wechat: false,
    feishu: false,
    telegram: false,
    discord: false,
  });
  const [configuredAccountByChannel, setConfiguredAccountByChannel] = useState<Record<ChannelId, string>>({
    wechat: "",
    feishu: "",
    telegram: "",
    discord: "",
  });
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadKey, setSelectedThreadKey] = useState("");
  const [messages, setMessages] = useState<ChannelTranscriptMessage[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [followingLatest, setFollowingLatest] = useState(true);
  const [sending, setSending] = useState(false);
  const [composer, setComposer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const restoreScrollHeightRef = useRef<number | null>(null);
  const threadLoadGenerationRef = useRef(0);
  const messageLoadGenerationRef = useRef(0);
  const selectedThreadKeyRef = useRef("");

  const selectedRuntimePlatform = RUNTIME_PLATFORM[selectedChannel];
  const selectedStatus = statusByChannel[selectedChannel];
  const connected = isChannelConnected(selectedStatus);
  const selectedThread = threads.find((thread) => threadKey(thread) === selectedThreadKey) ?? null;
  const selectedThreadPlatform = selectedThread?.platformType ?? "";
  const selectedThreadAccountId = selectedThread?.accountId ?? "";
  const selectedThreadChatId = selectedThread?.chatId ?? "";
  const activeAccountId = String(selectedStatus?.accountId ?? "").trim();
  const configuredAccountId = configuredAccountByChannel[selectedChannel];
  const canPrompt = Boolean(
    connected
    && selectedThread
    && selectedThread.accountId === activeAccountId
    && selectedThread.accountId !== "legacy-unknown-account",
  );
  const readOnlyHint = selectedThread?.accountId === "legacy-unknown-account"
    ? t("messaging.chat_legacy_readonly")
    : t("messaging.chat_inactive_account_readonly");

  const updateStatus = useCallback((channelId: ChannelId, status: MessagingChannelStatus | null) => {
    setStatusByChannel((current) => ({ ...current, [channelId]: status }));
    if (status) {
      setEnabledByChannel((current) => ({
        ...current,
        [channelId]: isChannelConnected(status),
      }));
    }
    const accountId = String(status?.accountId ?? "").trim();
    if (accountId) {
      setConfiguredAccountByChannel((current) => ({
        ...current,
        [channelId]: accountId,
      }));
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    const [results, accounts] = await Promise.all([
      Promise.allSettled([
        weixinStatus(),
        feishuStatus(),
        telegramStatus(),
        discordStatus(),
      ]),
      Promise.allSettled([
        weixinAccountStatus(),
        feishuAccountStatus(),
        telegramAccountStatus(),
        discordAccountStatus(),
      ]),
    ]);
    const ids: ChannelId[] = ["wechat", "feishu", "telegram", "discord"];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") updateStatus(ids[index], result.value);
    });
    accounts.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const accountId = String(result.value.account?.accountId ?? "").trim();
      setConfiguredAccountByChannel((current) => {
        if (current[ids[index]] === accountId) return current;
        return { ...current, [ids[index]]: accountId };
      });
    });
  }, [updateStatus]);

  useEffect(() => {
    void refreshStatus();
    return onChannelStatus((payload) => {
      const rawPlatform = String(payload.platformType ?? "").toLowerCase();
      const platform = rawPlatform === "weixin" ? "wechat" : rawPlatform;
      if (
        platform === "wechat"
        || platform === "feishu"
        || platform === "telegram"
        || platform === "discord"
      ) {
        updateStatus(platform, payload.status);
      }
    });
  }, [refreshStatus, updateStatus]);

  const refreshThreads = useCallback(async () => {
    const generation = ++threadLoadGenerationRef.current;
    setLoadingThreads(true);
    setError(null);
    try {
      const result = await channelGetTranscriptThreads({ platformType: selectedRuntimePlatform });
      if (generation !== threadLoadGenerationRef.current) return;
      const nextThreads = Array.isArray(result) ? result : [];
      setThreads(nextThreads);
      setSelectedThreadKey((current) => {
        if (nextThreads.some((thread) => threadKey(thread) === current)) return current;
        return nextThreads[0] ? threadKey(nextThreads[0]) : "";
      });
    } catch (cause) {
      if (generation !== threadLoadGenerationRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setThreads([]);
      setSelectedThreadKey("");
    } finally {
      if (generation === threadLoadGenerationRef.current) setLoadingThreads(false);
    }
  }, [selectedRuntimePlatform]);

  useEffect(() => {
    setThreads([]);
    setSelectedThreadKey("");
    setMessages([]);
    setHasMoreMessages(false);
    setError(null);
    setComposer("");
    void refreshThreads();
  }, [refreshThreads, selectedChannel]);

  const refreshMessages = useCallback(async () => {
    const generation = ++messageLoadGenerationRef.current;
    if (!selectedThreadPlatform || !selectedThreadAccountId || !selectedThreadChatId) {
      setMessages([]);
      setHasMoreMessages(false);
      setLoadingMessages(false);
      return;
    }
    setLoadingMessages(true);
    setError(null);
    followLatestRef.current = true;
    setFollowingLatest(true);
    try {
      const page = await channelGetTranscript({
        platformType: selectedThreadPlatform,
        accountId: selectedThreadAccountId,
        chatId: selectedThreadChatId,
        limit: 200,
      });
      if (generation !== messageLoadGenerationRef.current) return;
      setMessages(Array.isArray(page?.messages) ? page.messages : []);
      setHasMoreMessages(Boolean(page?.hasMore));
    } catch (cause) {
      if (generation !== messageLoadGenerationRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setMessages([]);
      setHasMoreMessages(false);
    } finally {
      if (generation === messageLoadGenerationRef.current) setLoadingMessages(false);
    }
  }, [selectedThreadAccountId, selectedThreadChatId, selectedThreadPlatform]);

  useEffect(() => {
    selectedThreadKeyRef.current = selectedThreadKey;
    restoreScrollHeightRef.current = null;
    followLatestRef.current = true;
    setFollowingLatest(true);
    setMessages([]);
    setHasMoreMessages(false);
    void refreshMessages();
  }, [refreshMessages, selectedThreadKey]);

  useEffect(() => {
    return onChannelTranscript((payload) => {
      const message = payload.message;
      if (!message || message.platformType !== selectedRuntimePlatform) return;
      void refreshThreads();
      if (threadKey(message) !== selectedThreadKey) return;
      setMessages((current) => {
        const next = current.some((item) => item.id === message.id)
          ? current.map((item) => (item.id === message.id ? message : item))
          : [...current, message];
        return next.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
      });
    });
  }, [refreshThreads, selectedRuntimePlatform, selectedThreadKey]);

  useLayoutEffect(() => {
    const node = timelineRef.current;
    if (!node) return;
    if (restoreScrollHeightRef.current !== null) {
      node.scrollTop += node.scrollHeight - restoreScrollHeightRef.current;
      restoreScrollHeightRef.current = null;
      return;
    }
    if (followLatestRef.current) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const setFollowLatest = useCallback((value: boolean) => {
    followLatestRef.current = value;
    setFollowingLatest(value);
  }, []);

  const onTimelineScroll = useCallback(() => {
    const node = timelineRef.current;
    if (!node) return;
    setFollowLatest(node.scrollHeight - node.scrollTop - node.clientHeight < 80);
  }, [setFollowLatest]);

  const scrollToLatest = useCallback(() => {
    const node = timelineRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    setFollowLatest(true);
  }, [setFollowLatest]);

  const loadOlderMessages = useCallback(async () => {
    const first = messages[0];
    if (!selectedThread || !first || loadingOlder) return;
    const requestThreadKey = threadKey(selectedThread);
    setLoadingOlder(true);
    setError(null);
    restoreScrollHeightRef.current = timelineRef.current?.scrollHeight ?? null;
    try {
      const page = await channelGetTranscript({
        platformType: selectedThread.platformType,
        accountId: selectedThread.accountId,
        chatId: selectedThread.chatId,
        limit: 200,
        before: first.timestamp,
        beforeId: first.id,
      });
      if (selectedThreadKeyRef.current !== requestThreadKey) return;
      const older = Array.isArray(page?.messages) ? page.messages : [];
      setMessages((current) => [
        ...older,
        ...current.filter(
          (message) => !older.some((item) => item.id === message.id),
        ),
      ]);
      setHasMoreMessages(Boolean(page?.hasMore));
    } catch (cause) {
      restoreScrollHeightRef.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, messages, selectedThread]);

  const setChannelStatus = useCallback(
    (channelId: ChannelId, status: MessagingChannelStatus) => {
      updateStatus(channelId, status);
    },
    [updateStatus],
  );
  const onWeixinStatusChange = useCallback(
    (status: MessagingChannelStatus) => setChannelStatus("wechat", status),
    [setChannelStatus],
  );
  const onFeishuStatusChange = useCallback(
    (status: MessagingChannelStatus) => setChannelStatus("feishu", status),
    [setChannelStatus],
  );
  const onTelegramStatusChange = useCallback(
    (status: MessagingChannelStatus) => setChannelStatus("telegram", status),
    [setChannelStatus],
  );
  const onDiscordStatusChange = useCallback(
    (status: MessagingChannelStatus) => setChannelStatus("discord", status),
    [setChannelStatus],
  );

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    void refreshStatus();
  }, [refreshStatus]);

  const toggleChannel = async (channelId: ChannelId, enabled: boolean) => {
    const accountId = configuredAccountByChannel[channelId];
    if (enabled && !accountId) {
      setSettingsOpen(true);
      setEnabledByChannel((current) => ({ ...current, [channelId]: false }));
      return;
    }
    setEnabledByChannel((current) => ({ ...current, [channelId]: enabled }));
    try {
      const action = await setChannelRunning(channelId, enabled, accountId);
      if (action?.ok === false) {
        throw new Error(String(action.error || t("messaging.channel_action_failed")));
      }
      const refreshed = await readChannelStatus(channelId);
      updateStatus(channelId, refreshed);
    } catch (cause) {
      setEnabledByChannel((current) => ({ ...current, [channelId]: !enabled }));
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const sendPrompt = async () => {
    const text = composer.trim();
    if (!text || !selectedThread || sending) return;
    if (!canPrompt) {
      setError(connected ? readOnlyHint : t("messaging.chat_start_to_prompt"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = await channelRunAgentPrompt({
        platformType: selectedRuntimePlatform,
        accountId: selectedThread.accountId,
        chatId: selectedThread.chatId,
        platformUserId: selectedThread.platformUserId,
        text,
      });
      if (!result?.ok) {
        setError(result?.error ?? t("messaging.chat_send_failed"));
        return;
      }
      setComposer("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const configureOnly = !configuredAccountId;
  const channelStatusText = connected
    ? t("messaging.connected")
    : configuredAccountId
      ? t("messaging.channel_stopped")
      : t("messaging.not_linked");
  const composerHint = !connected
    ? t("messaging.chat_start_to_prompt")
    : !canPrompt
      ? readOnlyHint
      : selectedChannel === "wechat"
        ? t("messaging.chat_wechat_prompt_hint")
        : t("messaging.chat_private_prompt_hint");
  const composerLabel = selectedChannel === "wechat"
    ? t("messaging.chat_wechat_composer_label")
    : t("messaging.chat_composer_label");
  const composerPlaceholder = selectedChannel === "wechat"
    ? t("messaging.chat_wechat_composer_placeholder")
    : t("messaging.chat_composer_placeholder");
  const sendLabel = selectedChannel === "wechat"
    ? t("messaging.chat_wechat_send")
    : t("messaging.chat_send");
  const channelPolicyHint = selectedChannel === "wechat"
    ? t("messaging.chat_wechat_prompt")
    : t("messaging.chat_private_prompt");

  return (
    <div
      data-testid="messaging-channels-page"
      className="flex h-full w-full min-h-0 flex-col bg-dls-background text-dls-text"
    >
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-dls-border bg-dls-sidebar md:w-[260px] md:border-b-0 md:border-e">
          <div className={cn(LIST_LANE_HEADER_CLASS, "border-b border-dls-border px-4")}>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-medium leading-5 text-dls-text">{t("messaging.title")}</h1>
              <p className="truncate text-xs leading-4 text-dls-secondary">{t("messaging.chat_desc")}</p>
            </div>
          </div>
          <nav
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pt-1.5"
            aria-label={t("messaging.channels_tab")}
          >
            {MESSAGING_CHANNELS.map((channel) => {
              const channelStatus = statusByChannel[channel.id];
              const isSelected = selectedChannel === channel.id;
              const isConnected = isChannelConnected(channelStatus);
              const statusText = isConnected
                ? t("messaging.connected")
                : configuredAccountByChannel[channel.id]
                  ? t("messaging.channel_stopped")
                  : t("messaging.not_linked");
              return (
                <SessionRowButton
                  key={channel.id}
                  type="button"
                  size="expert"
                  active={isSelected}
                  data-channel-id={channel.id}
                  onClick={() => setSelectedChannel(channel.id)}
                  aria-current={isSelected ? "page" : undefined}
                >
                  <ChannelIcon channelId={channel.id} connected={isConnected} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-dls-text">
                        {channel.name}
                      </span>
                      <span className="shrink-0 text-xs leading-none text-dls-text-tertiary">
                        {statusText}
                      </span>
                    </div>
                    <div className="mt-1 min-w-0 truncate text-xs leading-5 text-dls-secondary">
                      {channel.subtitle}
                    </div>
                  </div>
                </SessionRowButton>
              );
            })}
          </nav>
          <div className="hidden shrink-0 border-t border-dls-border px-4 py-3 text-xs leading-5 text-dls-secondary md:block">
            {channelPolicyHint}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className={cn(LIST_LANE_HEADER_CLASS, "justify-between gap-3 border-b border-dls-border px-5")}>
            <div className="flex min-w-0 items-center gap-3">
              <ChannelIcon channelId={selectedChannel} connected={connected} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-medium text-dls-text">
                    {settingsOpen
                      ? t("messaging.chat_settings_title", {
                        channel: platformLabel(selectedChannel),
                      })
                      : platformLabel(selectedChannel)}
                  </h2>
                  {settingsOpen ? null : (
                    <StatusBadge
                      tone={connected ? "accent" : "neutral"}
                      size="tiny"
                      shape="pill"
                    >
                      {channelStatusText}
                    </StatusBadge>
                  )}
                </div>
                <p className="truncate text-xs text-dls-secondary">
                  {settingsOpen
                    ? t("messaging.chat_settings_desc", { status: channelStatusText })
                    : selectedThread?.platformUserId
                      || selectedThread?.chatId
                      || t("messaging.chat_choose_thread")}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {settingsOpen ? (
                <Button
                  data-testid="messaging-settings-back"
                  variant="outline"
                  size="sm"
                  onClick={closeSettings}
                >
                  <ArrowLeft className="size-3.5" />
                  {t("messaging.chat_back_to_chat")}
                </Button>
              ) : (
                <>
                  <Switch
                    checked={enabledByChannel[selectedChannel]}
                    onCheckedChange={(value) => void toggleChannel(selectedChannel, value)}
                    aria-label={t("messaging.channel_toggle")}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setSettingsOpen(true)}
                    aria-label={t("messaging.chat_settings")}
                    title={t("messaging.chat_settings")}
                  >
                    <Settings2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
          </header>

          {error ? (
            <div
              role="alert"
              className="border-b border-dls-status-danger-border bg-dls-status-danger-soft px-5 py-2 text-xs text-dls-status-danger-fg"
            >
              {error}
            </div>
          ) : null}

          {settingsOpen ? (
            <MessagingSettingsContent
              channelId={selectedChannel}
              workspaceRoot={props.workspaceRoot}
              onWeixinStatusChange={onWeixinStatusChange}
              onFeishuStatusChange={onFeishuStatusChange}
              onTelegramStatusChange={onTelegramStatusChange}
              onDiscordStatusChange={onDiscordStatusChange}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <section className="flex h-52 min-h-0 w-full shrink-0 flex-col border-b border-dls-border lg:h-auto lg:w-64 lg:border-b-0 lg:border-e">
                <div className="flex items-center justify-between gap-2 border-b border-dls-border px-4 py-3">
                  <div className="text-sm font-medium text-dls-text">
                    {t("messaging.chat_threads")}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void refreshThreads()}
                    disabled={loadingThreads}
                    aria-label={t("messaging.refresh")}
                  >
                    {loadingThreads
                      ? <LoadingSpinner size="sm" />
                      : <RefreshCw className="size-3.5" />}
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {loadingThreads && threads.length === 0 ? (
                    <div className="flex justify-center py-8">
                      <LoadingSpinner />
                    </div>
                  ) : null}
                  {!loadingThreads && threads.length === 0 ? (
                    <div className="px-3 py-8 text-center text-xs leading-5 text-dls-secondary">
                      {configureOnly
                        ? t("messaging.chat_configure_first")
                        : t("messaging.chat_no_threads")}
                    </div>
                  ) : null}
                  {threads.map((thread) => {
                    const key = threadKey(thread);
                    return (
                      <MenuRowButton
                        key={key}
                        data-thread-key={key}
                        active={key === selectedThreadKey}
                        density="compact"
                        className="mb-1"
                        onClick={() => setSelectedThreadKey(key)}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-dls-text">
                            {thread.platformUserId || thread.chatId}
                          </span>
                          <span className="shrink-0 text-2xs text-dls-secondary">
                            {formatChannelMessageTime(thread.lastMessageAt)}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-xs text-dls-secondary">
                          {thread.lastMessage || t("messaging.chat_empty_thread")}
                        </span>
                      </MenuRowButton>
                    );
                  })}
                </div>
              </section>

              <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                {configureOnly ? (
                  <Empty
                    variant="ghost"
                    className="flex-1"
                  >
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Settings2 className="size-5" />
                      </EmptyMedia>
                      <EmptyTitle>
                        {t("messaging.chat_configure_title", {
                          channel: platformLabel(selectedChannel),
                        })}
                      </EmptyTitle>
                      <EmptyDescription>{t("messaging.chat_configure_desc")}</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button
                        data-testid="messaging-open-settings-empty"
                        onClick={() => setSettingsOpen(true)}
                      >
                        {t("messaging.chat_open_settings")}
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : selectedThread ? (
                  <>
                    <div className="relative min-h-0 flex-1">
                      <div
                        ref={timelineRef}
                        data-testid="messaging-transcript"
                        onScroll={onTimelineScroll}
                        className="h-full space-y-5 overflow-y-auto px-5 py-6"
                      >
                        {hasMoreMessages ? (
                          <div className="flex justify-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={loadingOlder}
                              onClick={() => void loadOlderMessages()}
                            >
                              {loadingOlder ? <LoadingSpinner size="sm" /> : null}
                              {t("messaging.chat_load_older")}
                            </Button>
                          </div>
                        ) : null}
                        {loadingMessages && messages.length === 0 ? (
                          <div className="flex justify-center py-12">
                            <LoadingSpinner />
                          </div>
                        ) : null}
                        {!loadingMessages && messages.length === 0 ? (
                          <Empty variant="ghost" className="h-full">
                            <EmptyMedia variant="icon">
                              <MessageSquare className="size-5" />
                            </EmptyMedia>
                            <EmptyTitle>{t("messaging.chat_empty_title")}</EmptyTitle>
                            <EmptyDescription>{t("messaging.chat_empty_desc")}</EmptyDescription>
                          </Empty>
                        ) : null}
                        {messages.map((message) => (
                          <TranscriptMessageRow key={message.id} message={message} />
                        ))}
                      </div>
                      {!followingLatest && messages.length > 0 ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="absolute bottom-4 end-4"
                          onClick={scrollToLatest}
                        >
                          <ArrowDown className="size-3.5" />
                          {t("messaging.chat_jump_latest")}
                        </Button>
                      ) : null}
                    </div>
                    <div className="border-t border-dls-border p-4">
                      <div className="flex items-end gap-3 rounded-xl border border-dls-border bg-dls-surface p-3 focus-within:border-dls-border-strong">
                        <Textarea
                          value={composer}
                          onChange={(event) => setComposer(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" || event.shiftKey) return;
                            event.preventDefault();
                            void sendPrompt();
                          }}
                          placeholder={composerPlaceholder}
                          aria-label={composerLabel}
                          className="min-h-10 flex-1 border-0 bg-transparent px-1 py-2 shadow-none"
                        />
                        <SendButton
                          label={sendLabel}
                          loading={sending}
                          disabled={!composer.trim() || sending || !canPrompt}
                          onClick={() => void sendPrompt()}
                        />
                      </div>
                      <p className="mt-2 text-xs text-dls-secondary">{composerHint}</p>
                    </div>
                  </>
                ) : (
                  <Empty variant="ghost" className="m-5 flex-1">
                    <EmptyMedia variant="icon">
                      <Inbox className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>{t("messaging.chat_choose_thread")}</EmptyTitle>
                    <EmptyDescription>{t("messaging.chat_choose_thread_desc")}</EmptyDescription>
                  </Empty>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
