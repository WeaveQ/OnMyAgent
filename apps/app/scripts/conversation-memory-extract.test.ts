/**
 * Drives shipped conversation-memory + work-memory assembly (extract/pending/B'/expert).
 */
import { describe, expect, test } from "bun:test";

import { buildOnboardingProfileSystemPrompt } from "../src/react-app/shell/onboarding-profile";
import {
  acceptPendingMemory,
  appendMemoryItems,
  applyAutoCaptureMemory,
  enqueuePendingMemoryCandidates,
  extractMemoryCandidatesFromUserText,
  formatProfileMemoryLine,
  importProfileBlockToItems,
  isSensitiveMemoryText,
  parseProfileMemoryLine,
  rejectPendingMemory,
  shouldAttemptMemoryExtract,
} from "../src/react-app/domains/shared/memory/conversation-memory";
import {
  buildUserProfileMarkdown,
  buildWorkMemoryContext,
  clearGlobalWorkMemory,
  resolveWorkMemoryAwarenessPaths,
  selectExpertMemoryItems,
  selectGlobalMemoryItems,
  truncateMemoryLines,
  WORK_MEMORY_SEED,
  getWorkMemorySeed,
} from "../src/react-app/domains/shared/memory/work-memory";
import {
  applyLongTermMemoryMarkdown,
  buildLongTermMemoryMarkdown,
  buildStyleMarkdown,
  parseStyleMarkdown,
  parseUserProfileMarkdown,
  prefsPatchFromAwarenessFile,
} from "../src/react-app/domains/shared/memory/work-memory-file-sync";
import type {
  ConversationMemoryState,
  OnboardingProfile,
} from "../src/react-app/kernel/local-provider";

function emptyState(over: Partial<ConversationMemoryState> = {}): ConversationMemoryState {
  return {
    enabled: true,
    autoCapture: false,
    items: [],
    pending: [],
    shortTerm: [],
    ...over,
  };
}

