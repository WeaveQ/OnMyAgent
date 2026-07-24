import { describe, expect, test } from "bun:test";

import enSession from "../src/i18n/locales/en/session";
import enNav from "../src/i18n/locales/en/nav";
import enSettings from "../src/i18n/locales/en/settings";
import zhTWSession from "../src/i18n/locales/zh-TW/session";
import zhTWNav from "../src/i18n/locales/zh-TW/nav";
import zhTWSettings from "../src/i18n/locales/zh-TW/settings";
import zhSession from "../src/i18n/locales/zh/session";
import zhNav from "../src/i18n/locales/zh/nav";
import zhSettings from "../src/i18n/locales/zh/settings";

const sessionRoot = new URL("../src/react-app/domains/session/", import.meta.url);
const settingsRoot = new URL("../src/react-app/domains/settings/", import.meta.url);
const shellRoot = new URL("../src/react-app/shell/", import.meta.url);

async function source(base: URL, relativePath: string) {
  return Bun.file(new URL(relativePath, base)).text();
}

describe("personal usage UI contract", () => {
  test("matches the centered Codex profile hierarchy and activity interactions", async () => {
    const page = await source(sessionRoot, "usage/personal-usage-page.tsx");
    expect(page).toContain('data-personal-usage-page="true"');
    expect(page).toContain('data-usage-profile="true"');
    expect(page).toContain('data-token-activity="true"');
    expect(page).toContain("max-w-4xl");
    expect(page).toContain("text-2xl");
    expect(page).toContain("text-base text-dls-secondary");
    expect(page).toContain('<span aria-hidden="true">·</span>');
    expect(page).toContain("usage_profile_plan");
    expect(page).toContain("StatusBadge");
    expect(page).toContain('density="bare"');
    expect(page).toContain('size="underline"');
    expect(page).toContain('shape="underline"');
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
    // Cumulative mode removed from the usage activity tabs.
    expect(page).not.toContain('(["daily", "weekly", "cumulative"]');
    // Metrics wrap on mid-width settings panes instead of clipping Chinese labels.
    expect(page).toContain("grid-cols-2 sm:grid-cols-3 xl:grid-cols-5");
    expect(page).not.toContain("min-w-3xl grid-cols-5");
    expect(page).not.toContain("mt-0.5 truncate text-sm text-dls-secondary");
    // Longest-task cells: roomy padding + compact multi-day duration keys.
    expect(page).toContain("min-h-20");
    expect(page).toContain("break-keep");
    expect(page).toContain("usage_duration_days_hours");
    expect(page).toContain("usage_duration_hours");
    // Heatmap trims leading empty weeks and can stretch columns when short.
    expect(page).toContain("buildTokenActivitySeries");
    expect(page).toContain("trimLeadingEmptyActivityColumns");
    expect(page).toContain("[--profile-usage-accent:#339cff]");
    expect(page).toContain("dark:[--profile-usage-accent:#99ceff]");
    expect(page).toContain("var(--profile-usage-accent)_22%");
    expect(page).toContain("var(--profile-usage-accent)_42%");
    expect(page).toContain("var(--profile-usage-accent)_68%");
    expect(page).toContain("var(--profile-usage-accent)_78%");
    expect(page).toContain("var(--profile-usage-accent)_55%");
    expect(page).toContain("var(--profile-usage-accent)_14%");
    expect(page).toContain("weeklyCellClass");
    expect(page).toContain('cell.date > props.today');
    expect(page).toContain("return null");
    expect(page).toContain('props.mode === "daily"');
    expect(page).toContain("size-3 shrink-0");
    expect(page).toContain("aspect-square");
    expect(page).toContain("overflow-x-auto");
    expect(page).not.toContain("weekCellForMode");
    expect(page).toContain("rounded-xs");
    expect(page).toContain("aria-label");
    expect(page).toContain("usage_daily_tooltip");
    expect(page).toContain("usage_weekly_tooltip");
    expect(page).not.toContain("usage_cumulative_tooltip");
    expect(page).not.toContain("usage_scope_label");
    expect(page).not.toContain("SelectTrigger");
    expect(page).not.toContain("icon:");
    // UI strings stay in i18n; only identity fallbacks may include CJK literals.
  });

  test("keeps Usage out of the account menu (settings global only)", async () => {
    const sidebar = await source(sessionRoot, "sidebar/app-sidebar.tsx");
    const settings = sidebar.indexOf('label={t("account_menu.settings")}');
    expect(settings).toBeGreaterThan(-1);
    // Account menu no longer hosts a dedicated Usage row.
    expect(sidebar).not.toContain('label={t("nav.usage")}');
    expect(sidebar).not.toContain("onOpenUsage");
  });

  test("hosts usage under global settings, not session sidebar views", async () => {
    const usageView = await source(settingsRoot, "pages/usage-view.tsx");
    const settingsPage = await source(settingsRoot, "shell/settings-page.tsx");
    const settingsRoute = await source(shellRoot, "settings-route/render.tsx");
    const assistant = await source(sessionRoot, "pages/assistant.tsx");
    const expert = await source(sessionRoot, "pages/expert.tsx");
    const sessionPage = await source(sessionRoot, "chat/session-page.tsx");

    expect(usageView).toContain("UsageSettingsView");
    expect(usageView).toContain("PersonalUsagePage");
    expect(settingsPage).toContain('"usage"');
    expect(settingsPage).toContain("getGlobalSettingsTabs");
    expect(settingsRoute).toContain('case "usage"');
    expect(settingsRoute).toContain("LazyUsageView");

    expect(assistant).not.toContain("PersonalUsagePage");
    expect(expert).not.toContain("PersonalUsagePage");
    expect(sessionPage).not.toContain("PersonalUsagePage");
    expect(assistant).not.toContain('activeSidebarView === "usage"');
    expect(expert).not.toContain('activeSidebarView === "usage"');
    expect(sessionPage).not.toContain('activeSidebarView === "usage"');
    expect(assistant).not.toContain("onOpenUsage");
    expect(expert).not.toContain("onOpenUsage");
    expect(sessionPage).not.toContain("onOpenUsage");
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

    expect(enSettings["settings.tab_usage"]).toBeTruthy();
    expect(zhSettings["settings.tab_usage"]).toBeTruthy();
    expect(zhTWSettings["settings.tab_usage"]).toBeTruthy();
    expect(enSettings["settings.tab_description_usage"]).toBeTruthy();
    expect(zhSettings["settings.tab_description_usage"]).toBeTruthy();
    expect(zhTWSettings["settings.tab_description_usage"]).toBeTruthy();

    expect(zhSession["session.usage_total_tokens"]).toBe("累计 Token 数");
    expect(zhSession["session.usage_peak_tokens"]).toBe("峰值 Token 数");
    expect(zhTWSession["session.usage_total_tokens"]).toBe("累計 Token 數");
    expect(zhTWSession["session.usage_peak_tokens"]).toBe("峰值 Token 數");

    const keys = [
      "session.usage_total_tokens",
      "session.usage_title",
      "session.usage_profile_plan",
      "session.usage_share",
      "session.usage_private",
      "session.usage_edit",
      "session.usage_day",
      "session.usage_peak_tokens",
      "session.usage_longest_task",
      "session.usage_duration_hours",
      "session.usage_duration_days",
      "session.usage_duration_days_hours",
      "session.usage_current_streak",
      "session.usage_longest_streak",
      "session.usage_activity",
      "session.usage_daily",
      "session.usage_weekly",
      "session.usage_daily_tooltip",
      "session.usage_weekly_tooltip",
    ] as const;
    for (const key of keys) {
      expect(enSession[key]).toBeTruthy();
      expect(zhSession[key]).toBeTruthy();
      expect(zhTWSession[key]).toBeTruthy();
    }
  });
});
