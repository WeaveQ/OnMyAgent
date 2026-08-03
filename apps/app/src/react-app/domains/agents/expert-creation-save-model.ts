import { createAgentRecordFromDraft } from "./agent-registry";
import { buildPendingAgentFromRecord } from "./agent-registry-store";
import type {
  AgentRecord,
  AgentRegistry,
  AgentSkillItem,
  AgentWizardDraft,
} from "./agent-registry-types";
import type { PendingAgentContext } from "./pending-agent-store";

export function createExpertRecordForSave(
  draft: AgentWizardDraft,
  nowIso: string,
  availableSkills: readonly AgentSkillItem[],
): AgentRecord {
  return createAgentRecordFromDraft(draft, nowIso, availableSkills);
}

export function buildSavedExpertPendingContext(
  agent: AgentRecord,
  registry: AgentRegistry,
  conversationStartId = Date.now(),
): PendingAgentContext | null {
  const pending = buildPendingAgentFromRecord(agent, registry);
  if (!pending) return null;
  return {
    ...pending,
    boundSessionId: undefined,
    conversationStartId,
    draftSource: "agent-selection",
  };
}
