import type { AgentSkillItem, AgentWizardDraft } from "./agent-registry-types";

export type ExpertCoachProposal = {
  name: string;
  description: string;
  rolePrompt: string;
  memory: string;
  skillIds: string[];
};

export type ExpertCoachTurnResult = {
  reply: string;
  proposal: ExpertCoachProposal | null;
};

export const EXPERT_COACH_OUTPUT_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reply", "proposal"],
    properties: {
      reply: { type: "string" },
      proposal: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["name", "description", "rolePrompt", "memory", "skillIds"],
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              rolePrompt: { type: "string" },
              memory: { type: "string" },
              skillIds: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        ],
      },
    },
  },
  retryCount: 2,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseExpertCoachProposal(value: unknown): ExpertCoachProposal | null {
  const parsed = parseNullableProposal(value);
  return parsed === undefined ? null : parsed;
}

function parseNullableProposal(value: unknown): ExpertCoachProposal | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    typeof value.rolePrompt !== "string" ||
    typeof value.memory !== "string" ||
    !isStringArray(value.skillIds)
  ) {
    return undefined;
  }
  return {
    name: value.name,
    description: value.description,
    rolePrompt: value.rolePrompt,
    memory: value.memory,
    skillIds: value.skillIds,
  };
}

export function parseExpertCoachTurnResult(value: unknown): ExpertCoachTurnResult | null {
  if (!isRecord(value) || typeof value.reply !== "string") return null;
  const proposal = parseNullableProposal(value.proposal);
  if (proposal === undefined) return null;
  return { reply: value.reply, proposal };
}

export function applyExpertCoachProposal(
  draft: AgentWizardDraft,
  proposal: ExpertCoachProposal,
  skills: readonly AgentSkillItem[],
): AgentWizardDraft {
  const availableSkillIds = new Set(skills.filter((skill) => skill.enabled).map((skill) => skill.id));
  return {
    ...draft,
    name: proposal.name,
    description: proposal.description,
    userNote: proposal.rolePrompt,
    agentMemory: proposal.memory,
    skillIds: proposal.skillIds.filter((skillId) => availableSkillIds.has(skillId)),
  };
}

export function buildExpertCoachSystemPrompt(
  draft: AgentWizardDraft,
  skills: readonly AgentSkillItem[],
): string {
  const skillCatalog = skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      id: skill.id,
      name: skill.displayNameEn?.trim() || skill.name,
      description: skill.descriptionEn?.trim() || skill.description?.trim() || "",
    }));
  const currentDraft = {
    name: draft.name,
    description: draft.description,
    rolePrompt: draft.userNote,
    memory: draft.agentMemory,
    skillIds: draft.skillIds,
  };

  return [
    "You are an expert-creation coach inside OnMyAgent.",
    "Help the user clarify the expert's purpose, audience, boundaries, workflow, tone, memory, and useful existing skills.",
    "Ask focused questions when key information is missing. Do not pretend files, skills, or capabilities exist.",
    "Return a concise conversational reply in `reply`.",
    "Set `proposal` to null while clarification is still needed.",
    "When there is enough information, return a complete proposal. Only use skill IDs from the provided catalog.",
    "A proposal is only a version suggestion: it will not overwrite the user's form until they explicitly apply it.",
    `Current form: ${JSON.stringify(currentDraft)}`,
    `Available skills: ${JSON.stringify(skillCatalog)}`,
  ].join("\n");
}
