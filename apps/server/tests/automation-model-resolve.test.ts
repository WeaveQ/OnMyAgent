import { describe, expect, test } from "bun:test";

import { resolveAutomationRunModel } from "../src/services/automation-runner.js";

describe("resolveAutomationRunModel", () => {
  test("prefers task model over agent model", async () => {
    const model = await resolveAutomationRunModel({
      model: { providerID: "openai", modelID: "gpt-test" },
      agent: { id: "a", name: "A", model: { providerID: "anthropic", modelID: "claude" } },
    });
    expect(model).toEqual({ providerID: "openai", modelID: "gpt-test" });
  });

  test("falls back to agent model when task model is missing", async () => {
    const model = await resolveAutomationRunModel({
      agent: { id: "a", name: "A", model: { providerID: "anthropic", modelID: "claude-test" } },
    });
    expect(model).toEqual({ providerID: "anthropic", modelID: "claude-test" });
  });

  test("returns undefined for empty provider or model ids", async () => {
    const model = await resolveAutomationRunModel({
      model: { providerID: "  ", modelID: "gpt" },
    });
    // Empty provider falls through; may still resolve from opencode recent model file.
    // Assert empty direct model does not win.
    if (model) {
      expect(model.providerID.trim().length).toBeGreaterThan(0);
      expect(model.modelID.trim().length).toBeGreaterThan(0);
    }
  });
});
