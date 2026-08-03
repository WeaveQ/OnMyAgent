import { describe, expect, test } from "bun:test";

import type { AgentWizardDraft } from "../src/react-app/domains/agents/agent-registry-types";
import {
  expertDraftSuggestionFingerprint,
  expertDraftSuggestionNeedsSync,
  mergeExpertDraftSuggestion,
  parseExpertDraftSuggestion,
  partitionExpertDraftSuggestion,
} from "../src/react-app/domains/agents/expert-creation-suggestions";

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
      userNote: "角色",
      agentMemory: "记忆",
    });
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
    expect(expertDraftSuggestionNeedsSync(partition)).toBe(true);
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
