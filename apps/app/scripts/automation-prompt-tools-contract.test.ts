import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("automation prompt tools contract", () => {
  test("matches the chat composer controls and keeps folder selection in the workspace field", () => {
    const pageSource = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/messaging/automation-page.tsx"),
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
    expect(toolsSource).toContain(".listCommands(");
    expect(toolsSource).toContain(".listSkills(");
    expect(toolsSource).toContain(".listPlugins(");
    expect(toolsSource).toContain(".listMcp(");
    expect(toolsSource).toContain(".uploadInbox(");
    expect(toolsSource).toContain('type="file"');
  });
});
