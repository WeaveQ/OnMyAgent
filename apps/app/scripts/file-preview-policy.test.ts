/**
 * Unit tests for shipped file-preview-policy (all file types).
 */
import { describe, expect, test } from "bun:test";

import {
  FILE_PREVIEW_SELECTION_DEBOUNCE_MS,
  INLINE_CONTENT_PREVIEW_MAX_BYTES,
  OFFICE_OVERLAY_PREVIEW_MAX_BYTES,
  buildAskAgentFileInstruction,
  isSamePreviewSelection,
  shouldForceExternalPreviewForSize,
} from "../src/react-app/capabilities/artifacts/file-preview-policy";
import { shouldPreviewOfficeBinaryViaOverlay } from "../src/react-app/capabilities/artifacts/sheet-preview-policy";
import { seedComposerFileAgentTask } from "../src/react-app/domains/session/pages/shared-page-utils";

describe("file-preview-policy (shipped)", () => {
  test("forces external preview above size caps by kind", () => {
    expect(
      shouldForceExternalPreviewForSize({
        sizeBytes: INLINE_CONTENT_PREVIEW_MAX_BYTES + 1,
        preview: "text",
      }),
    ).toBe(true);
    expect(
      shouldForceExternalPreviewForSize({
        sizeBytes: INLINE_CONTENT_PREVIEW_MAX_BYTES - 1,
        preview: "markdown",
      }),
    ).toBe(false);
    expect(
      shouldForceExternalPreviewForSize({
        sizeBytes: OFFICE_OVERLAY_PREVIEW_MAX_BYTES + 1,
        preview: "sheet",
      }),
    ).toBe(true);
    expect(
      shouldForceExternalPreviewForSize({
        sizeBytes: INLINE_CONTENT_PREVIEW_MAX_BYTES + 1,
        preview: "document",
      }),
    ).toBe(false);
    expect(FILE_PREVIEW_SELECTION_DEBOUNCE_MS).toBeGreaterThan(0);
  });

  test("office overlay eligibility for sheet/doc/ppt with Electron + abs path", () => {
    expect(
      shouldPreviewOfficeBinaryViaOverlay({
        preview: "document",
        pathOrName: "brief.docx",
        isRemoteWorkspace: false,
        absoluteFilePath: "/Users/me/ws/brief.docx",
        officePreviewAvailable: true,
      }),
    ).toBe(true);
    expect(
      shouldPreviewOfficeBinaryViaOverlay({
        preview: "presentation",
        pathOrName: "deck.pptx",
        isRemoteWorkspace: false,
        absoluteFilePath: "/Users/me/ws/deck.pptx",
        officePreviewAvailable: true,
      }),
    ).toBe(true);
    expect(
      shouldPreviewOfficeBinaryViaOverlay({
        preview: "sheet",
        pathOrName: "t.csv",
        isRemoteWorkspace: false,
        absoluteFilePath: "/Users/me/ws/t.csv",
        officePreviewAvailable: true,
      }),
    ).toBe(false);
    expect(
      shouldPreviewOfficeBinaryViaOverlay({
        preview: "document",
        pathOrName: "brief.docx",
        isRemoteWorkspace: false,
        absoluteFilePath: "/Users/me/ws/brief.docx",
        officePreviewAvailable: false,
      }),
    ).toBe(false);
  });

  test("selection identity helper", () => {
    expect(
      isSamePreviewSelection({ path: "a.xlsx" }, { path: "a.xlsx" }),
    ).toBe(true);
    expect(
      isSamePreviewSelection({ path: "a.xlsx" }, { path: "b.xlsx" }),
    ).toBe(false);
  });

  test("ask-agent instruction is non-empty for common kinds", () => {
    expect(buildAskAgentFileInstruction({ fileName: "a.xlsx", preview: "sheet" })).toContain(
      "a.xlsx",
    );
    expect(buildAskAgentFileInstruction({ fileName: "note.md", preview: "markdown" })).toContain(
      "note.md",
    );
  });
});

describe("seedComposerFileAgentTask (shipped)", () => {
  test("is exported and requires non-empty session + path", () => {
    expect(typeof seedComposerFileAgentTask).toBe("function");
    expect(seedComposerFileAgentTask("", "a.xlsx", "hi")).toBe(false);
    expect(seedComposerFileAgentTask("ses_1", "", "hi")).toBe(false);
  });
});
