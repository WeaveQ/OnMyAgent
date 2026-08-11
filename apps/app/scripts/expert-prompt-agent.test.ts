import { describe, expect, test } from "bun:test";

import {
  EXPERT_PROMPT_DEFAULT_AGENT,
  filterExpertPromptAgentOptions,
  normalizeExpertPromptAgentSelection,
  previewExpertPromptAgent,
} from "../src/react-app/capabilities/session-identity/expert-prompt-agent";

const agent = (name: string) => ({ name, hidden: false, mode: "primary" });

describe("Expert prompt preview/filter helpers", () => {
  test("custom Expert with an empty allowlist exposes only onmyagent", () => {
    expect(
      filterExpertPromptAgentOptions(
        [agent("onmyagent"), agent("custom-agent"), agent("sisyphus")],
        [],
      ).map((item) => item.name),
    ).toEqual(["onmyagent"]);
    expect(previewExpertPromptAgent("custom-agent", [])).toBe(
      EXPERT_PROMPT_DEFAULT_AGENT,
    );
  });

  test("marketplace allowlist keeps exact approved ids and the default", () => {
    expect(
      filterExpertPromptAgentOptions(
        [agent("onmyagent"), agent("package-agent"), agent("sisyphus")],
        [" package-agent "],
      ).map((item) => item.name),
    ).toEqual(["onmyagent", "package-agent"]);
    expect(previewExpertPromptAgent("package-agent", ["package-agent"])).toBe(
      "package-agent",
    );
  });

  test("stale selections normalize to null and preview as the default", () => {
    expect(normalizeExpertPromptAgentSelection("stale-agent", [])).toBeNull();
    expect(previewExpertPromptAgent("stale-agent", [])).toBe("onmyagent");
    expect(normalizeExpertPromptAgentSelection("  ", ["package-agent"])).toBeNull();
  });

  test("ordinary assistant lists are unchanged when Expert filtering is skipped", () => {
    const ordinary = [agent("onmyagent"), agent("sisyphus"), agent("build")];
    expect(ordinary.filter((item) => !item.hidden && item.mode !== "subagent")).toEqual(
      ordinary,
    );
  });
});
