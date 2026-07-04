/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { feishuStatus, type MessagingChannelStatus, weixinStatus } from "../../../../../app/lib/desktop";
import { t } from "../../../../../i18n";
import {
  MESSAGING_CHANNELS,
  type MessagingChannel,
} from "../../chat/session-page-messaging-model";
import { FeishuChannelPanel } from "./feishu-channel-panel";
import { ChannelPairingPanel } from "./ChannelPairingPanel";
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
    } satisfies MessagingChannel;
  });
}

const messagingTextClass = {
  pageTitle: "text-base font-medium text-dls-text",
  panelTitle: "text-base font-medium text-dls-text",
  sectionTitle: "text-sm font-medium uppercase text-dls-secondary",
};

function ChannelIcon(props: {
  channelId: MessagingChannel["id"];
  connected: boolean;
}) {
  const iconSrcByChannel: Record<MessagingChannel["id"], string> = {
    wechat: "/connector-icons/wechat.png",
    feishu: "/connector-icons/feishu.png",
  };
  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg bg-dls-surface p-1.5",
        props.connected ? "bg-dls-surface" : "bg-dls-icon-muted-bg",
      )}
    >
      <img
        src={resolvePublicAssetUrl(iconSrcByChannel[props.channelId])}
        alt=""
        className={cn(
          "size-full object-contain",
          !props.connected && "opacity-35",
        )}
        draggable={false}
      />
    </div>
  );
}

function MessagingChannelCard(props: { channel: MessagingChannel; active: boolean; onSelect: () => void }) {
  const { channel } = props;
  const connected = channel.status === "connected";
  return (
    <button
      type="button"
      className={cn(
        "flex w-full flex-col rounded-lg border border-dls-border bg-dls-card p-3 text-left transition-colors hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
        props.active && "border-dls-accent bg-dls-list-selected",
      )}
      onClick={props.onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelIcon channelId={channel.id} connected={connected} />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-dls-text">
              {channel.name}
            </h3>
            <div className="mt-0.5 truncate text-xs text-dls-secondary">
              {channel.subtitle}
            </div>
          </div>
        </div>
        <StatusBadge size="default" tone={connected ? "accent" : "neutral"}>
          {connected ? t("messaging.connected") : t("messaging.not_linked")}
        </StatusBadge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {channel.stats.map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 rounded-lg border border-dls-border bg-dls-surface px-2 py-1.5"
          >
            <div className="truncate text-xs text-dls-secondary">
              {stat.label}
            </div>
            {stat.value ? (
              <div className="mt-1 truncate text-xs font-medium text-dls-text">
                {stat.value}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-dls-mist pt-2">
        <div className="min-w-0 text-xs text-dls-secondary">
          {t("messaging.channel_panel_config_hint")}
        </div>
        <ChevronRight className="size-4 shrink-0 text-dls-secondary" />
      </div>
    </button>
  );
}

function MessagingChannelDetail(props: { channel: MessagingChannel; workspaceRoot?: string; onWeixinStatusChange?: (status: MessagingChannelStatus) => void; onFeishuStatusChange?: (status: MessagingChannelStatus) => void }) {
  return (
    <section className="rounded-lg border border-dls-border bg-dls-card p-3">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-dls-border pb-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelIcon channelId={props.channel.id} connected={props.channel.status === "connected"} />
          <div className="min-w-0">
            <h3 className="truncate text-base font-medium text-dls-text">{props.channel.name}</h3>
            <p className="mt-1 truncate text-sm text-dls-secondary">{props.channel.subtitle}</p>
          </div>
        </div>
        <StatusBadge tone={props.channel.status === "connected" ? "accent" : "neutral"}>
          {props.channel.status === "connected" ? t("messaging.connected") : t("messaging.not_linked")}
        </StatusBadge>
      </div>
      <div className="mb-3 rounded-lg border border-dls-border bg-dls-muted px-3 py-2 text-xs leading-5 text-dls-secondary">
        {t("messaging.channel_panel_config_hint")}
      </div>
      {props.channel.id === "wechat" ? <WeixinChannelPanel workspaceRoot={props.workspaceRoot} onStatusChange={props.onWeixinStatusChange} /> : null}
      {props.channel.id === "feishu" ? <FeishuChannelPanel workspaceRoot={props.workspaceRoot} onStatusChange={props.onFeishuStatusChange} /> : null}

      {/* Pairing & User Management Panel */}
      <div className="mt-4 pt-4 border-t border-dls-border">
        <h4 className="text-sm font-medium text-dls-text mb-3">配对与用户管理</h4>
        <ChannelPairingPanel />
      </div>
    </section>
  );
}

export function MessagingChannelsPage(props: { workspaceRoot?: string }) {
  const [selectedChannelId, setSelectedChannelId] = useState<MessagingChannel["id"]>("wechat");
  const [weixinRuntimeStatus, setWeixinRuntimeStatus] = useState<MessagingChannelStatus | null>(null);
  const [feishuRuntimeStatus, setFeishuRuntimeStatus] = useState<MessagingChannelStatus | null>(null);
  const channels = resolveMessagingChannels({ wechat: weixinRuntimeStatus, feishu: feishuRuntimeStatus });
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? channels[0];
  const connectedCount = channels.filter((channel) => channel.status === "connected").length;

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([weixinStatus(), feishuStatus()])
      .then(([weixinResult, feishuResult]) => {
        if (cancelled) return;
        if (weixinResult.status === "fulfilled") setWeixinRuntimeStatus(weixinResult.value);
        if (feishuResult.status === "fulfilled") setFeishuRuntimeStatus(feishuResult.value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background text-dls-text">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="w-full">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
            <h2 className={messagingTextClass.pageTitle}>
              {t("messaging.title")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-dls-secondary">
              {t("messaging.desc")}
            </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="neutral">{t("messaging.channels_tab")} {channels.length}</StatusBadge>
              <StatusBadge tone={connectedCount > 0 ? "accent" : "neutral"}>{t("messaging.connected")} {connectedCount}</StatusBadge>
            </div>
          </div>
          <div className="mt-4 grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-1">
              {channels.map((channel) => (
                <MessagingChannelCard
                  key={channel.id}
                  channel={channel}
                  active={selectedChannel.id === channel.id}
                  onSelect={() => setSelectedChannelId(channel.id)}
                />
              ))}
            </div>
            <div className="xl:col-span-2">
              <MessagingChannelDetail channel={selectedChannel} workspaceRoot={props.workspaceRoot} onWeixinStatusChange={setWeixinRuntimeStatus} onFeishuStatusChange={setFeishuRuntimeStatus} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
