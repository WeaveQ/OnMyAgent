import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("workspace files page navigation", () => {
  test("renders a breadcrumb and replaces the list with the selected folder children", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("const [currentDirectoryPath, setCurrentDirectoryPath]");
    expect(source).toContain("workspaceFileBreadcrumbs(currentDirectoryPath)");
    expect(source).toContain("setCurrentDirectoryPath(node.path)");
    expect(source).toContain('data-workspace-file-breadcrumb="true"');
    expect(source).toContain('data-workspace-file-row={node.kind}');
    expect(source).toContain("listCodeWorkspaceFiles");
    expect(source).toContain("shallow: true");
    expect(source).toContain("currentDirectoryPath");
  });

  test("matches the compact shell tab switcher and surface list chrome", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
      ),
      "utf8",
    );

    // Same pattern as agent management / marketplace: bare SegmentedTabGroup + tab NavTabButton
    expect(source).toContain("shellChrome.pageHeaderSimple");
    expect(source).toContain('<SegmentedTabGroup density="bare">');
    expect(source).toContain('size="tab"');
    expect(source).toContain('shape="tab"');
    expect(source).toContain("<Cloud aria-hidden />");
    // List lives in a surface card; file rows use typed icons
    expect(source).toContain("rounded-xl border border-dls-border bg-dls-surface-solid");
    expect(source).toContain("FileKindIcon");
    expect(source).toContain("max-w-6xl");
  });
});
