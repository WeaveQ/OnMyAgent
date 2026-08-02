/**
 * Installed/builtin skill cards: click → chat, not detail dialog.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");

describe("installed skill card → chat wiring", () => {
  test("card activate prefers onChat over onOpen (detail must not steal click)", () => {
    const page = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/plugins/skills-marketplace/skills-marketplace-page.tsx",
      ),
      "utf8",
    );
    expect(page).toContain("if (props.onChat)");
    expect(page).toContain("props.onChat(props.skill)");
    // Detail only when chat unavailable — not when market catalog matches.
    expect(page).toContain("!props.onChatWithSkill && market");
    // Auto-enable before chat so slash /name can load.
    expect(page).toContain("handleSkillEnabledChange(target, true)");
  });

  test("assistant and expert chat handlers seed slash with package name", () => {
    const assistant = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/assistant.tsx"),
      "utf8",
    );
    const expertNav = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/session/pages/use-expert-skill-navigation.ts",
      ),
      "utf8",
    );
    expect(assistant).toContain("chat_with_skill_prompt");
    expect(assistant).toContain('skill.name.trim().replace(/^\\/+/, "")');
    expect(expertNav).toContain("chat_with_skill_prompt");
    expect(expertNav).toContain('skill.name.trim().replace(/^\\/+/, "")');
  });

  test("i18n prompt uses slash skill name token", () => {
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const src = readFileSync(
        join(appRoot, `src/i18n/locales/${locale}/session.ts`),
        "utf8",
      );
      expect(src).toMatch(/chat_with_skill_prompt".*\/\{name\}/);
    }
  });
});
