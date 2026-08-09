import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COMMON_SETTINGS_PREFETCH_TABS,
  prefetchCommonSettingsTabs,
  prefetchSettingsTab,
  schedulePrefetchCommonSettingsTabs,
} from "../src/react-app/domains/settings/settings-tab-prefetch";

const appRoot = join(import.meta.dir, "..");

describe("settings tab prefetch", () => {
  test("lists high-traffic tabs including system and shortcuts", () => {
    expect(COMMON_SETTINGS_PREFETCH_TABS).toContain("general");
    expect(COMMON_SETTINGS_PREFETCH_TABS).toContain("system");
    expect(COMMON_SETTINGS_PREFETCH_TABS).toContain("shortcuts");
    expect(COMMON_SETTINGS_PREFETCH_TABS).toContain("ai");
  });

  test("exports fire-and-forget prefetch helpers", () => {
    expect(typeof prefetchSettingsTab).toBe("function");
    expect(typeof prefetchCommonSettingsTabs).toBe("function");
    expect(typeof schedulePrefetchCommonSettingsTabs).toBe("function");
    // Must not throw when loaders reject outside a browser bundle.
    expect(() => prefetchSettingsTab("shortcuts")).not.toThrow();
    expect(() => prefetchCommonSettingsTabs()).not.toThrow();
  });

  test("settings host schedules common prefetch on mount", () => {
    const render = readFileSync(
      join(appRoot, "src/react-app/shell/settings-route/render.tsx"),
      "utf8",
    );
    expect(render).toContain("schedulePrefetchCommonSettingsTabs");
  });

  test("sidebar nav warms chunks on pointer enter", () => {
    const page = readFileSync(
      join(appRoot, "src/react-app/domains/settings/shell/settings-page.tsx"),
      "utf8",
    );
    expect(page).toContain("prefetchSettingsTab");
    expect(page).toContain("onPointerEnter");
  });

  test("lazy host warms general/system/shortcuts loaders early", () => {
    const lazy = readFileSync(
      join(appRoot, "src/react-app/shell/settings-route/lazy-tab-views.tsx"),
      "utf8",
    );
    expect(lazy).toContain("loadGeneralSettingsView()");
    expect(lazy).toContain("loadShortcutsView()");
    expect(lazy).toContain("loadSystemSettingsView()");
  });
});
