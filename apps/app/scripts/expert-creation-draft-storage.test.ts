import { describe, expect, test } from "bun:test";

import {
  EMPTY_EXPERT_COACH_STATE,
  readExpertCreationStoredState,
  writeExpertCreationStoredState,
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

  test("restores only the coach session explicitly written with the draft", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      },
    });
    const registry = createDefaultAgentRegistry();
    const draft = {
      ...createBlankWizardDraft(registry, registry.skills),
      name: "Retained expert",
      skillIds: ["user-selected-skill"],
    };

    writeExpertCreationStoredState("workspace", {
      draft,
      coach: { ...EMPTY_EXPERT_COACH_STATE, sessionId: "session-coach" },
    });

    expect(readExpertCreationStoredState("workspace", draft)).toEqual({
      draft,
      coach: { ...EMPTY_EXPERT_COACH_STATE, sessionId: "session-coach" },
    });
  });

  test("drops legacy restored skill ids that were not explicitly selected in the current create flow", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
      },
    });
    const registry = createDefaultAgentRegistry();
    const fallback = createBlankWizardDraft(registry, registry.skills);
    values.set(
      "onmyagent.expert-creation.v1:workspace",
      JSON.stringify({
        version: 1,
        draft: {
          ...fallback,
          name: "Legacy retained expert",
          skillIds: ["browser-automation", "documents", "douyin-content-surge"],
        },
        coach: { ...EMPTY_EXPERT_COACH_STATE, sessionId: "legacy-coach" },
      }),
    );

    const restored = readExpertCreationStoredState("workspace", fallback);
    expect(restored.draft.name).toBe("Legacy retained expert");
    expect(restored.draft.skillIds).toEqual([]);
    expect(restored.coach.sessionId).toBe("legacy-coach");
  });
});
