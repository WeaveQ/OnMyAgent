import { describe, expect, test } from "bun:test";

import {
  buildExpertCreationCoachWorkflowInstructions,
  validateExpertCreationRolePrompt,
} from "../src/react-app/domains/agents/expert-creation-coach-contract";

describe("expert creation coach quality contract", () => {
  test("accepts seven non-empty level-two sections with either heading spacing", () => {
    const prompt = [
      "##专家简介\n面向产品团队交付研究结论。",
      "## 核心能力\n拆解问题并比较证据。",
      "##关键规则\n先确认目标和约束。",
      "## 禁止行为\n不编造事实，不越权承诺。",
      "##工作流程\n澄清、分析、验证、交付。",
      "## 内容结构\n结论、依据、风险、下一步。",
      "##沟通风格\n简洁直接，先给结论。",
    ].join("\n\n");

    expect(validateExpertCreationRolePrompt(prompt)).toEqual({
      valid: true,
      missingSectionCount: 0,
    });
  });

  test("rejects missing, empty, and placeholder sections", () => {
    expect(validateExpertCreationRolePrompt("## 专家简介\n只有一节").valid).toBe(false);
    expect(validateExpertCreationRolePrompt(
      ["## 专家简介\n", "## 核心能力\n能力"].join("\n"),
    ).valid).toBe(false);
    expect(validateExpertCreationRolePrompt(
      Array.from({ length: 7 }, (_, index) => `## 第${index}\n[TODO]`).join("\n"),
    ).valid).toBe(false);
  });

  test("workflow instructions require clarification before a complete proposal", () => {
    const instructions = buildExpertCreationCoachWorkflowInstructions();
    expect(instructions).toContain("one focused question");
    expect(instructions).toContain("seven");
    expect(instructions).toContain("skill IDs");
  });
});
