import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const previewPath = resolve(
  appRoot,
  "src/react-app/capabilities/artifacts/office-file-preview.tsx",
);
const viewerPath = resolve(appRoot, "src/office-viewer.tsx");
const viewerStylesPath = resolve(appRoot, "src/office-viewer.css");

test("uses a dedicated native preview viewport in the shared capability", () => {
  expect(existsSync(previewPath)).toBe(true);
  if (!existsSync(previewPath)) return;

  const source = readFileSync(previewPath, "utf8");
  expect(source).toContain("artifactPreview");
  expect(source).toContain("filePath: props.filePath");
  expect(source).toContain("document.documentElement.lang");
  expect(source).toContain("locale");
  expect(source).toContain("getBoundingClientRect");
  expect(source).not.toMatch(/https?:\/\//);
});

test("loads only the three modular Office renderers in a read-only viewer", () => {
  expect(existsSync(viewerPath)).toBe(true);
  if (!existsSync(viewerPath)) return;

  const source = readFileSync(viewerPath, "utf8");
  expect(source).toContain('from "@file-viewer/renderer-word"');
  expect(source).toContain('from "@file-viewer/renderer-spreadsheet"');
  expect(source).toContain('from "@file-viewer/renderer-presentation"');
  expect(source).not.toContain("preset-office");
  expect(source).not.toContain("renderer-pdf");
  expect(source).toContain("download: false");
  expect(source).toContain("print: false");
  expect(source).toContain("exportHtml: false");
});

test("lets the viewer detect the renderer from the named file extension", () => {
  expect(existsSync(viewerPath)).toBe(true);
  if (!existsSync(viewerPath)) return;

  const source = readFileSync(viewerPath, "utf8");
  expect(source).toContain("filename={payload.name}");
});

test("removes presentation charts that the upstream renderer falls back to document.body", () => {
  expect(existsSync(viewerPath)).toBe(true);
  if (!existsSync(viewerPath)) return;

  const source = readFileSync(viewerPath, "utf8");
  expect(source).toContain("MutationObserver");
  expect(source).toContain('node.matches(".bb")');
  expect(source).toContain("node.parentElement === document.body");
});

test("uses slide thumbnails for presentations and a heading tree for documents", () => {
  expect(existsSync(viewerPath)).toBe(true);
  if (!existsSync(viewerPath)) return;

  const source = readFileSync(viewerPath, "utf8");
  expect(source).toContain("const documentHeadings");
  expect(source).toContain("h1, h2, h3, h4, h5, h6");
  expect(source).toContain("docx_heading");
  expect(source).toContain("document-outline-tree");
  expect(source).toContain('aria-label={isDocument ? "Document outline" : "Slides"}');
  expect(source).toContain("presentation-outline-thumbnail");
  expect(source).toContain("slot.scrollIntoView");
  expect(source).toContain("heading.scrollIntoView");
  expect(source).toContain("presentation-outline-tab");
  expect(source).toContain("presentation-outline-close");
  expect(source).toContain("setOutlineOpen(false)");
  expect(source).not.toContain("presentation-outline-toggle");
});

test("keeps the document or slide surface independently scrollable beside its outline", () => {
  expect(existsSync(viewerStylesPath)).toBe(true);
  if (!existsSync(viewerStylesPath)) return;

  const source = readFileSync(viewerStylesPath, "utf8");
  expect(source).toMatch(/\.presentation-viewport\s*\{[^}]*overflow:\s*auto/s);
  expect(source).toContain(".document-outline-children");
  expect(source).toContain(".presentation-outline-thumbnail");
  expect(source).toMatch(/\.presentation-outline-tab\s*\{[^}]*top:\s*50%[^}]*left:\s*0/s);
  expect(source).toContain(".presentation-outline-header");
  expect(source).toContain(".presentation-outline-close");
});

test("extends sparse spreadsheets with native-looking grid chrome", () => {
  expect(existsSync(viewerPath)).toBe(true);
  expect(existsSync(viewerStylesPath)).toBe(true);
  if (!existsSync(viewerPath) || !existsSync(viewerStylesPath)) return;

  const viewer = readFileSync(viewerPath, "utf8");
  const styles = readFileSync(viewerStylesPath, "utf8");
  expect(viewer).toContain("SpreadsheetGridExtension");
  expect(viewer).toContain("e-virt-table-overlayer-header");
  expect(viewer).toContain("e-virt-table-overlayer-body");
  expect(viewer).toContain("spreadsheetColumnName");
  expect(styles).toContain(".spreadsheet-grid-extension-columns");
  expect(styles).toContain(".spreadsheet-grid-extension-rows");
  expect(styles).toMatch(/\.sheet-tab\.active::after\s*\{/);
  expect(styles).toMatch(/\.summary\s*\{\s*display:\s*none/);
});
