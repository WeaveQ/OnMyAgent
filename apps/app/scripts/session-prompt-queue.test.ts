import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ComposerDraft } from "../src/app/types";
import {
  EMPTY_PROMPT_QUEUE_DRAIN_LATCH,
  advancePromptQueueDrainLatch,
  composerDraftToRequeue,
  insertQueuedPrompt,
  isPromptQueueTurnBusy,
  moveQueuedPrompt,
  notePromptQueueSendStarted,
  promoteQueuedPrompt,
  promptQueueDrainLatchBlocks,
  removeQueuedPrompt,
  restoreQueuedPrompt,
  shouldDrainQueuedPrompt,
  shouldEnqueuePrompt,
  shouldTouchComposerOnSend,
  takeQueuedPrompt,
  MAX_QUEUED_PROMPTS,
} from "../src/react-app/domains/session/surface/composer/prompt-queue-model";

function draft(text: string): ComposerDraft {
  return {
    mode: "prompt",
    parts: [],
    attachments: [],
    text,
  };
}

describe("shouldEnqueuePrompt", () => {
  test("enqueues only when a live session is busy", () => {
    expect(
      shouldEnqueuePrompt({ busy: true, draftOnly: false, sessionId: "ses_1" }),
    ).toBe(true);
    expect(
      shouldEnqueuePrompt({ busy: false, draftOnly: false, sessionId: "ses_1" }),
    ).toBe(false);
  });

  test("does not enqueue expert empty-shell / draft sessions", () => {
    expect(
      shouldEnqueuePrompt({ busy: true, draftOnly: true, sessionId: "ses_1" }),
    ).toBe(false);
    expect(
      shouldEnqueuePrompt({
        busy: true,
        draftOnly: false,
        sessionId: "draft:expert",
      }),
    ).toBe(false);
  });
});

describe("isPromptQueueTurnBusy", () => {
  test("treats thinking and tool waits as an in-progress turn", () => {
    expect(
      isPromptQueueTurnBusy({
        sending: false,
        remoteBusy: false,
        activityStatus: "thinking",
      }),
    ).toBe(true);
    expect(
      isPromptQueueTurnBusy({
        sending: false,
        remoteBusy: false,
        activityStatus: "responding",
      }),
    ).toBe(true);
    expect(
      isPromptQueueTurnBusy({
        sending: false,
        remoteBusy: false,
        activityStatus: "waiting",
      }),
    ).toBe(true);
  });

  test("is idle only when send, stream, and activity have all settled", () => {
    expect(
      isPromptQueueTurnBusy({
        sending: false,
        remoteBusy: false,
        activityStatus: "idle",
      }),
    ).toBe(false);
    expect(
      isPromptQueueTurnBusy({
        sending: false,
        remoteBusy: false,
        activityStatus: "error",
      }),
    ).toBe(false);
  });
});

describe("prompt queue drain latch", () => {
  test("blocks until remote busy is seen, then idle", () => {
    let latch = notePromptQueueSendStarted();
    expect(promptQueueDrainLatchBlocks(latch)).toBe(true);
    latch = advancePromptQueueDrainLatch(latch, false);
    expect(latch).toEqual({ awaitingRemoteBusy: true, seenRemoteBusy: false });
    latch = advancePromptQueueDrainLatch(latch, true);
    expect(latch).toEqual({ awaitingRemoteBusy: false, seenRemoteBusy: true });
    expect(promptQueueDrainLatchBlocks(latch)).toBe(true);
    latch = advancePromptQueueDrainLatch(latch, false);
    expect(latch).toEqual(EMPTY_PROMPT_QUEUE_DRAIN_LATCH);
    expect(promptQueueDrainLatchBlocks(latch)).toBe(false);
  });

  test("does not clear the latch on idle before remote busy is observed", () => {
    const started = notePromptQueueSendStarted();
    expect(advancePromptQueueDrainLatch(started, false)).toEqual(started);
  });
});

describe("shouldDrainQueuedPrompt", () => {
  test("drains when the visible session is idle and still has items", () => {
    expect(
      shouldDrainQueuedPrompt({
        busy: false,
        draining: false,
        queuedCount: 3,
        awaitingTurn: false,
        paused: false,
      }),
    ).toBe(true);
  });

  test("does not drain while the visible session is busy or already flushing", () => {
    expect(
      shouldDrainQueuedPrompt({
        busy: true,
        draining: false,
        queuedCount: 3,
        awaitingTurn: false,
        paused: false,
      }),
    ).toBe(false);
    expect(
      shouldDrainQueuedPrompt({
        busy: false,
        draining: true,
        queuedCount: 3,
        awaitingTurn: false,
        paused: false,
      }),
    ).toBe(false);
    expect(
      shouldDrainQueuedPrompt({
        busy: false,
        draining: false,
        queuedCount: 0,
        awaitingTurn: false,
        paused: false,
      }),
    ).toBe(false);
  });

  test("does not drain in the prompt_async gap before the turn is busy", () => {
    expect(
      shouldDrainQueuedPrompt({
        busy: false,
        draining: false,
        queuedCount: 2,
        awaitingTurn: true,
        paused: false,
      }),
    ).toBe(false);
  });

  test("resumes after switching expert tabs once the hidden run is idle", () => {
    expect(
      shouldDrainQueuedPrompt({
        busy: false,
        draining: false,
        queuedCount: 2,
        awaitingTurn: false,
        paused: false,
      }),
    ).toBe(true);
  });

  test("does not drain remaining items after the user stops the current turn", () => {
    expect(
      shouldDrainQueuedPrompt({
        busy: false,
        draining: false,
        queuedCount: 3,
        awaitingTurn: false,
        paused: true,
      }),
    ).toBe(false);
  });

  test("hook waits for the in-flight turn before draining the next item", () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer-prompt-queue.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("shouldDrainQueuedPrompt");
    expect(src).toContain("markSessionPromptQueueSendStarted");
    expect(src).toContain(".restore(");
    expect(src).toContain("if (started) releaseSessionPromptQueueDrainPause");
    expect(src).toContain("composerDraftToRequeue");
    expect(src).not.toContain("wasBusyRef");
  });

  test("queue hook treats activity thinking as an in-progress turn", () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer-prompt-queue.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("isPromptQueueTurnBusy");
    expect(src).toContain("activityStatus === \"error\"");
  });
});

