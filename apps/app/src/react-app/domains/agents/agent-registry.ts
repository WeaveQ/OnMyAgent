import { t } from "@/i18n";
import { createDefaultAgentRegistry } from "../shared/agent-default-registry";
export { createDefaultAgentRegistry } from "../shared/agent-default-registry";
import {
  buildAgentAvatarDataUri,
  friendlyModelNameToModelRef,
  isValidSdkModelRef,
  resolveAgentAvatarUrl,
} from "../shared/agent-registry-helpers";
export {
  buildAgentAvatarDataUri,
  friendlyModelNameToModelRef,
  isValidSdkModelRef,
  resolveAgentAvatarUrl,
} from "../shared/agent-registry-helpers";
import type {
  AgentAvatarOption,
  AgentModelProvider,
  AgentRecord,
  AgentRegistry,
  AgentSkillItem,
  AgentTemplate,
  AgentTone,
  AgentToolCategory,
  AgentWizardDraft,
} from "../shared/agent-registry-types";
export type {
  AgentAvatarOption,
  AgentModelProvider,
  AgentRecord,
  AgentRegistry,
  AgentSkillItem,
  AgentTemplate,
  AgentTone,
  AgentToolCategory,
  AgentWizardDraft,
} from "../shared/agent-registry-types";

export const AGENT_REGISTRY_PATH = ".onmyagent/agents/registry.json";
export const LEGACY_AGENT_REGISTRY_PATH = "onmyagent-agents/registry.json";
export const USER_AGENT_REGISTRY_DISPLAY_PATH =
  "~/.onmyagent/agents/registry.json";

export type AgentAvatarStyle = "像素风" | "冒险家" | "机器人" | "洛蕾莱";

export type AgentToolCategoryId =
  | "filesystem"
  | "web"
  | "commerce"
  | "code"
  | "media"
  | "utility"
  | "memory"
  | "collaboration";

export function agentToneLabel(tone: AgentTone) {
  switch (tone) {
    case "专业":
      return t("agents.tone_professional");
    case "友好":
      return t("agents.tone_friendly");
    case "创意":
      return t("agents.tone_creative");
    case "简洁":
      return t("agents.tone_concise");
    case "随意":
      return t("agents.tone_casual");
    case "专家":
      return t("agents.tone_expert");
  }
}

export function agentAvatarStyleLabel(style: AgentAvatarStyle) {
  switch (style) {
    case "像素风":
      return t("agents.avatar_pixel");
    case "冒险家":
      return t("agents.avatar_adventurer");
    case "机器人":
      return t("agents.avatar_robot");
    case "洛蕾莱":
      return t("agents.avatar_lorelei");
  }
}

export function agentToolCategoryLabel(category: AgentToolCategoryId) {
  switch (category) {
    case "filesystem":
      return t("agents.tool_filesystem");
    case "web":
      return t("agents.tool_web");
    case "commerce":
      return t("agents.tool_commerce");
    case "code":
      return t("agents.tool_code");
    case "media":
      return t("agents.tool_media");
    case "utility":
      return t("agents.tool_utility");
    case "memory":
      return t("agents.tool_memory");
    case "collaboration":
      return t("agents.tool_collaboration");
  }
}

export function agentToolCategoryDescription(category: AgentToolCategoryId) {
  switch (category) {
    case "filesystem":
      return t("agents.tool_filesystem_desc");
    case "web":
      return t("agents.tool_web_desc");
    case "commerce":
      return t("agents.tool_commerce_desc");
    case "code":
      return t("agents.tool_code_desc");
    case "media":
      return t("agents.tool_media_desc");
    case "utility":
      return t("agents.tool_utility_desc");
    case "memory":
      return t("agents.tool_memory_desc");
    case "collaboration":
      return t("agents.tool_collaboration_desc");
  }
}

