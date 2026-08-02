import { createAgentRecordFromDraft } from "./agent-registry";
import type {
  AgentRecord,
  AgentSkillItem,
  AgentWizardDraft,
} from "./agent-registry-types";

export function createExpertRecordForSave(
  draft: AgentWizardDraft,
  nowIso: string,
  availableSkills: readonly AgentSkillItem[],
): AgentRecord {
  return createAgentRecordFromDraft(draft, nowIso, availableSkills);
}

