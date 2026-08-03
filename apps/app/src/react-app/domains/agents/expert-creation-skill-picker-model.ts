import type { AgentSkillItem } from "./agent-registry-types";

function skillSearchText(skill: AgentSkillItem): string {
  return [
    skill.name,
    skill.displayNameEn,
    skill.displayNameZh,
    skill.description,
    skill.descriptionEn,
    skill.descriptionZh,
    skill.category,
    skill.group,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLocaleLowerCase();
}

export function filterExpertCreationSkills(
  skills: readonly AgentSkillItem[],
  query: string,
): AgentSkillItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...skills];
  return skills.filter((skill) => skillSearchText(skill).includes(normalizedQuery));
}

export function toggleExpertCreationSkillId(
  selectedIds: readonly string[],
  skillId: string,
): string[] {
  if (selectedIds.includes(skillId)) {
    return selectedIds.filter((id) => id !== skillId);
  }
  return [...selectedIds, skillId];
}