export function localizedSkillCategoryLabel(category: string) {
  if (category === "built-in" || category === "内置技能") {
    return t("agents.skill_category_builtin");
  }
  if (category === "sourcing" || category === "货源与选品") {
    return t("agents.skill_category_sourcing");
  }
  if (category === "research" || category === "市场调研与分析") {
    return t("agents.skill_category_research");
  }
  return category;
}

export const AGENT_TOOL_CATALOG: AgentToolCategory[] = [
  {
    id: "filesystem",
    get name() {
      return agentToolCategoryLabel("filesystem");
    },
    get description() {
      return agentToolCategoryDescription("filesystem");
    },
  },
  {
    id: "web",
    get name() {
      return agentToolCategoryLabel("web");
    },
    get description() {
      return agentToolCategoryDescription("web");
    },
  },
  {
    id: "commerce",
    get name() {
      return agentToolCategoryLabel("commerce");
    },
    get description() {
      return agentToolCategoryDescription("commerce");
    },
  },
  {
    id: "code",
    get name() {
      return agentToolCategoryLabel("code");
    },
    get description() {
      return agentToolCategoryDescription("code");
    },
  },
  {
    id: "media",
    get name() {
      return agentToolCategoryLabel("media");
    },
    get description() {
      return agentToolCategoryDescription("media");
    },
  },
  {
    id: "utility",
    get name() {
      return agentToolCategoryLabel("utility");
    },
    get description() {
      return agentToolCategoryDescription("utility");
    },
  },
  {
    id: "memory",
    get name() {
      return agentToolCategoryLabel("memory");
    },
    get description() {
      return agentToolCategoryDescription("memory");
    },
  },
  {
    id: "collaboration",
    get name() {
      return agentToolCategoryLabel("collaboration");
    },
    get description() {
      return agentToolCategoryDescription("collaboration");
    },
  },
];

export const AGENT_MODEL_OPTIONS: Record<AgentModelProvider, string[]> = {
  自动: ["Auto"],
  Gemini: ["Gemini 3 Flash", "Gemini 1.5 Pro", "Gemini 2.5 Pro"],
  OpenAI: ["GPT-4.1", "GPT-4o", "o3"],
  Claude: ["Claude Sonnet 4", "Claude 3.7 Sonnet", "Claude 3.5 Haiku"],
};

export const AGENT_TONES: AgentTone[] = [
  "专业",
  "友好",
  "创意",
  "简洁",
  "随意",
  "专家",
];

export const AGENT_AVATAR_STYLES: AgentAvatarStyle[] = [
  "像素风",
  "冒险家",
  "机器人",
  "洛蕾莱",
];

const defaultRegistry = createDefaultAgentRegistry();

