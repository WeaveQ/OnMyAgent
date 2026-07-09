import type {
  AgentAvatarStyle,
  AgentToolCategoryId,
} from "./pending-agent-store";

export type AgentTone = "专业" | "友好" | "创意" | "简洁" | "随意" | "专家";

export type AgentModelProvider = string;

export type AgentAvatarOption = {
  id: string;
  style: AgentAvatarStyle;
  label: string;
  initials: string;
  background: string;
  foreground: string;
  accent: string;
};

export type AgentSkillItem = {
  id: string;
  category: string;
  group: string;
  name: string;
  description: string;
  enabled: boolean;
  path?: string;
  readonly?: boolean;
  displayNameZh?: string;
  displayNameEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
};

export type AgentTemplate = {
  id: string;
  name: string;
  description: string;
  quote: string;
  tone: AgentTone;
  avatarStyle: AgentAvatarStyle;
  avatarOptionId: string;
  modelProvider: AgentModelProvider;
  model: string;
  sdkProviderID?: string;
  sdkModelID?: string;
  enabledToolIds: AgentToolCategoryId[];
  skillIds: string[];
  preferredName: string;
  preferredLanguage: string;
  userNote: string;
  userBackground: string;
  agentMemory?: string;
  userMemory?: string;
  showInOverview: boolean;
  showInWizard: boolean;
};

export type AgentRecord = {
  id: string;
  name: string;
  description: string;
  quote: string;
  tone: AgentTone;
  avatarStyle: AgentAvatarStyle;
  avatarOptionId: string;
  customAvatarDataUrl: string | null;
  modelProvider: AgentModelProvider;
  model: string;
  sdkProviderID?: string;
  sdkModelID?: string;
  enabledToolIds: AgentToolCategoryId[];
  defaultWorkspace: string;
  skillIds: string[];
  preferredName: string;
  preferredLanguage: string;
  userNote: string;
  userBackground: string;
  agentMemory?: string;
  userMemory?: string;
  marketplaceSource?: "mine";
  marketplacePath?: string;
  marketplacePackageName?: string;
  sourceTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentRegistry = {
  version: 1;
  updatedAt: string;
  avatars: AgentAvatarOption[];
  templates: AgentTemplate[];
  agents: AgentRecord[];
  skills: AgentSkillItem[];
};

export type AgentWizardDraft = {
  templateId: string | null;
  name: string;
  description: string;
  quote: string;
  tone: AgentTone;
  avatarStyle: AgentAvatarStyle;
  avatarOptionId: string;
  customAvatarDataUrl: string | null;
  modelProvider: AgentModelProvider;
  model: string;
  sdkProviderID?: string;
  sdkModelID?: string;
  enabledToolIds: AgentToolCategoryId[];
  defaultWorkspace: string;
  skillIds: string[];
  preferredName: string;
  preferredLanguage: string;
  userNote: string;
  userBackground: string;
  agentMemory: string;
  userMemory: string;
};

export type AgentToolCategory = {
  id: AgentToolCategoryId;
  name: string;
  description: string;
};

export type AgentCardItem =
  | { kind: "template"; id: string; template: AgentTemplate }
  | { kind: "custom"; id: string; agent: AgentRecord };
