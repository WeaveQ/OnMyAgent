import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

/**
 * Language preference lives under Settings → Personalization → Display,
 * not in the account gear menu.
 */
describe("preferences language settings contract", () => {
  test("personalization display block includes LanguageBlockRow", () => {
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

    expect(preferences).toContain("LanguageBlockRow");
    expect(preferences).toContain("display_settings_title");
    expect(languageSection).toContain("setLocale");
    expect(languageSection).toContain("LANGUAGE_OPTIONS");
    expect(languageSection).toContain("settings.language");
  });

  test("account menu no longer hosts language submenu", () => {
    const sidebar = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx",
      ),
      "utf8",
    );

    expect(sidebar).not.toContain("account_menu.language");
    expect(sidebar).not.toContain("LANGUAGE_OPTIONS");
    expect(sidebar).not.toContain("setLocale");
    // Theme remains in the gear menu.
    expect(sidebar).toContain("account_menu.theme");
  });
});
