import { t } from "@/i18n";

import type { AgentRecord } from "./agent-registry-types";

/** Stable id for the expert-creation coach agent (product-bundled). */
export const EXPERT_CREATION_COACH_AGENT_ID = "builtin-expert-creation-coach";

const BUILTIN_AGENT_IDS = new Set<string>([EXPERT_CREATION_COACH_AGENT_ID]);

const BUILTIN_STAMP = "2026-05-29T00:00:00.000Z";

export function isBuiltinAgentId(id: string): boolean {
  return BUILTIN_AGENT_IDS.has(id.trim());
}

export function isBuiltinAgentRecord(
  agent: Pick<AgentRecord, "id" | "builtin">,
): boolean {
  return agent.builtin === true || isBuiltinAgentId(agent.id);
}

/**
 * Product-owned agent definitions. Always rebuilt from code so copy/prompt
 * updates ship without depending on user registry JSON.
 */
export function buildBuiltinAgentRecords(): AgentRecord[] {
  return [
    {
      id: EXPERT_CREATION_COACH_AGENT_ID,
      name: t("agents.builtin_expert_creation_coach_name"),
      description: t("agents.builtin_expert_creation_coach_description"),
      quote: t("agents.builtin_expert_creation_coach_quote"),
      tone: "friendly",
      avatarStyle: "lorelei",
      avatarOptionId: "lorelei-mentor",
      customAvatarDataUrl: null,
      modelProvider: "auto",
      model: "Auto",
      // Chat-only coach: no tool categories enabled.
      enabledToolIds: [],
      defaultWorkspace: "",
      skillIds: [],
      preferredName: "",
      preferredLanguage: "\u4E2D\u6587",
      userNote: t("agents.builtin_expert_creation_coach_user_note"),
      userBackground: "",
      agentMemory: undefined,
      userMemory: undefined,
      sourceTemplateId: null,
      builtin: true,
      createdAt: BUILTIN_STAMP,
      updatedAt: BUILTIN_STAMP,
    },
  ];
}

/** Prepend product builtins; drop any user copy of the same ids. */
export function mergeBuiltinAgents(
  userAgents: readonly AgentRecord[],
): AgentRecord[] {
  const builtins = buildBuiltinAgentRecords();
  const userOnly = userAgents.filter((agent) => !isBuiltinAgentRecord(agent));
  return [...builtins, ...userOnly];
}