function skillCategoryLabel(category: string) {
  return localizedSkillCategoryLabel(category);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTone(value: unknown): value is AgentTone {
  return (
    typeof value === "string" && AGENT_TONES.some((item) => item === value)
  );
}

function isAvatarStyle(value: unknown): value is AgentAvatarStyle {
  return (
    typeof value === "string" &&
    AGENT_AVATAR_STYLES.some((item) => item === value)
  );
}

function isModelProvider(value: unknown): value is AgentModelProvider {
  return typeof value === "string" && value.length > 0;
}

function isToolCategoryId(value: unknown): value is AgentToolCategoryId {
  return (
    typeof value === "string" &&
    AGENT_TOOL_CATALOG.some((item) => item.id === value)
  );
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseAvatarOption(value: unknown): AgentAvatarOption | null {
  if (!isRecord(value)) return null;
  if (!isAvatarStyle(value.style)) return null;
  const id = readString(value.id).trim();
  if (!id) return null;
  return {
    id,
    style: value.style,
    label: readString(value.label),
    initials: readString(value.initials).slice(0, 2) || "A",
    background: readString(value.background) || "#d9e3f0",
    foreground: readString(value.foreground) || "#233046",
    accent: readString(value.accent) || "#6d84a2",
  };
}

function parseTemplate(value: unknown): AgentTemplate | null {
  if (!isRecord(value)) return null;
  if (
    !isTone(value.tone) ||
    !isAvatarStyle(value.avatarStyle) ||
    !isModelProvider(value.modelProvider)
  )
    return null;
  const id = readString(value.id).trim();
  if (!id) return null;
  return {
    id,
    name: readString(value.name),
    description: readString(value.description),
    quote: readString(value.quote),
    tone: value.tone,
    avatarStyle: value.avatarStyle,
    avatarOptionId: readString(value.avatarOptionId),
    modelProvider: value.modelProvider,
    model: readString(value.model),
    sdkProviderID:
      typeof value.sdkProviderID === "string" ? value.sdkProviderID : undefined,
    sdkModelID:
      typeof value.sdkModelID === "string" ? value.sdkModelID : undefined,
    enabledToolIds: readStringArray(value.enabledToolIds).filter(
      isToolCategoryId,
    ),
    skillIds: readStringArray(value.skillIds),
    preferredName: readString(value.preferredName),
    preferredLanguage: readString(value.preferredLanguage, "中文"),
    userNote: readString(value.userNote),
    userBackground: readString(value.userBackground),
    agentMemory: typeof value.agentMemory === "string" ? value.agentMemory : undefined,
    userMemory: typeof value.userMemory === "string" ? value.userMemory : undefined,
    showInOverview: value.showInOverview === true,
    showInWizard: value.showInWizard === true,
  };
}

function parseAgent(value: unknown): AgentRecord | null {
  if (!isRecord(value)) return null;
  if (
    !isTone(value.tone) ||
    !isAvatarStyle(value.avatarStyle) ||
    !isModelProvider(value.modelProvider)
  )
    return null;
  const id = readString(value.id).trim();
  if (!id) return null;
  return {
    id,
    name: readString(value.name),
    description: readString(value.description),
    quote: readString(value.quote),
    tone: value.tone,
    avatarStyle: value.avatarStyle,
    avatarOptionId: readString(value.avatarOptionId),
    customAvatarDataUrl:
      typeof value.customAvatarDataUrl === "string"
        ? value.customAvatarDataUrl
        : null,
    modelProvider: value.modelProvider,
    model: readString(value.model),
    sdkProviderID:
      typeof value.sdkProviderID === "string" ? value.sdkProviderID : undefined,
    sdkModelID:
      typeof value.sdkModelID === "string" ? value.sdkModelID : undefined,
    enabledToolIds: readStringArray(value.enabledToolIds).filter(
      isToolCategoryId,
    ),
    defaultWorkspace: readString(value.defaultWorkspace),
    skillIds: readStringArray(value.skillIds),
    preferredName: readString(value.preferredName),
    preferredLanguage: readString(value.preferredLanguage, "中文"),
    userNote: readString(value.userNote),
    userBackground: readString(value.userBackground),
    agentMemory:
      typeof value.agentMemory === "string" ? value.agentMemory : undefined,
    userMemory:
      typeof value.userMemory === "string" ? value.userMemory : undefined,
    sourceTemplateId:
      typeof value.sourceTemplateId === "string"
        ? value.sourceTemplateId
        : null,
    createdAt: readString(value.createdAt),
    updatedAt: readString(value.updatedAt),
  };
}

function parseSkill(value: unknown): AgentSkillItem | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id).trim();
  if (!id) return null;
  return {
    id,
    category: readString(value.category),
    group: readString(value.group),
    name: readString(value.name),
    description: readString(value.description),
    enabled: value.enabled === true,
  };
}

function mergeById<T extends { id: string }>(current: T[], fallback: T[]) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...fallback.filter((item) => !ids.has(item.id))];
}

function applyBundledTemplateVisibility(
  templates: readonly AgentTemplate[],
): AgentTemplate[] {
  const defaultVisibility = new Map(
    defaultRegistry.templates.map((template) => [
      template.id,
      {
        showInOverview: template.showInOverview,
        showInWizard: template.showInWizard,
      },
    ]),
  );
  return templates.map((template) => {
    const visibility = defaultVisibility.get(template.id);
    if (!visibility) return template;
    return { ...template, ...visibility };
  });
}

