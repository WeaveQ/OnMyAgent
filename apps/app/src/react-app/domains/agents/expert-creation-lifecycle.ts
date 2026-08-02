import type { AgentWizardDraft } from "./agent-registry-types";
import type { ExpertCoachState } from "./expert-creation-draft-storage";

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function hasExpertCreationProgress(
  draft: AgentWizardDraft,
  baseline: AgentWizardDraft,
  coach: ExpertCoachState,
  knowledgeCount: number,
): boolean {
  return knowledgeCount > 0
    || coach.messages.length > 0
    || coach.versions.length > 0
    || draft.name !== baseline.name
    || draft.description !== baseline.description
    || draft.avatarOptionId !== baseline.avatarOptionId
    || draft.customAvatarDataUrl !== baseline.customAvatarDataUrl
    || draft.userNote !== baseline.userNote
    || draft.agentMemory !== baseline.agentMemory
    || !sameStrings(draft.skillIds, baseline.skillIds);
}

