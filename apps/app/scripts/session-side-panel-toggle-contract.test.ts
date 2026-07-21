import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("right side panel toggle contract", () => {
  test("chat header stays borderless while right panel titlebars keep their divider", () => {
    // Header implementation lives under chrome/session-surface-header; barrel re-exports it.
    const surfaceChromeBarrel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/session-surface-chrome.tsx",
    );
    const surfaceHeader = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/chrome/session-surface-header.tsx",
    );
    const surface = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/session-surface.tsx",
    );
    const sessionPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/chat/session-page.tsx",
    );
    const workspacePanel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
    );

    // Header base chrome; bottom rule is optional so expanded session tabs
    // can own the single divider (avoid double lines).
    expect(surfaceChromeBarrel).toContain("./chrome/session-surface-header");
    expect(surfaceHeader).toContain(
      '"flex h-12 shrink-0 items-center justify-between bg-dls-background px-5"',
    );
    expect(surfaceHeader).toContain("showBottomBorder?: boolean");
    expect(surfaceHeader).toContain(
      'showBottomBorder && "border-b border-dls-mist"',
    );
    expect(surface).toContain("showBottomBorder={!sessionTabsExpanded}");
    expect(surfaceHeader).not.toContain(
      'className="flex h-12 shrink-0 items-center justify-between border-b border-dls-mist bg-dls-surface px-5"',
    );
    expect(sessionPage).toContain(
      "flex h-12 shrink-0 items-center justify-end gap-1 border-b border-dls-mist",
    );
    expect(workspacePanel).toContain(
      "flex h-12 shrink-0 items-center gap-1 border-b border-dls-mist",
    );
  });

  test("sidebar resize handles do not draw a persistent divider", () => {
    const sources = [
      readWorkspaceFile("apps/app/src/react-app/domains/session/chat/session-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/local-agents/host/personal-local-agent-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx"),
    ];

    for (const source of sources) {
      expect(source).toContain(
        "bg-transparent transition-colors group-focus-visible:bg-dls-accent",
      );
      expect(source).not.toContain(
        "bg-dls-border transition-colors group-hover:bg-dls-border-strong group-focus-visible:bg-dls-accent",
      );
    }
  });

  test("local agent pages do not inherit the session side-panel toggle", () => {
    const sources = [
      readWorkspaceFile("apps/app/src/react-app/domains/session/chat/session-page.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx"),
      readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx"),
    ];

    for (const source of sources) {
      const localAgentStart = source.indexOf("<PersonalLocalAgentPage");
      const localAgentEnd = source.indexOf("/>", localAgentStart);
      const localAgentView = source.slice(localAgentStart, localAgentEnd);

      expect(localAgentStart).toBeGreaterThan(-1);
      expect(localAgentEnd).toBeGreaterThan(localAgentStart);
      expect(localAgentView).not.toContain("headerActions={headerPanelControls}");
    }
  });

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
    const sharedChrome = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/session-history-search-chrome.tsx",
    );

    // Shared chrome owns the toggle; hide when sidePanelOpen (no toggle in header).
    expect(sharedChrome).toContain("export function SessionHistorySearchChrome");
    expect(sharedChrome).toContain("sidePanelOpen: boolean");
    expect(sharedChrome).toContain("{!props.sidePanelOpen ? (");
    expect(sharedChrome).toContain('data-code-side-panel-toggle="true"');
    expect(sharedChrome).toContain('size="icon-xs"');
    expect(sharedChrome).toContain(
      'className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"',
    );
    expect(sharedChrome).toContain('<PanelRight className="size-3.5" />');

    for (const source of [assistant, expert]) {
      expect(source).toContain("SessionHistorySearchChrome");
      expect(source).toContain("sidePanelOpen={sidePanelOpen}");
      expect(source).toContain("headerActions={headerPanelControls}");
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

  test("workspace tool tabs activate content without relying on setState updater side-effects", () => {
    const workspacePanel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
    );
    // Deterministic singleton id + explicit setActiveId (browser/files/review).
    expect(workspacePanel).toContain("const singletonId = `${kind}-singleton`");
    expect(workspacePanel).toContain("setActiveId(singletonId)");
    // Safety net when tabs exist but activeId is briefly null/stale.
    expect(workspacePanel).toContain("tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null");
    expect(workspacePanel).toContain("Heal activeId when tabs exist");
    // Must not assign active id only from inside setTabs updater (async-defer bug).
    expect(workspacePanel).not.toContain("existingId = existing.id");
    expect(workspacePanel).not.toContain("if (existingId) setActiveId(existingId)");
  });

  test("workspace tool tabs survive side-panel close via session-scoped snapshot cache", () => {
    const workspacePanel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
    );
    expect(workspacePanel).toContain("workspacePanelSnapshots");
    expect(workspacePanel).toContain("writeWorkspacePanelSnapshot");
    expect(workspacePanel).toContain("readWorkspacePanelSnapshot");
    expect(workspacePanel).toContain("Persist durable tool tabs whenever they change");
  });
});
