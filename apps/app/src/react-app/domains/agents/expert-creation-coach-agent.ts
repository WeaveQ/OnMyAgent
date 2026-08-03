import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { t } from "@/i18n";
import {
  buildBuiltinAgentRecords,
  EXPERT_CREATION_COACH_AGENT_ID,
  EXPERT_CREATION_COACH_AVATAR_PATH,
} from "./agent-builtin";
import { buildPendingAgentFromRecord } from "./agent-registry-store";
import type { AgentRecord, AgentRegistry, AgentWizardDraft } from "./agent-registry-types";
import {
  buildAgentToolAccess,
  type AgentToolAccessMap,
  type PendingAgentContext,
} from "./pending-agent-store";

/**
 * Prefer registry copy; fall back to product builtin so a stale localStorage
 * cache (pre-coach) cannot blank the creation coach panel.
 */
export function resolveExpertCreationCoachAgent(
  registry: AgentRegistry | null | undefined,
): AgentRecord | null {
  const fromRegistry = registry?.agents.find(
    (agent) => agent.id === EXPERT_CREATION_COACH_AGENT_ID,
  );
  if (fromRegistry) return fromRegistry;
  return buildBuiltinAgentRecords()[0] ?? null;
}

/**
 * Dedicated coach system prompt.
 * Do NOT use buildAgentSystemPrompt here — that injects
 * "Your identity is now: Expert coach" and makes the model introduce itself
 * as a bare product name instead of an expert-creation coach.
 */
export function buildExpertCreationCoachSystemPrompt(
  coach: AgentRecord,
  draft: AgentWizardDraft,
): string {
  const roleNote = coach.userNote.trim();
  const identity = [
    t("agents.expert_creation_coach_system_identity"),
    "Your only job is to help the user design and create a useful, dependable expert agent.",
    "When asked who you are, introduce yourself as the coach that assists with creating experts — not as a generic assistant, and not as the expert being created.",
    t("agents.expert_creation_coach_system_language", {
      name: t("agents.expert_creation_coach"),
    }),
    "Use a natural conversation. Ask one focused question at a time and offer concrete suggestions.",
    "Do not claim you already changed the form; suggestions apply only after the user confirms in the UI.",
  ].join("\n");
  const draftContext = [
    "Current expert draft on the form (read-only context; do not claim you already wrote these fields):",
    `Name: ${draft.name.trim() || "Not set"}`,
    `Description: ${draft.description.trim() || "Not set"}`,
    `Role prompt: ${draft.userNote.trim() || "Not set"}`,
    `Expert memory: ${draft.agentMemory.trim() || "Not set"}`,
  ].join("\n");
  return [identity, roleNote ? `Coach instructions:\n${roleNote}` : "", draftContext]
    .filter(Boolean)
    .join("\n\n");
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
  const coachName = t("agents.expert_creation_coach");
  const coachAvatarUrl = resolvePublicAssetUrl(EXPERT_CREATION_COACH_AVATAR_PATH);
  return {
    ...base,
    name: coachName,
    // Empty description avoids the centered marketing hero; host uses welcome copy.
    description: "",
    avatar: {
      ...base.avatar,
      customAvatarDataUrl: EXPERT_CREATION_COACH_AVATAR_PATH,
      avatarUrl: coachAvatarUrl,
    },
    systemPrompt: buildExpertCreationCoachSystemPrompt(coach, draft),
    tools: buildExpertCreationCoachToolAccess(coach),
    conversationStartId: Date.now(),
    draftSource: "agent-selection",
  };
}
