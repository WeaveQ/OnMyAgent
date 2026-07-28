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

  test("builds expert empty state as capability intro plus three quick prompts", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/agents/agent-prompt-suggestions.tsx",
      ),
      "utf8",
    );
    expect(source).toContain(".slice(0, 3)");
    expect(source).toContain('title: t("session.expert_self_intro_prompt_title")');
    expect(source).toContain('"order-dispatch-specialist"');
    expect(source).toContain('"fleet-management-specialist"');
    expect(source).toContain('"logistics-finance-specialist"');
    expect(source).toContain('"session.expert_self_intro_capability_map_description"');
    expect(source).toContain('"session.expert_self_intro_capability_map_prompt"');

    const localeRoot = join(import.meta.dir, "../src/i18n/locales");
    const zh = readFileSync(join(localeRoot, "zh/session.ts"), "utf8");
    const zhTw = readFileSync(join(localeRoot, "zh-TW/session.ts"), "utf8");
    const en = readFileSync(join(localeRoot, "en/session.ts"), "utf8");
    expect(zh).toContain(
      '"session.expert_self_intro_prompt_title": "了解你的能力"',
    );
    expect(zh).toContain('"session.expert_self_intro_capability_map_description":');
    expect(zh).toContain("HTML 能力图谱");
    expect(zhTw).toContain(
      '"session.expert_self_intro_prompt_title": "瞭解你的能力"',
    );
    expect(zhTw).toContain('"session.expert_self_intro_capability_map_description":');
    expect(zhTw).toContain("HTML 能力圖譜");
    expect(en).toContain(
      '"session.expert_self_intro_prompt_title": "Explore your capabilities"',
    );
    expect(en).toContain('"session.expert_self_intro_capability_map_description":');
    expect(en).toContain("HTML capability map");
  });
});
