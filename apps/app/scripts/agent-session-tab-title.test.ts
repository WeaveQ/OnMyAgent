import { describe, expect, test } from "bun:test";
import {
  promoteSessionTitleFromPreview,
  sessionNeedsTabTitleFallback,
  sessionShouldFetchTabTitleSnapshot,
  resolvedSessionSnapshotTitle,
  shouldShowExpertTabSummarizing,
  summarizeSessionSnapshotForTab,
  summarizeTabTitle,
  tabTitleSnapshotRefetchIntervalMs,
} from "../src/react-app/domains/session/sidebar/agent-session-tabs";
import { selectSidebarPreviewSessionIds } from "../src/react-app/domains/session/sync/sidebar-load-policy";

describe("expert session tab titles", () => {
  test("keeps human titles", () => {
    expect(
      summarizeTabTitle({
        id: "ses_1",
        title: "仓库盘点任务",
      } as never),
    ).toBe("仓库盘点任务");
  });

  test("generated OpenCode titles need fallback and must not stick on summarizing", () => {
    const session = {
      id: "ses_2",
      title: "New session - 2026-07-26T01:00:00.000Z",
    } as never;
    expect(sessionNeedsTabTitleFallback(session)).toBe(true);
    expect(summarizeTabTitle(session)).not.toMatch(/总结中|Summarizing/);
    expect(
      summarizeTabTitle(session, undefined, { summarizing: true }),
    ).toMatch(/总结中|Summarizing/);
    // Message preview wins over summarizing so remount does not re-enter 总结中.
    expect(
      summarizeTabTitle(session, "请帮我查一下库存异常", { summarizing: true }),
    ).toContain("库存");
    expect(summarizeTabTitle(session, "请帮我查一下库存异常")).toContain("库存");
    expect(promoteSessionTitleFromPreview("请帮我查一下库存异常情况并出报告")).toContain(
      "库存",
    );
  });

  test("placeholder session without title or time shows loading, not new session", () => {
    const title = summarizeTabTitle({ id: "ses_3", title: "" } as never);
    expect(title).not.toMatch(/总结中|Summarizing/);
    expect(title).not.toMatch(/新会话|New session/);
  });

  test("untitled session with activity time shows relative time, not new session", () => {
    const recent = Date.now() - 5 * 60_000;
    const session = {
      id: "ses_time",
      title: "New session - 2026-07-26T01:00:00.000Z",
      time: { created: recent, updated: recent },
    } as never;
    const title = summarizeTabTitle(session);
    expect(title).not.toMatch(/新会话|New session/);
    expect(title).toMatch(/分钟前|m ago/);
  });

  test("snapshot tab title prefers first user message over assistant text", () => {
    const preview = summarizeSessionSnapshotForTab({
      session: { id: "ses_4", title: "New session - 2026-07-26T01:00:00.000Z" },
      messages: [
        {
          info: { role: "user", time: { created: 1 } },
          parts: [{ type: "text", text: "帮我做一份客户报价单" }],
        },
        {
          info: { role: "assistant", time: { created: 2 } },
          parts: [{ type: "text", text: "好的，我来帮你整理报价。" }],
        },
      ],
    } as never);
    expect(preview).toContain("报价");
    expect(summarizeTabTitle(
      { id: "ses_4", title: "New session - 2026-07-26T01:00:00.000Z" } as never,
      preview,
    )).toContain("报价");
  });

  test("uses a formal snapshot title instead of deriving one from tool text", () => {
    const snapshot = {
      session: { id: "ses_title", title: "核对六月运输账单" },
      messages: [
        {
          info: { role: "assistant", time: { created: 1 } },
          parts: [{ type: "text", text: "[工具] bash" }],
        },
      ],
    } as never;
    expect(resolvedSessionSnapshotTitle(snapshot)).toBe("核对六月运输账单");
    expect(resolvedSessionSnapshotTitle({
      ...snapshot,
      session: {
        id: "ses_title",
        title: "New session - 2026-07-26T01:00:00.000Z",
      },
    })).toBeUndefined();
  });

  test("keeps a remounted recent session in summarizing state", () => {
    const nowMs = Date.now();
    const recent = {
      id: "ses_recent",
      title: "New session - 2026-07-28T08:00:00.000Z",
      time: { created: nowMs - 3_000, updated: nowMs - 1_000 },
    } as never;
    expect(shouldShowExpertTabSummarizing(recent, {
      busy: false,
      trackedPending: false,
      pendingSelection: false,
      nowMs,
    })).toBe(true);
    const history = {
      ...recent,
      time: { created: nowMs - 10 * 60_000, updated: nowMs - 1_000 },
    } as never;
    expect(shouldShowExpertTabSummarizing(history, {
      busy: false,
      trackedPending: false,
      pendingSelection: false,
      nowMs,
    })).toBe(false);
  });

  test("history sessions are not summarizing without busy/pending/recent", () => {
    const nowMs = Date.now();
    const history = {
      id: "ses_old",
      title: "New session - 2026-07-28T08:00:00.000Z",
      time: { created: nowMs - 30 * 60_000, updated: nowMs - 20 * 60_000 },
    } as never;
    expect(
      shouldShowExpertTabSummarizing(history, {
        busy: false,
        trackedPending: false,
        pendingSelection: false,
        nowMs,
      }),
    ).toBe(false);
    expect(
      shouldShowExpertTabSummarizing(history, {
        busy: false,
        trackedPending: false,
        pendingSelection: true,
        nowMs,
      }),
    ).toBe(true);
  });

  test("pinned summarizing rules: busy or recent or selection only (no tracked state)", () => {
    const nowMs = Date.now();
    const recent = {
      id: "ses_r",
      title: "New session - 2026-08-10T00:00:00.000Z",
      time: { created: nowMs - 1_000, updated: nowMs },
    } as never;
    // Production tabs pass trackedPending=false always — age/busy/pendingSelection only.
    expect(
      shouldShowExpertTabSummarizing(recent, {
        busy: false,
        trackedPending: false,
        pendingSelection: false,
        nowMs,
      }),
    ).toBe(true);
    expect(
      shouldShowExpertTabSummarizing(recent, {
        busy: true,
        trackedPending: false,
        pendingSelection: false,
        nowMs,
      }),
    ).toBe(true);
    const human = { id: "ses_h", title: "仓库盘点" } as never;
    expect(
      shouldShowExpertTabSummarizing(human, {
        busy: true,
        trackedPending: true,
        pendingSelection: true,
        nowMs,
      }),
    ).toBe(false);
  });

  test("idle empty snapshot does not poll; busy empty does; titled stops", () => {
    const empty = {
      session: { id: "ses_5" },
      messages: [],
    } as never;
    expect(tabTitleSnapshotRefetchIntervalMs(undefined)).toBe(false);
    expect(tabTitleSnapshotRefetchIntervalMs(null)).toBe(false);
    expect(tabTitleSnapshotRefetchIntervalMs(empty)).toBe(false);
    expect(tabTitleSnapshotRefetchIntervalMs(empty, { busy: true })).toBe(3_000);
    expect(
      tabTitleSnapshotRefetchIntervalMs(empty, { titlePending: true }),
    ).toBe(3_000);
    expect(
      tabTitleSnapshotRefetchIntervalMs({
        session: { id: "ses_5" },
        messages: [
          {
            info: { role: "user", time: { created: 1 } },
            parts: [{ type: "text", text: "库存盘点" }],
          },
        ],
      } as never),
    ).toBe(false);
  });

  test("tab title selection never includes selected session in deferred set", () => {
    const sessions = [
      { id: "ses_selected" },
      { id: "ses_a" },
      { id: "ses_b" },
    ];
    const before = selectSidebarPreviewSessionIds({
      sessions,
      selectedSessionId: "ses_selected",
      deferred: false,
      prioritizeSelected: false,
      includeSelected: false,
    });
    expect(before.size).toBe(0);

    const after = selectSidebarPreviewSessionIds({
      sessions,
      selectedSessionId: "ses_selected",
      deferred: true,
      prioritizeSelected: false,
      includeSelected: false,
      maxPreviews: 3,
    });
    expect(after.has("ses_selected")).toBe(false);
    expect(after.has("ses_a")).toBe(true);
    expect(after.has("ses_b")).toBe(true);
  });

  test("expert tab title selection prioritizes the active tab and resolves a bounded strip after defer", () => {
    const sessions = Array.from({ length: 6 }, (_, index) => ({
      id: `ses_${index + 1}`,
    }));
    const before = selectSidebarPreviewSessionIds({
      sessions,
      selectedSessionId: "ses_3",
      deferred: false,
      includeSelected: true,
      prioritizeSelected: true,
      maxPreviews: 8,
    });
    expect([...before]).toEqual(["ses_3"]);

    const after = selectSidebarPreviewSessionIds({
      sessions,
      selectedSessionId: "ses_3",
      deferred: true,
      includeSelected: true,
      prioritizeSelected: true,
      maxPreviews: 8,
    });
    expect(after.size).toBe(6);
    expect(after.has("ses_3")).toBe(true);
  });

  test("default-titled real sessions fetch one bounded title snapshot regardless of list timestamps", () => {
    const defaultTitled = {
      id: "ses_default",
      title: "New session - 2026-07-26T01:00:00.000Z",
      time: { created: 1_000, updated: 1_000 },
    } as never;
    expect(sessionShouldFetchTabTitleSnapshot(defaultTitled)).toBe(true);
    expect(
      sessionShouldFetchTabTitleSnapshot({
        ...defaultTitled,
        id: "draft:ws:expert",
      }),
    ).toBe(false);
    expect(
      sessionShouldFetchTabTitleSnapshot({
        ...defaultTitled,
        title: "广州汽配运输",
      }),
    ).toBe(false);
  });
});
