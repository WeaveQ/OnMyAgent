import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

/**
 * Language + theme live under Settings → Personalization (three sections),
 * not in the account gear menu.
 */
describe("preferences personalization sections contract", () => {
  test("three sections: interface, display, session management", () => {
    const preferences = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/settings/pages/preferences-view.tsx",
      ),
      "utf8",
    );
    const languageSection = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/settings/appearance/language-section.tsx",
      ),
      "utf8",
    );
    const themeSection = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/settings/appearance/theme-section.tsx",
      ),
      "utf8",
    );

    expect(preferences).toContain("interface_settings_title");
    expect(preferences).toContain("display_settings_title");
    expect(preferences).toContain("session_management_title");
    expect(preferences).toContain("LanguageBlockRow");
    expect(preferences).toContain("ThemeBlockRow");
    expect(preferences).toContain("FontSizeBlockRow");
    expect(languageSection).toContain("setLocale");
    expect(themeSection).toContain("setAppThemeMode");
    expect(themeSection).toContain("settings.theme_title");
  });

  test("account menu no longer hosts language or theme submenus", () => {
    const sidebar = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx",
      ),
      "utf8",
    );

    expect(sidebar).not.toContain("account_menu.language");
    expect(sidebar).not.toContain("account_menu.theme");
    expect(sidebar).not.toContain("LANGUAGE_OPTIONS");
    expect(sidebar).not.toContain("setLocale");
    expect(sidebar).not.toContain("getInitialThemeMode");
    expect(sidebar).toContain("account_menu.settings");
  });
});
