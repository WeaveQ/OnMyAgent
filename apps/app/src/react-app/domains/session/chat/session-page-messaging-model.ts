import { t } from "../../../../i18n";

export type MessagingChannel = {
  id: "wechat" | "feishu";
  name: string;
  subtitle: string;
  status: "connected" | "unlinked";
  stats: Array<{ label: string; value?: string }>;
};

export const MESSAGING_CHANNELS: MessagingChannel[] = [
  {
    id: "wechat",
    get name() { return t("messaging.wechat"); },
    subtitle: "微信ClawBot",
    status: "unlinked",
    stats: [
      { get label() { return t("messaging.channel_runtime_state"); }, value: "--" },
      { get label() { return t("messaging.channel_reply_counts"); }, value: "0/0" },
      { get label() { return t("messaging.weixin_last_message"); }, value: "--" },
    ],
  },
  {
    id: "feishu",
    get name() { return t("messaging.feishu"); },
    subtitle: "飞书机器人",
    status: "unlinked",
    stats: [
      { get label() { return t("messaging.channel_runtime_state"); }, value: "--" },
      { get label() { return t("messaging.channel_reply_counts"); }, value: "0/0" },
      { get label() { return t("messaging.weixin_last_message"); }, value: "--" },
    ],
  },
];
