import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  EXPERT_SESSION_LIFECYCLE_RULES,
  isDraftSessionId,
  remainingExpertSessionIdsAfterDelete,
  shouldApplyExpertSelection,
  shouldClearLocalBindingOnDelete,
  shouldFlushComposerOnExpertCreate,
} from "../src/react-app/domains/agents/expert-session-lifecycle";
import {
  beginExpertCreateSaveAttempt,
  consumeExpertCreateComposerFlush,
} from "../src/react-app/domains/agents/expert-creation-actions";
import { clearExpertLocalSessionBindings } from "../src/react-app/domains/agents/expert-hard-delete";
import {
  readCustomAgentIdForSession,
  readSessionAgentSnapshot,
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
} from "../src/react-app/domains/agents/agent-registry-store";

const appRoot = path.join(import.meta.dir, "..");

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
    if (typeof localStorage === "undefined") return;
    writeCustomAgentIdForSession("keep-me", "agent-keep");
    writeCustomAgentIdForSession("drop-me", "agent-drop");
    writeSessionAgentSnapshot("drop-me", {
      id: "agent-drop",
      name: "Drop",
      description: "",
      avatar: {
        avatarStyle: "robot",
        avatarOptionId: "drop",
        customAvatarDataUrl: null,
        avatarUrl: null,
        avatarBackground: null,
      },
      systemPrompt: "",
    });
    clearExpertLocalSessionBindings(["drop-me", "draft:should-not-matter"]);
    expect(readCustomAgentIdForSession("keep-me")).toBe("agent-keep");
    expect(readCustomAgentIdForSession("drop-me")).toBeNull();
    expect(readSessionAgentSnapshot("drop-me")).toBeNull();
  });

  test("production call sites gate real create draft flush", () => {
    const createPage = readFileSync(
      path.join(
        appRoot,
        "src/react-app/domains/agents/expert-creation-page.tsx",
      ),
      "utf8",
    );
    expect(createPage).toContain("beginExpertCreateSaveAttempt");
    expect(createPage).toContain("consumeExpertCreateComposerFlush");
    expect(createPage).toContain("clearExpertCreationStoredState");
    // Must consume flush as gate for clear — not void discard.
    expect(createPage).toMatch(
      /consumeExpertCreateComposerFlush\(\)[\s\S]{0,120}clearExpertCreationStoredState/,
    );

    const createActions = readFileSync(
      path.join(
        appRoot,
        "src/react-app/domains/agents/expert-creation-actions.ts",
      ),
      "utf8",
    );
    // saveExpertCreation must not burn the latch without flushing.
    expect(createActions).not.toMatch(
      /void consumeExpertCreateComposerFlush\(\)/,
    );

    const surface = readFileSync(
      path.join(
        appRoot,
        "src/react-app/shell/session-route/surface-props-hook-impl.ts",
      ),
      "utf8",
    );
    expect(surface).toContain("shouldApplyExpertSelection");

    const deleteHook = readFileSync(
      path.join(
        appRoot,
        "src/react-app/domains/session/pages/use-expert-session-delete.ts",
      ),
      "utf8",
    );
    expect(deleteHook).not.toContain("remainingExpertSessionIdsAfterDelete");
    expect(deleteHook).not.toContain("removeExpertSession");

    beginExpertCreateSaveAttempt();
    expect(consumeExpertCreateComposerFlush()).toBe(true);
    expect(consumeExpertCreateComposerFlush()).toBe(false);
  });
});
