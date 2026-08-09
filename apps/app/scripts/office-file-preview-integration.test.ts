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

test("workspace Files browser keeps local Office/media preview under Task files", () => {
  expect(sessionPanel).toContain('import { OfficeFilePreview }');
  expect(sessionPanel).toContain("usesLocalFileRenderer");
  expect(sessionPanel).toContain('<OfficeFilePreview');
  expect(filesPage).toContain("WorkspaceFilesUploadsPanel");
  expect(filesPage).toContain("WorkspaceFilesBrowserPanel");
  expect(filesPage).toContain("FILES_SOURCE_RAIL_TABS");
  expect(filesPage).not.toContain("CloudDriveEmptyState");
  const browser = readFileSync(
    resolve(appRoot, "src/react-app/domains/workspace/workspace-files-browser-panel.tsx"),
    "utf8",
  );
  expect(browser).toContain("usesLocalFileRenderer");
  expect(browser).toContain("FilePreviewDrawer");
  expect(browser).toContain("workspace-files-preview-drawer");
  const drawer = readFileSync(
    resolve(
      appRoot,
      "src/react-app/domains/workspace/workspace-files-preview-drawer.tsx",
    ),
    "utf8",
  );
  expect(drawer).toContain('from "../../capabilities/artifacts/office-file-preview"');
  expect(drawer).toContain("<OfficeFilePreview");
  expect(drawer).toContain("filePath={state.filePath}");
  // Unsupported types: centered type icon + click opens default app.
  expect(drawer).toContain("ExternalOpenPlaceholder");
  expect(drawer).toContain("open_with_default_app_action");
  expect(drawer).toContain("onOpen={onOpenExternally}");
  const uploads = [
    readFileSync(
      resolve(
        appRoot,
        "src/react-app/domains/workspace/workspace-files-uploads-panel.tsx",
      ),
      "utf8",
    ),
    readFileSync(
      resolve(
        appRoot,
        "src/react-app/domains/workspace/use-workspace-files-uploads-panel.ts",
      ),
      "utf8",
    ),
    readFileSync(
      resolve(
        appRoot,
        "src/react-app/domains/workspace/workspace-files-uploads-catalog.ts",
      ),
      "utf8",
    ),
  ].join("\n");
  expect(uploads).toContain("FilePreviewDrawer");
  expect(uploads).toContain("absoluteInboxFilePath");
});

test("detaches the native preview before a full renderer reload", () => {
  expect(desktopWindow).toContain('webContents.on("did-start-navigation"');
  expect(desktopWindow).toContain("if (isMainFrame) artifactPreviewController.hide()");
});

test("session artifact panel uses OfficeFilePreview for local binary sheets", () => {
  const artifactPanel = readFileSync(
    resolve(
      appRoot,
      "src/react-app/domains/session/artifacts/artifact-panel.tsx",
    ),
    "utf8",
  );
  expect(artifactPanel).toContain('from "../../../capabilities/artifacts/office-file-preview"');
  expect(artifactPanel).toContain("shouldPreviewOfficeBinaryViaOverlay");
  expect(artifactPanel).toContain("<OfficeFilePreview");
  expect(artifactPanel).toContain("filePath={externalPath}");
  // Binary local path no longer exclusively dead-ends on UnsupportedBinaryNotice.
  expect(artifactPanel).toContain("useLocalOfficePreview");
  // Shared L1 action bar (open / reveal / copy / ask agent).
  expect(artifactPanel).toContain("FilePreviewActionBar");
  // Same Electron gate as Files/side-panel — no pretend-preview in web runtime.
  expect(artifactPanel).toContain("isElectronRuntime");
  expect(artifactPanel).toContain("officePreviewAvailable: isElectronRuntime()");
  // CSV/TSV still go through built-in sheet editor with onSave (write path).
  expect(artifactPanel).toContain("<SheetEditor");
  expect(artifactPanel).toContain("onSave={saveSpreadsheetContent}");
  // Office viewer path does not call save for binary workbooks.
  expect(artifactPanel).not.toMatch(
    /OfficeFilePreview[\s\S]{0,200}onSave/,
  );
});
