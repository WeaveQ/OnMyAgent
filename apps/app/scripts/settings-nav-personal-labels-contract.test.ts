import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Personal group vs profile tab must not share the same user-facing name
 * (settings sidebar IA: group "Personal" + tab "Profile"/"资料"/"資料").
 */
function readLocale(locale: "en" | "zh" | "zh-TW"): string {
  return readFileSync(
    join(import.meta.dir, `../src/i18n/locales/${locale}/settings.ts`),
    "utf8",
  );
}

function extractString(source: string, key: string): string {
  const re = new RegExp(
    `"${key.replace(/\./g, "\\.")}":\\s*"([^"]*)"`,
  );
  const match = source.match(re);
  if (!match?.[1]) {
    throw new Error(`Missing locale key: ${key}`);
  }
  return match[1];
}

describe("settings nav personal group vs profile tab labels", () => {
  for (const locale of ["en", "zh", "zh-TW"] as const) {
    test(`${locale}: group_personal_memory !== tab_memory`, () => {
      const source = readLocale(locale);
      const group = extractString(source, "settings.group_personal_memory");
      const tab = extractString(source, "settings.tab_memory");
      expect(group.length).toBeGreaterThan(0);
      expect(tab.length).toBeGreaterThan(0);
      expect(tab).not.toBe(group);
    });
  }

  test("en uses Personal group + Profile tab", () => {
    const source = readLocale("en");
    expect(extractString(source, "settings.group_personal_memory")).toBe(
      "Personal",
    );
    expect(extractString(source, "settings.tab_memory")).toBe("Profile");
    expect(extractString(source, "settings.tab_conversation_memory")).toBe(
      "Memory",
    );
  });

  test("zh uses 个人 group + 资料 tab", () => {
    const source = readLocale("zh");
    expect(extractString(source, "settings.group_personal_memory")).toBe(
      "个人",
    );
    expect(extractString(source, "settings.tab_memory")).toBe("资料");
  });

  test("zh-TW uses 個人 group + 資料 tab", () => {
    const source = readLocale("zh-TW");
    expect(extractString(source, "settings.group_personal_memory")).toBe(
      "個人",
    );
    expect(extractString(source, "settings.tab_memory")).toBe("資料");
  });
});
