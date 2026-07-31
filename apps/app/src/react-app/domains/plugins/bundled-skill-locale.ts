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
  // Skill *names* stay English (displayNameEn / package name). Only descriptions
  // follow the UI locale so cards never show translated titles like “发现技能”.
  const name = skill.displayNameEn ?? skill.name;
  if (locale === "zh" || locale === "zh-TW") {
    return {
      name,
      description:
        skill.descriptionZh ??
        skill.descriptionEn ??
        skill.description ??
        skill.name,
    };
  }
  return {
    name,
    description:
      skill.descriptionEn ??
      skill.descriptionZh ??
      skill.description ??
      skill.name,
  };
}
