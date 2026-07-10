import { describe, expect, test } from "bun:test";

import type {
  AgentRecord,
  AgentRegistry,
  AgentTemplate,
  AgentWizardDraft,
} from "../src/react-app/domains/agents/agent-registry-types";

const template = {
  id: "tpl-1",
  name: "Template",
  description: "Template description",
  quote: "Template quote",
  tone: "专业",
  avatarStyle: "机器人",
  avatarOptionId: "robot-helper",
  modelProvider: "自动",
  model: "Auto",
  enabledToolIds: ["filesystem", "web"],
  skillIds: ["skill-1"],
  preferredName: "Lee",
  preferredLanguage: "中文",
  userNote: "note",
  userBackground: "background",
  showInOverview: true,
  showInWizard: true,
} satisfies AgentTemplate;

const record = {
  ...template,
  id: "agent-1",
  customAvatarDataUrl: null,
  defaultWorkspace: "/tmp/demo",
  sourceTemplateId: "tpl-1",
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z",
} satisfies AgentRecord;

describe("shared agent registry types", () => {
  test("keeps registry shape consumable by session restore stores", () => {
    const registry = {
      version: 1,
      updatedAt: "2026-06-24T00:00:00.000Z",
      avatars: [],
      templates: [template],
      agents: [record],
      skills: [],
    } satisfies AgentRegistry;

    expect(registry.templates[0]?.id).toBe("tpl-1");
    expect(registry.agents[0]?.defaultWorkspace).toBe("/tmp/demo");
  });

  test("keeps wizard draft contract aligned with registry records", () => {
    const draft = {
      templateId: "tpl-1",
      name: "Draft",
      description: "Draft description",
      quote: "Draft quote",
      tone: "友好",
      avatarStyle: "像素风",
      avatarOptionId: "pixel-tech",
      customAvatarDataUrl: null,
      modelProvider: "自动",
      model: "Auto",
      enabledToolIds: ["code", "utility"],
      defaultWorkspace: "",
      skillIds: [],
      preferredName: "",
      preferredLanguage: "中文",
      userNote: "",
      userBackground: "",
      agentMemory: "agent memory",
      userMemory: "user memory",
    } satisfies AgentWizardDraft;

    expect(draft.enabledToolIds).toEqual(["code", "utility"]);
    expect(draft.agentMemory).toBe("agent memory");
  });
});
