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
    expect(source).toContain('prompt: t("session.expert_self_intro_prompt")');

    const localeRoot = join(import.meta.dir, "../src/i18n/locales");
    expect(readFileSync(join(localeRoot, "zh/session.ts"), "utf8")).toContain(
      '"session.expert_self_intro_prompt_title": "了解你的能力"',
    );
    expect(readFileSync(join(localeRoot, "zh-TW/session.ts"), "utf8")).toContain(
      '"session.expert_self_intro_prompt_title": "瞭解你的能力"',
    );
    expect(readFileSync(join(localeRoot, "en/session.ts"), "utf8")).toContain(
      '"session.expert_self_intro_prompt_title": "Explore your capabilities"',
    );
  });
});
