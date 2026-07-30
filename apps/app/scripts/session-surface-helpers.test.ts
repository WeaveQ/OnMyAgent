import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  COMPOSER_NOTICE_TIMEOUT_MS,
  DELAYED_SESSION_LOADING_MS,
  FOLDER_REQUIRED_BUBBLE_TIMEOUT_MS,
  NO_VISIBLE_ASSISTANT_OUTPUT_DELAY_MS,
  buildComposerDraft,
  deriveActiveGoalWaitingReason,
  deriveChatStreaming,
  derivePendingSessionLoad,
  hasIncompleteTodos,
  isRemoteSessionBusy,
  openTargetsFingerprint,
  pickVisibleSessionError,
  resolveCollaborationModeVariant,
  resolveWorkspaceRelativeDownloadPath,
  shouldShowCodeSceneToolbar,
  snapshotQueryErrorMessage,
  workspaceAttachmentContentType,
} from "../src/react-app/domains/session/surface/session-surface-helpers";

const appRoot = join(import.meta.dir, "..");
const surfaceHost = join(
  appRoot,
  "src/react-app/domains/session/surface/session-surface.tsx",
);

describe("session-surface helpers (shipped)", () => {
  test("host imports pure helpers from session-surface-helpers", () => {
    const src = readFileSync(surfaceHost, "utf8");
    expect(src).toContain('from "./session-surface-helpers"');
    expect(src).toContain("buildComposerDraft");
    expect(src).toContain("derivePendingSessionLoad");
    expect(src).toContain("deriveChatStreaming");
    expect(src).toContain("workspaceAttachmentContentType");
    expect(src).toContain("COMPOSER_NOTICE_TIMEOUT_MS");
    expect(src).toContain("FOLDER_REQUIRED_BUBBLE_TIMEOUT_MS");
    expect(src).toContain("DELAYED_SESSION_LOADING_MS");
    expect(src).not.toMatch(/function workspaceAttachmentContentType\(/);
    expect(src).not.toContain("window.setTimeout(() => setNotice(null), 2400)");
  });

  test("notice / folder / delayed-load timeouts are stable", () => {
    expect(COMPOSER_NOTICE_TIMEOUT_MS).toBe(2400);
    expect(FOLDER_REQUIRED_BUBBLE_TIMEOUT_MS).toBe(2600);
    expect(DELAYED_SESSION_LOADING_MS).toBe(2000);
    expect(NO_VISIBLE_ASSISTANT_OUTPUT_DELAY_MS).toBe(1000);
  });

  test("workspaceAttachmentContentType maps common extensions", () => {
    expect(workspaceAttachmentContentType("notes.md")).toBe("text/markdown");
    expect(workspaceAttachmentContentType("/tmp/photo.PNG")).toBe("image/png");
    expect(workspaceAttachmentContentType("data.bin")).toBe(
      "application/octet-stream",
    );
  });

  test("resolveWorkspaceRelativeDownloadPath strips workspace root", () => {
    expect(
      resolveWorkspaceRelativeDownloadPath("/ws/proj", "/ws/proj/src/a.ts"),
    ).toBe("src/a.ts");
    expect(resolveWorkspaceRelativeDownloadPath("/ws/proj", "./src/a.ts")).toBe(
      "src/a.ts",
    );
    expect(
      resolveWorkspaceRelativeDownloadPath("/ws/proj/", "/ws/proj"),
    ).toBe("");
    expect(resolveWorkspaceRelativeDownloadPath("", "file.txt")).toBe(
      "file.txt",
    );
  });

  test("openTargetsFingerprint is order-stable", () => {
    expect(
      openTargetsFingerprint([
        { kind: "file", value: "a.ts", confidence: 1 },
        { kind: "url", value: "https://x", confidence: 0.5 },
      ]),
    ).toBe("file:a.ts:1|url:https://x:0.5");
  });

  test("pending session load and remote busy / streaming flags", () => {
    expect(
      derivePendingSessionLoad({
        draftOnly: false,
        hasSnapshot: false,
        isLoading: true,
        messageCount: 0,
      }),
    ).toBe(true);
    expect(
      derivePendingSessionLoad({
        draftOnly: true,
        hasSnapshot: false,
        isLoading: true,
        messageCount: 0,
      }),
    ).toBe(false);
    expect(
      derivePendingSessionLoad({
        draftOnly: false,
        hasSnapshot: true,
        isLoading: true,
        messageCount: 0,
      }),
    ).toBe(false);

    expect(isRemoteSessionBusy("busy")).toBe(true);
    expect(isRemoteSessionBusy("retry")).toBe(true);
    expect(isRemoteSessionBusy("idle")).toBe(false);

    expect(
      deriveChatStreaming({
        sending: false,
        remoteBusy: true,
        draftOnly: false,
        stopRequested: true,
      }),
    ).toBe(false);
    expect(
      deriveChatStreaming({
        sending: true,
        remoteBusy: false,
        draftOnly: false,
        stopRequested: false,
      }),
    ).toBe(true);
    expect(
      deriveChatStreaming({
        sending: false,
        remoteBusy: true,
        draftOnly: false,
        stopRequested: false,
      }),
    ).toBe(true);
  });

  test("pickVisibleSessionError skips dismissed message", () => {
    expect(
      pickVisibleSessionError(
        [{ message: "a" }, { message: "b" }],
        "a",
      )?.message,
    ).toBe("b");
    expect(pickVisibleSessionError([null, { message: "a" }], "a")).toBeNull();
  });

  test("goal waiting reason and incomplete todos", () => {
    expect(
      deriveActiveGoalWaitingReason({
        activePermissionNeedsApproval: true,
        hasActiveQuestion: true,
        effectiveActivityStatus: "idle",
      }),
    ).toBe("permission");
    expect(
      deriveActiveGoalWaitingReason({
        activePermissionNeedsApproval: false,
        hasActiveQuestion: true,
        effectiveActivityStatus: "idle",
      }),
    ).toBe("question");
    expect(
      deriveActiveGoalWaitingReason({
        activePermissionNeedsApproval: false,
        hasActiveQuestion: false,
        effectiveActivityStatus: "compacting",
      }),
    ).toBe("compacting");
    expect(
      deriveActiveGoalWaitingReason({
        activePermissionNeedsApproval: false,
        hasActiveQuestion: false,
        effectiveActivityStatus: "idle",
      }),
    ).toBeNull();

    expect(
      hasIncompleteTodos([
        { id: "1", content: "done", status: "completed" },
        { id: "2", content: "  ", status: "pending" },
      ]),
    ).toBe(false);
    expect(
      hasIncompleteTodos([
        { id: "1", content: "open", status: "pending" },
      ]),
    ).toBe(true);
  });

  test("code scene toolbar and collaboration mode variant", () => {
    expect(
      shouldShowCodeSceneToolbar({
        assistantCodeFeaturesActive: true,
        assistantFeatureCategoryId: "code",
        draftOnly: false,
      }),
    ).toBe(true);
    expect(
      shouldShowCodeSceneToolbar({
        assistantCodeFeaturesActive: true,
        assistantFeatureCategoryId: "code",
        draftOnly: true,
      }),
    ).toBe(false);
    expect(
      resolveCollaborationModeVariant({
        assistantOfficeFeaturesActive: true,
        assistantFeatureCategoryId: "office",
      }),
    ).toBe("office");
    expect(
      resolveCollaborationModeVariant({
        assistantOfficeFeaturesActive: false,
        assistantFeatureCategoryId: "office",
      }),
    ).toBe("legacy");
  });

  test("snapshotQueryErrorMessage", () => {
    expect(snapshotQueryErrorMessage(new Error("boom"))).toBe("boom");
    expect(snapshotQueryErrorMessage("x")).toBe("Failed to load session.");
  });

  test("buildComposerDraft expands paste placeholders and mentions", () => {
    const draft = buildComposerDraft({
      text: "see [pasted text clip] and @agent-one please",
      attachments: [],
      pasteParts: [
        { id: "p1", label: "clip", text: "PASTED BODY", lines: 3 },
      ],
      mentions: { "agent-one": "agent" },
      accessMode: "default",
      collaborationMode: { planning: false, pursueGoal: false },
    });
    expect(draft.mode).toBe("prompt");
    expect(draft.resolvedText).toContain("PASTED BODY");
    expect(draft.resolvedText).toContain("@agent-one");
    expect(draft.parts.some((part) => part.type === "paste")).toBe(true);
    expect(draft.parts.some((part) => part.type === "agent")).toBe(true);
    expect(draft.accessMode).toBe("default");
  });

  test("buildComposerDraft parses leading slash commands", () => {
    const draft = buildComposerDraft({
      text: "/help me later",
      attachments: [],
      pasteParts: [],
      mentions: {},
      accessMode: "full",
      collaborationMode: { planning: true, pursueGoal: false },
    });
    expect(draft.command).toEqual({ name: "help", arguments: "me later" });
  });
});
