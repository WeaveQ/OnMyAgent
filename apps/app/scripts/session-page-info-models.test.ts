import { describe, expect, test } from "bun:test";

import {
  BILLING_CHART_BARS,
  BILLING_USAGE_RECORDS,
} from "../src/react-app/domains/session/chat/session-page-billing-model";
import { MESSAGING_CHANNELS } from "../src/react-app/domains/session/chat/session-page-messaging-model";

describe("session page info models", () => {
  test("exposes stable billing usage records and chart buckets", () => {
    expect(BILLING_USAGE_RECORDS).toHaveLength(7);
    expect(BILLING_USAGE_RECORDS.every((record) => record.time.includes("~"))).toBe(true);
    expect(BILLING_USAGE_RECORDS.every((record) => Number.isFinite(Number(record.credits)))).toBe(true);
    expect(BILLING_USAGE_RECORDS[0]).toMatchObject({
      scene: "AccioWork任务",
      session: "你是谁?",
      credits: "2.40",
    });

    expect(BILLING_CHART_BARS).toHaveLength(13);
    expect(BILLING_CHART_BARS.some((value) => value > 0)).toBe(true);
    expect(BILLING_CHART_BARS.every((value) => Number.isInteger(value) && value >= 0)).toBe(true);
  });

  test("exposes messaging channels with consistent status/action contracts", () => {
    expect(MESSAGING_CHANNELS.map((channel) => channel.id)).toEqual(["wechat", "feishu"]);
    expect(MESSAGING_CHANNELS.map((channel) => channel.name)).toEqual(["WeChat", "Feishu"]);

    const wechat = MESSAGING_CHANNELS[0];
    expect(wechat).toMatchObject({
      status: "unlinked",
    });
    expect(wechat?.stats.map((item) => item.value ?? null)).toEqual(["--", "0/0", "--"]);

    const setupChannels = MESSAGING_CHANNELS;
    expect(setupChannels.every((channel) => channel.status === "unlinked")).toBe(true);
    expect(setupChannels.flatMap((channel) => channel.stats).every((stat) => stat.label.trim().length > 0)).toBe(true);
  });
});
