import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import en from "../src/i18n/locales/en/files";
import zh from "../src/i18n/locales/zh/files";
import zhTW from "../src/i18n/locales/zh-TW/files";

const source = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/session/surface/workspace-files-panel.tsx",
  ),
  "utf8",
);

describe("WorkspaceFilesPanel layout contract", () => {
  test("keeps direct selection, width memory, and synchronous width refs", () => {
    expect(source).toContain("const [selectedPath, setSelectedPath]");
    expect(source).toContain("const [treeCollapsed, setTreeCollapsed]");
    expect(source).toContain("const [treeWidthPx, setTreeWidthPx]");
    expect(source).toContain(
      "filesTreeLayoutMemory = { widthPx: next, collapsed };",
    );
    expect(source).toMatch(/treeWidthRef\.current = next;\s*setTreeWidthPx\(next\);/);
    expect(source).not.toContain("WorkspaceFilesPanelLayoutController");
  });

  test("keeps both toggles, splitter interactions, and preview-only rendering", () => {
    expect(source.match(/<TreeToggleButton/g)).toHaveLength(2);
    const separator = source.match(/<div\s+role="separator"[\s\S]*?<\/div>/)?.[0];
    expect(separator).toContain("onPointerDown={startTreeResize}");
    expect(separator).toContain("onDoubleClick={collapseTree}");
    expect(separator).toContain('event.key !== "ArrowLeft"');
    expect(separator).toContain('event.key !== "ArrowRight"');
    expect(separator).toContain("treeWidthRef.current +");

    const previewOnly = source.slice(
      source.indexOf("// Detail open + tree collapsed"),
      source.indexOf("// Detail open + tree visible"),
    );
    expect(previewOnly).toContain("if (treeCollapsed)");
    expect(previewOnly).toContain("{previewHeader}");
    expect(previewOnly).toContain("{previewBody}");
    expect(previewOnly).not.toContain("{treeColumn}");
  });

  test("describes the visible surface as a file list in every locale", () => {
    expect([
      en["files.collapse_tree"],
      zh["files.collapse_tree"],
      zhTW["files.collapse_tree"],
    ]).toEqual(["Collapse file list", "收起文件列表", "收起檔案列表"]);
    expect([
      en["files.expand_tree"],
      zh["files.expand_tree"],
      zhTW["files.expand_tree"],
    ]).toEqual(["Expand file list", "展开文件列表", "展開檔案列表"]);
    expect([
      en["files.resize_tree"],
      zh["files.resize_tree"],
      zhTW["files.resize_tree"],
    ]).toEqual(["Resize file list", "调整文件列表宽度", "調整檔案列表寬度"]);
  });
});
