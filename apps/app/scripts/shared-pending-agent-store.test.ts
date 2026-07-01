import { describe, expect, test } from "bun:test";

import {
  buildAgentSystemPrompt,
  buildAgentToolAccess,
  usePendingAgentStore,
} from "../src/react-app/domains/shared/pending-agent-store";

describe("shared pending agent store contract", () => {
  test("builds first-message system prompts from persona fields", () => {
    const prompt = buildAgentSystemPrompt({
      name: "研究员",
      quote: "帮用户拆解复杂问题",
      tone: "专业",
      preferredName: "Lee",
      preferredLanguage: "中文",
      userBackground: "AI agent builder",
      userNote: "先给结论",
      agentMemory: "记住产品名 OnMyAgent",
      userMemory: "用户偏好短句",
      enabledToolIds: ["filesystem", "code"],
    });

    expect(prompt).toContain("你现在的身份是：研究员");
    expect(prompt).toContain("你的核心定位：帮用户拆解复杂问题");
    expect(prompt).toContain("称呼用户为：Lee");
    expect(prompt).toContain("【智能体记忆】");
    expect(prompt).toContain("【用户记忆】");
    expect(prompt).toContain("可用工具类别：filesystem、code");
    expect(prompt).toContain("回复语言：中文");
  });

  test("builds tool deny maps from enabled categories and skill access", () => {
    const toolAccess = buildAgentToolAccess({ enabledToolIds: ["code"], skillIds: [] });

    expect(toolAccess).toMatchObject({
      list: false,
      read: false,
      skill: false,
    });
    expect(toolAccess?.bash).toBeUndefined();
    expect(buildAgentToolAccess({ enabledToolIds: ["filesystem", "web", "code", "utility", "memory", "collaboration"] })).toBeUndefined();
    expect(buildAgentToolAccess({})).toBeUndefined();
  });

  test("keeps pending agent snapshot shared across route and surface consumers", () => {
    usePendingAgentStore.getState().setAgent(null);

    usePendingAgentStore.getState().setAgent({
      id: "agent-1",
      name: "研究员",
      description: "Research helper",
      avatar: {
        avatarStyle: "机器人",
        avatarOptionId: "generated:机器人:0:1",
        customAvatarDataUrl: null,
        avatarUrl: "data:image/svg+xml;base64,abc",
        avatarBackground: "#eef2ff",
      },
      systemPrompt: "hello",
      model: { providerID: "openai", modelID: "gpt-4.1" },
      conversationStartId: 42,
      boundSessionId: "ses-1",
    });

    expect(usePendingAgentStore.getState().getAgent()).toMatchObject({
      id: "agent-1",
      boundSessionId: "ses-1",
      model: { providerID: "openai", modelID: "gpt-4.1" },
    });
  });
});
