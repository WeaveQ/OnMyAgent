import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import en from "../src/i18n/locales/en/files";
import zh from "../src/i18n/locales/zh/files";
import zhTW from "../src/i18n/locales/zh-TW/files";
import {
  createWorkspaceFilesPanelLayoutController,
  createWorkspaceFilesPanelLayoutControllerForPanel,
  reduceWorkspaceFilesPanelLayout,
  resolveWorkspaceFilesPanelMode,
  type WorkspaceFilesPanelLayoutState,
} from "../src/react-app/domains/session/surface/workspace-files-panel-layout";

const selectedLayout: WorkspaceFilesPanelLayoutState = {
  selectedPath: "reports/forecast.xlsx",
  treeCollapsed: false,
  treeWidthPx: 312,
};

const panelSource = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/session/surface/workspace-files-panel.tsx",
  ),
  "utf8",
);

function createLayoutHarness(input?: {
  layout?: WorkspaceFilesPanelLayoutState;
  treeWidthRefPx?: number;
}) {
  let layout = input?.layout ?? selectedLayout;
  let treeWidthRefPx = input?.treeWidthRefPx ?? layout.treeWidthPx;
  let memory = {
    widthPx: treeWidthRefPx,
    collapsed: layout.treeCollapsed,
  };
  const controller = createWorkspaceFilesPanelLayoutController({
    readTreeWidthPx: () => treeWidthRefPx,
    readContainerWidthPx: () => 1_000,
    clampTreeWidthPx: (widthPx) =>
      Math.min(480, Math.max(160, Math.round(widthPx))),
    commitLayout: (action) => {
      layout = reduceWorkspaceFilesPanelLayout(layout, action);
      if ("treeWidthPx" in action) treeWidthRefPx = action.treeWidthPx;
    },
    persistLayout: (next) => {
      memory = next;
    },
  });

  return {
    controller,
    getLayout: () => layout,
    getMemory: () => memory,
    getTreeWidthRefPx: () => treeWidthRefPx,
  };
}

