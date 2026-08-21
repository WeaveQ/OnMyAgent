import { createAgentRecordFromDraft } from "./agent-registry";
import { buildPendingAgentFromRecord } from "./agent-registry-store";
import type {
  AgentRecord,
  AgentRegistry,
  AgentSkillItem,
  AgentWizardDraft,
} from "./agent-registry-types";
import {
  createExpertOperationId,
  type PendingAgentContext,
} from "./pending-agent-store";

export function isCreationExpertEditable(agent: AgentRecord): boolean {
  return agent.marketplaceSource === "mine" && agent.builtin !== true;
}

export function findCreationEditableAgentByPackageName(
  agents: readonly AgentRecord[] | null | undefined,
  packageName: string,
): AgentRecord | undefined {
  const pkg = packageName.trim();
  if (!pkg) return undefined;
  return (agents ?? []).find(
    (agent) =>
      isCreationExpertEditable(agent) && agent.marketplacePackageName === pkg,
  );
}

/** Sidebar / card ids may be AgentRecord.id or marketplacePackageName. */
export function findCreationEditableAgent(
  agents: readonly AgentRecord[] | null | undefined,
  agentIdOrPackageName: string,
): AgentRecord | undefined {
  const key = agentIdOrPackageName.trim();
  if (!key) return undefined;
  return (agents ?? []).find(
    (agent) =>
      isCreationExpertEditable(agent) &&
      (agent.id === key || agent.marketplacePackageName === key),
  );
}

export function collectCreationEditableIdentityKeys(
  agents: readonly AgentRecord[] | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const agent of agents ?? []) {
    if (!isCreationExpertEditable(agent)) continue;
    ids.add(agent.id);
    const pkg = agent.marketplacePackageName?.trim();
    if (pkg) ids.add(pkg);
  }
  return ids;
}

export type ImportedMineExpertSeed = {
  packageName: string;
  packagePath: string;
  displayName: string;
  description: string;
  quote?: string;
  skillIds?: readonly string[];
  userNote?: string;
  agentMemory?: string;
  customAvatarDataUrl?: string | null;
};

export type RegisterImportedMineExpertInput = ImportedMineExpertSeed & {
  registry: AgentRegistry;
  nowIso: string;
};

/**
 * Seed or refresh a user-owned mine registry record after a package copy.
 * Same persist markers as create-save (`marketplaceSource: "mine"`, not builtin).
 */
export function registerImportedMineExpert(
  input: RegisterImportedMineExpertInput,
): { agent: AgentRecord; registry: AgentRegistry } {
  const packageName = input.packageName.trim();
  const existing = input.registry.agents.find(
    (agent) =>
      agent.marketplacePackageName === packageName &&
      agent.marketplaceSource === "mine",
  );
  const displayName = input.displayName.trim() || packageName;
  const description = input.description.trim();
  const quote = (input.quote ?? description).trim() || displayName;
  const agent: AgentRecord = {
    id: existing?.id ?? packageName,
    name: displayName,
    description,
    quote,
    tone: existing?.tone ?? "professional",
    avatarStyle: existing?.avatarStyle ?? "pixel",
    avatarOptionId: existing?.avatarOptionId ?? "pixel-tech",
    customAvatarDataUrl:
      input.customAvatarDataUrl !== undefined
        ? input.customAvatarDataUrl
        : (existing?.customAvatarDataUrl ?? null),
    modelProvider: existing?.modelProvider ?? "auto",
    model: existing?.model ?? "Auto",
    ...(existing?.sdkProviderID ? { sdkProviderID: existing.sdkProviderID } : {}),
    ...(existing?.sdkModelID ? { sdkModelID: existing.sdkModelID } : {}),
    enabledToolIds: existing?.enabledToolIds ?? [
      "filesystem",
      "web",
      "code",
      "utility",
    ],
    defaultWorkspace: existing?.defaultWorkspace ?? "",
    skillIds: [...(input.skillIds ?? existing?.skillIds ?? [])],
    preferredName: existing?.preferredName ?? "",
    preferredLanguage: existing?.preferredLanguage ?? "\u4E2D\u6587",
    userNote: input.userNote ?? existing?.userNote ?? "",
    userBackground: existing?.userBackground ?? "",
    ...(input.agentMemory !== undefined
      ? input.agentMemory
        ? { agentMemory: input.agentMemory }
        : {}
      : existing?.agentMemory
        ? { agentMemory: existing.agentMemory }
        : {}),
    ...(existing?.userMemory ? { userMemory: existing.userMemory } : {}),
    sourceTemplateId: existing?.sourceTemplateId ?? null,
    marketplaceSource: "mine",
    marketplacePath: input.packagePath,
    marketplacePackageName: packageName,
    createdAt: existing?.createdAt ?? input.nowIso,
    updatedAt: input.nowIso,
  };
  const agents = existing
    ? input.registry.agents.map((item) => (item.id === existing.id ? agent : item))
    : [agent, ...input.registry.agents];
  return {
    agent,
    registry: {
      ...input.registry,
      updatedAt: input.nowIso,
      agents,
    },
  };
}

export function createExpertRecordForSave(
  draft: AgentWizardDraft,
  nowIso: string,
  availableSkills: readonly AgentSkillItem[],
): AgentRecord {
  return createAgentRecordFromDraft(draft, nowIso, availableSkills);
}

export function updateExpertRecordFromDraft(
  agent: AgentRecord,
  draft: AgentWizardDraft,
  nowIso: string,
  availableSkills: readonly AgentSkillItem[],
): AgentRecord {
  const enabledSkillIds = new Set(
    availableSkills.filter((skill) => skill.enabled).map((skill) => skill.id),
  );
  return {
    ...agent,
    name: draft.name.trim(),
    description: draft.description.trim(),
    quote: draft.quote.trim(),
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
    skillIds: draft.skillIds.filter(
      (skillId) =>
        enabledSkillIds.has(skillId) || agent.skillIds.includes(skillId),
    ),
    preferredName: draft.preferredName.trim(),
    preferredLanguage: draft.preferredLanguage.trim(),
    userNote: draft.userNote.trim(),
    userBackground: draft.userBackground.trim(),
    agentMemory: draft.agentMemory.trim() || undefined,
    userMemory: draft.userMemory.trim() || undefined,
    updatedAt: nowIso,
  };
}

export function buildSavedExpertPendingContext(
  agent: AgentRecord,
  registry: AgentRegistry,
  operationId = createExpertOperationId(),
  draftCreatedAt = Date.now(),
): PendingAgentContext | null {
  const pending = buildPendingAgentFromRecord(agent, registry);
  if (!pending) return null;
  return {
    ...pending,
    boundSessionId: undefined,
    operationId,
    draftCreatedAt,
    draftSource: "agent-selection",
  };
}
