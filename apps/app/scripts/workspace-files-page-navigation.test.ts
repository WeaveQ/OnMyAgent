import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("workspace files page navigation", () => {
  test("P0 renders three-source tabs and routes uploads vs pending empty", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("DEFAULT_FILES_SOURCE_TAB");
    expect(source).toContain("FILES_SOURCE_RAIL_TABS");
    expect(source).toContain('activeTab === "uploads"');
    expect(source).toContain("WorkspaceFilesUploadsPanel");
    expect(source).toContain("WorkspaceFilesBrowserPanel");
    expect(source).toContain('sourceTab={activeTab === "expert" ? "expert" : "task"}');
    // Cloud tab removed in P0 three-source IA
    expect(source).not.toContain('activeTab === "cloud"');

    const browser = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/workspace/workspace-files-browser-panel.tsx",
      ),
      "utf8",
    );
    // Task/expert browsers share catalog UI; filter splits expert agent folders.
    expect(browser).toContain("const [currentDirectoryPath, setCurrentDirectoryPath]");
    expect(browser).toContain("workspaceFileBreadcrumbs(currentDirectoryPath)");
    expect(browser).toContain('data-workspace-file-breadcrumb="true"');
    expect(browser).toContain("listCodeWorkspaceFiles");
    expect(browser).toContain("collectMatchingFilesUnder");
    expect(browser).toContain("filterWorkspaceTreeBySourceTab");
    // Continuity: Mine-style drill-in (click folder → breadcrumb), not outline tree.
    expect(browser).toContain("enterDirectory");
    expect(browser).toContain("listDeep");
    expect(browser).toContain("data-files-list-deep");
    expect(browser).not.toContain("groupLooseAsOrphan");
    expect(browser).not.toContain("orphan-header");
    // Loose root files still group under drillable 未分组.
    expect(browser).toContain("buildUngroupedFolderNode");
    expect(browser).toContain("files.ungrouped");
  });

  test("matches the compact shell tab switcher (bare SegmentedTabGroup + tab NavTab)", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
      ),
      "utf8",
    );
    const browser = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/workspace/workspace-files-browser-panel.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("shellChrome.pageHeaderSimple");
    expect(source).toContain('density="bare"');
    expect(source).toContain('size="tab"');
    expect(source).toContain('shape="tab"');
    // Browser uses full-width shell (no max-w-6xl constraint).
    expect(browser).toMatch(/flex min-h-0 flex-1|w-full min-h-0/);
    // No raw white active override (dark theme remaps bg-white)
    expect(source).not.toMatch(/className=\{?["'`][^"'`]*bg-white/);
  });
});
