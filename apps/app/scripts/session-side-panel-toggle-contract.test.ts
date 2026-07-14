import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("right side panel toggle contract", () => {
  test("chat code mode uses the panel icon and hides the header toggle while expanded", () => {
    const source = readWorkspaceFile("apps/app/src/react-app/domains/session/chat/session-page.tsx");

    expect(source).not.toContain("Columns3");
    expect(source).toContain("showCodeSideRail ? (");
    expect(source).toContain("!sidePanelOpen ? (");
    expect(source).toContain('data-code-side-panel-toggle="true"');
    expect(source).toContain('size="icon-xs"');
    expect(source).toContain('className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"');
    expect(source).toContain('<PanelRight className="size-3.5" />');
  });

  test("assistant and expert pages hide the header toggle while the right panel is expanded", () => {
    const assistant = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx");
    const expert = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");

    for (const source of [assistant, expert]) {
      expect(source).toContain("const headerPanelControls = !sidePanelOpen ?");
      expect(source).toContain('data-code-side-panel-toggle="true"');
      expect(source).toContain('size="icon-xs"');
      expect(source).toContain('className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"');
      expect(source).toContain('<PanelRight className="size-3.5" />');
    }
  });

  test("expanded code side panels expose an explicit close affordance", () => {
    const sessionPage = readWorkspaceFile("apps/app/src/react-app/domains/session/chat/session-page.tsx");
    const workspacePanel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
    );

    expect(sessionPage).toContain('data-code-side-panel-close="true"');
    expect(sessionPage).toContain("flex h-12 shrink-0 items-center justify-end gap-1 border-b border-dls-mist");
    expect(workspacePanel).toContain('data-code-side-panel-close="true"');
    expect(workspacePanel).toContain('className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"');
    expect(workspacePanel).toContain('<PanelRight className="size-3.5" />');
    expect(workspacePanel).toContain("flex h-12 shrink-0 items-center gap-1 border-b border-dls-mist");
  });
});
