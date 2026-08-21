import { describe, expect, it } from "bun:test";

import type {
  AgentRecord,
  AgentRegistry,
} from "../src/react-app/domains/agents/agent-registry-types";
import {
  buildAgentConversationGroups,
  buildDraftAgentGroups,
  listUnstartedMineExpertContexts,
  resolveUnstartedMinePending,
} from "../src/react-app/domains/session/pages/expert-conversation-model";
import { buildExpertPageNavigationModel } from "../src/react-app/domains/session/pages/expert-page-navigation-model";

const mineAgent: AgentRecord = {
  id: "agent-222",
  name: "222",
  description: "3333",
  quote: "3333",
  tone: "professional",
  avatarStyle: "pixel",
  avatarOptionId: "pixel-tech",
  customAvatarDataUrl: null,
  modelProvider: "auto",
  model: "Auto",
  enabledToolIds: ["filesystem"],
  defaultWorkspace: "",
  skillIds: [],
  preferredName: "",
  preferredLanguage: "\u4E2D\u6587",
  userNote: "",
  userBackground: "",
  marketplaceSource: "mine",
  marketplacePath: "/tmp/my-experts/agent-222",
  marketplacePackageName: "agent-222",
  sourceTemplateId: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

const summonedAgent: AgentRecord = {
  ...mineAgent,
  id: "summoned-kol",
  name: "Summoned",
  marketplaceSource: "installed",
  marketplacePackageName: "kol-ops",
};

function registryWith(agents: AgentRecord[]): AgentRegistry {
  return {
    version: 1,
    updatedAt: "2026-08-20T00:00:00.000Z",
    avatars: [],
    templates: [],
    agents,
    skills: [],
  };
}

describe("unstarted mine experts stay in the conversation list", () => {
  it("seeds a mine expert that has no sessions after in-memory drafts are dropped", () => {
    const seeded = listUnstartedMineExpertContexts({
      registry: registryWith([mineAgent, summonedAgent]),
      occupiedAgentIds: [],
    });
    expect(Object.keys(seeded)).toEqual(["agent-222"]);
    expect(seeded["agent-222"]).toMatchObject({
      id: "agent-222",
      name: "222",
      draftSource: "agent-selection",
      marketplaceExpert: {
        source: "mine",
        packageName: "agent-222",
      },
    });
    expect(seeded["agent-222"]?.operationId).toBeUndefined();

    const groups = buildExpertPageNavigationModel({
      draftAgentContexts: {},
      selectedWorkspaceId: "ws-1",
      draftAgentId: null,
      activeConversationAgentId: null,
      conversationGroups: [],
      pendingAgent: null,
      registry: registryWith([mineAgent]),
    }).draftAgentGroups;
    expect(groups.map((group) => group.agentId)).toEqual(["agent-222"]);
    expect(groups[0]?.sessions[0]?.id).toBe("draft:ws-1:agent-222");
    expect(groups[0]?.avatarUrl).toBeNull();
  });

  it("keeps an uploaded mine avatar while suppressing generated placeholders", () => {
    const customAvatar = "data:image/png;base64,custom";
    const groups = buildDraftAgentGroups(
      {
        generated: {
          id: "generated",
          name: "Generated",
          description: "",
          avatar: {
            avatarStyle: "pixel",
            avatarOptionId: "pixel-tech",
            customAvatarDataUrl: null,
            avatarUrl: "data:image/svg+xml,generated",
            avatarBackground: null,
          },
          systemPrompt: "",
          marketplaceExpert: {
            source: "mine",
            packageName: "generated",
            packagePath: "/tmp/generated",
          },
        },
        uploaded: {
          id: "uploaded",
          name: "Uploaded",
          description: "",
          avatar: {
            avatarStyle: "pixel",
            avatarOptionId: "pixel-tech",
            customAvatarDataUrl: customAvatar,
            avatarUrl: customAvatar,
            avatarBackground: null,
          },
          systemPrompt: "",
          marketplaceExpert: {
            source: "mine",
            packageName: "uploaded",
            packagePath: "/tmp/uploaded",
          },
        },
      },
      "ws-1",
    );

    expect(groups.find((group) => group.agentId === "generated")?.avatarUrl).toBeNull();
    expect(groups.find((group) => group.agentId === "uploaded")?.avatarUrl).toBe(customAvatar);
  });

  it("restores a mine expert when Directory uses its composite runtime id", () => {
    const groups = buildAgentConversationGroups(
      [{ id: "session-1", title: "Wrong fallback" }],
      registryWith([mineAgent]),
      {
        sessionIds: new Set(["session-1"]),
        agentIdBySessionId: new Map([["session-1", "agent-222:agent-222"]]),
      },
    );

    expect(groups[0]?.name).toBe("222");
    expect(groups[0]?.avatarUrl).toBeNull();
  });

  it("does not duplicate a mine expert that already has a session or live draft", () => {
    expect(
      listUnstartedMineExpertContexts({
        registry: registryWith([mineAgent]),
        occupiedAgentIds: ["agent-222"],
      }),
    ).toEqual({});

    const liveDrafts = buildDraftAgentGroups(
      {
        "agent-222": {
          id: "agent-222",
          name: "222",
          description: "live",
          avatar: {
            avatarStyle: "pixel",
            avatarOptionId: "pixel-tech",
            customAvatarDataUrl: null,
            avatarUrl: null,
            avatarBackground: null,
          },
          systemPrompt: "",
          draftSource: "agent-selection",
        },
      },
      "ws-1",
    );
    const model = buildExpertPageNavigationModel({
      draftAgentContexts: {
        "agent-222": {
          id: "agent-222",
          name: "222",
          description: "live",
          avatar: {
            avatarStyle: "pixel",
            avatarOptionId: "pixel-tech",
            customAvatarDataUrl: null,
            avatarUrl: null,
            avatarBackground: null,
          },
          systemPrompt: "",
          draftSource: "agent-selection",
        },
      },
      selectedWorkspaceId: "ws-1",
      draftAgentId: "agent-222",
      activeConversationAgentId: "agent-222",
      conversationGroups: [],
      pendingAgent: null,
      registry: registryWith([mineAgent]),
    });
    expect(model.draftAgentGroups).toHaveLength(1);
    expect(model.draftAgentGroups[0]?.description).toBe("live");
    expect(liveDrafts).toHaveLength(1);
  });

  it("reopens a mine expert even when a leftover session already occupies the agent id", () => {
    const registry = registryWith([mineAgent]);
    expect(
      listUnstartedMineExpertContexts({
        registry,
        occupiedAgentIds: ["agent-222"],
      }),
    ).toEqual({});
    const restored = resolveUnstartedMinePending(registry, "agent-222");
    expect(restored?.id).toBe("agent-222");
    expect(restored?.operationId?.trim()).toBeTruthy();
    expect(resolveUnstartedMinePending(registry, "missing")).toBeUndefined();
  });
});
