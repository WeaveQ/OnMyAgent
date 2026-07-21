/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import {
  discordStart,
  discordStatus,
  discordStop,
  feishuStatus,
  telegramStart,
  telegramStatus,
  telegramStop,
  type MessagingChannelStatus,
  weixinStatus,
  weixinStart,
  weixinStop,
  feishuStart,
  feishuStop,
} from "../../../app/lib/desktop";
import { t } from "../../../i18n";
import {
  MESSAGING_CHANNELS,
  type MessagingChannel,
} from "./messaging-model";
import { FeishuChannelPanel } from "./feishu-channel-panel";
import { ChannelPairingPanel } from "./ChannelPairingPanel";
import { TokenChannelPanel } from "./token-channel-panel";
import { WeixinChannelPanel } from "./weixin-channel-panel";

function isChannelConnected(status: MessagingChannelStatus | null) {
  const websocketState = typeof status?.websocketState === "string" ? status.websocketState : "";
  return status?.status === "running" || status?.status === "backoff" || websocketState === "open";
}

function shortTime(value: unknown) {
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function runtimeStats(status: MessagingChannelStatus | null) {
  const runtimeState = typeof status?.websocketState === "string" && status.websocketState
    ? `${String(status.status ?? "stopped")}/${status.websocketState}`
    : String(status?.status ?? "stopped");
  return [
    { label: t("messaging.channel_runtime_state"), value: runtimeState },
    { label: t("messaging.channel_reply_counts"), value: `${String(status?.processedCount ?? 0)}/${String(status?.sentCount ?? 0)}` },
    { label: t("messaging.weixin_last_message"), value: shortTime(status?.lastMessageAt) },
  ];
}

function resolveMessagingChannels(statusByChannel: Record<MessagingChannel["id"], MessagingChannelStatus | null>) {
  return MESSAGING_CHANNELS.map((channel) => {
    const runtimeStatus = statusByChannel[channel.id];
    return {
      ...channel,
      status: isChannelConnected(runtimeStatus) ? "connected" as const : "unlinked" as const,
      stats: runtimeStats(runtimeStatus),
      runtimeStatus,
    } satisfies MessagingChannel & { runtimeStatus: MessagingChannelStatus | null };
  });
}

const messagingTextClass = {
  pageTitle: "text-lg font-medium leading-7 text-dls-text",
  panelTitle: "text-base font-medium leading-6 text-dls-text",
  sectionTitle: "text-sm font-medium text-dls-secondary",
};

function ChannelIcon(props: {
  channelId: MessagingChannel["id"];
  connected: boolean;
}) {
  const iconSrcByChannel: Record<MessagingChannel["id"], string> = {
    wechat: "/connector-icons/wechat.png",
    feishu: "/connector-icons/feishu.png",
    telegram: "/connector-icons/telegram.svg",
    discord: "/connector-icons/discord.svg",
  };
  return (
    <div
      className={cn(
        // Match expert marketplace avatar / local agent brand icon scale (size-9).
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md",
        props.connected ? "" : "opacity-50",
      )}
    >
      <img
        src={resolvePublicAssetUrl(iconSrcByChannel[props.channelId])}
        alt=""
        className="size-full object-contain"
        draggable={false}
      />
    </div>
  );
}

// 折叠态头部：图标 + 名称 + 状态徽章 + 开关
function CollapsibleChannelHeader(props: {
  channel: MessagingChannel & { runtimeStatus: MessagingChannelStatus | null };
  expanded: boolean;
  enabled: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}) {
  const { channel } = props;
  const connected = channel.status === "connected";

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-dls-hover transition-colors"
      onClick={props.onToggleExpand}
    >
      {/* Left: icon + name + status */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <ChannelIcon channelId={channel.id} connected={connected} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-dls-text truncate">{channel.name}</span>
            <StatusBadge size="tiny" shape="pill" tone={connected ? "accent" : "neutral"}>
              {connected ? t("messaging.connected") : t("messaging.not_linked")}
            </StatusBadge>
          </div>
          <div className="mt-0.5 text-xs text-dls-secondary truncate">
            {channel.subtitle}
          </div>
        </div>
      </div>

      {/* Right: toggle + expand/collapse */}
      <div className="flex items-center gap-3 shrink-0">
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={props.enabled}
            onCheckedChange={props.onToggleEnabled}
            disabled={!connected && !props.enabled}
          />
        </div>
        {props.expanded ? (
          <ChevronDown className="size-4 text-dls-secondary" />
        ) : (
          <ChevronRight className="size-4 text-dls-secondary" />
        )}
      </div>
    </div>
  );
}

// 展开态内容：配置表单 + 配对面板
function CollapsibleChannelContent(props: {
  channel: MessagingChannel & { runtimeStatus: MessagingChannelStatus | null };
  workspaceRoot?: string;
  onWeixinStatusChange?: (status: MessagingChannelStatus) => void;
  onFeishuStatusChange?: (status: MessagingChannelStatus) => void;
  onTelegramStatusChange?: (status: MessagingChannelStatus) => void;
  onDiscordStatusChange?: (status: MessagingChannelStatus) => void;
}) {
  return (
    <div className="space-y-3 border-t border-dls-border bg-dls-background/40 px-4 pb-4 pt-3">
      {props.channel.id === "wechat" ? (
        <WeixinChannelPanel
          workspaceRoot={props.workspaceRoot}
          onStatusChange={props.onWeixinStatusChange}
        />
      ) : null}
      {props.channel.id === "feishu" ? (
        <FeishuChannelPanel
          workspaceRoot={props.workspaceRoot}
          onStatusChange={props.onFeishuStatusChange}
        />
      ) : null}
      {props.channel.id === "telegram" ? (
        <TokenChannelPanel
          kind="telegram"
          workspaceRoot={props.workspaceRoot}
          onStatusChange={props.onTelegramStatusChange}
        />
      ) : null}
      {props.channel.id === "discord" ? (
        <TokenChannelPanel
          kind="discord"
          workspaceRoot={props.workspaceRoot}
          onStatusChange={props.onDiscordStatusChange}
        />
      ) : null}

      <section className="space-y-3 rounded-xl border border-dls-border bg-dls-surface p-4">
        <h4 className="text-sm font-medium text-dls-text">
          {t("messaging.pairing_management")}
        </h4>
        <ChannelPairingPanel />
      </section>
    </div>
  );
}

// 可折叠的单个渠道项
function CollapsibleChannelItem(props: {
  channel: MessagingChannel & { runtimeStatus: MessagingChannelStatus | null };
  expanded: boolean;
  enabled: boolean;
  workspaceRoot?: string;
  onToggleExpand: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onWeixinStatusChange?: (status: MessagingChannelStatus) => void;
  onFeishuStatusChange?: (status: MessagingChannelStatus) => void;
  onTelegramStatusChange?: (status: MessagingChannelStatus) => void;
  onDiscordStatusChange?: (status: MessagingChannelStatus) => void;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-dls-border bg-dls-card",
        props.expanded && "border-dls-border-strong",
      )}
      data-channel-id={props.channel.id}
      data-channel-status={props.channel.status}
    >
      <CollapsibleChannelHeader
        channel={props.channel}
        expanded={props.expanded}
        enabled={props.enabled}
        onToggleExpand={props.onToggleExpand}
        onToggleEnabled={props.onToggleEnabled}
      />
      {props.expanded ? (
        <CollapsibleChannelContent
          channel={props.channel}
          workspaceRoot={props.workspaceRoot}
          onWeixinStatusChange={props.onWeixinStatusChange}
          onFeishuStatusChange={props.onFeishuStatusChange}
          onTelegramStatusChange={props.onTelegramStatusChange}
          onDiscordStatusChange={props.onDiscordStatusChange}
        />
      ) : null}
    </div>
  );
}

