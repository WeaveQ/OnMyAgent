/**
 * skills domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

import {
  dematerializeExpertPackageSkillsAndRefresh,
  materializeExpertPackageSkillsAndRefresh,
} from "../expert-package-skills.mjs";

export const HANDLER_COMMAND_NAMES = Object.freeze([
  "importSkill",
  "installSkillTemplate",
  "listLocalSkills",
  "listBuiltinSkillCatalog",
  "ensureDefaultBuiltinSkills",
  "onmyagentSkillsRoot",
  "onmyagentMarketplaceRoot",
  "listExpertPackages",
  "listExpertRegistryRecords",
  "installExpertPackage",
  "uninstallExpertPackage",
  "installBuiltinSkillPackage",
  "writeMyExpertPackage",
  "stageMyExpertKnowledge",
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
  listBuiltinSkillCatalog,
  ensureDefaultBuiltinSkills,
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
  refreshRuntimeSkillLinks,
} = {}) {
  const normalizeKnowledgePath = (value) => {
    const normalized = String(value ?? "").replaceAll("\\", "/").trim();
    const segments = normalized.split("/").filter(Boolean);
    if (
      !normalized ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:\//.test(normalized) ||
      segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))
    ) {
      throw new Error("Invalid expert knowledge path");
    }
    return segments.join("/");
  };
  const parseAvatarDataUrl = (value) => {
    const match = String(value ?? "").match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return null;
    const extension = match[1] === "image/jpeg"
      ? "jpg"
      : match[1] === "image/svg+xml"
        ? "svg"
        : match[1].slice("image/".length);
    return { extension, bytes: Buffer.from(match[2], "base64") };
  };
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

  listBuiltinSkillCatalog: async () => {
    if (typeof listBuiltinSkillCatalog === "function") {
      return listBuiltinSkillCatalog();
    }
    return { skills: [] };
  },

  ensureDefaultBuiltinSkills: async () => {
    if (typeof ensureDefaultBuiltinSkills === "function") {
      return ensureDefaultBuiltinSkills();
    }
    return { ok: true, installed: [], skipped: [], errors: [] };
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
    const skills = await materializeExpertPackageSkillsAndRefresh({
      packageDir: destination,
      skillsRoot: onmyagentUserSkillsRoot(),
      refreshSkillLinks: refreshRuntimeSkillLinks,
    });
    return {
      ok: true,
      path: destination,
      packageName: safePackage,
      marketplace,
      skills,
    };
  },

  uninstallExpertPackage: async (event, args) => {
    const input = args[0] ?? {};
    const marketplace = validateExpertMarketplaceName(input.marketplace ?? "my-experts");
    const safePackage = validateExpertPackageName(input.packageName ?? input.id);
    const destinationRoot = onmyagentMarketplaceRoot(marketplace);
    const destination = path.join(destinationRoot, safePackage);
    const packageExists = existsSync(destination);
    let removedSkills = [];
    if (packageExists) {
      removedSkills = await dematerializeExpertPackageSkillsAndRefresh({
        packageDir: destination,
        skillsRoot: onmyagentUserSkillsRoot(),
        refreshSkillLinks: refreshRuntimeSkillLinks,
      });
      await rm(destination, { recursive: true, force: true });
    }
    return {
      ok: true,
      path: destination,
      packageName: safePackage,
      marketplace,
      removedSkills,
      removedPackage: packageExists,
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
    if (typeof refreshRuntimeSkillLinks === "function") {
      await refreshRuntimeSkillLinks().catch(() => undefined);
    }
    return { ok: true, path: destination, packageName: safePackage, skillName: safeSkillName };
  },

  writeMyExpertPackage: async (event, args) => {
    const input = args[0] ?? {};
    const safePackage = validateExpertPackageName(input.packageName ?? input.id);
    const destinationRoot = onmyagentMarketplaceRoot("my-experts");
    const destination = path.join(destinationRoot, safePackage);
    const files = myExpertPackageFiles(input, safePackage);
    const avatar = parseAvatarDataUrl(input.avatarDataUrl);
    if (avatar) files.plugin.avatar = `./avatars/avatar.${avatar.extension}`;
    const knowledgeRoot = path.join(destination, "knowledge");
    let preservedKnowledgeRoot = null;
    try {
      if (input.preserveKnowledge === true && await pathExists(knowledgeRoot)) {
        preservedKnowledgeRoot = path.join(
          destinationRoot,
          `.knowledge-backup-${safePackage}-${Date.now()}`,
        );
        await rm(preservedKnowledgeRoot, { recursive: true, force: true });
        await cp(knowledgeRoot, preservedKnowledgeRoot, { recursive: true });
      }
      await rm(destination, { recursive: true, force: true });
      await mkdir(path.join(destination, ".expert-plugin"), { recursive: true });
      await mkdir(path.join(destination, "agents"), { recursive: true });
      if (avatar) {
        const avatarRoot = path.join(destination, "avatars");
        await mkdir(avatarRoot, { recursive: true });
        await writeFile(path.join(avatarRoot, `avatar.${avatar.extension}`), avatar.bytes);
      }
      await mkdir(knowledgeRoot, { recursive: true });
      if (preservedKnowledgeRoot) {
        await cp(preservedKnowledgeRoot, knowledgeRoot, { recursive: true });
      }
      if (input.draftId) {
        const safeDraft = validateExpertPackageName(input.draftId);
        const stagedKnowledgeRoot = path.join(destinationRoot, ".drafts", safeDraft, "knowledge");
        if (await pathExists(stagedKnowledgeRoot)) {
          await cp(stagedKnowledgeRoot, knowledgeRoot, { recursive: true });
        }
      }
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
      for (const entry of Array.isArray(input.knowledge) ? input.knowledge : []) {
        const relativePath = normalizeKnowledgePath(entry.relativePath);
        const target = path.join(knowledgeRoot, ...relativePath.split("/"));
        if (entry.kind === "directory") {
          await mkdir(target, { recursive: true });
          continue;
        }
        if (entry.kind !== "file") throw new Error("Invalid expert knowledge entry");
        await mkdir(path.dirname(target), { recursive: true });
        const encoded = typeof entry.dataBase64 === "string" ? entry.dataBase64 : "";
        await writeFile(target, Buffer.from(encoded, "base64"));
      }
      if (input.draftId) {
        const safeDraft = validateExpertPackageName(input.draftId);
        await rm(path.join(destinationRoot, ".drafts", safeDraft), { recursive: true, force: true });
      }
      return { ok: true, path: destination, packageName: safePackage, marketplace: "my-experts" };
    } finally {
      if (preservedKnowledgeRoot) {
        await rm(preservedKnowledgeRoot, { recursive: true, force: true });
      }
    }
  },

  stageMyExpertKnowledge: async (event, args) => {
    const input = args[0] ?? {};
    const safeDraft = validateExpertPackageName(input.draftId);
    const destinationRoot = onmyagentMarketplaceRoot("my-experts");
    const draftRoot = path.join(destinationRoot, ".drafts", safeDraft);
    const knowledgeRoot = path.join(draftRoot, "knowledge");
    await rm(draftRoot, { recursive: true, force: true });
    if (input.discard === true) {
      return { ok: true, path: knowledgeRoot, draftId: safeDraft };
    }
    await mkdir(knowledgeRoot, { recursive: true });
    for (const entry of Array.isArray(input.knowledge) ? input.knowledge : []) {
      const relativePath = normalizeKnowledgePath(entry.relativePath);
      const target = path.join(knowledgeRoot, ...relativePath.split("/"));
      if (entry.kind === "directory") {
        await mkdir(target, { recursive: true });
        continue;
      }
      if (entry.kind !== "file") throw new Error("Invalid expert knowledge entry");
      await mkdir(path.dirname(target), { recursive: true });
      const sourcePath = String(entry.sourcePath ?? "").trim();
      if (sourcePath) {
        await cp(sourcePath, target);
        continue;
      }
      const encoded = typeof entry.dataBase64 === "string" ? entry.dataBase64 : "";
      await writeFile(target, Buffer.from(encoded, "base64"));
    }
    return { ok: true, path: knowledgeRoot, draftId: safeDraft };
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