export function parseAgentRegistry(raw: string): AgentRegistry {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    return createDefaultAgentRegistry();
  }

  const avatars = Array.isArray(parsed.avatars)
    ? parsed.avatars
        .map(parseAvatarOption)
        .filter((item): item is AgentAvatarOption => Boolean(item))
    : [];
  const templates = Array.isArray(parsed.templates)
    ? parsed.templates
        .map(parseTemplate)
        .filter((item): item is AgentTemplate => Boolean(item))
    : [];
  const agents = Array.isArray(parsed.agents)
    ? parsed.agents
        .map(parseAgent)
        .filter((item): item is AgentRecord => Boolean(item))
    : [];
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills
        .map(parseSkill)
        .filter((item): item is AgentSkillItem => Boolean(item))
    : [];
  if (avatars.length === 0 || templates.length === 0 || skills.length === 0) {
    return createDefaultAgentRegistry();
  }

  return {
    version: 1,
    updatedAt: readString(parsed.updatedAt, new Date().toISOString()),
    avatars: mergeById(avatars, defaultRegistry.avatars),
    templates: applyBundledTemplateVisibility(
      mergeById(templates, defaultRegistry.templates),
    ),
    agents,
    skills: defaultRegistry.skills,
  };
}

export function createAgentRegistryWithUserAgents(
  agents: readonly AgentRecord[],
  updatedAt = new Date().toISOString(),
  templates: readonly AgentTemplate[] = [],
): AgentRegistry {
  const registry = createDefaultAgentRegistry();
  return {
    ...registry,
    updatedAt,
    templates: applyBundledTemplateVisibility(
      mergeById([...templates], registry.templates),
    ),
    agents: [...agents],
  };
}

export function parseUserAgentRegistry(raw: string): AgentRegistry {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    return createDefaultAgentRegistry();
  }
  const agents = Array.isArray(parsed.agents)
    ? parsed.agents
        .map(parseAgent)
        .filter((item): item is AgentRecord => Boolean(item))
    : [];
  const templates = Array.isArray(parsed.templates)
    ? parsed.templates
        .map(parseTemplate)
        .filter((item): item is AgentTemplate => Boolean(item))
    : [];
  return createAgentRegistryWithUserAgents(
    agents,
    readString(parsed.updatedAt, new Date().toISOString()),
    templates,
  );
}

export function createWizardDraftFromTemplate(
  template: AgentTemplate,
  mergedSkills?: readonly AgentSkillItem[],
): AgentWizardDraft {
  const enabledSkillIds = new Set(
    (mergedSkills ?? defaultRegistry.skills)
      .filter((skill) => skill.enabled)
      .map((skill) => skill.id),
  );
  if (template.id === "blank-agent") {
    return {
      templateId: template.id,
      name: "",
      description: "",
      quote: "",
      tone: "专业",
      avatarStyle: "像素风",
      avatarOptionId: "",
      customAvatarDataUrl: null,
      modelProvider: "自动",
      model: "Auto",
      enabledToolIds: [],
      defaultWorkspace: "",
      skillIds: [],
      preferredName: "",
      preferredLanguage: "",
      userNote: "",
      userBackground: "",
      agentMemory: "",
      userMemory: "",
    };
  }
  return {
    templateId: template.id,
    name: template.name,
    description: template.description,
    quote: template.quote,
    tone: template.tone,
    avatarStyle: template.avatarStyle,
    avatarOptionId: template.avatarOptionId,
    customAvatarDataUrl: null,
    modelProvider: template.modelProvider,
    model: template.model,
    sdkProviderID: template.sdkProviderID,
    sdkModelID: template.sdkModelID,
    enabledToolIds: [...template.enabledToolIds],
    defaultWorkspace: "",
    skillIds: template.skillIds.filter((skillId) =>
      enabledSkillIds.has(skillId),
    ),
    preferredName: template.preferredName,
    preferredLanguage: template.preferredLanguage,
    userNote: template.userNote,
    userBackground: template.userBackground,
    agentMemory: template.agentMemory ?? "",
    userMemory: template.userMemory ?? "",
  };
}

