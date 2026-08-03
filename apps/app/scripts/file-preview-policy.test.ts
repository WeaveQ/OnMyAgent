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
    // Soft office cap is high enough for typical large decks (e.g. 51MB pptx).
    expect(OFFICE_OVERLAY_PREVIEW_MAX_BYTES).toBeGreaterThanOrEqual(100 * 1024 * 1024);
    expect(
      shouldForceExternalPreviewForSize({
        sizeBytes: 51 * 1024 * 1024,
        preview: "presentation",
      }),
    ).toBe(false);
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

  test("ask-agent instruction is non-empty and does not re-embed the filename", () => {
    const sheet = buildAskAgentFileInstruction({
      fileName: "a.xlsx",
      preview: "sheet",
    });
    expect(sheet.length).toBeGreaterThan(8);
    expect(sheet).not.toContain("a.xlsx");
    expect(sheet).not.toMatch(/「[^」]+」/);
    const note = buildAskAgentFileInstruction({
      fileName: "note.md",
      preview: "markdown",
    });
    expect(note).not.toContain("note.md");
  });
});

describe("seedComposerFileAgentTask (shipped)", () => {
  test("is exported and requires non-empty session + path", () => {
    expect(typeof seedComposerFileAgentTask).toBe("function");
    expect(seedComposerFileAgentTask("", "a.xlsx", "hi")).toBe(false);
    expect(seedComposerFileAgentTask("ses_1", "", "hi")).toBe(false);
  });
});

import {
  getComposerDraft,
  getComposerMentions,
  useComposerStateStore,
} from "../src/react-app/domains/session/surface/composer-state-store";
import { appendComposerFileMention } from "../src/react-app/domains/session/pages/shared-page-utils";
import {
  isNativeDisplayFilePart,
  attachmentsForParts,
} from "../src/react-app/domains/session/surface/message-list/parts";

describe("user message file:// chips (shipped)", () => {
  test("file:// office mentions render as native display attachments", () => {
    const part = {
      type: "file" as const,
      url: "file:///Users/me/ws/inbox/a.xlsx",
      filename: "a.xlsx",
      mime: "text/plain",
    };
    expect(isNativeDisplayFilePart(part)).toBe(true);
    const chips = attachmentsForParts([part]);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.filename).toBe("a.xlsx");
    expect(chips[0]?.url).toContain("file://");
  });
});

describe("appendComposerFileMention (shipped)", () => {
  test("writes mentions map before draft so @token can become a chip", () => {
    const sessionId = `test-mention-${Date.now()}`;
    useComposerStateStore.getState().clearSession(sessionId);
    expect(appendComposerFileMention(sessionId, "inbox/a.xlsx")).toBe(true);
    const store = useComposerStateStore.getState();
    expect(getComposerMentions(store, sessionId)["inbox/a.xlsx"]).toBe("file");
    expect(getComposerDraft(store, sessionId)).toContain("@inbox/a.xlsx");
    useComposerStateStore.getState().clearSession(sessionId);
  });

  test("seedComposerFileAgentTask puts @path chip token + instruction without re-embedding name", () => {
    const sessionId = `test-seed-${Date.now()}`;
    useComposerStateStore.getState().clearSession(sessionId);
    expect(
      seedComposerFileAgentTask(sessionId, "inbox/sheet.xlsx", "请查看该表格"),
    ).toBe(true);
    const store = useComposerStateStore.getState();
    const draft = getComposerDraft(store, sessionId);
    expect(draft.startsWith("@inbox/sheet.xlsx")).toBe(true);
    expect(draft).toContain("请查看该表格");
    expect(draft).not.toMatch(/「/);
    expect(getComposerMentions(store, sessionId)["inbox/sheet.xlsx"]).toBe(
      "file",
    );
    useComposerStateStore.getState().clearSession(sessionId);
  });
});
