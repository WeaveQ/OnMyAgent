import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("built-in BrowserSkill (Path B)", () => {
  test("ships a bundled skill for the external bsk CLI", () => {
    const skillPath = join(
      repoRoot,
      "apps/desktop/resources/bundled-skills/browser-skill/SKILL.md",
    );
    expect(existsSync(skillPath)).toBe(true);

    const skill = readFileSync(skillPath, "utf8");
    expect(skill).toContain("name: browser-skill");
    expect(skill).toContain("bsk");
    expect(skill).toContain("session start");
    expect(skill).toContain("session stop");
    expect(skill).toContain("browser-automation");
    expect(skill).toContain("Computer Use");
    expect(skill).toContain("Tencent/BrowserSkill");
    expect(skill).toContain("Extensions → BrowserSkill");
    expect(skill).toContain("do not dump shell unless asked");
    for (const cmd of ["navigate", "snapshot", "click", "fill", "request-help"]) {
      expect(skill).toContain(cmd);
    }
  });

  test("registers extension card, settings panel, and IPC health checks", () => {
    const extensions = readWorkspaceFile("apps/app/src/app/extensions.ts");
    expect(extensions).toContain('id: "browser-skill"');
    expect(extensions).toContain('path: "bundled-skills/browser-skill/SKILL.md"');
    expect(extensions).toContain('ref: "onmyagent.browserSkill.settings"');
    expect(extensions).toContain('testActionRef: "onmyagent.browserSkill.healthCheck"');
    expect(extensions).toContain('instructions: t("extensions.browser_skill_setup")');
    expect(extensions).toContain('prompt: t("extensions.browser_skill_prompt")');

    const settingsIndex = readWorkspaceFile(
      "apps/app/src/react-app/domains/settings/index.ts",
    );
    expect(settingsIndex).toContain('import "./browser-skill-config"');

    const panel = readWorkspaceFile(
      "apps/app/src/react-app/domains/settings/browser-skill-config.tsx",
    );
    expect(panel).toContain('registerExtensionConfig("browser-skill"');
    expect(panel).toContain("checkBrowserSkillStatus");
    expect(panel).toContain("openBrowserSkillInstallPage");

    const commands = readWorkspaceFile(
      "packages/types/src/desktop-ipc-commands.mjs",
    );
    expect(commands).toContain("checkBrowserSkillStatus");
    expect(commands).toContain("openBrowserSkillInstallPage");

    const systemHandlers = readWorkspaceFile(
      "apps/desktop/electron/desktop-handlers/system.mjs",
    );
    expect(systemHandlers).toContain("checkBrowserSkillStatus");
    expect(systemHandlers).toContain("openBrowserSkillInstallPage");

    const desktopHelper = readWorkspaceFile(
      "apps/desktop/electron/browser-skill-desktop.mjs",
    );
    expect(desktopHelper).toContain("createBrowserSkillDesktopHelpers");
    expect(desktopHelper).toContain("resolveBskBinary");
  });

  test("localizes BrowserSkill strings in en / zh / zh-TW", () => {
    for (const locale of ["en", "zh", "zh-TW"]) {
      const messages = readWorkspaceFile(
        `apps/app/src/i18n/locales/${locale}/extensions.ts`,
      );
      for (const key of [
        "extensions.browser_skill_name",
        "extensions.browser_skill_description",
        "extensions.browser_skill_setup",
        "extensions.browser_skill_prompt",
        "extensions.browser_skill_suggestion_summary",
        "extensions.browser_skill_suggestion_form",
        "extensions.browser_skill_suggestion_smoke",
        "extensions.browser_skill_install_extension",
        "extensions.browser_skill_run_doctor",
        "extensions.browser_skill_vs_in_app",
        "extensions.browser_skill_choose_surface",
      ]) {
        expect(messages).toContain(`"${key}"`);
      }
    }
  });
});
