import { describe, expect, test } from "bun:test";

import { createBlankWizardDraft, createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-registry";
import { EMPTY_EXPERT_COACH_STATE } from "../src/react-app/domains/agents/expert-creation-draft-storage";
import {
  buildExpertPreviewDraftKey,
  hasExpertCreationProgress,
} from "../src/react-app/domains/agents/expert-creation-lifecycle";

describe("expert creation lifecycle", () => {
  const registry = createDefaultAgentRegistry();
  const baseline = createBlankWizardDraft(registry, registry.skills);

  test("treats an untouched draft as safe to close", () => {
    expect(hasExpertCreationProgress(baseline, baseline, EMPTY_EXPERT_COACH_STATE, 0)).toBe(false);
  });

  test("detects form, coach, skill, and knowledge progress", () => {
    expect(hasExpertCreationProgress({ ...baseline, name: "Researcher" }, baseline, EMPTY_EXPERT_COACH_STATE, 0)).toBe(true);
    expect(hasExpertCreationProgress({ ...baseline, skillIds: ["research"] }, baseline, EMPTY_EXPERT_COACH_STATE, 0)).toBe(true);
    expect(hasExpertCreationProgress(baseline, baseline, {
      ...EMPTY_EXPERT_COACH_STATE,
      messages: [{ id: "message", role: "user", content: "Help me" }],
    }, 0)).toBe(true);
    expect(hasExpertCreationProgress(baseline, baseline, EMPTY_EXPERT_COACH_STATE, 1)).toBe(true);
  });

  test("tracks behavior changes for preview sessions without depending on skill order", () => {
    const first = { ...baseline, name: "Researcher", skillIds: ["writing", "research"] };
    const sameBehavior = { ...first, skillIds: ["research", "writing"] };
    const changed = { ...first, agentMemory: "Remember the audience." };

    expect(buildExpertPreviewDraftKey(first)).toBe(buildExpertPreviewDraftKey(sameBehavior));
    expect(buildExpertPreviewDraftKey(first)).not.toBe(buildExpertPreviewDraftKey(changed));
  });
});
