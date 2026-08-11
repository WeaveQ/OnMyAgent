/**
 * Materialize expert-package skills into the OnMyAgent user skills root so
 * load_skill / listSkills can resolve them by name.
 *
 * Built-in experts declare skills in plugin.json (`skills: ["./skills/foo"]`)
 * and agent frontmatter (`skills: [foo]`). Install used to copy only the
 * marketplace package; the skill never appeared in ~/.onmyagent/skills/.
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const EXPERT_OWNERS_FILE = ".onmyagent-expert-owners.json";

const RETIRED_EXPERT_PACKAGE_SKILLS = new Map([
  ["order-dispatch-specialist", ["introduce-order-dispatch"]],
  ["fleet-management-specialist", ["introduce-fleet-management"]],
  ["fulfillment-specialist", ["introduce-fulfillment"]],
  ["logistics-finance-specialist", ["introduce-logistics-finance"]],
  ["kol-media-specialist", ["kol-content-risk-checklist"]],
  [
    "kol-content-ops-specialist",
    [
      "kol-content-risk-checklist",
      "kol-rebate-invoice-audit",
      "kol-script-risk-review",
    ],
  ],
  ["kol-project-review-specialist", ["kol-content-risk-checklist"]],
]);

const RETIRED_CREATOR_OPS_SKILL_SHA256 = new Map([
  [
    "kol-content-risk-checklist",
    "6c9f0a7b9c5cfca359211889609e607fa0e946132af1114a08ea4c03d4505af9",
  ],
  [
    "kol-rebate-invoice-audit",
    "5e34b69711d53394abf7a6e2b7c69352350ade3b8ffc165a00b1383f7bbe1fed",
  ],
  [
    "kol-script-risk-review",
    "0bc260648e73b7272c1ed1ec99819ba1d05ac766f56bd0fd86d3685b5d96f57f",
  ],
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
 * Read the canonical package manifest declarations without requiring every
 * source directory to exist. Missing declarations remain visible to callers.
 * @param {string} packageDir
 * @returns {Promise<string[]>}
 */
export async function listExpertPackageSkillDeclarations(packageDir) {
  const root = String(packageDir ?? "").trim();
  if (!root) return [];
  const plugin =
    (await readJsonIfExists(path.join(root, ".onmyagent-plugin", "plugin.json"))) ??
    (await readJsonIfExists(path.join(root, ".expert-plugin", "plugin.json"))) ??
    {};
  return [...new Set((Array.isArray(plugin.skills) ? plugin.skills : [])
    .map((ref) => String(ref ?? "").trim().replace(/\\/g, "/").replace(/\/$/, ""))
    .map((ref) => ref.split("/").filter(Boolean).pop() ?? "")
    .filter((name) => isSafeSkillFolderName(name)))];
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
  const packageName = path.basename(packageDir);
  for (const { skillName, sourceDir } of sources) {
    const destination = path.join(skillsRoot, skillName);
    const owners = await readExpertOwners(destination);
    const otherOwners = owners.filter((owner) => owner !== packageName);
    if (otherOwners.length > 0 && !(await skillTreesMatch(sourceDir, destination))) {
      throw new Error(
        `Expert skill collision for ${skillName}: ${packageName} differs from ${otherOwners.join(", ")}`,
      );
    }
    await rm(destination, { recursive: true, force: true });
    await cp(sourceDir, destination, { recursive: true });
    await writeExpertOwners(destination, [...otherOwners, packageName]);
    installed.push(skillName);
  }
  return installed;
}

/**
 * Materialize canonical declarations while preserving an explicit missing
 * list for recovery UI and marker projection.
 * @param {{ packageDir: string, skillsRoot: string }} input
 * @returns {Promise<{ declared: string[], installed: string[], missing: string[] }>}
 */
export async function materializeExpertPackageSkillsState(input) {
  const declared = await listExpertPackageSkillDeclarations(input?.packageDir);
  const installed = await materializeExpertPackageSkills(input);
  return {
    declared,
    installed,
    missing: declared.filter((name) => !installed.includes(name)),
  };
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
    if (
      packageName.startsWith("kol-") &&
      !(await matchesRetiredCreatorOpsSkill(destination, skillName))
    ) {
      continue;
    }
    await rm(destination, { recursive: true, force: true });
    removed.push(skillName);
  }
  return removed;
}

