import { describe, expect, test } from "bun:test";

import {
  applyExpertCoachProposal,
  buildExpertCoachSystemPrompt,
  EXPERT_COACH_OUTPUT_FORMAT,
  parseExpertCoachTurnResult,
} from "../src/react-app/domains/agents/expert-creation-coach-model";
import { createBlankWizardDraft, createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-registry";

const completeRolePrompt = [
  "## Expert overview\nServes product teams with research conclusions.",
  "## Core capabilities\nBreaks down problems and compares evidence.",
  "## Key rules\nConfirm goals and constraints first.",
  "## Prohibited behavior\nDo not invent facts or make unauthorized promises.",
  "## Workflow\nClarify, analyze, verify, and deliver.",
  "## Deliverable structure\nConclusion, evidence, risks, and next steps.",
  "## Communication style\nBe concise and lead with the conclusion.",
].join("\n\n");

describe("expert creation coach model", () => {
  test("uses strict native structured output", () => {
    expect(EXPERT_COACH_OUTPUT_FORMAT.type).toBe("json_schema");
    expect(EXPERT_COACH_OUTPUT_FORMAT.schema.additionalProperties).toBe(false);
    expect(EXPERT_COACH_OUTPUT_FORMAT.schema.required).toEqual(["reply", "proposal"]);
  });

  test("accepts clarification turns and complete proposals", () => {
    expect(parseExpertCoachTurnResult({ reply: "Who will use it?", proposal: null })).toEqual({
      reply: "Who will use it?",
      proposal: null,
    });
    expect(parseExpertCoachTurnResult({
      reply: "I prepared a version.",
      proposal: {
        name: "Decision partner",
        description: "Compares options and explains tradeoffs.",
        rolePrompt: completeRolePrompt,
        memory: "Remember the user's risk tolerance.",
        skillIds: ["research"],
      },
    })?.proposal?.name).toBe("Decision partner");
  });

  test("rejects a proposal with an incomplete role prompt", () => {
    expect(parseExpertCoachTurnResult({
      reply: "I need one more detail.",
      proposal: {
        name: "Decision partner",
        description: "Compares options.",
        rolePrompt: "## Expert overview\nOnly one section.",
        memory: "Remember constraints.",
        skillIds: [],
      },
    })).toBeNull();
  });

  test("rejects malformed structured output", () => {
    expect(parseExpertCoachTurnResult({ reply: "Ready", proposal: {} })).toBeNull();
    expect(parseExpertCoachTurnResult({ reply: 1, proposal: null })).toBeNull();
    expect(parseExpertCoachTurnResult(null)).toBeNull();
  });

  test("applies only supported fields and available skill ids", () => {
    const registry = createDefaultAgentRegistry();
    const enabledSkill = {
      id: "research",
      category: "installed",
      group: "",
      name: "Research",
      description: "Find and compare evidence.",
      enabled: true,
    };
    const draft = createBlankWizardDraft(registry, [enabledSkill]);
    const next = applyExpertCoachProposal(draft, {
      name: "Planning expert",
      description: "Turns goals into plans.",
      rolePrompt: "Clarify the desired outcome first.",
      memory: "Remember agreed constraints.",
      skillIds: [enabledSkill.id, "missing-skill"],
    }, [enabledSkill]);

    expect(next.name).toBe("Planning expert");
    expect(next.userNote).toContain("desired outcome");
    expect(next.agentMemory).toContain("constraints");
    expect(next.skillIds).toEqual([enabledSkill.id]);
    expect(next.model).toBe(draft.model);
    expect(next.customAvatarDataUrl).toBe(draft.customAvatarDataUrl);
  });

  test("includes the current form and available skills in every turn", () => {
    const registry = createDefaultAgentRegistry();
    const draft = {
      ...createBlankWizardDraft(registry, registry.skills),
      name: "Current name",
      userNote: "Current role",
    };
    const prompt = buildExpertCoachSystemPrompt(draft, registry.skills);

    expect(prompt).toContain("Current name");
    expect(prompt).toContain("Current role");
    expect(prompt).toContain("Available skills");
    expect(prompt).toContain("explicitly apply");
    expect(prompt).toContain("seven non-empty level-two Markdown sections");
    expect(prompt).toContain("skill IDs");
  });
});
