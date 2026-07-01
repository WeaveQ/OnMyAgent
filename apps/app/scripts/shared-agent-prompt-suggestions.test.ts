import { describe, expect, test } from "bun:test";

import {
  AgentPromptSuggestions,
  type PromptSuggestion,
} from "../src/react-app/domains/shared/agent-prompt-suggestions";

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
});
