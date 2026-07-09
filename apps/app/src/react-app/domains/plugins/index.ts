/**
 * Plugins / skills catalog domain entry.
 *
 * Implementation still lives under `domains/shared/` transitionally.
 * New code should import from this entry (`domains/plugins`) so ownership
 * is clear. See `ARCHITECTURE.md` shared migration map.
 */
export {
  ConnectorsPage,
  PluginsPage,
  SkillsPage,
} from "../shared/plugins-page";
export { resolveBundledSkillDisplay } from "../shared/bundled-skill-locale";
export {
  ALL_SKILLS,
  LEGACY_SKILLS,
  type SkillCategory,
  type SkillItem,
} from "../shared/skills-catalog";
export {
  LOCAL_ORIGIN_LABELS,
  SKILL_SCOPE_LABELS,
  classifyLocalOrigin,
  classifySkillScope,
  type LocalSkillOrigin,
  type SkillScope,
} from "../shared/skill-scope";
