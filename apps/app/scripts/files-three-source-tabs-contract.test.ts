import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_FILES_SOURCE_TAB,
  FILES_SOURCE_TABS,
  USER_UPLOADS_RELATIVE_DIR,
  buildUserUploadRelativePath,
  filterUploadRows,
  isFilesSourceListReady,
  mapInboxItemsToUploadRows,
} from "../src/react-app/domains/workspace/workspace-files-model";

const repoRoot = join(import.meta.dir, "../../..");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("files three-source tabs (P0)", () => {
  test("source tab helpers default to task and only uploads is list-ready", () => {
    expect(DEFAULT_FILES_SOURCE_TAB).toBe("task");
    expect([...FILES_SOURCE_TABS]).toEqual(["uploads", "task", "expert"]);
    expect(isFilesSourceListReady("uploads")).toBe(true);
    expect(isFilesSourceListReady("task")).toBe(false);
    expect(isFilesSourceListReady("expert")).toBe(false);
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
    expect(page).toContain("FilesSourcePendingEmpty");
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
