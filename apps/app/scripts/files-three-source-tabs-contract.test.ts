import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_FILES_SOURCE_TAB,
  FILES_SOURCE_RAIL_TABS,
  FILES_SOURCE_TABS,
  USER_UPLOADS_RELATIVE_DIR,
  WORKSPACE_INBOX_DIR,
  absoluteInboxFilePath,
  buildUserUploadRelativePath,
  filterUploadRows,
  filterWorkspaceTreeBySourceTab,
  isFilesSourceListReady,
  isFilesSourceRailTabEnabled,
  isLikelyExpertAgentFolderName,
  mapInboxItemsToUploadRows,
  workspaceRelativeInboxPath,
} from "../src/react-app/domains/workspace/workspace-files-model";
import type { WorkspaceFileTreeNode } from "../src/react-app/capabilities/artifacts/workspace-file-tree";

const repoRoot = join(import.meta.dir, "../../..");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("files three-source tabs (P0)", () => {
  test("source tab helpers default to uploads; project rail is disabled", () => {
    expect(DEFAULT_FILES_SOURCE_TAB).toBe("uploads");
    expect([...FILES_SOURCE_TABS]).toEqual(["uploads", "task", "expert"]);
    expect([...FILES_SOURCE_RAIL_TABS]).toEqual([
      "uploads",
      "task",
      "expert",
      "project",
    ]);
    expect(isFilesSourceListReady("uploads")).toBe(true);
    expect(isFilesSourceListReady("task")).toBe(true);
    expect(isFilesSourceListReady("expert")).toBe(true);
    expect(isFilesSourceRailTabEnabled("uploads")).toBe(true);
    expect(isFilesSourceRailTabEnabled("project")).toBe(false);
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
    expect(isLikelyExpertAgentFolderName("tasks")).toBe(false);
    expect(isLikelyExpertAgentFolderName("experts")).toBe(false);
    expect(isLikelyExpertAgentFolderName("我的草稿")).toBe(false);
    expect(isLikelyExpertAgentFolderName("爆款选题策划专家")).toBe(true);

    const root: WorkspaceFileTreeNode = {
      name: "",
      path: "",
      kind: "dir",
      size: 0,
      mtimeMs: 0,
      children: [
        {
          name: "experts",
          path: "experts",
          kind: "dir",
          size: 0,
          mtimeMs: 1,
          children: [
            {
              name: "财报研究员-earnings-reviewer",
              path: "experts/财报研究员-earnings-reviewer",
              kind: "dir",
              size: 0,
              mtimeMs: 1,
              children: [],
            },
          ],
        },
        {
          name: "tasks",
          path: "tasks",
          kind: "dir",
          size: 0,
          mtimeMs: 2,
          children: [
            {
              name: "自动化任务-2026-07-31-12-00-00",
              path: "tasks/自动化任务-2026-07-31-12-00-00",
              kind: "dir",
              size: 0,
              mtimeMs: 2,
              children: [],
            },
          ],
        },
        {
          name: "projects",
          path: "projects",
          kind: "dir",
          size: 0,
          mtimeMs: 3,
          children: [
            {
              name: "home-notes",
              path: "projects/home-notes",
              kind: "dir",
              size: 0,
              mtimeMs: 3,
              children: [],
            },
          ],
        },
        {
          name: "legacy-expert-display",
          path: "legacy-expert-display",
          kind: "dir",
          size: 0,
          mtimeMs: 4,
          children: [],
        },
        {
          name: "loose.md",
          path: "loose.md",
          kind: "file",
          size: 1,
          mtimeMs: 5,
          children: [],
        },
      ],
    };
    const taskTree = filterWorkspaceTreeBySourceTab(root, "task");
    const expertTree = filterWorkspaceTreeBySourceTab(root, "expert", [
      "legacy-expert-display",
    ]);
    expect(taskTree.children.map((c) => c.name).sort()).toEqual([
      "home-notes",
      "loose.md",
      "自动化任务-2026-07-31-12-00-00",
    ]);
    // Expert L0 uses display names; DisplayName-slug merges to DisplayName.
    expect(expertTree.children.map((c) => c.name).sort()).toEqual([
      "legacy-expert-display",
      "财报研究员",
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
    expect(filterUploadRows(rows, "", "document")).toEqual(rows);
    expect(filterUploadRows(rows, "", "spreadsheet")).toEqual([]);
  });

  test("Mine upload rows hide .DS_Store and other system junk", () => {
    const rows = mapInboxItemsToUploadRows([
      {
        id: "ds1",
        name: ".DS_Store",
        path: "uploads/.DS_Store",
        size: 6148,
        updatedAt: 30,
      },
      {
        id: "ds2",
        name: ".DS_Store",
        path: ".DS_Store",
        size: 6148,
        updatedAt: 29,
      },
      {
        id: "thumbs",
        name: "Thumbs.db",
        path: "uploads/Thumbs.db",
        size: 1,
        updatedAt: 28,
      },
      {
        id: "keep",
        name: "应收台账模板.xlsx",
        path: "uploads/应收台账模板.xlsx",
        size: 43_000,
        updatedAt: 27,
      },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["应收台账模板.xlsx"]);
    expect(rows.some((r) => r.name === ".DS_Store")).toBe(false);
  });

  test("Files page wires rail NavTabs without bg-white active override", () => {
    const page = read(
      "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
    );
    const uploads = read(
      "apps/app/src/react-app/domains/workspace/workspace-files-uploads-panel.tsx",
    );

    expect(page).toContain("FILES_SOURCE_RAIL_TABS");
    expect(page).toContain("DEFAULT_FILES_SOURCE_TAB");
    expect(page).toContain("isFilesSourceRailTabEnabled");
    expect(page).toContain("WorkspaceFilesUploadsPanel");
    expect(page).toContain("WorkspaceFilesBrowserPanel");
    expect(page).toContain('sourceTab={activeTab === "expert" ? "expert" : "task"}');
    expect(page).toContain('density="bare"');
    expect(page).toContain('size="tab"');
    expect(page).toContain('shape="tab"');
    expect(page).toContain("disabled={!enabled}");
    expect(page).toContain("source_project_coming_soon");
    expect(page).not.toMatch(/className=\{?["'`][^"'`]*bg-white/);
    expect(page).not.toContain('activeTab === "cloud"');
    expect(page).not.toContain("CloudDriveEmptyState");

    expect(uploads).toContain("writeWorkspaceBinaryFile");
    expect(uploads).toContain("listInbox");
    expect(uploads).toContain("buildUserUploadRelativePath");
    expect(uploads).toContain("mapUploadsCatalogToRows");
    expect(uploads).toContain("planInboxToUploadsMigration");
    // My files: preview drawer + open/reveal/copy parity with Task files.
    expect(uploads).toContain("FilePreviewDrawer");
    expect(uploads).toContain("workspaceRoot");
    expect(uploads).toContain("workspaceRelativeForUploadRow");
    expect(uploads).toContain("openArtifactForEditing");
    expect(uploads).toContain("revealDesktopItemInDir");
    expect(uploads).toContain("handleCopyPath");
    expect(uploads).toContain("UploadRowActionsMenu");
    expect(page).toContain("workspaceRoot={props.workspaceRoot}");

    const browser = read(
      "apps/app/src/react-app/domains/workspace/workspace-files-browser-panel.tsx",
    );
    expect(browser).toContain("listCodeWorkspaceFiles");
    expect(browser).toContain("filterWorkspaceTreeBySourceTab");
    expect(browser).toContain("data-files-browser-pathbar");
    expect(browser).toContain("buildTreeOutlineRows");
    expect(browser).toContain("FilePreviewDrawer");
    expect(browser).toContain("workspace-files-preview-drawer");
  });

  test("inbox path helpers map list paths to workspace + absolute locations", () => {
    expect(WORKSPACE_INBOX_DIR).toBe(".opencode/onmyagent/inbox");
    expect(workspaceRelativeInboxPath("uploads/a.key")).toBe(
      ".opencode/onmyagent/inbox/uploads/a.key",
    );
    expect(
      workspaceRelativeInboxPath(".opencode/onmyagent/inbox/x.pdf"),
    ).toBe(".opencode/onmyagent/inbox/x.pdf");
    expect(absoluteInboxFilePath("/Users/me/ws", "note.md")).toBe(
      "/Users/me/ws/.opencode/onmyagent/inbox/note.md",
    );
  });

  test("i18n locales define short rail labels and upload copy semantics", () => {
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const source = read(`apps/app/src/i18n/locales/${locale}/files.ts`);
      expect(source).toContain('"files.source_uploads"');
      expect(source).toContain('"files.source_task"');
      expect(source).toContain('"files.source_expert"');
      expect(source).toContain('"files.source_project"');
      expect(source).toContain('"files.source_project_coming_soon"');
      expect(source).toContain('"files.source_uploads_title"');
      expect(source).toContain('"files.source_task_title"');
      expect(source).toContain('"files.source_expert_title"');
      expect(source).toContain('"files.source_uploads_desc"');
      expect(source).toContain('"files.import_to_workspace"');
      expect(source).toContain('"files.upload_copy_success"');
      expect(source).toContain('"files.upload_too_large"');
      expect(source).toContain('"files.session_folder_title"');
      expect(source).toContain('"files.task_empty_hint"');
      expect(source).toContain('"files.ask_agent"');
      expect(source).toContain('"files.preview_too_large"');
      expect(source).toContain('"files.expert_empty_hint"');
      expect(source).toContain('"files.title"');
    }
    const zh = read("apps/app/src/i18n/locales/zh/files.ts");
    expect(zh).toContain('"files.source_uploads": "我的"');
    expect(zh).toContain('"files.source_task": "任务"');
    expect(zh).toContain('"files.source_expert": "专家"');
    expect(zh).toContain('"files.source_project": "项目"');
    const zhNav = read("apps/app/src/i18n/locales/zh/nav.ts");
    expect(zhNav).toContain('"nav.files": "文件"');
  });
});
