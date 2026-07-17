import { describe, expect, test } from "bun:test";

import enSession from "../src/i18n/locales/en/session";
import enNav from "../src/i18n/locales/en/nav";
import zhTWSession from "../src/i18n/locales/zh-TW/session";
import zhTWNav from "../src/i18n/locales/zh-TW/nav";
import zhSession from "../src/i18n/locales/zh/session";
import zhNav from "../src/i18n/locales/zh/nav";

const root = new URL("../src/react-app/domains/session/", import.meta.url);

async function source(relativePath: string) {
  return Bun.file(new URL(relativePath, root)).text();
}

describe("personal usage UI contract", () => {
  test("matches the centered Codex profile hierarchy", async () => {
    const page = await source("usage/personal-usage-page.tsx");
    expect(page).toContain('data-personal-usage-page="true"');
    expect(page).toContain('data-usage-profile="true"');
    expect(page).toContain('data-token-activity="true"');
    expect(page).toContain("max-w-4xl");
    expect(page).toContain("usage_profile_title");
    expect(page).toContain("usage_profile_plan");
    expect(page).toContain("StatusBadge");
    expect(page).toContain('density="filter"');
    expect(page).toContain("SegmentedTabGroup");
    expect(page).toContain("LoadingSpinner");
    expect(page).toContain("NoticeBox");
    expect(page).toContain("EmptyStateBox");
    expect(page).toContain("usage_total_tokens");
    expect(page).toContain("usage_peak_tokens");
    expect(page).toContain("usage_longest_task");
    expect(page).toContain("usage_current_streak");
    expect(page).toContain("usage_longest_streak");
    expect(page).toContain("usage_day");
    expect(page).toContain('"daily"');
    expect(page).toContain('"weekly"');
    expect(page).toContain('"cumulative"');
    expect(page).toContain('"size-3 rounded-xs"');
    expect(page).toContain("aria-label");
    expect(page).not.toContain("usage_scope_label");
    expect(page).not.toContain("SelectTrigger");
    expect(page).not.toContain("icon:");
    expect(page).not.toMatch(/[\u3400-\u9fff]/);
  });

  test("places Usage between Devices and Settings in the account menu", async () => {
    const sidebar = await source("sidebar/app-sidebar.tsx");
    const devices = sidebar.indexOf('label={t("nav.devices")}');
    const usage = sidebar.indexOf('label={t("nav.usage")}');
    const settings = sidebar.indexOf('label={t("account_menu.settings")}');
    expect(devices).toBeGreaterThan(-1);
    expect(usage).toBeGreaterThan(devices);
    expect(settings).toBeGreaterThan(usage);
  });

  test("wires the usage page into assistant, expert, and session hosts", async () => {
    const hosts = await Promise.all([
      source("pages/assistant.tsx"),
      source("pages/expert.tsx"),
      source("chat/session-page.tsx"),
    ]);
    for (const host of hosts) {
      expect(host).toContain("PersonalUsagePage");
      expect(host).toContain('activeSidebarView === "usage"');
    }
  });

  test("keeps all personal usage copy synchronized across locales", () => {
    const expected = {
      en: "Usage",
      zh: "用量",
      zhTW: "用量",
    };
    expect(enNav["nav.usage"]).toBe(expected.en);
    expect(zhNav["nav.usage"]).toBe(expected.zh);
    expect(zhTWNav["nav.usage"]).toBe(expected.zhTW);

    const keys = [
      "session.usage_total_tokens",
      "session.usage_profile_title",
      "session.usage_profile_plan",
      "session.usage_share",
      "session.usage_private",
      "session.usage_edit",
      "session.usage_day",
      "session.usage_peak_tokens",
      "session.usage_longest_task",
      "session.usage_current_streak",
      "session.usage_longest_streak",
      "session.usage_activity",
      "session.usage_daily",
      "session.usage_weekly",
      "session.usage_cumulative",
    ] as const;
    for (const key of keys) {
      expect(enSession[key]).toBeTruthy();
      expect(zhSession[key]).toBeTruthy();
      expect(zhTWSession[key]).toBeTruthy();
    }
  });
});
