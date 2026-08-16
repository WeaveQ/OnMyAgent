import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("automation prompt tools contract", () => {
  test("matches the chat composer controls and keeps folder selection in the workspace field", () => {
    const pageSource = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/messaging/automation-page-dialogs.tsx"),
      "utf8",
    );
    const toolsSource = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/messaging/automation-prompt-tools.tsx"),
      "utf8",
    );

    expect(pageSource).toContain("<AutomationPromptTools");
    expect(pageSource).toContain("<AccessPermissionSelect");
    expect(pageSource).toContain("<ModelSelectContainer");
    expect(pageSource).not.toContain("<AgentSelect");
    expect(pageSource).toContain("pickDirectory({");
    // Toolbar order: model → skills → permission (session-like simple chips).
    const modelIdx = pageSource.indexOf("<ModelSelectContainer");
    const toolsIdx = pageSource.indexOf("<AutomationPromptTools");
    const permIdx = pageSource.indexOf("<AccessPermissionSelect");
    expect(modelIdx).toBeGreaterThan(-1);
    expect(toolsIdx).toBeGreaterThan(modelIdx);
    expect(permIdx).toBeGreaterThan(toolsIdx);
    // Same catalog as session composer Skills: OpenCode command.list + skills.
    expect(pageSource).toContain("listOpenCodeCommands");
    expect(toolsSource).toContain("listOpenCodeCommands");
    expect(toolsSource).toContain("buildAutomationSkillCatalog");
    expect(toolsSource).toContain(".listCommands(");
    expect(toolsSource).toContain(".listSkills(");
    expect(toolsSource).toContain(".uploadInbox(");
    expect(toolsSource).toContain('type="file"');
    expect(toolsSource).toContain("<PopoverContent");
    expect(toolsSource).toContain('side="top"');
    // Simple 技能 chip — not dual-pane 36rem tool menu.
    expect(toolsSource).toContain('t("automation.tool_skills")');
    expect(toolsSource).toContain("w-64");
    expect(toolsSource).toContain("max-h-56");
    expect(toolsSource).not.toContain("36rem");
    expect(toolsSource).not.toContain('id: "plugins"');
    expect(toolsSource).not.toContain('id: "connectors"');
    expect(toolsSource).not.toContain('id: "commands"');
  });
});
