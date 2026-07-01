import { describe, expect, test } from "bun:test";

import { createDefaultAgentRegistry } from "../src/react-app/domains/shared/agent-default-registry";
import {
  isAgentTemplateVisible,
  isAgentTemplateWizardVisible,
} from "../src/react-app/domains/agents/agents-page-model";
import { parseUserAgentRegistry } from "../src/react-app/domains/agents/agent-registry";

describe("shared default agent registry", () => {
  test("provides independent default registry snapshots", () => {
    const first = createDefaultAgentRegistry();
    const second = createDefaultAgentRegistry();

    expect(first).not.toBe(second);
    expect(first.version).toBe(1);
    expect(first.avatars.length).toBeGreaterThan(0);
    expect(first.templates.some((template) => template.id === "blank-agent")).toBe(true);
    expect(first.skills.length).toBeGreaterThan(0);

    first.templates[0]!.name = "changed";

    expect(second.templates[0]?.name).not.toBe("changed");
  });

  test("keeps only the daily assistant visible in the default expert list", () => {
    const registry = createDefaultAgentRegistry();
    const overviewTemplateIds = registry.templates
      .filter(isAgentTemplateVisible)
      .map((template) => template.id);
    const wizardTemplateIds = registry.templates
      .filter(isAgentTemplateWizardVisible)
      .map((template) => template.id);

    expect(overviewTemplateIds).toEqual(["daily-assistant"]);
    expect(wizardTemplateIds).toContain("blank-agent");
    expect(wizardTemplateIds).toContain("shopify-operator");
    expect(wizardTemplateIds).toContain("daily-assistant");
  });

  test("normalizes bundled template visibility when reading older user registries", () => {
    const registry = createDefaultAgentRegistry();
    const legacyRegistry = {
      version: 1,
      updatedAt: registry.updatedAt,
      agents: [],
      templates: registry.templates.map((template) => ({
        ...template,
        showInOverview: template.id !== "blank-agent",
        showInWizard: true,
      })),
    };

    const parsed = parseUserAgentRegistry(JSON.stringify(legacyRegistry));

    expect(
      parsed.templates
        .filter(isAgentTemplateVisible)
        .map((template) => template.id),
    ).toEqual(["daily-assistant"]);
  });
});
