import { describe, expect, test } from "bun:test";

import { createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-default-registry";
import {
  isAgentTemplateVisible,
  isAgentTemplateWizardVisible,
} from "../src/react-app/domains/agents/agents-page-model";
import {
  EXPERT_CREATION_COACH_AGENT_ID,
  isBuiltinAgentRecord,
  parseUserAgentRegistry,
  serializeUserAgentRegistry,
} from "../src/react-app/domains/agents/agent-registry";

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

  test("seeds the expert-creation coach as a non-deletable builtin agent", () => {
    const registry = createDefaultAgentRegistry();
    const coach = registry.agents.find((agent) => agent.id === EXPERT_CREATION_COACH_AGENT_ID);
    expect(coach).toBeDefined();
    expect(coach?.builtin).toBe(true);
    expect(isBuiltinAgentRecord(coach!)).toBe(true);
    expect(coach?.enabledToolIds).toEqual([]);
    expect(coach?.userNote.trim().length).toBeGreaterThan(0);
  });

  test("re-seeds builtin coach when loading a user registry without it", () => {
    const registry = createDefaultAgentRegistry();
    const userFile = {
      version: 1,
      updatedAt: registry.updatedAt,
      agents: [
        {
          id: "agent-user-1",
          name: "User Expert",
          description: "mine",
          quote: "hi",
          tone: "professional",
          avatarStyle: "pixel",
          avatarOptionId: "pixel-tech",
          customAvatarDataUrl: null,
          modelProvider: "auto",
          model: "Auto",
          enabledToolIds: ["web"],
          defaultWorkspace: "",
          skillIds: [],
          preferredName: "",
          preferredLanguage: "中文",
          userNote: "",
          userBackground: "",
          sourceTemplateId: null,
          createdAt: registry.updatedAt,
          updatedAt: registry.updatedAt,
        },
      ],
      templates: registry.templates,
    };

    const parsed = parseUserAgentRegistry(JSON.stringify(userFile));
    expect(parsed.agents.some((agent) => agent.id === EXPERT_CREATION_COACH_AGENT_ID)).toBe(true);
    expect(parsed.agents.some((agent) => agent.id === "agent-user-1")).toBe(true);

    const serialized = JSON.parse(serializeUserAgentRegistry(parsed)) as {
      agents: Array<{ id: string }>;
    };
    expect(serialized.agents.some((agent) => agent.id === EXPERT_CREATION_COACH_AGENT_ID)).toBe(
      false,
    );
    expect(serialized.agents.some((agent) => agent.id === "agent-user-1")).toBe(true);
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
