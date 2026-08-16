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

describe("create skill matches WorkBuddy chip draft", () => {
  test("create handlers seed /skill-creator and install the package", () => {
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
    expect(assistant).toContain("const handleCreateSkill");
    expect(assistant).toContain("create_skill_prompt");
    expect(assistant).toContain("installBuiltinSkillPackage");
    expect(assistant).toContain("CREATE_SKILL_PACKAGE_NAME");
    expect(expertNav).toContain("const handleCreateSkill");
    expect(expertNav).toContain("create_skill_prompt");
    expect(expertNav).toContain("installBuiltinSkillPackage");
  });

  test("create-skill draft starts with /skill-creator and a short placeholder", () => {
    const zh = readFileSync(join(appRoot, "src/i18n/locales/zh/session.ts"), "utf8");
    const en = readFileSync(join(appRoot, "src/i18n/locales/en/session.ts"), "utf8");
    const zhTW = readFileSync(join(appRoot, "src/i18n/locales/zh-TW/session.ts"), "utf8");
    expect(zh).toMatch(/create_skill_prompt": "\/skill-creator 请帮我创建一个可以实现「\.\.\.\.\.\.」的skill"/);
    expect(en).toMatch(/create_skill_prompt": "\/skill-creator Please help me create a skill that can \\?"\.\.\.\.\.\.\\?"/);
    expect(zhTW).toMatch(/create_skill_prompt": "\/skill-creator 請幫我建立一個可以實現「\.\.\.\.\.\.」的skill"/);
  });

  test("bundled skill-creator trigger stays English and card copy is Chinese", () => {
    const skill = readFileSync(
      join(
        appRoot,
        "../desktop/resources/bundled-skills/skill-creator/SKILL.md",
      ),
      "utf8",
    );
    const frontmatter = skill.slice(0, skill.indexOf("\n---", 4));
    const triggerDescription = frontmatter.match(/^description:\s*(.*)$/m)?.[1] ?? "";
    expect(frontmatter).toContain('display_name: "Skill Creator"');
    expect(triggerDescription).toContain("Create, edit, evaluate, benchmark");
    expect(triggerDescription).not.toMatch(/[\u4e00-\u9fff]/);
    expect(frontmatter).toMatch(/description_zh:\s*".*[\u4e00-\u9fff]/);
  });

  test("injected skill-creator bodies finish in installed-skills, not eval-viewer", () => {
    const bundled = readFileSync(
      join(appRoot, "../desktop/resources/bundled-skills/skill-creator/SKILL.md"),
      "utf8",
    );
    const template = readFileSync(
      join(appRoot, "src/app/data/skill-creator.md"),
      "utf8",
    );
    for (const body of [bundled, template]) {
      expect(body).toContain("profiles/local/config/skills");
      expect(body).toMatch(/name/i);
      expect(body).toMatch(/description/i);
      expect(body).not.toMatch(/GENERATE THE EVAL VIEWER _BEFORE_/);
    }
    expect(template).not.toMatch(/prefer creating the skill at `\.opencode\/skills\//i);
  });

  test("expert create-skill still navigates before awaiting install", () => {
    const expertNav = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/session/pages/use-expert-skill-navigation.ts",
      ),
      "utf8",
    );
    expect(expertNav).toContain("goAssistantOfficeNewTaskWithDraft(t(\"session.create_skill_prompt\"))");
    expect(expertNav).not.toContain("await installBuiltinSkillPackage");
  });
});
