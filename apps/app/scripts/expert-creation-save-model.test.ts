import { describe, expect, test } from "bun:test";

import { createBlankWizardDraft, createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-registry";
import {
  buildSavedExpertPendingContext,
  createExpertRecordForSave,
} from "../src/react-app/domains/agents/expert-creation-save-model";

describe("expert creation save model", () => {
  test("preserves a newly imported skill from the page inventory", () => {
    const registry = createDefaultAgentRegistry();
    const importedSkill = {
      id: "local-research",
      category: "installed",
      group: "",
      name: "local-research",
      description: "Research local files.",
      enabled: true,
    };
    const draft = {
      ...createBlankWizardDraft(registry, registry.skills),
      name: "Research expert",
      skillIds: [importedSkill.id],
    };

    const record = createExpertRecordForSave(draft, "2026-08-02T00:00:00.000Z", [
      ...registry.skills,
      importedSkill,
    ]);

    expect(record.skillIds).toEqual([importedSkill.id]);
  });

  test("builds the summon context from the exact saved expert record", () => {
    const registry = createDefaultAgentRegistry();
    const draft = {
      ...createBlankWizardDraft(registry, registry.skills),
      name: "Research expert",
      description: "Works from evidence.",
      userNote: "Cite the source.",
    };
    const agent = createExpertRecordForSave(
      draft,
      "2026-08-03T00:00:00.000Z",
      registry.skills,
    );
    const nextRegistry = { ...registry, agents: [agent, ...registry.agents] };

    const pending = buildSavedExpertPendingContext(agent, nextRegistry, 1234);

    expect(pending).toMatchObject({
      id: agent.id,
      name: "Research expert",
      description: "Works from evidence.",
      conversationStartId: 1234,
      draftSource: "agent-selection",
    });
    expect(pending?.systemPrompt).toContain("Cite the source.");
    expect(pending?.boundSessionId).toBeUndefined();
  });
});
