import { describe, expect, test } from "bun:test";
import {
  DEFAULT_KEYMAP_ACTIONS,
  formatAcceleratorForDisplay,
  resolveAccelerator,
} from "../src/react-app/kernel/keymap";
import {
  SESSION_CONTENT_MAX_WIDTH_PX,
  applyConversationWidthCssVar,
  sessionContentMaxWidthClass,
  sessionContentMaxWidthPx,
} from "../src/react-app/capabilities/layout/content-column";
import { computeTranscriptMaxContentWidth } from "../src/react-app/domains/session/surface/transcript-presentation";

describe("settings keymap defaults", () => {
  test("includes planned actions without QuickPick", () => {
    const ids = DEFAULT_KEYMAP_ACTIONS.map((a) => a.id);
    expect(ids).toContain("openSettings");
    expect(ids).toContain("appSnapshot");
    expect(ids).not.toContain("quickPick" as never);
    expect(DEFAULT_KEYMAP_ACTIONS.length).toBe(7);
  });

  test("resolveAccelerator prefers overrides", () => {
    expect(resolveAccelerator("openSettings", {}, "macos")).toBe(
      "CommandOrControl+,",
    );
    expect(
      resolveAccelerator(
        "openSettings",
        { openSettings: "CommandOrControl+;" },
        "macos",
      ),
    ).toBe("CommandOrControl+;");
  });

  test("formatAcceleratorForDisplay maps CommandOrControl", () => {
    expect(formatAcceleratorForDisplay("CommandOrControl+,", "macos")).toContain(
      "⌘",
    );
    expect(
      formatAcceleratorForDisplay("CommandOrControl+,", "windows"),
    ).toContain("Ctrl");
    expect(formatAcceleratorForDisplay("double-command", "macos")).toBe("⌘⌘");
  });
});

describe("conversation width", () => {
  test("fixed vs wide max width math", () => {
    expect(sessionContentMaxWidthPx("fixed", 2000)).toBe(
      SESSION_CONTENT_MAX_WIDTH_PX,
    );
    expect(sessionContentMaxWidthPx("wide", 2000)).toBe(2000);
    expect(computeTranscriptMaxContentWidth(2000, "fixed")).toBe(
      SESSION_CONTENT_MAX_WIDTH_PX,
    );
    expect(computeTranscriptMaxContentWidth(2000, "wide")).toBeGreaterThan(
      SESSION_CONTENT_MAX_WIDTH_PX,
    );
  });

  test("class helpers", () => {
    expect(sessionContentMaxWidthClass("fixed")).toContain(
      "--session-content-max-w",
    );
    expect(sessionContentMaxWidthClass("wide")).toBe("max-w-none");
  });

  test("applyConversationWidthCssVar sets dataset when document exists", () => {
    if (typeof document === "undefined") return;
    applyConversationWidthCssVar("wide");
    expect(document.documentElement.dataset.conversationWidth).toBe("wide");
    applyConversationWidthCssVar("fixed");
    expect(document.documentElement.dataset.conversationWidth).toBe("fixed");
  });
});
