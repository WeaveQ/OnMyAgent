import { EXPERT_CREATION_COACH_AGENT_ID } from "./agent-builtin";
import { buildPendingAgentFromRecord } from "./agent-registry-store";
import type { AgentRecord, AgentRegistry, AgentWizardDraft } from "./agent-registry-types";
import {
  buildAgentSystemPrompt,
  buildAgentToolAccess,
  type AgentToolAccessMap,
  type PendingAgentContext,
} from "./pending-agent-store";

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

/**
 * PendingAgentContext for SessionSurface agentContext — identity + live draft system.
 * Does not touch the global pending-agent store.
 */
export function buildExpertCreationCoachPendingContext(
  registry: AgentRegistry,
  draft: AgentWizardDraft,
): PendingAgentContext | null {
  const coach = resolveExpertCreationCoachAgent(registry);
  if (!coach) return null;
  const base = buildPendingAgentFromRecord(coach, registry);
  if (!base) return null;
  return {
    ...base,
    systemPrompt: buildExpertCreationCoachSystemPrompt(coach, draft),
    tools: buildExpertCreationCoachToolAccess(coach),
    conversationStartId: Date.now(),
    draftSource: "agent-selection",
  };
}
