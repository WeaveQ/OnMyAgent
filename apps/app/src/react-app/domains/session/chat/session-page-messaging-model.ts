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
    get subtitle() { return t("messaging.wechat_clawbot"); },
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
    get subtitle() { return t("messaging.feishu_bot"); },
    status: "unlinked",
    stats: [
      { get label() { return t("messaging.channel_runtime_state"); }, value: "--" },
      { get label() { return t("messaging.channel_reply_counts"); }, value: "0/0" },
      { get label() { return t("messaging.weixin_last_message"); }, value: "--" },
    ],
  },
];
