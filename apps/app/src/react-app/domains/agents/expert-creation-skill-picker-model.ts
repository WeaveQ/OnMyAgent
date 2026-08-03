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

export function expertCreationSkillKey(
  skill: Pick<AgentSkillItem, "id" | "name">,
): string {
  return skill.name.trim() || skill.id.trim();
}

function findInstalledExpertCreationSkill(
  skill: AgentSkillItem,
  installedSkills: readonly AgentSkillItem[],
): AgentSkillItem | null {
  const key = expertCreationSkillKey(skill);
  return installedSkills.find(
    (candidate) => expertCreationSkillKey(candidate) === key,
  ) ?? null;
}

export function resolveExpertCreationSkillId(
  skill: AgentSkillItem,
  installedSkills: readonly AgentSkillItem[],
): string {
  return findInstalledExpertCreationSkill(skill, installedSkills)?.id ?? skill.id;
}

export function isExpertCreationSkillSelected(
  skill: AgentSkillItem,
  selectedIds: readonly string[],
  installedSkills: readonly AgentSkillItem[],
): boolean {
  return selectedIds.includes(resolveExpertCreationSkillId(skill, installedSkills));
}

export function toggleExpertCreationSkill(
  selectedIds: readonly string[],
  skill: AgentSkillItem,
  installedSkills: readonly AgentSkillItem[],
): string[] {
  return toggleExpertCreationSkillId(
    selectedIds,
    resolveExpertCreationSkillId(skill, installedSkills),
  );
}

export function materializeExpertCreationMarketplaceSkill(
  skill: AgentSkillItem,
  path: string,
): AgentSkillItem {
  return {
    ...skill,
    id: expertCreationSkillKey(skill),
    enabled: true,
    path,
  };
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
