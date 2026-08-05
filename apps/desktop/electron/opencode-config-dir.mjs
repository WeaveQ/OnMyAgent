/**
 * OpenCode config-dir preparation for managed desktop runtime:
 * plugin pin align, default builtin skills, artifact/legacy skill materialization.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ARTIFACT_PLUGIN_SKILL_IDS,
  artifactPluginEnablementPath,
  materializeEnabledArtifactSkills,
  materializeLegacySkillLinks,
  readArtifactPluginEnablementSnapshot,
  scanBundledArtifactPlugins,
} from "./artifact-plugin-runtime.mjs";
import {
  desiredOpencodePluginVersion,
  shouldAlignOpencodePluginPin,
} from "./runtime-helpers.mjs";
import { parseVersionTokens } from "./opencode-binary-policy.mjs";

/**
 * Sync skill-dir walk (SKILL.md one level deep + one nested level).
 * @param {string | null | undefined} root
 * @returns {string[]}
 */
export function collectSkillDirs(root) {
  if (!root || !existsSync(root)) return [];
  const dirs = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const direct = path.join(root, entry.name);
    if (existsSync(path.join(direct, "SKILL.md"))) {
      dirs.push(direct);
      continue;
    }
    let nestedEntries = [];
    try {
      nestedEntries = readdirSync(direct, { withFileTypes: true });
    } catch {
      nestedEntries = [];
    }
    for (const nested of nestedEntries) {
      if (!nested.isDirectory() && !nested.isSymbolicLink()) continue;
      const nestedDir = path.join(direct, nested.name);
      if (existsSync(path.join(nestedDir, "SKILL.md"))) {
        dirs.push(nestedDir);
      }
    }
  }
  return dirs;
}

/**
 * Keep @opencode-ai/plugin package pin aligned with the product OpenCode
 * version. A lagging pin (e.g. 1.14.x plugin against 1.17.x runtime) is a
 * common root cause of "fn3 is not a function" during provider load.
 *
 * @param {string} configDir
 * @param {string | null | undefined} opencodeVersion
 */
export async function ensureOpencodePluginPackagePin(configDir, opencodeVersion) {
  const pin = parseVersionTokens(opencodeVersion);
  if (!pin || !configDir) return;
  const desired = desiredOpencodePluginVersion(opencodeVersion);
  if (!desired) return;
  const packagePath = path.join(configDir, "package.json");
  /** @type {{ dependencies?: Record<string, string>, [key: string]: unknown }} */
  let pkg = { dependencies: {} };
  try {
    if (existsSync(packagePath)) {
      const parsed = JSON.parse(await readFile(packagePath, "utf8"));
      if (parsed && typeof parsed === "object") pkg = parsed;
    }
  } catch {
    pkg = { dependencies: {} };
  }
  if (
    !pkg.dependencies ||
    typeof pkg.dependencies !== "object" ||
    Array.isArray(pkg.dependencies)
  ) {
    pkg.dependencies = {};
  }
  const current = String(pkg.dependencies["@opencode-ai/plugin"] ?? "").trim();
  if (!shouldAlignOpencodePluginPin(current, desired)) return;
  pkg.dependencies["@opencode-ai/plugin"] = desired;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.warn(
    `[runtime] Aligned ${packagePath} @opencode-ai/plugin ${current || "(missing)"} -> ${desired}. Reinstall plugins if provider load still fails (fn3).`,
  );
}

/**
 * Materialize managed skills + plugin pins under an OpenCode config dir.
 *
 * @param {string} configDir
 * @param {{
 *   resolveOpencodeVersion?: () => string | null | undefined | Promise<string | null | undefined>,
 *   bundledSkillsRootPath: () => string | null,
 *   onmyagentUserSkillsRoot: () => string,
 *   bundledPluginsRootPath: () => string | null,
 * }} deps
 */
export async function prepareOnMyAgentOpencodeConfigDir(configDir, deps) {
  const skillsDir = path.join(configDir, "skills");
  await mkdir(skillsDir, { recursive: true });

  try {
    if (typeof deps.resolveOpencodeVersion === "function") {
      const version = await deps.resolveOpencodeVersion();
      if (version) {
        await ensureOpencodePluginPackagePin(configDir, version);
      }
    }
  } catch (error) {
    console.warn("[runtime] Failed to align @opencode-ai/plugin pin:", error);
  }

  const bundledSkillsRootPath = deps.bundledSkillsRootPath;
  const onmyagentUserSkillsRoot = deps.onmyagentUserSkillsRoot;
  const bundledPluginsRootPath = deps.bundledPluginsRootPath;

  await import("./ensure-default-builtin-skills.mjs")
    .then((m) =>
      m.ensureDefaultBuiltinSkillsFromRoots(
        bundledSkillsRootPath,
        onmyagentUserSkillsRoot,
      ),
    )
    .catch((error) =>
      console.warn("[runtime] ensureDefaultBuiltinSkills failed:", error),
    );

  const artifactSkillIds = new Set(ARTIFACT_PLUGIN_SKILL_IDS);
  const pluginRoot = bundledPluginsRootPath();
  if (pluginRoot) {
    const catalog = await scanBundledArtifactPlugins(pluginRoot);
    for (const plugin of catalog.items) {
      for (const skill of plugin.skills) artifactSkillIds.add(skill.id);
    }
    const snapshot = await readArtifactPluginEnablementSnapshot({
      enablementPath: artifactPluginEnablementPath(
        process.env.ONMYAGENT_SERVER_CONFIG?.trim() || undefined,
      ),
      catalog,
    });
    const materialized = await materializeEnabledArtifactSkills({
      pluginRoot,
      managedSkillsRoot: skillsDir,
      enabledSkillIds: snapshot.enabledSkillIds,
    });
    for (const diagnostic of [
      ...snapshot.diagnostics,
      ...materialized.diagnostics,
    ]) {
      console.warn("[runtime] Artifact plugin skill diagnostic:", diagnostic);
    }
  }

  // Only materialize *installed* user skills into OpenCode config.
  // Full bundled-skills tree is catalog/install source, not always-on Agent load.
  const roots = [onmyagentUserSkillsRoot()].filter(Boolean);
  const legacySkillDirs = [];
  for (const root of roots) {
    for (const skillDir of collectSkillDirs(root)) {
      legacySkillDirs.push(skillDir);
    }
  }
  await materializeLegacySkillLinks({
    skillDirs: legacySkillDirs,
    managedSkillsRoot: skillsDir,
    legacySkillRoots: roots,
    reservedSkillIds: artifactSkillIds,
  });
  return configDir;
}
