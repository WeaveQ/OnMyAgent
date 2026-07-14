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
  });

  test("matches the compact marketplace tab switcher", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      'className="flex h-12 shrink-0 items-center border-b border-dls-border bg-dls-surface px-6"',
    );
    expect(source).toContain(
      '<SegmentedTabGroup className="rounded-md border-0 p-0.5">',
    );
    expect(source).toContain(
      'className="h-7 min-w-24 rounded-md px-3 py-0"',
    );
    expect(source).not.toContain('<Cloud className="size-4" />');
  });
});
