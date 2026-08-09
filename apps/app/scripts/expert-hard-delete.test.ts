import { describe, expect, test } from "bun:test";

import {
  canHardDeleteExpert,
  packageNameCandidatesForAgent,
} from "../src/react-app/domains/agents/expert-hard-delete";
import type { AgentRegistry } from "../src/react-app/domains/agents";
import { EXPERT_CREATION_COACH_AGENT_ID } from "../src/react-app/domains/agents";

function emptyRegistry(agents: AgentRegistry["agents"] = []): AgentRegistry {
  return {
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    avatars: [],
    templates: [],
    agents,
    skills: [],
  };
}

describe("expert hard delete", () => {
  test("blocks product builtin coach", () => {
    expect(canHardDeleteExpert(EXPERT_CREATION_COACH_AGENT_ID, emptyRegistry())).toBe(
      false,
    );
    expect(
      canHardDeleteExpert(
        "user-expert",
        emptyRegistry([
          {
            id: "user-expert",
            name: "Mine",
            description: "",
            quote: "",
            tone: "friendly",
            avatarStyle: "lorelei",
            avatarOptionId: "lorelei-mentor",
            customAvatarDataUrl: null,
            modelProvider: "auto",
            model: "Auto",
            enabledToolIds: [],
            defaultWorkspace: "",
            skillIds: [],
            preferredName: "",
            preferredLanguage: "zh",
            userNote: "",
            userBackground: "",
            sourceTemplateId: null,
            marketplaceSource: "mine",
            marketplacePackageName: "user-expert",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
      ),
    ).toBe(true);
  });

  test("package name candidates include marketplace package name", () => {
    const registry = emptyRegistry([
      {
        id: "agent-1",
        name: "A",
        description: "",
        quote: "",
        tone: "friendly",
        avatarStyle: "lorelei",
        avatarOptionId: "lorelei-mentor",
        customAvatarDataUrl: null,
        modelProvider: "auto",
        model: "Auto",
        enabledToolIds: [],
        defaultWorkspace: "",
        skillIds: [],
        preferredName: "",
        preferredLanguage: "zh",
        userNote: "",
        userBackground: "",
        sourceTemplateId: null,
        marketplacePackageName: "pkg-a",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(packageNameCandidatesForAgent({ agentId: "agent-1", registry }).sort()).toEqual([
      "agent-1",
      "pkg-a",
    ]);
  });
});