async function matchesRetiredCreatorOpsSkill(destination, skillName) {
  const expectedHash = RETIRED_CREATOR_OPS_SKILL_SHA256.get(skillName);
  if (!expectedHash) return false;
  try {
    const entries = await readdir(destination);
    if (entries.length !== 1 || entries[0] !== "SKILL.md") return false;
    const markdown = await readFile(path.join(destination, "SKILL.md"), "utf8");
    const actualHash = createHash("sha256").update(markdown).digest("hex");
    return actualHash === expectedHash;
  } catch {
    return false;
  }
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

/**
 * Materialize expert-owned skills and retain the declaration state for marker
 * and recovery consumers. Missing declarations are intentionally preserved;
 * callers can surface them without treating a partial package as complete.
 * @param {{
 *   packageDir: string,
 *   skillsRoot: string,
 *   refreshSkillLinks?: () => Promise<unknown>,
 * }} input
 * @returns {Promise<{declared: string[], installed: string[], missing: string[]}>}
 */
export async function materializeExpertPackageSkillsStateAndRefresh(input) {
  const removed = await removeRetiredExpertPackageSkills(input);
  const state = await materializeExpertPackageSkillsState(input);
  if (
    (state.installed.length > 0 || removed.length > 0) &&
    typeof input?.refreshSkillLinks === "function"
  ) {
    await input.refreshSkillLinks();
  }
  return state;
}

/**
 * Remove skills that this expert package previously materialized into skillsRoot.
 * Only removes package-owned skill folders (plugin.json skills entries); never
 * deletes arbitrary user skills by skillIds references.
 * @param {{ packageDir: string, skillsRoot: string }} input
 * @returns {Promise<string[]>} removed skill names
 */
export async function dematerializeExpertPackageSkills(input) {
  const packageDir = String(input?.packageDir ?? "").trim();
  const skillsRoot = String(input?.skillsRoot ?? "").trim();
  if (!packageDir || !skillsRoot) return [];

  const sources = await listExpertPackageSkillSources(packageDir);
  const removed = [];
  const packageName = path.basename(packageDir);
  for (const { skillName } of sources) {
    const destination = path.join(skillsRoot, skillName);
    if (!existsSync(destination)) continue;
    const owners = await readExpertOwners(destination);
    if (owners.length > 0) {
      if (!owners.includes(packageName)) continue;
      const remainingOwners = owners.filter((owner) => owner !== packageName);
      if (remainingOwners.length > 0) {
        await writeExpertOwners(destination, remainingOwners);
        continue;
      }
    }
    await rm(destination, { recursive: true, force: true });
    removed.push(skillName);
  }
  const retired = await removeRetiredExpertPackageSkills(input);
  for (const name of retired) {
    if (!removed.includes(name)) removed.push(name);
  }
  return removed;
}

/**
 * @param {{
 *   packageDir: string,
 *   skillsRoot: string,
 *   refreshSkillLinks?: () => Promise<unknown>,
 * }} input
 * @returns {Promise<string[]>}
 */
export async function dematerializeExpertPackageSkillsAndRefresh(input) {
  const removed = await dematerializeExpertPackageSkills(input);
  if (removed.length > 0 && typeof input?.refreshSkillLinks === "function") {
    await input.refreshSkillLinks();
  }
  return removed;
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

async function readExpertOwners(destination) {
  try {
    const raw = await readFile(path.join(destination, EXPERT_OWNERS_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.owners)) return [];
    return parsed.owners
      .map((owner) => String(owner ?? "").trim())
      .filter((owner) => isSafeSkillFolderName(owner));
  } catch {
    return [];
  }
}

async function writeExpertOwners(destination, owners) {
  const uniqueOwners = [...new Set(owners)].sort();
  await writeFile(
    path.join(destination, EXPERT_OWNERS_FILE),
    `${JSON.stringify({ owners: uniqueOwners }, null, 2)}\n`,
    "utf8",
  );
}

async function skillTreesMatch(sourceDir, destination) {
  try {
    const [sourceFingerprint, installedFingerprint] = await Promise.all([
      skillTreeFingerprint(sourceDir),
      skillTreeFingerprint(destination),
    ]);
    return sourceFingerprint === installedFingerprint;
  } catch {
    return false;
  }
}

async function skillTreeFingerprint(root) {
  const hash = createHash("sha256");

  async function visit(directory, relativeRoot = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!relativeRoot && entry.name === EXPERT_OWNERS_FILE) continue;
      const relativePath = path.posix.join(relativeRoot, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D\0${relativePath}\0`);
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        hash.update(`F\0${relativePath}\0`);
        hash.update(await readFile(absolutePath));
        hash.update("\0");
      } else {
        throw new Error(`Unsupported skill entry: ${relativePath}`);
      }
    }
  }

  await visit(root);
  return hash.digest("hex");
}
