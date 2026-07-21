import { describe, expect, test } from "bun:test";
import { deriveSessionSurfaceLayoutMode } from "../src/react-app/domains/session/surface/session-surface-layout-mode";

describe("deriveSessionSurfaceLayoutMode", () => {
  const base = {
    hasAgentContext: false,
    hasEffectiveAgent: false,
    renderedMessageCount: 0,
    hasTranscriptContent: false,
    hasVisibleTranscriptError: false,
    activityIdle: true,
    assistantCategoryId: "office" as const,
  };

  test("assistant draft home when personal assistant + draft + idle empty", () => {
    const mode = deriveSessionSurfaceLayoutMode({
      ...base,
      personalAssistantHome: true,
      draftOnly: true,
    });
    expect(mode.personalAssistantDraftHome).toBe(true);
    expect(mode.homeComposerLayout).toBe(true);
    expect(mode.draftWorkspaceAccessoryActive).toBe(true);
  });

  test("expert empty composer when agent present and no transcript", () => {
    const mode = deriveSessionSurfaceLayoutMode({
      ...base,
      personalAssistantHome: false,
      draftOnly: false,
      hasEffectiveAgent: true,
    });
    expect(mode.personalAssistantDraftHome).toBe(false);
    expect(mode.expertEmptyComposer).toBe(true);
    expect(mode.homeComposerLayout).toBe(true);
  });

  test("not draft home once messages exist", () => {
    const mode = deriveSessionSurfaceLayoutMode({
      ...base,
      personalAssistantHome: true,
      draftOnly: true,
      renderedMessageCount: 2,
      hasTranscriptContent: true,
    });
    expect(mode.personalAssistantDraftHome).toBe(false);
    expect(mode.homeComposerLayout).toBe(false);
  });

  test("not empty while not idle", () => {
    const mode = deriveSessionSurfaceLayoutMode({
      ...base,
      personalAssistantHome: true,
      draftOnly: true,
      activityIdle: false,
    });
    expect(mode.personalAssistantDraftHome).toBe(false);
  });
});
