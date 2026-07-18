/**
 * Drives shipped conversation-memory extract + staging helpers
 * (no reimplementation of fingerprint / accept logic).
 */
import { describe, expect, test } from "bun:test";

import { buildOnboardingProfileSystemPrompt } from "../src/react-app/shell/onboarding-profile";
import {
  acceptPendingMemory,
  extractMemoryCandidatesFromUserText,
  isSensitiveMemoryText,
  mergePendingMemoryCandidates,
  rejectPendingMemory,
  shouldAttemptMemoryExtract,
} from "../src/react-app/domains/shared/memory/conversation-memory";
import type { ConversationMemoryState } from "../src/react-app/kernel/local-provider";

function emptyState(over: Partial<ConversationMemoryState> = {}): ConversationMemoryState {
  return {
    enabled: true,
    items: [],
    pending: [],
    ...over,
  };
}

describe("conversation memory extract (shipped)", () => {
  test("gate opens on remember / identity / preference signals", () => {
    expect(shouldAttemptMemoryExtract("请记住：周报用表格")).toBe(true);
    expect(shouldAttemptMemoryExtract("我是物流调度")).toBe(true);
    expect(shouldAttemptMemoryExtract("偏好简洁要点")).toBe(true);
    expect(shouldAttemptMemoryExtract("remember: prefer tables")).toBe(true);
    expect(shouldAttemptMemoryExtract("今天天气怎么样")).toBe(false);
    expect(shouldAttemptMemoryExtract("帮我写周报")).toBe(false);
  });

  test("extracts short dialog candidates from user text", () => {
    const items = extractMemoryCandidatesFromUserText("请记住：输出优先表格", {
      sessionId: "s1",
      now: 1_000,
    });
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]?.source).toBe("dialog");
    expect(items[0]?.sessionId).toBe("s1");
    expect(items[0]?.text).toContain("表格");
    expect(items[0]?.text.length).toBeLessThanOrEqual(500);
  });

  test("rejects sensitive-looking captures", () => {
    expect(isSensitiveMemoryText("api_key=sk-abc123")).toBe(true);
    const items = extractMemoryCandidatesFromUserText(
      "记住：password is hunter2-secret",
    );
    expect(items.length).toBe(0);
  });

  test("merge pending skips duplicates against items and existing pending", () => {
    const candidates = extractMemoryCandidatesFromUserText("记住：周报用表格", {
      now: 2,
    });
    expect(candidates[0]?.text).toBeTruthy();
    const base = emptyState({
      items: [
        {
          id: "a",
          text: candidates[0]!.text,
          source: "dialog",
          updatedAt: 1,
        },
      ],
    });
    const merged = mergePendingMemoryCandidates(base, candidates);
    // Same fact already in items → not re-added
    expect(merged.pending.length).toBe(0);
  });

  test("merge pending is no-op when memory disabled", () => {
    const disabled = emptyState({ enabled: false });
    const candidates = extractMemoryCandidatesFromUserText("记住：我做跨境电商");
    const merged = mergePendingMemoryCandidates(disabled, candidates);
    expect(merged.pending).toEqual([]);
  });

  test("accept moves pending into items; reject drops it", () => {
    const pending = extractMemoryCandidatesFromUserText("我是跨境电商运营", {
      now: 3,
    });
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const withPending = mergePendingMemoryCandidates(emptyState(), pending);
    expect(withPending.pending.length).toBeGreaterThanOrEqual(1);

    const id = withPending.pending[0]!.id;
    const accepted = acceptPendingMemory(withPending, id);
    expect(accepted.pending.find((p) => p.id === id)).toBeUndefined();
    expect(accepted.items.some((i) => i.id === id || i.text === withPending.pending[0]!.text)).toBe(
      true,
    );

    const rejected = rejectPendingMemory(withPending, id);
    expect(rejected.pending.find((p) => p.id === id)).toBeUndefined();
    expect(rejected.items.length).toBe(0);
  });

  test("system prompt injects confirmed items only, never pending", () => {
    const state: ConversationMemoryState = {
      enabled: true,
      items: [
        {
          id: "ok",
          text: "User preference: concise bullets",
          source: "dialog",
          updatedAt: 1,
        },
      ],
      pending: [
        {
          id: "pend",
          text: "User note: must not appear in system prompt",
          source: "dialog",
          updatedAt: 2,
        },
      ],
    };
    const prompt = buildOnboardingProfileSystemPrompt(
      { skipped: true } as never,
      state,
    );
    expect(prompt).toContain("User preference: concise bullets");
    expect(prompt).not.toContain("must not appear in system prompt");
  });
});

