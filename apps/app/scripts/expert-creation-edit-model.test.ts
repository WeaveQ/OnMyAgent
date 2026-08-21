import { describe, expect, it } from "bun:test";

import {
  createWizardDraftFromAgent,
  parseUserAgentRegistry,
} from "../src/react-app/domains/agents/agent-registry";
import {
  collectCreationEditableIdentityKeys,
  findCreationEditableAgent,
  findCreationEditableAgentByPackageName,
  isCreationExpertEditable,
  registerImportedMineExpert,
  updateExpertRecordFromDraft,
} from "../src/react-app/domains/agents/expert-creation-save-model";
import type {
  AgentRecord,
  AgentRegistry,
  AgentSkillItem,
  AgentWizardDraft,
} from "../src/react-app/domains/agents/agent-registry-types";

const agent: AgentRecord = {
  id: "agent-created",
  name: "Original expert",
  description: "Original description",
  quote: "Original quote",
  tone: "professional",
  avatarStyle: "pixel",
  avatarOptionId: "avatar-1",
  customAvatarDataUrl: null,
  modelProvider: "auto",
  model: "Auto",
  enabledToolIds: ["filesystem"],
  defaultWorkspace: "",
  skillIds: ["skill-old"],
  preferredName: "",
  preferredLanguage: "中文",
  userNote: "Original role",
  userBackground: "",
  agentMemory: "Original memory",
  userMemory: "",
  marketplaceSource: "mine",
  marketplacePath: "/experts/agent-created",
  marketplacePackageName: "agent-created",
  sourceTemplateId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const draft: AgentWizardDraft = {
  templateId: null,
  name: "Updated expert",
  description: "Updated description",
  quote: "Updated quote",
  tone: "friendly",
  avatarStyle: "robot",
  avatarOptionId: "avatar-2",
  customAvatarDataUrl: "data:image/png;base64,abc",
  modelProvider: "auto",
  model: "Auto",
  enabledToolIds: ["web"],
  defaultWorkspace: "",
  skillIds: ["skill-new", "skill-old", "skill-disabled"],
  preferredName: "Updated name",
  preferredLanguage: "en",
  userNote: "Updated role",
  userBackground: "Updated background",
  agentMemory: "Updated memory",
  userMemory: "Updated user memory",
};

const availableSkills: AgentSkillItem[] = [
  {
    id: "skill-new",
    category: "installed",
    group: "",
    name: "skill-new",
    description: "New skill",
    enabled: true,
  },
  {
    id: "skill-disabled",
    category: "installed",
    group: "",
    name: "skill-disabled",
    description: "Disabled skill",
    enabled: false,
  },
];

describe("expert creation edit model", () => {
  it("only allows experts created by the creation module to be edited", () => {
    expect(isCreationExpertEditable(agent)).toBe(true);
    expect(isCreationExpertEditable({ ...agent, marketplaceSource: undefined })).toBe(false);
    expect(isCreationExpertEditable({ ...agent, builtin: true })).toBe(false);
    expect(isCreationExpertEditable({ ...agent, builtin: true, marketplaceSource: undefined })).toBe(false);
  });

  it("matches sidebar edit by registry id or marketplace package name", () => {
    const custom: AgentRecord = {
      ...agent,
      id: "agent-222",
      marketplacePackageName: "review-helper",
    };
    const keys = collectCreationEditableIdentityKeys([
      custom,
      { ...custom, id: "summoned", marketplaceSource: "installed", marketplacePackageName: "kol-ops" },
    ]);
    expect(keys.has("agent-222")).toBe(true);
    expect(keys.has("review-helper")).toBe(true);
    expect(keys.has("kol-ops")).toBe(false);
    expect(findCreationEditableAgent([custom], "agent-222")?.id).toBe("agent-222");
    expect(findCreationEditableAgent([custom], "review-helper")?.id).toBe("agent-222");
    expect(findCreationEditableAgent([custom], "kol-ops")).toBeUndefined();
  });

  it("backfills the editable basic, memory, and skill fields", () => {
    const backfilled = createWizardDraftFromAgent(agent, [
      {
        id: "skill-old",
        category: "installed",
        group: "",
        name: "skill-old",
        description: "Existing skill",
        enabled: true,
      },
    ]);

    expect(backfilled).toMatchObject({
      name: "Original expert",
      description: "Original description",
      quote: "Original quote",
      userNote: "Original role",
      agentMemory: "Original memory",
      skillIds: ["skill-old"],
    });
  });

  it("keeps the creation source marker when loading the user registry", () => {
    const parsed = parseUserAgentRegistry(
      JSON.stringify({
        version: 1,
        updatedAt: agent.updatedAt,
        agents: [agent],
      }),
    );
    const loaded = parsed.agents.find((item) => item.id === agent.id);

    expect(loaded).toMatchObject({
      marketplaceSource: "mine",
      marketplacePath: "/experts/agent-created",
      marketplacePackageName: "agent-created",
    });
  });

  it("registers an imported package as a creation-editable mine expert", () => {
    const registry: AgentRegistry = {
      version: 1,
      updatedAt: "2026-08-01T00:00:00.000Z",
      avatars: [],
      templates: [],
      agents: [],
      skills: [],
    };
    const first = registerImportedMineExpert({
      registry,
      nowIso: "2026-08-20T00:00:00.000Z",
      packageName: "review-helper",
      packagePath: "/tmp/my-experts/review-helper",
      displayName: "Review helper",
      description: "Reviews diffs",
      skillIds: ["demo-skill"],
      userNote: "You are a reviewer",
      agentMemory: "Prefers concise notes",
    });
    expect(isCreationExpertEditable(first.agent)).toBe(true);
    expect(first.agent).toMatchObject({
      id: "review-helper",
      marketplaceSource: "mine",
      marketplacePackageName: "review-helper",
      marketplacePath: "/tmp/my-experts/review-helper",
      userNote: "You are a reviewer",
      agentMemory: "Prefers concise notes",
    });
    expect(first.agent.builtin).toBeUndefined();
    expect(
      findCreationEditableAgentByPackageName(first.registry.agents, "review-helper")?.id,
    ).toBe("review-helper");

    const summoned: AgentRecord = {
      ...first.agent,
      id: "summoned-review-helper",
      marketplaceSource: "installed",
    };
    expect(isCreationExpertEditable(summoned)).toBe(false);
    expect(
      findCreationEditableAgentByPackageName([summoned], "review-helper"),
    ).toBeUndefined();

    const overwritten = registerImportedMineExpert({
      registry: first.registry,
      nowIso: "2026-08-21T00:00:00.000Z",
      packageName: "review-helper",
      packagePath: "/tmp/my-experts/review-helper",
      displayName: "Review helper v2",
      description: "Updated",
      skillIds: ["demo-skill", "extra"],
    });
    expect(overwritten.agent.id).toBe(first.agent.id);
    expect(overwritten.agent.name).toBe("Review helper v2");
    expect(
      overwritten.registry.agents.filter(
        (item) => item.marketplacePackageName === "review-helper",
      ),
    ).toHaveLength(1);
  });

  it("updates editable fields while preserving expert identity and package metadata", () => {
    const updated = updateExpertRecordFromDraft(
      agent,
      draft,
      "2026-08-03T00:00:00.000Z",
      availableSkills,
    );

    expect(updated).toMatchObject({
      id: "agent-created",
      name: "Updated expert",
      description: "Updated description",
      quote: "Updated quote",
      userNote: "Updated role",
      agentMemory: "Updated memory",
      skillIds: ["skill-new", "skill-old"],
      marketplaceSource: "mine",
      marketplacePath: "/experts/agent-created",
      marketplacePackageName: "agent-created",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    });
  });
});