export function createWizardDraftFromAgent(
  agent: AgentRecord,
  mergedSkills?: readonly AgentSkillItem[],
): AgentWizardDraft {
  const enabledSkillIds = new Set(
    (mergedSkills ?? defaultRegistry.skills)
      .filter((skill) => skill.enabled)
      .map((skill) => skill.id),
  );
  return {
    templateId: null,
    name: agent.name,
    description: agent.description,
    quote: agent.quote,
    tone: agent.tone,
    avatarStyle: agent.avatarStyle,
    avatarOptionId: agent.avatarOptionId,
    customAvatarDataUrl: agent.customAvatarDataUrl,
    modelProvider: agent.modelProvider,
    model: agent.model,
    sdkProviderID: agent.sdkProviderID,
    sdkModelID: agent.sdkModelID,
    enabledToolIds: [...agent.enabledToolIds],
    defaultWorkspace: agent.defaultWorkspace,
    skillIds: agent.skillIds.filter((skillId) => enabledSkillIds.has(skillId)),
    preferredName: agent.preferredName,
    preferredLanguage: agent.preferredLanguage,
    userNote: agent.userNote,
    userBackground: agent.userBackground,
    agentMemory: agent.agentMemory ?? "",
    userMemory: agent.userMemory ?? "",
  };
}

export function createBlankWizardDraft(
  registry: AgentRegistry,
  mergedSkills?: readonly AgentSkillItem[],
): AgentWizardDraft {
  const fallbackTemplate =
    registry.templates.find((item) => item.id === "blank-agent") ??
    registry.templates[0];
  return createWizardDraftFromTemplate(fallbackTemplate, mergedSkills);
}

export function createAgentRecordFromDraft(
  draft: AgentWizardDraft,
  nowIso: string,
  mergedSkills?: readonly AgentSkillItem[],
): AgentRecord {
  const id = `agent-${Date.now()}`;
  const enabledSkillIds = new Set(
    (mergedSkills ?? defaultRegistry.skills)
      .filter((skill) => skill.enabled)
      .map((skill) => skill.id),
  );
  return {
    id,
    name: draft.name.trim() || "新建智能体",
    description: draft.description.trim(),
    quote:
      draft.quote.trim() ||
      draft.description.trim() ||
      "我是一个专业的智能体助手。",
    tone: draft.tone,
    avatarStyle: draft.avatarStyle,
    avatarOptionId: draft.avatarOptionId,
    customAvatarDataUrl: draft.customAvatarDataUrl,
    modelProvider: draft.modelProvider,
    model: draft.model,
    sdkProviderID: draft.sdkProviderID,
    sdkModelID: draft.sdkModelID,
    enabledToolIds: [...draft.enabledToolIds],
    defaultWorkspace: draft.defaultWorkspace.trim(),
    skillIds: draft.skillIds.filter((skillId) => enabledSkillIds.has(skillId)),
    preferredName: draft.preferredName.trim(),
    preferredLanguage: draft.preferredLanguage.trim() || "中文",
    userNote: draft.userNote.trim(),
    userBackground: draft.userBackground.trim(),
    agentMemory: draft.agentMemory.trim() || undefined,
    userMemory: draft.userMemory.trim() || undefined,
    sourceTemplateId: draft.templateId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function serializeAgentRegistry(registry: AgentRegistry) {
  return `${JSON.stringify(registry, null, 2)}\n`;
}

export function serializeUserAgentRegistry(registry: AgentRegistry) {
  return `${JSON.stringify(
    {
      version: 1,
      updatedAt: registry.updatedAt,
      templates: registry.templates,
      agents: registry.agents,
    },
    null,
    2,
  )}\n`;
}
