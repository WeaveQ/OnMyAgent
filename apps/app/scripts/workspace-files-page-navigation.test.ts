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
});
