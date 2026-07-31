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
    expect(source).toContain("FILES_SOURCE_TABS");
    expect(source).toContain('activeTab === "uploads"');
    expect(source).toContain("WorkspaceFilesUploadsPanel");
    expect(source).toContain("FilesSourcePendingEmpty");
    // Cloud tab removed in P0 three-source IA
    expect(source).not.toContain("<Cloud aria-hidden");
    expect(source).not.toContain('activeTab === "cloud"');
  });

  test("matches the compact shell tab switcher (bare SegmentedTabGroup + tab NavTab)", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("shellChrome.pageHeaderSimple");
    expect(source).toContain('density="bare"');
    expect(source).toContain('size="tab"');
    expect(source).toContain('shape="tab"');
    expect(source).toContain("max-w-6xl");
    // No raw white active override (dark theme remaps bg-white)
    expect(source).not.toMatch(/className=\{?["'`][^"'`]*bg-white/);
  });
});
