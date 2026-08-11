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
