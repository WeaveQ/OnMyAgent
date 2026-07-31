import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const sessionPanel = readFileSync(
  resolve(
    appRoot,
    "src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
  ),
  "utf8",
);
const filesPage = readFileSync(
  resolve(appRoot, "src/react-app/domains/workspace/workspace-files-page.tsx"),
  "utf8",
);
const desktopWindow = readFileSync(
  resolve(appRoot, "../desktop/electron/desktop-window.mjs"),
  "utf8",
);

test("adds local Office and media preview inside the existing session Files tool", () => {
  expect(sessionPanel).toContain('import { OfficeFilePreview }');
  expect(sessionPanel).toContain("absoluteWorkspaceFilePath");
  expect(sessionPanel).toContain("filePath={preview.filePath}");
  expect(sessionPanel).toContain('<OfficeFilePreview');
  expect(sessionPanel).toContain('<ResizablePanelGroup orientation="horizontal"');
  expect(sessionPanel).toContain('<ResizableHandle aria-label={t("files.resize_tree")}');
  expect(sessionPanel).toContain('defaultSize="220px"');
  expect(sessionPanel).toContain("usesLocalFileRenderer");
  expect(sessionPanel).toContain('preview === "audio"');
  expect(sessionPanel).toContain('preview === "video"');
  expect(sessionPanel).not.toContain('grid-cols-[220px_minmax(0,1fr)]');

  expect(sessionPanel).toContain('type ToolKind = "review" | "terminal" | "browser" | "files"');
  expect(sessionPanel).toContain("<CodeWorkspaceReviewPanel");
  expect(sessionPanel).toContain("<TerminalPanel");
  expect(sessionPanel).toContain("<BrowserPanel");
});

test("session Files tool keeps local Office/media preview (workspace Files P0 defers drawer)", () => {
  // Workspace Files P0 is three-source tabs (uploads list + pending empty); full
  // catalog preview drawer returns with P1 provenance browser. Office/media
  // preview remains required on the in-session files tool panel.
  expect(sessionPanel).toContain('import { OfficeFilePreview }');
  expect(sessionPanel).toContain("usesLocalFileRenderer");
  expect(sessionPanel).toContain('<OfficeFilePreview');
  expect(filesPage).toContain("WorkspaceFilesUploadsPanel");
  expect(filesPage).toContain("FILES_SOURCE_TABS");
  expect(filesPage).not.toContain("CloudDriveEmptyState");
});

test("detaches the native preview before a full renderer reload", () => {
  expect(desktopWindow).toContain('webContents.on("did-start-navigation"');
  expect(desktopWindow).toContain("if (isMainFrame) artifactPreviewController.hide()");
});
