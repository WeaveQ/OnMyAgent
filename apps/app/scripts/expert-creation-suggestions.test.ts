import { describe, expect, test } from "bun:test";

import { parseExpertDraftSuggestion } from "../src/react-app/domains/agents/expert-creation-suggestions";

describe("expert creation coach suggestions", () => {
  test("extracts a proposed expert name without exposing the machine block", () => {
    const parsed = parseExpertDraftSuggestion(
      '这个名字更清楚，请确认是否应用。\n<expert-update>{"name":"物流报价专家"}</expert-update>',
    );

    expect(parsed.content).toBe("这个名字更清楚，请确认是否应用。");
    expect(parsed.suggestion).toEqual({ name: "物流报价专家" });
  });

  test("hides an incomplete streaming update until it is complete", () => {
    const parsed = parseExpertDraftSuggestion(
      '我建议这样填写。\n<expert-update>{"description":"负责整理报价',
    );

    expect(parsed.content).toBe("我建议这样填写。");
    expect(parsed.suggestion).toBeNull();
  });
});
