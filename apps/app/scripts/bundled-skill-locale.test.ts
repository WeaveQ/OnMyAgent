/**
 * Skill titles stay English; only descriptions follow locale.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveBundledSkillDisplay } from "../src/react-app/domains/plugins/bundled-skill-locale";

const appRoot = join(import.meta.dir, "..");

describe("resolveBundledSkillDisplay (shipped)", () => {
  test("never uses Chinese display name for the title", () => {
    const skill = {
      name: "find-skills",
      displayNameZh: "发现技能",
      displayNameEn: "Find Skills",
      descriptionZh: "中文描述",
      descriptionEn: "English description",
      description: "fallback",
    };
    const resolved = resolveBundledSkillDisplay(skill);
    expect(resolved.name).toBe("Find Skills");
    expect(resolved.name).not.toMatch(/发现|技能|自动化|专家/);
  });

  test("falls back to package name when EN display is missing", () => {
    const resolved = resolveBundledSkillDisplay({
      name: "create-automation",
      displayNameZh: "创建自动化",
      descriptionZh: "中文",
    });
    expect(resolved.name).toBe("create-automation");
  });
});

describe("skills marketplace title wiring", () => {
  test("skillDisplayName prefers EN / package name, not displayNameZh", () => {
    const page = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/plugins/skills-marketplace/skills-marketplace-page.tsx",
      ),
      "utf8",
    );
    expect(page).toContain(
      "return skill.displayNameEn || skill.name;",
    );
    expect(page).not.toMatch(
      /function skillDisplayName[\s\S]*?displayNameZh\s*\|\|/,
    );
  });
});
