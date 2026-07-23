/**
 * skills domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

import { materializeExpertPackageSkills } from "../expert-package-skills.mjs";

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "importSkill",
  "installSkillTemplate",
  "listLocalSkills",
  "onmyagentSkillsRoot",
  "onmyagentMarketplaceRoot",
  "listExpertPackages",
  "listExpertRegistryRecords",
  "installExpertPackage",
  "installBuiltinSkillPackage",
  "writeMyExpertPackage",
  "readLocalSkill",
  "writeLocalSkill",
  "uninstallSkill",
]);

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (event: any, args: any[]) => any>}
 */
export function createSkillsDomainHandlers({
  ensureProjectSkillRoot,
  validateSkillName,
  pathExists,
  execResult,
  rm,
  cp,
  mkdir,
  writeFile,
  readFile,
  path,
  listLocalSkills,
  onmyagentUserSkillsRoot,
  validateExpertMarketplaceName,
  onmyagentMarketplaceRoot,
  listExpertPackages,
  listExpertRegistryRecords,
  builtinExpertPackageSource,
  existsSync,
  copyDirectoryRecursive,
  builtinSkillPackageSource,
  validateExpertPackageName,
  myExpertPackageFiles,
  findSkillFile,
  isBundledSkillPath,
} = {}) {
  return {
  importSkill: async (event, args) => {
    const projectDir = String(args[0] ?? "").trim();
    const sourceDir = String(args[1] ?? "").trim();
    const overwrite = args[2]?.overwrite === true;
    if (!projectDir || !sourceDir) {
      throw new Error("projectDir and sourceDir are required");
    }
    const skillRoot = await ensureProjectSkillRoot(projectDir);
    const name = validateSkillName(path.basename(sourceDir));
    const destination = path.join(skillRoot, name);
    if (await pathExists(destination)) {
      if (!overwrite) {
        return execResult(
          false,
          "",
          `Skill already exists at ${destination}`,
        );
      }
      await rm(destination, { recursive: true, force: true });
    }
    await cp(sourceDir, destination, { recursive: true });
    return execResult(true, `Imported skill to ${destination}`);
  },

  installSkillTemplate: async (event, args) => {
    const projectDir = String(args[0] ?? "").trim();
    const name = validateSkillName(args[1]);
    const content = String(args[2] ?? "");
    const overwrite = args[3]?.overwrite === true;
    const skillRoot = await ensureProjectSkillRoot(projectDir);
    const destination = path.join(skillRoot, name);
    if (await pathExists(destination)) {
      if (!overwrite) {
        return execResult(
          false,
          "",
          `Skill already exists at ${destination}`,
        );
      }
      await rm(destination, { recursive: true, force: true });
    }
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, "SKILL.md"), content, "utf8");
    return execResult(true, `Installed skill to ${destination}`);
  },

  listLocalSkills: async (event, args) => {
    return listLocalSkills(String(args[0] ?? "").trim());
  },

  onmyagentSkillsRoot: async (event, args) => {
    await mkdir(onmyagentUserSkillsRoot(), { recursive: true });
    return onmyagentUserSkillsRoot();
  },

  onmyagentMarketplaceRoot: async (event, args) => {
    const marketplace = validateExpertMarketplaceName(args[0]);
    const root = onmyagentMarketplaceRoot(marketplace);
    await mkdir(root, { recursive: true });
    return root;
  },

  listExpertPackages: async (event, args) => {
    const marketplace = validateExpertMarketplaceName(args[0]);
    await mkdir(onmyagentMarketplaceRoot(marketplace), { recursive: true });
    return listExpertPackages(marketplace);
  },

  listExpertRegistryRecords: async (event, args) => {
    const marketplace = validateExpertMarketplaceName(args[0]);
    await mkdir(onmyagentMarketplaceRoot(marketplace), { recursive: true });
    return listExpertRegistryRecords(marketplace);
  },

  installExpertPackage: async (event, args) => {
    const input = args[0] ?? {};
    const source = String(input.source ?? "builtin").trim();
    if (source !== "builtin") throw new Error("Unsupported expert package source");
    const marketplace = validateExpertMarketplaceName(input.marketplace ?? "experts");
    const { safePackage, candidates } = builtinExpertPackageSource(input.packageName);
    const sourceDir = candidates.find((candidate) => existsSync(candidate));
    if (!sourceDir) {
      throw new Error(
        `Built-in expert package not found: ${safePackage}. Checked: ${candidates.join(", ")}`,
      );
    }
    const destinationRoot = onmyagentMarketplaceRoot(marketplace);
    const destination = path.join(destinationRoot, safePackage);
    await mkdir(destinationRoot, { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await copyDirectoryRecursive(sourceDir, destination);
    // Expert-owned skills (e.g. order-entry on order-entry-clerk) must also land
    // in the user skills root so load_skill / listSkills resolve them by name.
    const skills = await materializeExpertPackageSkills({
      packageDir: destination,
      skillsRoot: onmyagentUserSkillsRoot(),
    });
    return {
      ok: true,
      path: destination,
      packageName: safePackage,
      marketplace,
      skills,
    };
  },

  installBuiltinSkillPackage: async (event, args) => {
    const input = args[0] ?? {};
    const source = String(input.source ?? "builtin").trim();
    if (source !== "builtin") throw new Error("Unsupported skill package source");
    const { safePackage, candidates } = builtinSkillPackageSource(input.packageName);
    const safeSkillName = validateSkillName(input.skillName ?? safePackage);
    const sourceDir = candidates.find((candidate) => existsSync(candidate));
    if (!sourceDir) {
      throw new Error(
        `Built-in skill package not found: ${safePackage}. Checked: ${candidates.join(", ")}`,
      );
    }
    const destinationRoot = onmyagentUserSkillsRoot();
    const destination = path.join(destinationRoot, safeSkillName);
    await mkdir(destinationRoot, { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await cp(sourceDir, destination, { recursive: true });
    return { ok: true, path: destination, packageName: safePackage, skillName: safeSkillName };
  },

  writeMyExpertPackage: async (event, args) => {
    const input = args[0] ?? {};
    const safePackage = validateExpertPackageName(input.packageName ?? input.id);
    const destinationRoot = onmyagentMarketplaceRoot("my-experts");
    const destination = path.join(destinationRoot, safePackage);
    const files = myExpertPackageFiles(input, safePackage);
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.join(destination, ".expert-plugin"), { recursive: true });
    await mkdir(path.join(destination, "agents"), { recursive: true });
    await writeFile(
      path.join(destination, ".expert-plugin", "plugin.json"),
      `${JSON.stringify(files.plugin, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(destination, "agents", `${safePackage}.md`),
      files.agentMarkdown,
      "utf8",
    );
    await writeFile(path.join(destination, "README.md"), files.readme, "utf8");
    return { ok: true, path: destination, packageName: safePackage, marketplace: "my-experts" };
  },

  readLocalSkill: async (event, args) => {
    const projectDir = String(args[0] ?? "").trim();
    const skillPath = await findSkillFile(projectDir, args[1]);
    if (!skillPath) {
      throw new Error("Skill not found");
    }
    return { path: skillPath, content: await readFile(skillPath, "utf8") };
  },

  writeLocalSkill: async (event, args) => {
    const projectDir = String(args[0] ?? "").trim();
    const skillPath = await findSkillFile(projectDir, args[1]);
    if (!skillPath) {
      return execResult(false, "", "Skill not found");
    }
    if (isBundledSkillPath(skillPath)) {
      return execResult(false, "", "Built-in skills are read-only");
    }
    const content = String(args[2] ?? "");
    const next = content.endsWith("\n") ? content : `${content}\n`;
    await writeFile(skillPath, next, "utf8");
    return execResult(
      true,
      `Saved skill ${path.basename(path.dirname(skillPath))}`,
    );
  },

  uninstallSkill: async (event, args) => {
    const projectDir = String(args[0] ?? "").trim();
    const skillPath = await findSkillFile(projectDir, args[1]);
    if (!skillPath) {
      return execResult(
        false,
        "",
        "Skill not found in .opencode/skills or .claude/skills",
      );
    }
    if (isBundledSkillPath(skillPath)) {
      return execResult(false, "", "Built-in skills are read-only");
    }
    await rm(path.dirname(skillPath), { recursive: true, force: true });
    return execResult(true, `Removed skill ${args[1]}`);
  },

  };
}
