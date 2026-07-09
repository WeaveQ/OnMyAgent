import { describe, expect, test } from "bun:test";

import {
  extractPlanDetailSections,
  extractPlanSteps,
  inferPlanStepsFromPrompt,
  planTextFromMessages,
  resolvePlanStepItems,
} from "../src/react-app/domains/session/surface/plan-goal/plan-parse";
import type { UIMessage } from "ai";

describe("plan-parse", () => {
  test("planTextFromMessages joins assistant text", () => {
    const messages = [
      { id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "OnMyAgent step one" }] },
      { id: "3", role: "assistant", parts: [{ type: "text", text: "step two" }] },
    ] as UIMessage[];
    const text = planTextFromMessages(messages);
    expect(text).toContain("step one");
    expect(text).toContain("step two");
    // Prefix strip is best-effort via /^OnMyAgent\s*/i on readable text.
    expect(text.split("\n\n").length).toBe(2);
  });

  test("extractPlanSteps reads numbered/bullet step section", () => {
    const plan = [
      "## 执行步骤",
      "1. 确认目标文件路径和写入内容",
      "2. 创建或更新文件并写入指定内容",
      "3. 验证文件已生成且内容符合要求",
      "## 风险",
      "- 可能覆盖同名文件",
    ].join("\n");
    const steps = extractPlanSteps(plan);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0]?.status).toBe("pending");
  });

  test("extractPlanDetailSections picks risk/validation/reversibility", () => {
    const plan = [
      "风险：可能覆盖同名文件",
      "验证：读取文件确认内容",
      "可逆性：可删除新建文件",
    ].join("\n");
    const sections = extractPlanDetailSections(plan);
    const kinds = sections.map((s) => s.kind);
    expect(kinds.length).toBeGreaterThan(0);
  });

  test("inferPlanStepsFromPrompt returns file-oriented steps", () => {
    const steps = inferPlanStepsFromPrompt("请创建 notes.md 文件");
    expect(steps.length).toBe(3);
  });

  test("resolvePlanStepItems prefers todos over plan text", () => {
    const items = resolvePlanStepItems({
      planText: "1. ignore me",
      originalPrompt: "do something",
      runtimeStatus: "awaiting_approval",
      todos: [
        { id: "t1", content: "todo A", status: "in_progress", priority: "medium" },
        { id: "t2", content: "todo B", status: "pending", priority: "medium" },
      ],
    });
    expect(items).toHaveLength(2);
    expect(items[0]?.status).toBe("active");
    expect(items[0]?.content).toBe("todo A");
  });
});
