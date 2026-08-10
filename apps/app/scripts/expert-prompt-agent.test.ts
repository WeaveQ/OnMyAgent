import { describe, expect, test } from "bun:test";

import {
  EXPERT_PROMPT_DEFAULT_AGENT,
  parseSkillNamesFromAgentMarkdown,
  resolveExpertPromptAgent,
} from "../src/react-app/capabilities/session-identity/expert-prompt-agent";

describe("resolveExpertPromptAgent", () => {
  test("defaults to onmyagent when selection is empty", () => {
    expect(resolveExpertPromptAgent(null)).toBe(EXPERT_PROMPT_DEFAULT_AGENT);
    expect(resolveExpertPromptAgent(undefined)).toBe(EXPERT_PROMPT_DEFAULT_AGENT);
    expect(resolveExpertPromptAgent("  ")).toBe(EXPERT_PROMPT_DEFAULT_AGENT);
  });

  test("blocks heavy orchestrator agents from home oh-my-openagent", () => {
    expect(resolveExpertPromptAgent("Sisyphus - ultraworker")).toBe(
      EXPERT_PROMPT_DEFAULT_AGENT,
    );
    expect(resolveExpertPromptAgent("sisyphus")).toBe(EXPERT_PROMPT_DEFAULT_AGENT);
    expect(resolveExpertPromptAgent("Oh-My-OpenAgent")).toBe(
      EXPERT_PROMPT_DEFAULT_AGENT,
    );
  });

  test("keeps a safe explicit agent selection", () => {
    expect(resolveExpertPromptAgent("onmyagent")).toBe("onmyagent");
    expect(resolveExpertPromptAgent("build")).toBe("build");
  });
});

describe("parseSkillNamesFromAgentMarkdown", () => {
  test("parses bracket skills from frontmatter", () => {
    const md = `---
name: kol-content-ops-specialist
skills: [kol-script-risk-review, kol-reputation-monitor, document-processing]
---
# body
`;
    expect(parseSkillNamesFromAgentMarkdown(md)).toEqual([
      "kol-script-risk-review",
      "kol-reputation-monitor",
      "document-processing",
    ]);
  });

  test("parses YAML list skills and drops unsafe names", () => {
    const md = `---
skills:
  - kol-brief-structuring
  - ../escape
  - ok-skill
---
`;
    expect(parseSkillNamesFromAgentMarkdown(md)).toEqual([
      "kol-brief-structuring",
      "ok-skill",
    ]);
  });
});
