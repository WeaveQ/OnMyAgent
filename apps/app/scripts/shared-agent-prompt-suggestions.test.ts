import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AgentPromptSuggestions,
  type PromptSuggestion,
} from "../src/react-app/domains/agents/agent-prompt-suggestions";

const suggestion = {
  title: "Test",
  description: "Description",
  prompt: "Prompt",
  icon: () => null,
} satisfies PromptSuggestion;

describe("shared agent prompt suggestions contract", () => {
  test("exports the reusable prompt suggestion component for session surfaces", () => {
    expect(typeof AgentPromptSuggestions).toBe("function");
  });

  test("keeps prompt suggestion records simple and serializable except icon", () => {
    expect({ ...suggestion, icon: "component" }).toEqual({
      title: "Test",
      description: "Description",
      prompt: "Prompt",
      icon: "component",
    });
  });

  test("builds expert empty state as a plain-text capability intro plus quick prompts", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/agents/agent-prompt-suggestions.tsx",
      ),
      "utf8",
    );
    expect(source).toContain(".slice(0, 3)");
    expect(source).toContain("promptTemplates");
    expect(source).toContain("template: true");
    expect(source).toContain('title: t("session.expert_self_intro_prompt_title")');
    expect(source).toContain(
      'description: t("session.expert_self_intro_prompt_description")',
    );
    expect(source).toContain('"session.expert_self_intro_prompt"');
    expect(source).toContain("LOGISTICS_COLLEAGUE_INTRO_EXPERT_IDS");
    expect(source).toContain('agentId.endsWith(`:${expertId}`)');
    expect(source).toContain(
      '"session.logistics_expert_self_intro_prompt"',
    );
    expect(source).not.toContain("CAPABILITY_MAP_EXPERT_IDS");
    expect(source).not.toContain("expert_self_intro_capability_map");

    const localeRoot = join(import.meta.dir, "../src/i18n/locales");
    const zh = readFileSync(join(localeRoot, "zh/session.ts"), "utf8");
    const zhTw = readFileSync(join(localeRoot, "zh-TW/session.ts"), "utf8");
    const en = readFileSync(join(localeRoot, "en/session.ts"), "utf8");
    expect(zh).toContain(
      '"session.expert_self_intro_prompt_title": "了解我的能力"',
    );
    expect(zh).toContain("介绍能力、适用场景和使用方法");
    expect(zh).toContain("具备什么能力、适合哪些业务场景");
    expect(zh).toContain(
      '"session.logistics_expert_self_intro_prompt": "介绍一下你自己，你能帮我做什么？"',
    );
    expect(zh).not.toContain("像物流部新同事第一次见面一样");
    expect(zh).not.toContain("不要生成表格");
    expect(zhTw).toContain(
      '"session.expert_self_intro_prompt_title": "瞭解我的能力"',
    );
    expect(zhTw).toContain("介紹能力、適用場景和使用方法");
    expect(zhTw).toContain("具備什麼能力、適合哪些業務場景");
    expect(zhTw).toContain(
      '"session.logistics_expert_self_intro_prompt": "介紹一下你自己，你能幫我做什麼？"',
    );
    expect(zhTw).not.toContain("像物流部新同事第一次見面一樣");
    expect(zhTw).not.toContain("不要生成表格");
    expect(en).toContain(
      '"session.expert_self_intro_prompt_title": "Explore my capabilities"',
    );
    expect(en).toContain("Capabilities, use cases, and how to get started");
    expect(en).toContain("what you can do, when to use each capability");
    expect(en).toContain(
      '"session.logistics_expert_self_intro_prompt": "Introduce yourself — what can you help me with?"',
    );
    expect(en).not.toContain("like a new teammate in the logistics department");
    expect(en).not.toContain("Do not generate tables");
  });
});
