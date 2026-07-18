/**
 * Drives shipped conversation-memory extract + direct-write helpers.
 */
import { describe, expect, test } from "bun:test";

import { buildOnboardingProfileSystemPrompt } from "../src/react-app/shell/onboarding-profile";
import {
  appendMemoryItems,
  extractMemoryCandidatesFromUserText,
  formatProfileMemoryLine,
  importProfileBlockToItems,
  isSensitiveMemoryText,
  parseProfileMemoryLine,
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
  });

  test("extract writes one clean profile line with category tag", () => {
    const items = extractMemoryCandidatesFromUserText("请记住：输出优先表格", {
      sessionId: "s1",
      now: Date.parse("2026-07-18T12:00:00Z"),
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe("dialog");
    const parsed = parseProfileMemoryLine(items[0]!.text);
    expect(parsed.category).toBe("instruction");
    expect(parsed.content).toContain("表格");
    expect(parsed.content).not.toMatch(/User identity/i);
  });

  test("identity extract keeps short body only", () => {
    const items = extractMemoryCandidatesFromUserText("我是物流调度", {
      now: Date.parse("2026-07-18T12:00:00Z"),
    });
    expect(items).toHaveLength(1);
    const parsed = parseProfileMemoryLine(items[0]!.text);
    expect(parsed.category).toBe("identity");
    expect(parsed.content).toBe("物流调度");
  });

  test("rejects sensitive-looking captures", () => {
    expect(isSensitiveMemoryText("api_key=sk-abc123")).toBe(true);
    const items = extractMemoryCandidatesFromUserText(
      "记住：password is hunter2-secret",
    );
    expect(items.length).toBe(0);
  });

  test("appendMemoryItems writes into items and skips dups", () => {
    const candidates = extractMemoryCandidatesFromUserText("记住：周报用表格", {
      now: 2,
    });
    const once = appendMemoryItems(emptyState(), candidates);
    expect(once.items.length).toBe(1);
    const twice = appendMemoryItems(once, candidates);
    expect(twice.items.length).toBe(1);
  });

  test("append is no-op when memory disabled", () => {
    const disabled = emptyState({ enabled: false });
    const candidates = extractMemoryCandidatesFromUserText("记住：我做跨境电商");
    expect(appendMemoryItems(disabled, candidates).items).toEqual([]);
  });

  test("import profile block maps section headers to categories", () => {
    const block = `
指令
[2026-01-01] - 始终用表格输出周报

身份
[2026-02-01] - 物流调度

偏好
[unknown] - 简洁要点
`;
    const items = importProfileBlockToItems(block, { now: 100 });
    expect(items.length).toBe(3);
    expect(parseProfileMemoryLine(items[0]!.text).category).toBe("instruction");
    expect(parseProfileMemoryLine(items[1]!.text).category).toBe("identity");
    expect(parseProfileMemoryLine(items[2]!.text).category).toBe("preference");
    expect(parseProfileMemoryLine(items[1]!.text).content).toContain("物流");
  });

  test("formatProfileMemoryLine + parse round-trip", () => {
    const line = formatProfileMemoryLine({
      category: "career",
      content: "跨境电商运营",
      date: "2026-07-18",
    });
    expect(line).toBe("[2026-07-18] #career 跨境电商运营");
    expect(parseProfileMemoryLine(line)).toEqual({
      date: "2026-07-18",
      category: "career",
      content: "跨境电商运营",
    });
  });

  test("system prompt injects items content", () => {
    const state: ConversationMemoryState = {
      enabled: true,
      items: [
        {
          id: "ok",
          text: formatProfileMemoryLine({
            category: "preference",
            content: "concise bullets",
            date: "2026-07-18",
          }),
          source: "dialog",
          updatedAt: 1,
        },
      ],
      pending: [],
    };
    const prompt = buildOnboardingProfileSystemPrompt(
      { skipped: true } as never,
      state,
    );
    expect(prompt).toContain("concise bullets");
    expect(prompt).toContain("#preference");
  });
});
