import { describe, expect, test } from "bun:test";

import {
  EMPTY_EXPERT_COACH_STATE,
  readExpertCreationStoredState,
} from "../src/react-app/domains/agents/expert-creation-draft-storage";
import { createBlankWizardDraft, createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-registry";

describe("expert creation draft storage", () => {
  test("uses the provided draft when browser storage is unavailable", () => {
    const registry = createDefaultAgentRegistry();
    const draft = createBlankWizardDraft(registry, registry.skills);
    expect(readExpertCreationStoredState("workspace", draft)).toEqual({
      draft,
      coach: EMPTY_EXPERT_COACH_STATE,
    });
  });
});