export function MessagingChannelsPage(props: { workspaceRoot?: string }) {
  // 折叠状态：true = 折叠，false = 展开
  const [collapseKeys, setCollapseKeys] = useState<Record<string, boolean>>({
    wechat: true,   // 默认折叠
    feishu: true,
    telegram: true,
    discord: true,
  });

  // 启用状态：true = 启用（服务运行），false = 禁用（服务停止）
  const [enabledKeys, setEnabledKeys] = useState<Record<string, boolean>>({
    wechat: false,
    feishu: false,
    telegram: false,
    discord: false,
  });

  const [weixinRuntimeStatus, setWeixinRuntimeStatus] = useState<MessagingChannelStatus | null>(null);
  const [feishuRuntimeStatus, setFeishuRuntimeStatus] = useState<MessagingChannelStatus | null>(null);
  const [telegramRuntimeStatus, setTelegramRuntimeStatus] = useState<MessagingChannelStatus | null>(null);
  const [discordRuntimeStatus, setDiscordRuntimeStatus] = useState<MessagingChannelStatus | null>(null);

  const channels = resolveMessagingChannels({
    wechat: weixinRuntimeStatus,
    feishu: feishuRuntimeStatus,
    telegram: telegramRuntimeStatus,
    discord: discordRuntimeStatus,
  });
  const connectedCount = channels.filter((channel) => channel.status === "connected").length;

  // 初始化时同步启用状态
  useEffect(() => {
    setEnabledKeys({
      wechat: isChannelConnected(weixinRuntimeStatus),
      feishu: isChannelConnected(feishuRuntimeStatus),
      telegram: isChannelConnected(telegramRuntimeStatus),
      discord: isChannelConnected(discordRuntimeStatus),
    });
  }, [weixinRuntimeStatus, feishuRuntimeStatus, telegramRuntimeStatus, discordRuntimeStatus]);

  // 获取运行状态
  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([weixinStatus(), feishuStatus(), telegramStatus(), discordStatus()])
      .then(([weixinResult, feishuResult, telegramResult, discordResult]) => {
        if (cancelled) return;
        if (weixinResult.status === "fulfilled") setWeixinRuntimeStatus(weixinResult.value);
        if (feishuResult.status === "fulfilled") setFeishuRuntimeStatus(feishuResult.value);
        if (telegramResult.status === "fulfilled") setTelegramRuntimeStatus(telegramResult.value);
        if (discordResult.status === "fulfilled") setDiscordRuntimeStatus(discordResult.value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // 切换折叠
  const handleToggleCollapse = (channelId: string) => {
    setCollapseKeys((prev) => ({
      ...prev,
      [channelId]: !prev[channelId],
    }));
  };

  // 切换启用（启动/停止服务）
  const handleToggleEnabled = async (channelId: string, enabled: boolean) => {
    setEnabledKeys((prev) => ({
      ...prev,
      [channelId]: enabled,
    }));

    try {
      if (channelId === "wechat") {
        if (enabled) {
          await weixinStart({});
        } else {
          await weixinStop();
        }
        // 启动/停止后刷新状态
        const status = await weixinStatus();
        setWeixinRuntimeStatus(status);
      } else if (channelId === "feishu") {
        if (enabled) {
          await feishuStart({});
        } else {
          await feishuStop();
        }
        const status = await feishuStatus();
        setFeishuRuntimeStatus(status);
      } else if (channelId === "telegram") {
        if (enabled) {
          await telegramStart({});
        } else {
          await telegramStop();
        }
        const status = await telegramStatus();
        setTelegramRuntimeStatus(status);
      } else if (channelId === "discord") {
        if (enabled) {
          await discordStart({});
        } else {
          await discordStop();
        }
        const status = await discordStatus();
        setDiscordRuntimeStatus(status);
      }
    } catch (error) {
      // 失败时回滚状态
      setEnabledKeys((prev) => ({
        ...prev,
        [channelId]: !enabled,
      }));
      console.error(`Failed to toggle ${channelId}:`, error);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background text-dls-text">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="w-full">
          {/* Page title */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className={messagingTextClass.pageTitle}>
                  {t("messaging.title")}
                </h2>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={<button type="button" className="text-dls-secondary hover:text-dls-text transition-colors"><HelpCircle className="size-4" /></button>} />
                    <TooltipContent side="bottom" className="max-w-sm">
                      <div className="space-y-2 text-xs">
                        <div className="font-medium">{t("messaging.command_help_title")}</div>
                        <div className="text-dls-secondary">
                          <div><span className="font-mono text-dls-text">#agent</span> - {t("messaging.command_help_agent")}</div>
                          <div><span className="font-mono text-dls-text">#status</span> - {t("messaging.command_help_status")}</div>
                          <div><span className="font-mono text-dls-text">#runs</span> - {t("messaging.command_help_runs")}</div>
                          <div><span className="font-mono text-dls-text">#approve</span> - {t("messaging.command_help_approve")}</div>
                          <div><span className="font-mono text-dls-text">#new</span> - {t("messaging.command_help_new")}</div>
                          <div><span className="font-mono text-dls-text">#mode raw</span> / <span className="font-mono text-dls-text">#mode debug</span> - {t("messaging.command_help_mode")}</div>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <p className="mt-1 text-sm leading-6 text-dls-secondary">
                {t("messaging.desc")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="neutral" shape="soft" size="sm">{t("messaging.channels_tab")} {channels.length}</StatusBadge>
              <StatusBadge tone={connectedCount > 0 ? "accent" : "neutral"} shape="soft" size="sm">{t("messaging.connected")} {connectedCount}</StatusBadge>
            </div>
          </div>

          {/* Channel accordion list */}
          <div className="mt-4 space-y-2">
            {channels.map((channel) => (
              <CollapsibleChannelItem
                key={channel.id}
                channel={channel}
                expanded={!collapseKeys[channel.id]}
                enabled={enabledKeys[channel.id]}
                workspaceRoot={props.workspaceRoot}
                onToggleExpand={() => handleToggleCollapse(channel.id)}
                onToggleEnabled={(enabled) => handleToggleEnabled(channel.id, enabled)}
                onWeixinStatusChange={setWeixinRuntimeStatus}
                onFeishuStatusChange={setFeishuRuntimeStatus}
                onTelegramStatusChange={setTelegramRuntimeStatus}
                onDiscordStatusChange={setDiscordRuntimeStatus}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
