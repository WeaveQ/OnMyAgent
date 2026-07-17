/**
 * Plugins / skills catalog domain.
 */
export {
  ConnectorsPage,
  PluginsPage,
  SkillsPage,
  type ArtifactPluginPromptSelection,
} from "./plugins-page";
export { ArtifactPluginCard, type ArtifactPluginCardProps } from "./artifact-plugin-card";
export {
  ArtifactPluginDetail,
  ArtifactStarterPrompts,
  type ArtifactPluginDetailLabels,
  type ArtifactPluginDetailProps,
} from "./artifact-plugin-detail";
export {
  loadArtifactPluginCatalog,
  loadArtifactPluginDetail,
  type ArtifactPluginClient,
  type ArtifactPluginDetail as ArtifactPluginDetailModel,
} from "./artifact-plugin-client";
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
