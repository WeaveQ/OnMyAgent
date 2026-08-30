/**
 * Unit tests for shipped file-preview-policy (all file types).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FILE_PREVIEW_SELECTION_DEBOUNCE_MS,
  INLINE_CONTENT_PREVIEW_MAX_BYTES,
  OFFICE_OVERLAY_PREVIEW_MAX_BYTES,
  buildAskAgentFileInstruction,
  isSamePreviewSelection,
  shouldForceExternalPreviewForSize,
} from "../src/react-app/capabilities/artifacts/file-preview-policy";
import { shouldPreviewOfficeBinaryViaOverlay } from "../src/react-app/capabilities/artifacts/sheet-preview-policy";
import {
  createWorkspaceFilesAgentHandlers,
  normalizeWorkspaceFileMentionPath,
  seedComposerFileAgentTask,
} from "../src/react-app/domains/session/pages/shared-page-utils";
import { formatComposerFileMentionLabel } from "../src/react-app/domains/session/surface/composer/mention-encoding";

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

  test("seedComposerFileAgentTask maps spaced uploads paths so mention lookup matches", () => {
    const sessionId = `test-seed-space-${Date.now()}`;
    useComposerStateStore.getState().clearSession(sessionId);
    const abs =
      "/Users/me/ws/uploads/Demo from dsh-genui.mp4";
    expect(
      seedComposerFileAgentTask(sessionId, abs, "请查看该文件"),
    ).toBe(true);
    const store = useComposerStateStore.getState();
    expect(
      getComposerMentions(store, sessionId)["uploads/Demo from dsh-genui.mp4"],
    ).toBe("file");
    const draft = getComposerDraft(store, sessionId);
    expect(draft).toContain("@uploads/Demo%20from%20dsh-genui.mp4");
    expect(draft).not.toContain("/Users/me");
    useComposerStateStore.getState().clearSession(sessionId);
  });
});

describe("ask-agent home routing (shipped)", () => {
  test("normalizeWorkspaceFileMentionPath strips absolute prefixes to uploads/", () => {
    expect(
      normalizeWorkspaceFileMentionPath(
        "/Users/me/ws/uploads/Demo from dsh-genui.mp4",
      ),
    ).toBe("uploads/Demo from dsh-genui.mp4");
    expect(formatComposerFileMentionLabel("uploads/Demo from dsh-genui.mp4")).toBe(
      "uploads/Demo from dsh-genui.mp4",
    );
  });

  test("createWorkspaceFilesAgentHandlers seeds the home draft session and calls goHomeNewTask", () => {
    const workspaceId = `ws-ask-${Date.now()}`;
    const homeId = `draft:${workspaceId}`;
    useComposerStateStore.getState().clearSession(homeId);
    let homeJumps = 0;
    const handlers = createWorkspaceFilesAgentHandlers({
      sessionId: "ses_expert_last",
      workspaceId,
      openRail: () => undefined,
      goHomeNewTask: () => {
        homeJumps += 1;
      },
      showToast: () => undefined,
      buildInstruction: () => "请查看该文件",
      t: (key) => key,
    });
    handlers.onAskAgentAboutFile({
      path: "uploads/Demo from dsh-genui.mp4",
      name: "Demo from dsh-genui.mp4",
      preview: "generic",
    });
    expect(homeJumps).toBe(1);
    expect(getComposerDraft(useComposerStateStore.getState(), homeId)).toContain(
      "@uploads/Demo%20from%20dsh-genui.mp4",
    );
    expect(
      getComposerDraft(useComposerStateStore.getState(), "ses_expert_last") || "",
    ).not.toContain("Demo from dsh-genui");
    useComposerStateStore.getState().clearSession(homeId);
  });

  test("file preview drawer closes before asking the agent", () => {
    const drawer = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/workspace/workspace-files-preview-drawer.tsx",
      ),
      "utf8",
    );
    const expertLayout = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/pages/expert-page-layout.tsx",
      ),
      "utf8",
    );
    expect(drawer).toContain("onClose()");
    expect(drawer).toContain("onAskAgent()");
    expect(expertLayout).toContain('onNavigateToMode("assistant")');
    expect(expertLayout).toContain("goHomeNewTask:");
  });
});
