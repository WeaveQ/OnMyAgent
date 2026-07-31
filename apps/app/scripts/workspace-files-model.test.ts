import { describe, expect, test } from "bun:test";

import {
  buildRootOutlineRows,
  collectMatchingFilesUnder,
  countDirsInNode,
  countFilesInNode,
  fileCategoryI18nKey,
  filterWorkspaceFileTree,
  getFileCategory,
  relativeDisplayPath,
  resolveToolWorkspaceFileRoot,
} from "../src/react-app/domains/workspace/workspace-files-model";
import type { WorkspaceFileTreeNode } from "../src/react-app/capabilities/artifacts/workspace-file-tree";

function file(name: string, path: string, mtimeMs = 1): WorkspaceFileTreeNode {
  return { name, path, kind: "file", size: 10, mtimeMs, children: [] };
}

function dir(name: string, path: string, children: WorkspaceFileTreeNode[]): WorkspaceFileTreeNode {
  return { name, path, kind: "dir", size: 0, mtimeMs: 0, children };
}

describe("getFileCategory", () => {
  test("maps common extensions", () => {
    expect(getFileCategory("a.md")).toBe("markdown");
    expect(getFileCategory("a.PDF")).toBe("pdf");
    expect(getFileCategory("a.ts")).toBe("code");
    expect(getFileCategory("noext")).toBe("other");
  });
});

describe("fileCategoryI18nKey", () => {
  test("returns keys for chips", () => {
    expect(fileCategoryI18nKey("all")).toBe("files.category_all");
    expect(fileCategoryI18nKey("code")).toBe("files.category_code");
  });
});

describe("tree counts and outline", () => {
  test("countFilesInNode / countDirsInNode", () => {
    const tree = dir("root", "root", [
      file("a.ts", "root/a.ts"),
      dir("sub", "root/sub", [file("b.ts", "root/sub/b.ts")]),
    ]);
    expect(countFilesInNode(tree)).toBe(2);
    expect(countDirsInNode(tree)).toBe(1);
  });

  test("buildRootOutlineRows respects expanded set", () => {
    const children = [
      dir("proj", "proj", [
        dir("task", "proj/task", [file("f.ts", "proj/task/f.ts")]),
        file("root.ts", "proj/root.ts"),
      ]),
      file("loose.ts", "loose.ts"),
    ];
    const collapsed = buildRootOutlineRows(children, new Set());
    expect(collapsed.some((r) => r.type === "loose-file")).toBe(true);
    expect(collapsed.filter((r) => r.type === "task").length).toBe(0);
    const expanded = buildRootOutlineRows(children, new Set(["proj", "proj/task"]));
    expect(expanded.some((r) => r.type === "task")).toBe(true);
    expect(expanded.some((r) => r.type === "file" && r.node.path === "proj/task/f.ts")).toBe(true);
  });
});

describe("filter and collect", () => {
  test("filterWorkspaceFileTree by query and type", () => {
    const root = dir("", "", [
      file("readme.md", "readme.md"),
      file("app.ts", "app.ts"),
      dir("src", "src", [file("main.ts", "src/main.ts")]),
    ]);
    const filtered = filterWorkspaceFileTree(root, "main", "code");
    expect(filtered?.children.some((c) => c.path === "src")).toBe(true);
    // Root path is empty so the helper keeps the root shell even when no files match.
    const noMatch = filterWorkspaceFileTree(root, "readme", "code");
    expect(noMatch).not.toBeNull();
    expect(noMatch?.children).toEqual([]);
  });

  test("collectMatchingFilesUnder sorts by updated desc", () => {
    const root = dir("", "", [
      file("a.ts", "a.ts", 1),
      file("b.ts", "b.ts", 3),
      file("c.md", "c.md", 2),
    ]);
    const files = collectMatchingFilesUnder(root, "", "code", "updated", "desc");
    expect(files.map((f) => f.name)).toEqual(["b.ts", "a.ts"]);
  });
});

describe("path helpers", () => {
  test("relativeDisplayPath", () => {
    // Strips leading/trailing slashes from the base, then relative when full is under base/.
    expect(relativeDisplayPath("ws/a/b.ts", "ws")).toBe("a/b.ts");
    expect(relativeDisplayPath("ws/a/b.ts", "/ws/")).toBe("a/b.ts");
    expect(relativeDisplayPath("/other", "ws")).toBe("/other");
  });

  test("resolveToolWorkspaceFileRoot preference order", () => {
    expect(
      resolveToolWorkspaceFileRoot({
        draftWorkspaceDirectory: " draft ",
        sessionFileRoot: "session",
        workspaceRoot: "root",
      }),
    ).toBe("draft");
    expect(
      resolveToolWorkspaceFileRoot({
        draftWorkspaceDirectory: "",
        sessionFileRoot: " session ",
        workspaceRoot: "root",
      }),
    ).toBe("session");
    expect(
      resolveToolWorkspaceFileRoot({
        draftWorkspaceDirectory: null,
        sessionFileRoot: null,
        workspaceRoot: " root ",
      }),
    ).toBe("root");
  });
});

describe("workspace-files-page host keeps required UI surfaces (structural)", () => {
  test("P0 three-source shell: uploads panel + pending empty; pure helpers in model", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(
        import.meta.dir,
        "../src/react-app/domains/workspace/workspace-files-page.tsx",
      ),
      "utf8",
    );
    const uploads = require("node:fs").readFileSync(
      require("node:path").join(
        import.meta.dir,
        "../src/react-app/domains/workspace/workspace-files-uploads-panel.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("function FilesSourcePendingEmpty");
    expect(source).toContain("<WorkspaceFilesUploadsPanel");
    expect(source).toContain("<FilesSourcePendingEmpty");
    expect(source).not.toContain("CloudDriveEmptyState");
    expect(source).not.toContain("FilePreviewDrawer");
    expect(source).toContain('from "./workspace-files-model"');
    expect(source).toContain("DEFAULT_FILES_SOURCE_TAB");
    expect(uploads).toContain("uploadInbox");
    expect(uploads).toContain("listInbox");
    // Pure tree helpers remain in model for P1 browser restore / unit tests
    expect(
      require("node:fs")
        .readFileSync(
          require("node:path").join(
            import.meta.dir,
            "../src/react-app/domains/workspace/workspace-files-model.ts",
          ),
          "utf8",
        )
        .includes("buildRootOutlineRows"),
    ).toBe(true);
  });
});
