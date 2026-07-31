import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_FILES_SOURCE_TAB,
  FILES_SOURCE_TABS,
  USER_UPLOADS_RELATIVE_DIR,
  buildUserUploadRelativePath,
  filterUploadRows,
  filterWorkspaceTreeBySourceTab,
  isFilesSourceListReady,
  isLikelyExpertAgentFolderName,
  mapInboxItemsToUploadRows,
} from "../src/react-app/domains/workspace/workspace-files-model";
import type { WorkspaceFileTreeNode } from "../src/react-app/capabilities/artifacts/workspace-file-tree";

const repoRoot = join(import.meta.dir, "../../..");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("files three-source tabs (P0)", () => {
  test("source tab helpers default to task and only uploads is list-ready", () => {
    expect(DEFAULT_FILES_SOURCE_TAB).toBe("task");
    expect([...FILES_SOURCE_TABS]).toEqual(["uploads", "task", "expert"]);
    expect(isFilesSourceListReady("uploads")).toBe(true);
    expect(isFilesSourceListReady("task")).toBe(true);
    expect(isFilesSourceListReady("expert")).toBe(true);
  });

  test("expert folder heuristics split task vs expert top-level dirs", () => {
    expect(isLikelyExpertAgentFolderName("财报研究员-earnings-reviewer")).toBe(
      true,
    );
    expect(
      isLikelyExpertAgentFolderName("B站内容策略师-bilibili-content-strategist"),
    ).toBe(true);
    expect(isLikelyExpertAgentFolderName("fleet-management-specialist")).toBe(
      true,
    );
    expect(
      isLikelyExpertAgentFolderName("创业教练-chuangye-manor", [
        "chuangye-manor",
      ]),
    ).toBe(true);
    expect(isLikelyExpertAgentFolderName("uploads")).toBe(false);
    expect(isLikelyExpertAgentFolderName("我的草稿")).toBe(false);

    const root: WorkspaceFileTreeNode = {
      name: "",
      path: "",
      kind: "dir",
      size: 0,
      mtimeMs: 0,
      children: [
        {
          name: "财报研究员-earnings-reviewer",
          path: "财报研究员-earnings-reviewer",
          kind: "dir",
          size: 0,
          mtimeMs: 1,
          children: [],
        },
        {
          name: "home-notes",
          path: "home-notes",
          kind: "dir",
          size: 0,
          mtimeMs: 2,
          children: [],
        },
        {
          name: "loose.md",
          path: "loose.md",
          kind: "file",
          size: 1,
          mtimeMs: 3,
          children: [],
        },
      ],
    };
    const taskTree = filterWorkspaceTreeBySourceTab(root, "task");
    const expertTree = filterWorkspaceTreeBySourceTab(root, "expert");
    expect(taskTree.children.map((c) => c.name).sort()).toEqual([
      "home-notes",
      "loose.md",
    ]);
    expect(expertTree.children.map((c) => c.name)).toEqual([
      "财报研究员-earnings-reviewer",
    ]);
  });

  test("import-by-copy paths land under uploads/", () => {
    expect(USER_UPLOADS_RELATIVE_DIR).toBe("uploads");
    expect(buildUserUploadRelativePath("report.pdf")).toBe("uploads/report.pdf");
    expect(buildUserUploadRelativePath("/tmp/nested/notes.md")).toBe(
      "uploads/notes.md",
    );
    expect(buildUserUploadRelativePath("")).toBe("uploads/file");
  });

  test("mapInboxItemsToUploadRows filters and sorts real inbox payloads", () => {
    const rows = mapInboxItemsToUploadRows([
      { id: "b", name: "b.txt", path: "uploads/b.txt", size: 2, updatedAt: 10 },
      { id: "a", name: "a.txt", path: "uploads/a.txt", size: 1, updatedAt: 20 },
      { id: "  ", name: "skip" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterUploadRows(rows, "A.TXT")).toEqual([rows[0]]);
    expect(filterUploadRows(rows, "nope")).toEqual([]);
  });

  test("Files page wires three NavTabs without bg-white active override", () => {
    const page = read(
      "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
    );
    const uploads = read(
      "apps/app/src/react-app/domains/workspace/workspace-files-uploads-panel.tsx",
    );

    expect(page).toContain("FILES_SOURCE_TABS");
    expect(page).toContain("DEFAULT_FILES_SOURCE_TAB");
    expect(page).toContain("WorkspaceFilesUploadsPanel");
    expect(page).toContain("WorkspaceFilesBrowserPanel");
    expect(page).toContain('sourceTab={activeTab === "expert" ? "expert" : "task"}');
    expect(page).toContain('density="bare"');
    expect(page).toContain('size="tab"');
    expect(page).toContain('shape="tab"');
    expect(page).not.toMatch(/className=\{?["'`][^"'`]*bg-white/);
    expect(page).not.toContain('activeTab === "cloud"');
    expect(page).not.toContain("CloudDriveEmptyState");

    expect(uploads).toContain("uploadInbox");
    expect(uploads).toContain("listInbox");
    expect(uploads).toContain("buildUserUploadRelativePath");
    expect(uploads).toContain("mapInboxItemsToUploadRows");

    const browser = read(
      "apps/app/src/react-app/domains/workspace/workspace-files-browser-panel.tsx",
    );
    expect(browser).toContain("listCodeWorkspaceFiles");
    expect(browser).toContain("filterWorkspaceTreeBySourceTab");
    expect(browser).toContain("data-workspace-file-breadcrumb");
    expect(browser).toContain("FilePreviewDrawer");
  });

  test("i18n locales define three source tabs and upload copy semantics", () => {
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const source = read(`apps/app/src/i18n/locales/${locale}/files.ts`);
      expect(source).toContain('"files.source_uploads"');
      expect(source).toContain('"files.source_task"');
      expect(source).toContain('"files.source_expert"');
      expect(source).toContain('"files.source_uploads_desc"');
      expect(source).toContain('"files.import_to_workspace"');
      expect(source).toContain('"files.upload_copy_success"');
      expect(source).toContain('"files.task_empty_hint"');
      expect(source).toContain('"files.expert_empty_hint"');
      expect(source).toContain('"files.title"');
    }
    const zhNav = read("apps/app/src/i18n/locales/zh/nav.ts");
    expect(zhNav).toContain('"nav.files": "文件"');
  });
});
