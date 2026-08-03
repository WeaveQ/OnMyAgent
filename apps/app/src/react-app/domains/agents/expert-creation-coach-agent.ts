import { EXPERT_CREATION_COACH_AGENT_ID } from "./agent-builtin";
import type { AgentRecord, AgentRegistry, AgentWizardDraft } from "./agent-registry-types";
import { buildAgentSystemPrompt, buildAgentToolAccess } from "./pending-agent-store";
import type { AgentToolAccessMap } from "./pending-agent-store";

export function resolveExpertCreationCoachAgent(
  registry: AgentRegistry | null | undefined,
): AgentRecord | null {
  if (!registry) return null;
  return (
    registry.agents.find((agent) => agent.id === EXPERT_CREATION_COACH_AGENT_ID) ??
    null
  );
}

/**
 * Product coach identity (from builtin agent) + live form snapshot for this turn.
 */
export function buildExpertCreationCoachSystemPrompt(
  coach: AgentRecord,
  draft: AgentWizardDraft,
): string {
  const identity = buildAgentSystemPrompt(coach);
  const draftContext = [
    "Current expert draft on the form (read-only context; do not claim you already wrote these fields):",
    `Name: ${draft.name.trim() || "Not set"}`,
    `Description: ${draft.description.trim() || "Not set"}`,
    `Role prompt: ${draft.userNote.trim() || "Not set"}`,
    `Expert memory: ${draft.agentMemory.trim() || "Not set"}`,
  ].join("\n");
  return [identity, draftContext].filter(Boolean).join("\n\n");
}

/** Coach is chat-first: prefer agent tool policy (empty = all tools disabled). */
export function buildExpertCreationCoachToolAccess(
  coach: AgentRecord,
): AgentToolAccessMap | undefined {
  return buildAgentToolAccess(coach);
}
