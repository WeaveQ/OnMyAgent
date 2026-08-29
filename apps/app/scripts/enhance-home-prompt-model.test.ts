import { describe, expect, test } from "bun:test";

import {
  beginHomePromptEnhance,
  canEnhanceHomePrompt,
  collectDraftMentionNames,
  completeHomePromptEnhance,
  dropHomePromptEnhanceSnapshot,
  failHomePromptEnhance,
  homePromptEnhanceButtonMode,
  INITIAL_HOME_PROMPT_ENHANCE_STATE,
  undoHomePromptEnhance,
  workspaceFolderNameFromPath,
} from "../src/app/lib/enhance-home-prompt-model";

describe("home prompt enhance model", () => {
  test("empty draft or missing model stays disabled", () => {
    expect(canEnhanceHomePrompt({ draft: "", modelAvailable: true })).toBe(false);
    expect(canEnhanceHomePrompt({ draft: "   ", modelAvailable: true })).toBe(false);
    expect(canEnhanceHomePrompt({ draft: "写周报", modelAvailable: false })).toBe(false);
    expect(canEnhanceHomePrompt({ draft: "写周报", modelAvailable: true })).toBe(true);
    expect(
      homePromptEnhanceButtonMode({
        draft: "",
        modelAvailable: true,
        state: INITIAL_HOME_PROMPT_ENHANCE_STATE,
      }),
    ).toBe("disabled");
    expect(
      homePromptEnhanceButtonMode({
        draft: "写周报",
        modelAvailable: false,
        state: INITIAL_HOME_PROMPT_ENHANCE_STATE,
      }),
    ).toBe("disabled");
  });

  test("success is undoable and restores the pre-enhance snapshot", () => {
    const started = beginHomePromptEnhance(INITIAL_HOME_PROMPT_ENHANCE_STATE, "写周报");
    expect(started.phase).toBe("enhancing");
    expect(started.snapshot).toBe("写周报");
    expect(
      homePromptEnhanceButtonMode({
        draft: "写周报",
        modelAvailable: true,
        state: started,
      }),
    ).toBe("loading");

    const done = completeHomePromptEnhance(started);
    expect(done.phase).toBe("undoable");
    expect(
      homePromptEnhanceButtonMode({
        draft: "请写一份本周周报，包含目标、进展和风险。",
        modelAvailable: true,
        state: done,
      }),
    ).toBe("undo");

    const undone = undoHomePromptEnhance(done);
    expect(undone.restored).toBe("写周报");
    expect(undone.state).toEqual(INITIAL_HOME_PROMPT_ENHANCE_STATE);
  });

  test("a second enhance is one-level: undo restores the text from immediately before it", () => {
    const first = completeHomePromptEnhance(
      beginHomePromptEnhance(INITIAL_HOME_PROMPT_ENHANCE_STATE, "写周报"),
    );
    const second = completeHomePromptEnhance(
      beginHomePromptEnhance(first, "请写一份本周周报"),
    );
    expect(undoHomePromptEnhance(second).restored).toBe("请写一份本周周报");
  });

  test("send or clear drops the snapshot so undo is gone", () => {
    const done = completeHomePromptEnhance(
      beginHomePromptEnhance(INITIAL_HOME_PROMPT_ENHANCE_STATE, "写周报"),
    );
    expect(dropHomePromptEnhanceSnapshot()).toEqual(INITIAL_HOME_PROMPT_ENHANCE_STATE);
    expect(undoHomePromptEnhance(dropHomePromptEnhanceSnapshot()).restored).toBeNull();
    expect(failHomePromptEnhance(done)).toEqual(INITIAL_HOME_PROMPT_ENHANCE_STATE);
  });

  test("collects folder labels and @ mention names already in the draft", () => {
    expect(workspaceFolderNameFromPath("/Users/me/work/reports/")).toBe("reports");
    expect(collectDraftMentionNames("看 @notes.md 和 @folder%20name")).toEqual([
      "notes.md",
      "folder name",
    ]);
  });
});
