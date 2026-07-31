/**
 * Materialize expert-package skills into the OnMyAgent user skills root so
 * load_skill / listSkills can resolve them by name.
 *
 * Built-in experts declare skills in plugin.json (`skills: ["./skills/foo"]`)
 * and agent frontmatter (`skills: [foo]`). Install used to copy only the
 * marketplace package; the skill never appeared in ~/.onmyagent/skills/.
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const RETIRED_EXPERT_PACKAGE_SKILLS = new Map([
  ["order-dispatch-specialist", ["introduce-order-dispatch"]],
  ["fleet-management-specialist", ["introduce-fleet-management"]],
  ["fulfillment-specialist", ["introduce-fulfillment"]],
  ["logistics-finance-specialist", ["introduce-logistics-finance"]],
]);

/**
 * @param {string} packageDir
 * @returns {Promise<Array<{ skillName: string, sourceDir: string }>>}
 */
export async function listExpertPackageSkillSources(packageDir) {
  const root = String(packageDir ?? "").trim();
  if (!root) return [];

  const plugin =
    (await readJsonIfExists(path.join(root, ".onmyagent-plugin", "plugin.json"))) ??
    (await readJsonIfExists(path.join(root, ".expert-plugin", "plugin.json"))) ??
    {};
  const refs = Array.isArray(plugin.skills) ? plugin.skills : [];
  const sources = [];

  for (const ref of refs) {
    const relative = String(ref ?? "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");
    if (!relative || relative.includes("..") || path.isAbsolute(relative)) continue;
    const sourceDir = path.join(root, ...relative.split("/").filter(Boolean));
    const skillMd = path.join(sourceDir, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const folderName = path.basename(sourceDir);
    if (!isSafeSkillFolderName(folderName)) continue;
    const frontmatterName = await readSkillFrontmatterName(skillMd);
    // listSkills requires directory name === frontmatter name when present.
    const skillName = frontmatterName || folderName;
    if (frontmatterName && frontmatterName !== folderName) {
      // Prefer folder layout that matches frontmatter for inventory compatibility.
      continue;
    }
    if (!isSafeSkillFolderName(skillName)) continue;
    sources.push({ skillName, sourceDir });
  }
  return sources;
}

/**
 * Copy each package skill into skillsRoot/<skillName>.
 * @param {{ packageDir: string, skillsRoot: string }} input
 * @returns {Promise<string[]>} installed skill names
 */
export async function materializeExpertPackageSkills(input) {
  const packageDir = String(input?.packageDir ?? "").trim();
  const skillsRoot = String(input?.skillsRoot ?? "").trim();
  if (!packageDir || !skillsRoot) return [];

  const sources = await listExpertPackageSkillSources(packageDir);
  if (sources.length === 0) return [];

  await mkdir(skillsRoot, { recursive: true });
  const installed = [];
  for (const { skillName, sourceDir } of sources) {
    const destination = path.join(skillsRoot, skillName);
    await rm(destination, { recursive: true, force: true });
    await cp(sourceDir, destination, { recursive: true });
    installed.push(skillName);
  }
  return installed;
}

/**
 * Remove known retired skills that older releases materialized globally.
 * The package-name allowlist keeps cleanup scoped to legacy expert-owned
 * folders and leaves every unrelated user skill untouched.
 * @param {{ packageDir: string, skillsRoot: string }} input
 * @returns {Promise<string[]>} removed skill names
 */
export async function removeRetiredExpertPackageSkills(input) {
  const packageDir = String(input?.packageDir ?? "").trim();
  const skillsRoot = String(input?.skillsRoot ?? "").trim();
  if (!packageDir || !skillsRoot) return [];

  const packageName = path.basename(packageDir);
  const retiredSkills = RETIRED_EXPERT_PACKAGE_SKILLS.get(packageName) ?? [];
  const removed = [];
  for (const skillName of retiredSkills) {
    const destination = path.join(skillsRoot, skillName);
    if (!existsSync(destination)) continue;
    await rm(destination, { recursive: true, force: true });
    removed.push(skillName);
  }
  return removed;
}

/**
 * Materialize expert-owned skills and expose them to an already-running
 * OpenCode config without requiring an engine restart.
 * @param {{
 *   packageDir: string,
 *   skillsRoot: string,
 *   refreshSkillLinks?: () => Promise<unknown>,
 * }} input
 * @returns {Promise<string[]>} installed skill names
 */
export async function materializeExpertPackageSkillsAndRefresh(input) {
  const removed = await removeRetiredExpertPackageSkills(input);
  const installed = await materializeExpertPackageSkills(input);
  if (
    (installed.length > 0 || removed.length > 0) &&
    typeof input?.refreshSkillLinks === "function"
  ) {
    await input.refreshSkillLinks();
  }
  return installed;
}

function isSafeSkillFolderName(value) {
  const name = String(value ?? "").trim();
  return Boolean(name) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name !== "." && name !== "..";
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function readSkillFrontmatterName(skillMdPath) {
  try {
    const raw = await readFile(skillMdPath, "utf8");
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return "";
    const nameLine = match[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("name:"));
    if (!nameLine) return "";
    return nameLine
      .slice("name:".length)
      .trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}
