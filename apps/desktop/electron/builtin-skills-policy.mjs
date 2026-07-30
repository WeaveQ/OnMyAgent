/**
 * Built-in skill install policy.
 *
 * Product model: bundled packages ship in the app, but Agent only loads skills
 * that are installed under the user skills root (same mental model as connectors).
 * A small core set is preinstalled on first launch.
 */

/** Package dir names under resources/bundled-skills that ship with the app. */
export const BUNDLED_SKILL_PACKAGE_NAMES = Object.freeze([
  "browser-automation",
  "browser-skill",
  "canvas-design",
  "computer-use",
  "create-automation",
  "doc-coauthoring",
  "document-processing",
  "expert-manager",
  "find-skills",
  "frontend-design",
  "github",
  "pptx",
  "qcc-company",
  "self-improving",
  "self-improving-agent",
  "skill-creator",
  "tencent-docs",
  "tencent-meeting-skill",
  "weather",
  "web-artifacts-builder",
  "webapp-testing",
  "wecom-unified",
]);

/**
 * First-launch / ensureDefault preinstall into ~/.onmyagent/skills.
 * packageName = folder under bundled-skills; skillName = installed folder name.
 */
export const CORE_PREINSTALL_SKILLS = Object.freeze([
  { packageName: "expert-manager", skillName: "expert-manager" },
  { packageName: "create-automation", skillName: "create-automation" },
  { packageName: "skill-creator", skillName: "skill-creator" },
  { packageName: "find-skills", skillName: "find-skills" },
  /** Unified office-document entry; format runtimes are provided by artifact skills and pptx. */
  { packageName: "document-processing", skillName: "document-processing" },
  { packageName: "pptx", skillName: "pptx" },
  { packageName: "self-improving", skillName: "self-improving" },
]);

/**
 * Whether a skill root path is the app-packaged bundled-skills tree.
 * Used so list/UI can still discover catalog without treating it as "installed".
 *
 * @param {string | null | undefined} root
 * @param {string | null | undefined} bundledRoot
 */
export function isBundledSkillsRoot(root, bundledRoot) {
  if (!root || !bundledRoot) return false;
  const a = String(root).replace(/[/\\]+$/, "");
  const b = String(bundledRoot).replace(/[/\\]+$/, "");
  return a === b;
}

/**
 * Global roots that should feed Agent load_skill / listLocalSkills.
 * Intentionally excludes the full bundled-skills tree.
 *
 * @param {{
 *   userSkillsRoot: string,
 *   extraRoots?: string[],
 * }} input
 */
export function selectAgentSkillRoots(input) {
  const roots = [];
  const seen = new Set();
  const push = (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    roots.push(trimmed);
  };
  push(input.userSkillsRoot);
  for (const root of input.extraRoots ?? []) push(root);
  return roots;
}

/**
 * @param {{
 *   packageName: string,
 *   skillName?: string,
 *   destinationExists: boolean,
 * }} input
 */
export function shouldInstallCoreSkill(input) {
  if (input.destinationExists) return false;
  return CORE_PREINSTALL_SKILLS.some(
    (entry) =>
      entry.packageName === input.packageName &&
      entry.skillName === (input.skillName ?? input.packageName),
  );
}

/**
 * Resolve catalog entries for UI (builtin tab).
 *
 * @param {{
 *   packageNames: string[],
 *   installedSkillNames: Set<string> | string[],
 *   corePackageNames?: Set<string> | string[],
 * }} input
 */
export function buildBuiltinSkillCatalogEntries(input) {
  const installed = new Set(
    Array.isArray(input.installedSkillNames)
      ? input.installedSkillNames
      : [...input.installedSkillNames],
  );
  const core = new Set(
    input.corePackageNames
      ? Array.isArray(input.corePackageNames)
        ? input.corePackageNames
        : [...input.corePackageNames]
      : CORE_PREINSTALL_SKILLS.map((e) => e.packageName),
  );
  return input.packageNames.map((packageName) => {
    const skillName = packageName;
    return {
      packageName,
      skillName,
      installed: installed.has(skillName),
      corePreinstall: core.has(packageName),
    };
  });
}
