import { t } from "@/i18n";

export type MessagingChannel = {
  id: "wechat" | "feishu" | "telegram" | "discord";
  name: string;
  subtitle: string;
};

export function channelRuntimeStatusLabel(status?: string) {
  if (status === "running") return t("messaging.channel_running");
  if (status === "backoff") return t("messaging.channel_reconnecting");
  return t("messaging.channel_stopped");
}

export function channelConnectionStateLabel(state?: string) {
  if (state === "open") return t("messaging.connected");
  if (state === "connecting") return t("messaging.channel_reconnecting");
  return t("messaging.not_linked");
}

export const MESSAGING_CHANNELS: MessagingChannel[] = [
  {
    id: "wechat",
    get name() { return t("messaging.wechat"); },
    get subtitle() { return t("messaging.wechat_clawbot"); },
  },
  {
    id: "feishu",
    get name() { return t("messaging.feishu"); },
    get subtitle() { return t("messaging.feishu_bot"); },
  },
  {
    id: "telegram",
    get name() { return t("messaging.telegram"); },
    get subtitle() { return t("messaging.telegram_bot"); },
  },
  {
    id: "discord",
    get name() { return t("messaging.discord"); },
    get subtitle() { return t("messaging.discord_bot"); },
  },
];
