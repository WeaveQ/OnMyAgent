import { describe, expect, test } from "bun:test";
import {
  sessionNeedsTabTitleFallback,
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
    expect(summarizeTabTitle(session, "请帮我查一下库存异常")).toContain("库存");
  });

  test("empty title falls back to new session, not summarizing forever", () => {
    const title = summarizeTabTitle({ id: "ses_3", title: "" } as never);
    expect(title).not.toMatch(/总结中|Summarizing/);
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

  test("empty snapshot keeps polling; titled snapshot stops", () => {
    expect(tabTitleSnapshotRefetchIntervalMs(undefined)).toBe(3_000);
    expect(tabTitleSnapshotRefetchIntervalMs(null)).toBe(false);
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

  test("tab title selection includes focused session before and after defer", () => {
    const sessions = [
      { id: "ses_selected" },
      { id: "ses_a" },
      { id: "ses_b" },
    ];
    const before = selectSidebarPreviewSessionIds({
      sessions,
      selectedSessionId: "ses_selected",
      deferred: false,
      prioritizeSelected: true,
      includeSelected: true,
    });
    expect([...before]).toEqual(["ses_selected"]);

    const after = selectSidebarPreviewSessionIds({
      sessions,
      selectedSessionId: "ses_selected",
      deferred: true,
      prioritizeSelected: true,
      includeSelected: true,
      maxPreviews: 8,
    });
    expect(after.has("ses_selected")).toBe(true);
    expect(after.has("ses_a")).toBe(true);
    expect(after.has("ses_b")).toBe(true);
  });
});
