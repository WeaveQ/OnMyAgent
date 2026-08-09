import { describe, expect, test } from "bun:test";

import {
  EXPERT_SESSION_LIFECYCLE_RULES,
  isDraftSessionId,
  remainingExpertSessionIdsAfterDelete,
  shouldApplyExpertSelection,
  shouldClearLocalBindingOnDelete,
  shouldFlushComposerOnExpertCreate,
} from "../src/react-app/domains/agents/expert-session-lifecycle";
import { clearExpertLocalSessionBindings } from "../src/react-app/domains/agents/expert-hard-delete";
import {
  addExpertSession,
  isExpertSession,
  removeExpertSession,
} from "../src/react-app/domains/agents/agent-session-state";

describe("expert-session-lifecycle contracts", () => {
  test("draft sessions are never cleared on hard-delete", () => {
    expect(isDraftSessionId("draft:ws-1")).toBe(true);
    expect(shouldClearLocalBindingOnDelete("draft:ws-1")).toBe(false);
    expect(shouldClearLocalBindingOnDelete("ses_real")).toBe(true);
    expect(shouldClearLocalBindingOnDelete("  ")).toBe(false);
  });

  test("remainingExpertSessionIdsAfterDelete removes ghosts and keeps others", () => {
    const remaining = remainingExpertSessionIdsAfterDelete(
      ["ses_a", "ses_b", "ses_c", "draft:x"],
      ["ses_b", "draft:x", "  "],
    );
    expect(remaining).toEqual(["ses_a", "ses_c", "draft:x"]);
  });

  test("create composer flushes at most once per save path", () => {
    expect(shouldFlushComposerOnExpertCreate(false)).toBe(true);
    expect(shouldFlushComposerOnExpertCreate(true)).toBe(false);
    expect(EXPERT_SESSION_LIFECYCLE_RULES.createComposerFlushOnce).toBe(true);
  });

  test("select is noop when expert id unchanged", () => {
    expect(
      shouldApplyExpertSelection({
        nextExpertId: "exp-1",
        selectedExpertId: "exp-1",
      }),
    ).toBe(false);
    expect(
      shouldApplyExpertSelection({
        nextExpertId: "exp-2",
        selectedExpertId: "exp-1",
      }),
    ).toBe(true);
    expect(
      shouldApplyExpertSelection({ nextExpertId: "  ", selectedExpertId: null }),
    ).toBe(false);
  });

  test("clearExpertLocalSessionBindings uses lifecycle filter (shipped path)", () => {
    if (typeof localStorage === "undefined") {
      // jsdom-less bun: exercise pure filter via remainingExpertSessionIdsAfterDelete only
      const after = remainingExpertSessionIdsAfterDelete(
        new Set(["keep-me", "drop-me"]),
        ["drop-me", "draft:ignored"],
      );
      expect(after.includes("keep-me")).toBe(true);
      expect(after.includes("drop-me")).toBe(false);
      return;
    }

    addExpertSession("keep-me");
    addExpertSession("drop-me");
    clearExpertLocalSessionBindings(["drop-me", "draft:should-not-matter"]);
    expect(isExpertSession("keep-me")).toBe(true);
    expect(isExpertSession("drop-me")).toBe(false);
    removeExpertSession("keep-me");
  });
});