describe("queued prompt list ops", () => {
  test("inserts, removes, promotes, and takes in FIFO order", () => {
    const first = { id: "a", draft: draft("one") };
    const second = { id: "b", draft: draft("two") };
    const third = { id: "c", draft: draft("three") };
    let items = insertQueuedPrompt([], first.draft, first.id);
    items = insertQueuedPrompt(items, second.draft, second.id);
    items = insertQueuedPrompt(items, third.draft, third.id);
    expect(items.map((item) => item.draft.text)).toEqual(["one", "two", "three"]);

    items = promoteQueuedPrompt(items, "c");
    expect(items.map((item) => item.id)).toEqual(["c", "a", "b"]);

    const removed = removeQueuedPrompt(items, "a");
    expect(removed.removed?.id).toBe("a");
    expect(removed.items.map((item) => item.id)).toEqual(["c", "b"]);

    const taken = takeQueuedPrompt(removed.items);
    expect(taken.next?.id).toBe("c");
    expect(taken.rest.map((item) => item.id)).toEqual(["b"]);
  });

  test("moves a queued item to the drop target index", () => {
    const items = [
      { id: "a", draft: draft("one") },
      { id: "b", draft: draft("two") },
      { id: "c", draft: draft("three") },
    ];
    expect(moveQueuedPrompt(items, "c", "a").map((item) => item.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(moveQueuedPrompt(items, "a", "c").map((item) => item.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(moveQueuedPrompt(items, "a", "a").map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("restores a taken item to the front of the queue", () => {
    const taken = { id: "a", draft: draft("one") };
    const rest = [{ id: "b", draft: draft("two") }];
    expect(restoreQueuedPrompt(rest, taken).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(restoreQueuedPrompt([taken, ...rest], taken).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
  });

  test("edit puts a non-empty live composer draft back on the queue", () => {
    expect(composerDraftToRequeue(draft("still typing"))?.text).toBe("still typing");
    expect(composerDraftToRequeue(draft("   "))).toBeNull();
    expect(
      composerDraftToRequeue({
        ...draft(""),
        attachments: [{
          id: "a1",
          name: "note.md",
          mimeType: "text/markdown",
          size: 12,
          kind: "file",
        }] as ComposerDraft["attachments"],
      })?.attachments,
    ).toHaveLength(1);
  });

  test("queued drain must not touch the live composer", () => {
    expect(shouldTouchComposerOnSend()).toBe(true);
    expect(shouldTouchComposerOnSend(undefined)).toBe(true);
    expect(shouldTouchComposerOnSend(draft("queued"))).toBe(false);
  });

  test("caps the queue and does not mix session keys in policy", () => {
    let items = [];
    for (let i = 0; i < MAX_QUEUED_PROMPTS + 3; i += 1) {
      items = insertQueuedPrompt(items, draft(`m${i}`), `id${i}`);
    }
    expect(items).toHaveLength(MAX_QUEUED_PROMPTS);
    expect(
      shouldEnqueuePrompt({ busy: true, draftOnly: false, sessionId: "ses_home" }),
    ).toBe(true);
    expect(
      shouldEnqueuePrompt({ busy: true, draftOnly: false, sessionId: "ses_expert" }),
    ).toBe(true);
  });
});

describe("session prompt queue cleanup", () => {
  test("deleting a session drops its in-memory queue and drain latch", async () => {
    const {
      clearSessionPromptQueueState,
      markSessionPromptQueueSendStarted,
      pauseSessionPromptQueueDrain,
      isSessionPromptQueueDrainPaused,
      sessionPromptQueueDrainLatchBlocks,
      useSessionPromptQueueStore,
    } = await import(
      "../src/react-app/domains/session/surface/composer/prompt-queue-store"
    );
    const sessionId = "ses_cleanup";
    useSessionPromptQueueStore.getState().enqueue(sessionId, draft("later"));
    pauseSessionPromptQueueDrain(sessionId);
    markSessionPromptQueueSendStarted(sessionId);
    expect(useSessionPromptQueueStore.getState().bySession[sessionId]).toHaveLength(1);
    expect(isSessionPromptQueueDrainPaused(sessionId)).toBe(true);
    expect(sessionPromptQueueDrainLatchBlocks(sessionId)).toBe(true);

    clearSessionPromptQueueState(sessionId);
    expect(useSessionPromptQueueStore.getState().bySession[sessionId]).toBeUndefined();
    expect(isSessionPromptQueueDrainPaused(sessionId)).toBe(false);
    expect(sessionPromptQueueDrainLatchBlocks(sessionId)).toBe(false);
  });

  test("session.deleted clears the prompt queue", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/react-app/domains/session/sync/session-sync.ts"),
      "utf8",
    );
    expect(src).toContain("clearSessionPromptQueueState(sessionId)");
  });
});
