/** @jsxImportSource react */

import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";

import type { MessagingChannelStatus } from "../../../app/lib/desktop";
import type { ChannelTranscriptMessage } from "../../../app/lib/desktop-messaging";
import { t } from "../../../i18n";
import { ChannelPairingPanel } from "./ChannelPairingPanel";
import { FeishuChannelPanel } from "./feishu-channel-panel";
import { PanelSection } from "./settings-primitives";
import type { MessagingChannel } from "./messaging-model";
import { TokenChannelPanel } from "./token-channel-panel";
import { WeixinChannelPanel } from "./weixin-channel-panel";

export type MessagingChatChannelId = MessagingChannel["id"];

export function formatChannelMessageTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChannelIcon(props: {
  channelId: MessagingChatChannelId;
  connected?: boolean;
  size?: "sm" | "default" | "lg";
}) {
  const iconSrcByChannel: Record<MessagingChatChannelId, string> = {
    wechat: "/connector-icons/wechat.png",
    feishu: "/connector-icons/feishu.png",
    telegram: "/connector-icons/telegram.svg",
    discord: "/connector-icons/discord.svg",
  };
  const sizeClass = props.size === "sm"
    ? "size-5"
    : props.size === "lg"
      ? "size-10"
      : "size-9";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md",
        sizeClass,
        props.size === "lg" && "ring-1 ring-dls-border/60",
        !props.connected && "opacity-50",
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

const transcriptClass = {
  message: "flex max-w-[min(86%,48rem)] min-w-0 flex-col gap-1",
  bubble: "min-w-0 whitespace-pre-wrap rounded-xl border px-4 py-3 text-sm leading-6",
  userBubble: "border-dls-border bg-dls-chat-user-bg text-dls-text",
  agentBubble: "border-dls-border bg-dls-surface-muted text-dls-chat-agent-text",
  errorBubble: "border-dls-status-danger-border bg-dls-status-danger-soft text-dls-status-danger-fg",
} as const;

function messageSpeakerRole(
  message: ChannelTranscriptMessage,
): "user" | "assistant" | "system" {
  if (message.direction === "local") {
    return message.role === "operator" ? "user" : "system";
  }
  if (message.direction === "outbound" || message.role === "assistant") {
    return "assistant";
  }
  return "user";
}

function messageSpeakerLabel(message: ChannelTranscriptMessage) {
  if (message.direction === "local") {
    return message.role === "operator"
      ? t("messaging.chat_you")
      : t("messaging.chat_studio");
  }
  if (message.direction === "outbound") {
    return message.agentName || message.agentId || t("messaging.chat_agent");
  }
  return message.platformUserId || t("messaging.chat_contact");
}

export function TranscriptMessageRow(props: {
  message: ChannelTranscriptMessage;
}) {
  const { message } = props;
  const speakerRole = messageSpeakerRole(message);
  const userMessage = speakerRole === "user";
  const bubbleTone = message.role === "error"
    ? transcriptClass.errorBubble
    : userMessage
      ? transcriptClass.userBubble
      : transcriptClass.agentBubble;

  return (
    <article
      data-message-direction={message.direction}
      data-message-speaker={speakerRole}
      data-agent-id={message.agentId}
      className={cn("flex gap-3", userMessage ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          transcriptClass.message,
          userMessage ? "items-end" : "items-start",
        )}
      >
        <div className="flex items-center gap-2 text-xs text-dls-secondary">
          <span title={message.agentId || undefined}>{messageSpeakerLabel(message)}</span>
          <time dateTime={new Date(message.timestamp).toISOString()}>
            {formatChannelMessageTime(message.timestamp)}
          </time>
        </div>
        <div
          data-message-bubble
          className={cn(transcriptClass.bubble, bubbleTone)}
        >
          {message.content}
        </div>
        {message.role === "command" ? (
          <span className="text-2xs text-dls-secondary">
            {t("messaging.chat_command_notice")}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function MessagingSettingsContent(props: {
  channelId: MessagingChatChannelId;
  workspaceRoot?: string;
  onWeixinStatusChange: (status: MessagingChannelStatus) => void;
  onFeishuStatusChange: (status: MessagingChannelStatus) => void;
  onTelegramStatusChange: (status: MessagingChannelStatus) => void;
  onDiscordStatusChange: (status: MessagingChannelStatus) => void;
}) {
  return (
    <div
      data-testid="messaging-settings-workspace"
      data-settings-channel={props.channelId}
      className="min-h-0 flex-1 overflow-y-auto bg-dls-background"
    >
      <div className="space-y-4 p-4 sm:p-5 lg:p-6">
        {props.channelId === "wechat" ? (
          <WeixinChannelPanel
            key="wechat-settings"
            workspaceRoot={props.workspaceRoot}
            onStatusChange={props.onWeixinStatusChange}
          />
        ) : null}
        {props.channelId === "feishu" ? (
          <FeishuChannelPanel
            key="feishu-settings"
            workspaceRoot={props.workspaceRoot}
            onStatusChange={props.onFeishuStatusChange}
          />
        ) : null}
        {props.channelId === "telegram" ? (
          <TokenChannelPanel
            key="telegram-settings"
            kind="telegram"
            workspaceRoot={props.workspaceRoot}
            onStatusChange={props.onTelegramStatusChange}
          />
        ) : null}
        {props.channelId === "discord" ? (
          <TokenChannelPanel
            key="discord-settings"
            kind="discord"
            workspaceRoot={props.workspaceRoot}
            onStatusChange={props.onDiscordStatusChange}
          />
        ) : null}
        <PanelSection
          data-testid="messaging-pairing-section"
          headerLayout="inline"
          title={t("messaging.pairing_management")}
        >
          <ChannelPairingPanel />
        </PanelSection>
      </div>
    </div>
  );
}
