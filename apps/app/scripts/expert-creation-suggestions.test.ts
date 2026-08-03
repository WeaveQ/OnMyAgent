import { describe, expect, test } from "bun:test";

import type { AgentWizardDraft } from "../src/react-app/domains/agents/agent-registry-types";
import {
  expertDraftSuggestionFingerprint,
  expertDraftSuggestionNeedsSync,
  mergeExpertDraftSuggestion,
  parseExpertDraftSuggestion,
  partitionExpertDraftSuggestion,
  expertDraftSuggestionPendingKeys,
} from "../src/react-app/domains/agents/expert-creation-suggestions";

const completeRolePrompt = [
  "## 专家简介\n面向产品团队交付研究结论。",
  "## 核心能力\n拆解问题并比较证据。",
  "## 关键规则\n先确认目标和约束。",
  "## 禁止行为\n不编造事实，不越权承诺。",
  "## 工作流程\n澄清、分析、验证、交付。",
  "## 内容结构\n结论、依据、风险、下一步。",
  "## 沟通风格\n简洁直接，先给结论。",
].join("\n\n");

function draftStub(overrides: Partial<AgentWizardDraft> = {}): AgentWizardDraft {
  return {
    templateId: null,
    name: "",
    description: "",
    quote: "",
    tone: "professional",
    avatarStyle: "pixel",
    avatarOptionId: "default",
    customAvatarDataUrl: null,
    modelProvider: "openai",
    model: "gpt",
    enabledToolIds: [],
    defaultWorkspace: "",
    skillIds: [],
    preferredName: "",
    preferredLanguage: "",
    userNote: "",
    userBackground: "",
    agentMemory: "",
    userMemory: "",
    ...overrides,
  };
}

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

  test("strips bare expert draft JSON that models dump into visible text", () => {
    const parsed = parseExpertDraftSuggestion(
      [
        "如果你觉得以上方向没问题，我帮你把表单字段填好：",
        '{"name":"物流报价专家","description":"整理报价","userNote":"角色","agentMemory":"记忆"}',
        "你可以看看有没有需要调整的地方。",
      ].join("\n"),
    );

    expect(parsed.content).toContain("如果你觉得以上方向没问题");
    expect(parsed.content).toContain("你可以看看有没有需要调整的地方");
    expect(parsed.content.includes('"name":"物流报价专家"')).toBe(false);
    expect(parsed.suggestion).toEqual({
      name: "物流报价专家",
      description: "整理报价",
      agentMemory: "记忆",
    });
  });

  test("does not expose an incomplete role prompt as an applicable update", () => {
    const parsed = parseExpertDraftSuggestion(
      '<expert-update>{"name":"研究专家","description":"整理证据","userNote":"## 专家简介\\n只有一节","agentMemory":"记住先确认范围"}</expert-update>',
    );

    expect(parsed.suggestion).toEqual({
      name: "研究专家",
      description: "整理证据",
      agentMemory: "记住先确认范围",
    });
  });

  test("moves a role prompt accidentally placed in memory back to the role prompt field", () => {
    const parsed = parseExpertDraftSuggestion(
      `<expert-update>${JSON.stringify({
        name: "美食制作专家",
        agentMemory: completeRolePrompt,
      })}</expert-update>`,
    );

    expect(parsed.suggestion).toEqual({
      name: "美食制作专家",
      userNote: completeRolePrompt,
    });
  });

  test("accepts the structured coach memory alias without changing its target field", () => {
    const parsed = parseExpertDraftSuggestion(
      '<expert-update>{"name":"美食制作专家","memory":"1. 项目是一个 AI 设计工具。\\n2. 目标用户是设计师。"}</expert-update>',
    );

    expect(parsed.suggestion).toEqual({
      name: "美食制作专家",
      agentMemory: "1. 项目是一个 AI 设计工具。\n2. 目标用户是设计师。",
    });
  });

  test("keeps a complete seven-section role prompt", () => {
    const parsed = parseExpertDraftSuggestion(
      `<expert-update>${JSON.stringify({ name: "研究专家", userNote: completeRolePrompt })}</expert-update>`,
    );
    expect(parsed.suggestion?.userNote).toBe(completeRolePrompt);
  });

  test("partitions empty fill vs conflicts vs matches", () => {
    const partition = partitionExpertDraftSuggestion(
      draftStub({
        name: "",
        description: "旧简介",
        userNote: "同一提示词",
        agentMemory: "旧记忆",
      }),
      {
        name: "新专家",
        description: "新简介",
        userNote: "同一提示词",
        agentMemory: "新记忆",
      },
    );

      expect(partition.emptyFillKeys).toEqual(["name"]);
      expect(partition.conflictKeys).toEqual(["description", "agentMemory"]);
      expect(partition.matchKeys).toEqual(["userNote"]);
      expect(partition.confirmationKeys).toEqual([]);
      expect(expertDraftSuggestionPendingKeys(partition)).toEqual(["description", "agentMemory"]);
      expect(expertDraftSuggestionNeedsSync(partition)).toBe(true);
  });

  test("requires confirmation before filling an empty expert memory", () => {
    const partition = partitionExpertDraftSuggestion(
      draftStub(),
      { agentMemory: "1. 我的项目是一个 AI 设计工具\n2. 我的目标用户是设计师。" },
    );

    expect(partition.emptyFillKeys).toEqual([]);
    expect(partition.confirmationKeys).toEqual(["agentMemory"]);
    expect(mergeExpertDraftSuggestion(
      draftStub(),
      { agentMemory: "1. 我的项目是一个 AI 设计工具\n2. 我的目标用户是设计师。" },
      "empty-only",
    ).draft.agentMemory).toBe("");
    expect(mergeExpertDraftSuggestion(
      draftStub(),
      { agentMemory: "1. 我的项目是一个 AI 设计工具\n2. 我的目标用户是设计师。" },
      "force",
    ).draft.agentMemory).toContain("目标用户");
  });

  test("empty-only merge fills blanks without overwriting conflicts", () => {
    const base = draftStub({
      name: "",
      description: "手改简介",
      userNote: "",
    });
    const { draft, appliedKeys } = mergeExpertDraftSuggestion(
      base,
      {
        name: "教练命名",
        description: "教练简介",
        userNote: "角色提示词",
      },
      "empty-only",
    );

    expect(appliedKeys).toEqual(["name", "userNote"]);
    expect(draft.name).toBe("教练命名");
    expect(draft.description).toBe("手改简介");
    expect(draft.userNote).toBe("角色提示词");
  });

  test("force merge overwrites conflicting fields", () => {
    const { draft, appliedKeys } = mergeExpertDraftSuggestion(
      draftStub({ name: "旧名", description: "旧简介" }),
      { name: "新名", description: "新简介" },
      "force",
    );
    expect(appliedKeys).toEqual(["name", "description"]);
    expect(draft.name).toBe("新名");
    expect(draft.description).toBe("新简介");
  });

  test("fingerprint changes when suggestion content changes", () => {
    const a = expertDraftSuggestionFingerprint("m1", { name: "A" });
    const b = expertDraftSuggestionFingerprint("m1", { name: "B" });
    const c = expertDraftSuggestionFingerprint("m2", { name: "A" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
