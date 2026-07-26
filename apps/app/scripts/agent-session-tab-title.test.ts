import { describe, expect, test } from "bun:test";
import {
  sessionNeedsTabTitleFallback,
  summarizeTabTitle,
} from "../src/react-app/domains/session/sidebar/agent-session-tabs";

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
});