describe("WorkspaceFilesPanel layout state", () => {
  test("production wiring reads the width ref and reduces current state while syncing the ref", () => {
    let layout = {
      ...selectedLayout,
      treeCollapsed: true,
      treeWidthPx: 176,
    };
    const treeWidthRef = { current: 312 };
    const filesTreeLayoutMemory = {
      current: { widthPx: 200, collapsed: true },
    };
    const controller = createWorkspaceFilesPanelLayoutControllerForPanel({
      treeWidthRef,
      filesTreeLayoutMemory,
      setLayout: (update) => {
        layout = update(layout);
      },
      readContainerWidthPx: () => 1_000,
      clampTreeWidthPx: (widthPx) => Math.round(widthPx),
    });

    controller.expand();
    expect(layout).toEqual(selectedLayout);
    expect(treeWidthRef.current).toBe(312);

    controller.resizeFromPointer({
      startWidthPx: 312,
      startClientX: 20,
      clientX: 64,
      containerWidthPx: 1_000,
    });
    expect(layout).toEqual({
      selectedPath: "reports/forecast.xlsx",
      treeCollapsed: false,
      treeWidthPx: 356,
    });
    expect(treeWidthRef.current).toBe(356);
  });

  test("production wiring persists the exact collapsed state and settled width", () => {
    let layout = selectedLayout;
    const treeWidthRef = { current: 312 };
    const filesTreeLayoutMemory = {
      current: { widthPx: 200, collapsed: false },
    };
    const controller = createWorkspaceFilesPanelLayoutControllerForPanel({
      treeWidthRef,
      filesTreeLayoutMemory,
      setLayout: (update) => {
        layout = update(layout);
      },
      readContainerWidthPx: () => 1_000,
      clampTreeWidthPx: (widthPx) => Math.round(widthPx),
    });

    controller.collapse();
    expect(filesTreeLayoutMemory.current).toEqual({
      widthPx: 312,
      collapsed: true,
    });

    treeWidthRef.current = 368;
    controller.finishResize();
    expect(layout.treeWidthPx).toBe(368);
    expect(filesTreeLayoutMemory.current).toEqual({
      widthPx: 368,
      collapsed: false,
    });
  });

  test("production wiring sequences pointer settle and rapid keys before deferred state flush", () => {
    let layout = selectedLayout;
    const queuedLayoutUpdates: Array<
      (
        current: WorkspaceFilesPanelLayoutState,
      ) => WorkspaceFilesPanelLayoutState
    > = [];
    const treeWidthRef = { current: 312 };
    const filesTreeLayoutMemory = {
      current: { widthPx: 312, collapsed: false },
    };
    const controller = createWorkspaceFilesPanelLayoutControllerForPanel({
      treeWidthRef,
      filesTreeLayoutMemory,
      setLayout: (update) => {
        queuedLayoutUpdates.push(update);
      },
      readContainerWidthPx: () => 1_000,
      clampTreeWidthPx: (widthPx) => Math.round(widthPx),
    });

    controller.resizeFromPointer({
      startWidthPx: 312,
      startClientX: 100,
      clientX: 148,
      containerWidthPx: 1_000,
    });
    expect(treeWidthRef.current).toBe(360);

    controller.finishResize();
    expect(filesTreeLayoutMemory.current).toEqual({
      widthPx: 360,
      collapsed: false,
    });

    expect(controller.resizeByKeyboard("ArrowRight")).toBe(true);
    expect(controller.resizeByKeyboard("ArrowRight")).toBe(true);
    expect(treeWidthRef.current).toBe(392);
    expect(filesTreeLayoutMemory.current).toEqual({
      widthPx: 392,
      collapsed: false,
    });
    expect(layout).toEqual(selectedLayout);

    for (const update of queuedLayoutUpdates) {
      layout = update(layout);
    }
    expect(layout).toEqual({
      selectedPath: "reports/forecast.xlsx",
      treeCollapsed: false,
      treeWidthPx: 392,
    });
  });

  test("collapse controller persists preview-only layout without resetting selection", () => {
    const harness = createLayoutHarness();
    harness.controller.collapse();
    const collapsed = harness.getLayout();

    expect(collapsed).toEqual({
      selectedPath: "reports/forecast.xlsx",
      treeCollapsed: true,
      treeWidthPx: 312,
    });
    expect(harness.getMemory()).toEqual({ widthPx: 312, collapsed: true });
    expect(resolveWorkspaceFilesPanelMode(collapsed)).toBe("preview");
  });

  test("expand controller restores treeWidthRef and persists the expanded layout", () => {
    const harness = createLayoutHarness({
      layout: { ...selectedLayout, treeCollapsed: true, treeWidthPx: 176 },
      treeWidthRefPx: 312,
    });
    harness.controller.expand();
    const expanded = harness.getLayout();

    expect(expanded).toEqual(selectedLayout);
    expect(harness.getMemory()).toEqual({ widthPx: 312, collapsed: false });
    expect(resolveWorkspaceFilesPanelMode(expanded)).toBe("split");
  });

  test("pointer and keyboard resize apply deltas and persist only settled widths", () => {
    const harness = createLayoutHarness();
    harness.controller.resizeFromPointer({
      startWidthPx: 312,
      startClientX: 100,
      clientX: 148,
      containerWidthPx: 1_000,
    });
    expect(harness.getLayout()).toEqual({
      selectedPath: "reports/forecast.xlsx",
      treeCollapsed: false,
      treeWidthPx: 360,
    });
    expect(harness.getTreeWidthRefPx()).toBe(360);
    expect(harness.getMemory()).toEqual({ widthPx: 312, collapsed: false });

    harness.controller.finishResize();
    expect(harness.getMemory()).toEqual({ widthPx: 360, collapsed: false });
    expect(harness.controller.resizeByKeyboard("ArrowLeft")).toBe(true);
    expect(harness.getTreeWidthRefPx()).toBe(344);
    expect(harness.getMemory()).toEqual({ widthPx: 344, collapsed: false });
    expect(harness.controller.resizeByKeyboard("ArrowRight")).toBe(true);
    expect(harness.getTreeWidthRefPx()).toBe(360);
    expect(harness.controller.resizeByKeyboard("Enter")).toBe(false);
    expect(harness.getTreeWidthRefPx()).toBe(360);
  });

  test("selection and reset transitions preserve the tree layout", () => {
    const resized = { ...selectedLayout, treeWidthPx: 368 };
    const selected = reduceWorkspaceFilesPanelLayout(resized, {
      type: "select",
      selectedPath: "reports/revised.xlsx",
    });
    expect(selected).toEqual({
      selectedPath: "reports/revised.xlsx",
      treeCollapsed: false,
      treeWidthPx: 368,
    });

    const reset = reduceWorkspaceFilesPanelLayout(selected, {
      type: "reset-selection",
    });
    expect(reset.selectedPath).toBeNull();
    expect(reset.treeWidthPx).toBe(368);
    expect(resolveWorkspaceFilesPanelMode(reset)).toBe("tree");
  });

  test("component callbacks delegate to the tested controller without resetting selection", () => {
    const controllerWiring = panelSource.match(
      /createWorkspaceFilesPanelLayoutControllerForPanel\(\{[\s\S]*?\}\),\n    \[\],/,
    )?.[0];
    const collapseCallback = panelSource.match(
      /const collapseTree = useCallback\(\(\) => \{[\s\S]*?\}, \[layoutController\]\);/,
    )?.[0];
    const expandCallback = panelSource.match(
      /const expandTree = useCallback\(\(\) => \{[\s\S]*?\}, \[layoutController\]\);/,
    )?.[0];

    expect(controllerWiring).toContain("treeWidthRef,");
    expect(controllerWiring).toContain("filesTreeLayoutMemory,");
    expect(controllerWiring).toContain("setLayout,");
    expect(collapseCallback).toContain("layoutController.collapse();");
    expect(collapseCallback).not.toContain("resetSelection");
    expect(expandCallback).toContain("layoutController.expand();");
  });

  test("separator delegates double-click, pointer deltas, settle, and keyboard keys", () => {
    expect(panelSource).toContain(
      "layoutController.resizeFromPointer({",
    );
    expect(panelSource).toContain("startWidthPx: startWidth");
    expect(panelSource).toContain("startClientX: startX");
    expect(panelSource).toContain("clientX: moveEvent.clientX");
    expect(panelSource).toContain("layoutController.finishResize();");
    expect(panelSource).toContain(
      "layoutController.resizeByKeyboard(event.key)",
    );
    const separator = panelSource.match(
      /<div\s+role="separator"[\s\S]*?<\/div>/,
    )?.[0];

    expect(separator).toContain("onPointerDown={startTreeResize}");
    expect(separator).toContain("onKeyDown={(event) =>");
    expect(separator).toContain("onDoubleClick={collapseTree}");
  });

  test("keeps both toggle controls and the preview-only render branch", () => {
    const previewHeader = panelSource.match(
      /const previewHeader = \([\s\S]*?\n  \);/,
    )?.[0];
    const treeColumn = panelSource.match(
      /const treeColumn = \([\s\S]*?\n  \);/,
    )?.[0];
    expect(previewHeader).toContain("{treeCollapsed ? (");
    expect(previewHeader).toContain("<TreeToggleButton");
    expect(previewHeader).toContain("collapsed");
    expect(previewHeader).toContain("onExpand={expandTree}");
    expect(treeColumn).toContain("{detailOpen ? (");
    expect(treeColumn).toContain("<TreeToggleButton");
    expect(treeColumn).toContain("collapsed={false}");
    expect(treeColumn).toContain("onCollapse={collapseTree}");
    const previewOnlyBranch = panelSource.match(
      /if \(panelMode === "preview"\) \{[\s\S]*?\n  \}/,
    )?.[0];
    expect(previewOnlyBranch).toContain("{previewHeader}");
    expect(previewOnlyBranch).toContain("{previewBody}");
    expect(previewOnlyBranch).not.toContain("{treeColumn}");
  });

  test("describes the visible surface as a file list in every locale", () => {
    expect([
      en["files.collapse_tree"],
      en["files.expand_tree"],
      en["files.resize_tree"],
    ]).toEqual([
      "Collapse file list",
      "Expand file list",
      "Resize file list",
    ]);
    expect([
      zh["files.collapse_tree"],
      zh["files.expand_tree"],
      zh["files.resize_tree"],
    ]).toEqual([
      "收起文件列表",
      "展开文件列表",
      "调整文件列表宽度",
    ]);
    expect([
      zhTW["files.collapse_tree"],
      zhTW["files.expand_tree"],
      zhTW["files.resize_tree"],
    ]).toEqual([
      "收起檔案列表",
      "展開檔案列表",
      "調整檔案列表寬度",
    ]);
  });
});
