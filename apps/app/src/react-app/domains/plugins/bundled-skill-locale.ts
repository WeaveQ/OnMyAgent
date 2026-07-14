import { currentLocale } from "../../../i18n";

type LocalizableSkill = {
  name: string;
  description?: string;
  displayNameZh?: string;
  displayNameEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
};

export function resolveBundledSkillDisplay(
  skill: LocalizableSkill,
): { name: string; description: string } {
  const locale = currentLocale();
  if (locale === "zh") {
    return {
      name: skill.displayNameZh ?? skill.displayNameEn ?? skill.name,
      description:
        skill.descriptionZh ??
        skill.descriptionEn ??
        skill.description ??
        skill.name,
    };
  }
  return {
    name: skill.displayNameEn ?? skill.displayNameZh ?? skill.name,
    description:
      skill.descriptionEn ??
      skill.descriptionZh ??
      skill.description ??
      skill.name,
  };
}
