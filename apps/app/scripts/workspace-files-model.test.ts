import { describe, expect, test } from "bun:test";

import {
  buildRootOutlineRows,
  collectMatchingFilesUnder,
  countDirsInNode,
  countFilesInNode,
  fileCategoryI18nKey,
  filterWorkspaceFileTree,
  filterWorkspaceTreeBySourceTab,
  formatExpertFolderDisplayName,
  formatSessionFolderDisplayName,
  formatWorkspaceFolderDisplayName,
  getFileCategory,
  isLikelySessionFolderName,
  mergeExpertSiblingFolders,
  relativeDisplayPath,
  resolveSessionFolderTimeMs,
  resolveToolWorkspaceFileRoot,
} from "../src/react-app/domains/workspace/workspace-files-model";
import {
  compareTaskSourceNodes,
  taskSourceBucketRank,
  type WorkspaceFileTreeNode,
} from "../src/react-app/capabilities/artifacts/workspace-file-tree";

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

describe("folder display names", () => {
  test("strips expert displayName-slug for L0 labels", () => {
    expect(formatExpertFolderDisplayName("财报研究员-earnings-reviewer")).toBe(
      "财报研究员",
    );
    expect(
      formatExpertFolderDisplayName(
        "报价作业-quote-specialistquote-specialist",
      ),
    ).toBe("报价作业");
    expect(formatExpertFolderDisplayName("fleet-management-specialist")).toBe(
      "fleet-management-specialist",
    );
  });

  test("session folders use fixed 会话 · datetime title", () => {
    expect(isLikelySessionFolderName("1785029883722")).toBe(true);
    expect(isLikelySessionFolderName("e4fae6588c5f")).toBe(true);
    expect(isLikelySessionFolderName("2026-07-23_155052")).toBe(true);
    expect(isLikelySessionFolderName("报价作业")).toBe(false);
    expect(resolveSessionFolderTimeMs("1785029883722")).toBe(1785029883722);
    const label = formatSessionFolderDisplayName("1785029883722");
    expect(label.startsWith("会话 · ") || label.startsWith("Session · ")).toBe(
      true,
    );
    expect(formatWorkspaceFolderDisplayName("1785029883722")).toBe(label);
  });

  test("merges duplicate expert folders that share a display name", () => {
    const a = dir("报价作业", "experts/报价作业", [
      dir("e4fae6588c5f", "experts/报价作业/e4fae6588c5f", [
        file("a.json", "experts/报价作业/e4fae6588c5f/a.json", 10),
      ]),
    ]);
    a.mtimeMs = 10;
    const b = dir(
      "报价作业-quote-specialistquote-specialist",
      "experts/报价作业-quote-specialistquote-specialist",
      [
        dir(
          "1785029883722",
          "experts/报价作业-quote-specialistquote-specialist/1785029883722",
          [
            file(
              "b.json",
              "experts/报价作业-quote-specialistquote-specialist/1785029883722/b.json",
              20,
            ),
          ],
        ),
      ],
    );
    b.mtimeMs = 20;
    const merged = mergeExpertSiblingFolders([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("报价作业");
    expect(merged[0]?.children.map((c) => c.name).sort()).toEqual([
      "1785029883722",
      "e4fae6588c5f",
    ]);

    const root = dir("", "", [
      dir("experts", "experts", [a, b]),
    ]);
    const expertTree = filterWorkspaceTreeBySourceTab(root, "expert");
    expect(expertTree.children.map((c) => c.name)).toEqual(["报价作业"]);
  });
});

describe("task tab sort buckets", () => {
  test("ranks projects/spaces above automation runs", () => {
    const isAuto = (name: string) => name.startsWith("auto-run-");
    const space = dir("demo", "projects/demo", []);
    const auto = dir("auto-run-2026-07-31", "tasks/auto-run-2026-07-31", []);
    const other = dir("notes", "tasks/notes", []);
    expect(taskSourceBucketRank(space, isAuto)).toBe(0);
    expect(taskSourceBucketRank(other, isAuto)).toBe(1);
    expect(taskSourceBucketRank(auto, isAuto)).toBe(2);
    // Even when auto is newer, space sorts first.
    space.mtimeMs = 1;
    auto.mtimeMs = 99;
    expect(
      compareTaskSourceNodes(space, auto, "updated", "desc", isAuto),
    ).toBeLessThan(0);
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
  test("P0 three-source shell: uploads + task browser + expert pending empty", () => {
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
    const browser = require("node:fs").readFileSync(
      require("node:path").join(
        import.meta.dir,
        "../src/react-app/domains/workspace/workspace-files-browser-panel.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("<WorkspaceFilesUploadsPanel");
    expect(source).toContain("<WorkspaceFilesBrowserPanel");
    expect(source).toContain('sourceTab={activeTab === "expert" ? "expert" : "task"}');
    expect(source).not.toContain("CloudDriveEmptyState");
    expect(source).toContain('from "./workspace-files-model"');
    expect(source).toContain("DEFAULT_FILES_SOURCE_TAB");
    expect(uploads).toContain("uploadInbox");
    expect(uploads).toContain("listInbox");
    expect(browser).toContain("FilePreviewDrawer");
    expect(browser).toContain("workspace-files-preview-drawer");
    expect(browser).toContain("filterWorkspaceTreeBySourceTab");
    expect(browser).toContain("buildRootOutlineRows");
  });
});
