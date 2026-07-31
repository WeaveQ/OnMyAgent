import { describe, expect, test } from "bun:test";
import {
  latestAssistantText,
  latestUserTextBeforeAssistant,
  parseFollowUpMarkers,
  resolveFollowUpSuggestions,
  stripFollowUpMarkers,
} from "../src/react-app/domains/session/surface/follow-up-suggestions";

describe("follow-up suggestions", () => {
  test("parses and strips fence markers", () => {
    const text = [
      "这票信息基本齐了。",
      "",
      ":::followups",
      "检查还缺什么",
      "帮我算怎么报价",
      ":::",
    ].join("\n");
    expect(parseFollowUpMarkers(text)).toEqual([
      "检查还缺什么",
      "帮我算怎么报价",
    ]);
    expect(stripFollowUpMarkers(text)).toBe("这票信息基本齐了。");
  });

  test("parses html comment markers", () => {
    const text = "结论如下。\n<!-- followups\n- 导出成 Excel\n- 再核对订单\n-->";
    expect(parseFollowUpMarkers(text)).toEqual([
      "导出成 Excel",
      "再核对订单",
    ]);
    expect(stripFollowUpMarkers(text)).toContain("结论如下。");
    expect(stripFollowUpMarkers(text)).not.toContain("followups");
  });

  test("prefers markers over heuristics", () => {
    const text = [
      "报价毛利偏低。",
      ":::followups",
      "上调建议客户价",
      ":::",
    ].join("\n");
    expect(
      resolveFollowUpSuggestions({
        lastAssistantText: text,
        agentId: "order-dispatch-specialist",
      }),
    ).toEqual(["上调建议客户价"]);
  });

  test("awaiting materials does not pretend work is done", () => {
    const assistant =
      "行，整理发货信息我来。你把手头的资料直接丢过来就行——微信聊天截图、Excel、PDF 都行。" +
      "如果资料不全，我会标出还缺什么，并写好一段可以直接发给客户的补问话。发吧，我先读内容再动手。";
    const suggestions = resolveFollowUpSuggestions({
      lastAssistantText: assistant,
      lastUserText: "帮我整理发货信息",
      agentId: "order-dispatch-specialist",
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((item) => item.includes("补问话术"))).toBe(false);
    expect(suggestions.some((item) => item.includes("根据这份表"))).toBe(false);
    expect(
      suggestions.some(
        (item) =>
          item.includes("聊天") ||
          item.includes("Excel") ||
          item.includes("资料") ||
          item.includes("截图") ||
          item.includes("模板"),
      ),
    ).toBe(true);
  });

  test("after real structure result suggests audit or quote", () => {
    const suggestions = resolveFollowUpSuggestions({
      lastAssistantText:
        "已整理成标准发货信息表，一票一行。发货人上海 A，收货人苏州 B。",
      lastUserText: "帮我整理",
      agentId: "builtin:order-dispatch-specialist",
    });
    expect(suggestions.some((item) => item.includes("缺") || item.includes("报价"))).toBe(
      true,
    );
  });

  test("reads latest assistant and preceding user text", () => {
    const messages = [
      { role: "user", parts: [{ type: "text", text: "你好" }] },
      { role: "assistant", parts: [{ type: "text", text: "先整理这票。" }] },
      { role: "user", parts: [{ type: "text", text: "帮我整理发货信息" }] },
      {
        role: "assistant",
        parts: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "资料丢过来就行。" },
        ],
      },
    ];
    expect(latestAssistantText(messages)).toBe("资料丢过来就行。");
    expect(latestUserTextBeforeAssistant(messages)).toBe("帮我整理发货信息");
  });
});
