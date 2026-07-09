/**
 * Plugins / skills catalog domain.
 */
export {
  ConnectorsPage,
  PluginsPage,
  SkillsPage,
} from "./plugins-page";
export { resolveBundledSkillDisplay } from "./bundled-skill-locale";
export {
  ALL_SKILLS,
  LEGACY_SKILLS,
  type SkillCategory,
  type SkillItem,
} from "./skills-catalog";
export {
  LOCAL_ORIGIN_LABELS,
  SKILL_SCOPE_LABELS,
  classifyLocalOrigin,
  classifySkillScope,
  type LocalSkillOrigin,
  type SkillScope,
} from "./skill-scope";
