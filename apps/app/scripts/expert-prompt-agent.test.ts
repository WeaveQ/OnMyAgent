import { describe, expect, test } from "bun:test";

import {
  EXPERT_PROMPT_DEFAULT_AGENT,
  EXPERT_RUNTIME_CONTRACT_ERROR_CODE,
  resolveExpertPromptAgent,
} from "../src/react-app/capabilities/session-identity/expert-prompt-agent";

describe("resolveExpertPromptAgent", () => {
  test("defaults to onmyagent when selection is empty", () => {
    expect(resolveExpertPromptAgent(null)).toBe(EXPERT_PROMPT_DEFAULT_AGENT);
    expect(resolveExpertPromptAgent(undefined)).toBe(EXPERT_PROMPT_DEFAULT_AGENT);
    expect(resolveExpertPromptAgent("  ")).toBe(EXPERT_PROMPT_DEFAULT_AGENT);
  });

  test("fails closed for every undeclared agent", () => {
    for (const agentId of ["Sisyphus - ultraworker", "sisyphus", "build"]) {
      expect(() => resolveExpertPromptAgent(agentId)).toThrow(
        EXPERT_RUNTIME_CONTRACT_ERROR_CODE,
      );
    }
  });

  test("keeps the default and exact package-approved selections", () => {
    expect(resolveExpertPromptAgent("onmyagent")).toBe("onmyagent");
    expect(resolveExpertPromptAgent("package-agent", ["package-agent"])).toBe(
      "package-agent",
    );
    expect(() =>
      resolveExpertPromptAgent("package-agent", ["pkg:package-agent"]),
    ).toThrow(EXPERT_RUNTIME_CONTRACT_ERROR_CODE);
  });
});