function sampleProfile(over: Partial<OnboardingProfile> = {}): OnboardingProfile {
  return {
    userName: "Hope",
    assistantName: "",
    mbti: "",
    roles: [],
    industries: [],
    tools: [],
    tasks: [],
    docPreference: "",
    terminology: "",
    skipped: false,
    updatedAt: 1,
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
    expect(items[0]?.sessionId).toBe("s1");
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

  test("autoCapture on: writes long-term + short-term immediately", () => {
    const candidates = extractMemoryCandidatesFromUserText("记住：周报用表格", {
      now: 2,
      sessionId: "sess-a",
    });
    const once = applyAutoCaptureMemory(
      emptyState({ autoCapture: true }),
      candidates,
    );
    expect(once.items.length).toBe(1);
    expect(once.shortTerm.length).toBe(1);
    expect(once.pending.length).toBe(0);
    expect(once.items[0]?.sessionId).toBe("sess-a");
  });

  test("autoCapture off: applyAutoCapture is no-op", () => {
    const candidates = extractMemoryCandidatesFromUserText("记住：周报用表格", {
      now: 2,
    });
    const next = applyAutoCaptureMemory(
      emptyState({ autoCapture: false }),
      candidates,
    );
    expect(next.items).toEqual([]);
    expect(next.shortTerm).toEqual([]);
  });

  test("enqueue pending only when used without auto path", () => {
    const candidates = extractMemoryCandidatesFromUserText("记住：周报用表格", {
      now: 2,
      sessionId: "sess-a",
    });
    const once = enqueuePendingMemoryCandidates(emptyState(), candidates);
    expect(once.items.length).toBe(0);
    expect(once.pending.length).toBe(1);
  });

  test("applyAutoCapture is no-op when memory disabled", () => {
    const disabled = emptyState({ enabled: false, autoCapture: true });
    const candidates = extractMemoryCandidatesFromUserText("记住：我做跨境电商");
    const next = applyAutoCaptureMemory(disabled, candidates);
    expect(next.items).toEqual([]);
    expect(next.shortTerm).toEqual([]);
  });

  test("accept promotes pending into injectable items", () => {
    const candidates = extractMemoryCandidatesFromUserText("记住：周报用表格", {
      now: 3,
    });
    const pending = enqueuePendingMemoryCandidates(emptyState(), candidates);
    const id = pending.pending[0]!.id;
    const confirmed = acceptPendingMemory(pending, id);
    expect(confirmed.pending.length).toBe(0);
    expect(confirmed.items.length).toBe(1);
    expect(confirmed.items[0]?.text).toContain("周报");
  });

  test("reject drops pending without adding items", () => {
    const candidates = extractMemoryCandidatesFromUserText("记住：只用要点", {
      now: 4,
    });
    const pending = enqueuePendingMemoryCandidates(emptyState(), candidates);
    const id = pending.pending[0]!.id;
    const rejected = rejectPendingMemory(pending, id);
    expect(rejected.pending.length).toBe(0);
    expect(rejected.items.length).toBe(0);
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
});

describe("work memory B' inject + expert isolation (shipped)", () => {
  test("B': personal profile injects when memory disabled", () => {
    const profile = sampleProfile({ userName: "Hope" });
    const memory = emptyState({ enabled: false });
    const result = buildWorkMemoryContext({ profile, conversationMemory: memory });
    expect(result.hasPersonal).toBe(true);
    expect(result.hasMemory).toBe(false);
    expect(result.systemText).toContain("Hope");
    expect(result.systemText).not.toContain("周报");
  });

  test("B': confirmed memory injects only when enabled", () => {
    const profile = sampleProfile({ skipped: true, userName: "" });
    const line = formatProfileMemoryLine({
      category: "preference",
      content: "concise bullets",
      date: "2026-07-18",
    });
    const item = {
      id: "ok",
      text: line,
      source: "dialog" as const,
      updatedAt: 1,
    };
    const off = buildWorkMemoryContext({
      profile,
      conversationMemory: emptyState({ enabled: false, items: [item] }),
    });
    expect(off.systemText).toBeNull();

    const on = buildWorkMemoryContext({
      profile,
      conversationMemory: emptyState({ enabled: true, items: [item] }),
    });
    expect(on.systemText).toContain("concise bullets");
    expect(on.systemText).toContain("#preference");
  });

  test("pending is never injected", () => {
    const profile = sampleProfile({ skipped: true, userName: "" });
    const line = formatProfileMemoryLine({
      category: "instruction",
      content: "secret-pending-fact",
      date: "2026-07-18",
    });
    const result = buildWorkMemoryContext({
      profile,
      conversationMemory: emptyState({
        enabled: true,
        pending: [
          {
            id: "p1",
            text: line,
            source: "dialog",
            updatedAt: 1,
          },
        ],
      }),
    });
    expect(result.systemText).toBeNull();
  });

  test("short-term injects when enabled", () => {
    const profile = sampleProfile({ skipped: true, userName: "" });
    const line = formatProfileMemoryLine({
      category: "preference",
      content: "today-note",
      date: "2026-08-02",
    });
    const result = buildWorkMemoryContext({
      profile,
      conversationMemory: emptyState({
        enabled: true,
        shortTerm: [
          {
            id: "s1",
            text: line,
            source: "dialog",
            updatedAt: 1,
          },
        ],
      }),
    });
    expect(result.systemText).toContain("today-note");
    expect(result.systemText).toContain("Short-term");
  });

  test("expert A memory absent from expert B assembly", () => {
    const profile = sampleProfile({ skipped: true, userName: "" });
    const aLine = formatProfileMemoryLine({
      category: "preference",
      content: "only-for-expert-a",
      date: "2026-07-18",
    });
    const globalLine = formatProfileMemoryLine({
      category: "instruction",
      content: "global-table-rule",
      date: "2026-07-18",
    });
    const state: ConversationMemoryState = {
      enabled: true,
      autoCapture: false,
      items: [
        {
          id: "ea",
          text: aLine,
          source: "dialog",
          updatedAt: 2,
          expertId: "expert-a",
        },
        {
          id: "g",
          text: globalLine,
          source: "manual",
          updatedAt: 1,
        },
      ],
      pending: [],
      shortTerm: [],
    };

    const forB = buildWorkMemoryContext({
      profile,
      conversationMemory: state,
      expertId: "expert-b",
    });
    expect(forB.systemText).toContain("global-table-rule");
    expect(forB.systemText).not.toContain("only-for-expert-a");

    const forA = buildWorkMemoryContext({
      profile,
      conversationMemory: state,
      expertId: "expert-a",
    });
    expect(forA.systemText).toContain("only-for-expert-a");
    expect(forA.systemText).toContain("global-table-rule");

    expect(selectExpertMemoryItems(state.items, "expert-a")).toHaveLength(1);
    expect(selectExpertMemoryItems(state.items, "expert-b")).toHaveLength(0);
    expect(selectGlobalMemoryItems(state.items)).toHaveLength(1);
  });

  test("extract tags expertId for slot C", () => {
    const items = extractMemoryCandidatesFromUserText("记住：物流对账用模板", {
      expertId: "logistics-expert",
      sessionId: "s9",
    });
    expect(items[0]?.expertId).toBe("logistics-expert");
    const queued = enqueuePendingMemoryCandidates(emptyState(), items);
    expect(queued.pending[0]?.expertId).toBe("logistics-expert");
    const confirmed = acceptPendingMemory(queued, queued.pending[0]!.id);
    expect(confirmed.items[0]?.expertId).toBe("logistics-expert");
  });

  test("buildUserProfileMarkdown fills USER.md from personal selections", () => {
    const md = buildUserProfileMarkdown(
      sampleProfile({
        userName: "Hope",
        assistantName: "Xiao",
        mbti: "INTJ",
        roles: ["product"],
        industries: ["internet"],
        tools: ["feishu", "excel"],
        tasks: ["weekly-report"],
      }),
      {
        roles: { product: "Product" },
        industries: { internet: "Internet" },
        tools: { feishu: "Feishu", excel: "Excel" },
        tasks: { "weekly-report": "Weekly report" },
      },
      "zh",
    );
    expect(md).toContain("# 用户画像");
    expect(md).toContain("Hope");
    expect(md).toContain("Xiao");
    expect(md).toContain("INTJ");
    expect(md).toContain("Product");
    expect(md).toContain("Internet");
    expect(md).toContain("Feishu");
    expect(md).toContain("Weekly report");
    expect(buildUserProfileMarkdown(null, undefined, "zh")).toBe(
      WORK_MEMORY_SEED["USER.md"],
    );
    expect(buildUserProfileMarkdown(null, undefined, "en")).toContain(
      "# User profile",
    );
  });

  test("style.md and MEMORY.md round-trip prefs ↔ markdown", () => {
    const style = buildStyleMarkdown("professional", "prefer tables", "zh");
    expect(style).toContain("## 语气");
    expect(style).toContain("professional");
    expect(style).toContain("prefer tables");
    const parsedStyle = parseStyleMarkdown(style);
    expect(parsedStyle.responseTone).toBe("professional");
    expect(parsedStyle.customInstructions).toBe("prefer tables");

    const memState = emptyState({
      items: [
        {
          id: "g1",
          text: "weekly-report-as-table",
          source: "manual",
          updatedAt: 2,
        },
        {
          id: "e1",
          text: "expert-only",
          source: "manual",
          updatedAt: 1,
          expertId: "exp-a",
        },
      ],
    });
    const memMd = buildLongTermMemoryMarkdown(memState, "zh");
    expect(memMd).toContain("# 长期记忆");
    expect(memMd).toContain("weekly-report-as-table");
    expect(memMd).not.toContain("expert-only");
    const applied = applyLongTermMemoryMarkdown(memState, memMd);
    expect(applied.items.filter((i) => !i.expertId)).toHaveLength(1);
    expect(applied.items.find((i) => i.expertId)?.text).toBe("expert-only");
    expect(applied.items.find((i) => !i.expertId)?.text).toBe(
      "weekly-report-as-table",
    );

    const labels = {
      roles: { product: "Product" },
      industries: { internet: "Internet" },
      tools: { feishu: "Feishu" },
      tasks: { "weekly-report": "Weekly report" },
    };
    const userMd = buildUserProfileMarkdown(
      sampleProfile({
        userName: "Hope",
        roles: ["product"],
        industries: ["internet"],
      }),
      labels,
      "zh",
    );
    const userParsed = parseUserProfileMarkdown(userMd, labels);
    expect(userParsed.userName).toBe("Hope");
    expect(userParsed.roles).toContain("product");

    const stylePatch = prefsPatchFromAwarenessFile("style.md", style, {});
    expect(stylePatch?.responseTone).toBe("professional");
    const memPatch = prefsPatchFromAwarenessFile("MEMORY.md", memMd, {
      conversationMemory: memState,
    });
    expect(
      memPatch?.conversationMemory?.items.some(
        (i) => i.text === "weekly-report-as-table",
      ),
    ).toBe(true);
    expect(getWorkMemorySeed("en")["style.md"]).toContain("Collaboration style");
    expect(getWorkMemorySeed("zh-TW")["USER.md"]).toContain("使用者畫像");
  });

  test("clearGlobalWorkMemory drops global/pending/short, keeps expert C", () => {
    const state = emptyState({
      enabled: true,
      autoCapture: true,
      items: [
        {
          id: "g1",
          text: "global-fact",
          source: "manual",
          updatedAt: 1,
        },
        {
          id: "e1",
          text: "expert-fact",
          source: "manual",
          updatedAt: 2,
          expertId: "expert-a",
        },
      ],
      pending: [
        {
          id: "p1",
          text: "pending",
          source: "dialog",
          updatedAt: 3,
        },
      ],
      shortTerm: [
        {
          id: "s1",
          text: "today",
          source: "dialog",
          updatedAt: 4,
        },
      ],
    });
    const cleared = clearGlobalWorkMemory(state);
    expect(cleared.enabled).toBe(true);
    expect(cleared.autoCapture).toBe(true);
    expect(cleared.items).toHaveLength(1);
    expect(cleared.items[0]?.expertId).toBe("expert-a");
    expect(cleared.pending).toEqual([]);
    expect(cleared.shortTerm).toEqual([]);
    expect(WORK_MEMORY_SEED["style.md"]).toContain("协作风格");
    expect(WORK_MEMORY_SEED["AGENTS.md"]).toContain("工作手册");
    expect(WORK_MEMORY_SEED["MEMORY.md"]).toContain("长期记忆");
  });

  test("budget truncation holds max chars", () => {
    const longLines = Array.from({ length: 20 }, (_, i) =>
      `- ${"x".repeat(100)}-${i}`,
    );
    const { lines, truncated } = truncateMemoryLines(longLines, 250);
    expect(truncated).toBe(true);
    expect(lines.join("\n").length).toBeLessThanOrEqual(250);
  });

  test("awareness paths are under data/user/awareness not package tree", () => {
    const paths = resolveWorkMemoryAwarenessPaths("/Users/hope");
    expect(paths.userAwarenessRoot).toContain("data/user/awareness");
    expect(paths.globalMainDir).toContain("awareness/main");
    const expertDir = paths.expertSlotDir("my/expert");
    expect(expertDir).toContain("experts");
    expect(expertDir).not.toContain("marketplaces");
    expect(expertDir).not.toContain("config/experts");
    expect(paths.workspaceAwarenessDir("/proj")).toBe(
      "/proj/.onmyagent/awareness",
    );
  });

  test("buildOnboardingProfileSystemPrompt delegates to work memory (B')", () => {
    const profile = sampleProfile({ userName: "Lee" });
    const withOff = buildOnboardingProfileSystemPrompt(profile, {
      enabled: false,
      autoCapture: false,
      items: [
        {
          id: "x",
          text: formatProfileMemoryLine({
            category: "preference",
            content: "hidden-when-off",
            date: "2026-07-18",
          }),
          source: "dialog",
          updatedAt: 1,
        },
      ],
      pending: [],
      shortTerm: [],
    });
    expect(withOff).toContain("Lee");
    expect(withOff).not.toContain("hidden-when-off");
  });

  test("manual append writes items without requiring enable (confirm path)", () => {
    const line = formatProfileMemoryLine({
      category: "preference",
      content: "manual note",
      date: "2026-07-18",
    });
    const next = appendMemoryItems(emptyState({ enabled: false }), [
      {
        id: "m1",
        text: line,
        source: "manual",
        updatedAt: 1,
      },
    ]);
    expect(next.items.length).toBe(1);
  });
});
