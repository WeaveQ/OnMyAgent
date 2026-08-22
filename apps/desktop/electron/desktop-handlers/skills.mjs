/**
 * skills domain IPC handlers for the Electron desktop bridge.
 * Factories receive services/helpers constructed in main.mjs.
 */

import {
  listExpertPackageSkillDeclarations,
} from "../expert-package-skills.mjs";
import {
  exportExpertPackageToZip,
  importExpertPackageFromSource,
} from "../expert-package-import.mjs";
import { createZipFromDir, extractZipToDir } from "../managed-tools/managed-cli/archive.mjs";
import { toPortableRelativePath } from "../lib/portable-path.mjs";

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
  "deleteExpertPackage",
  "importExpertPackage",
  "exportExpertPackage",
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
  expertDeleteJournalPath,
  userAgentRegistryPath,
  rename,
} = {}) {
  const normalizeKnowledgePath = (value) => {
    const normalized = toPortableRelativePath(value);
    if (!normalized) {
      throw new Error("Invalid expert knowledge path");
    }
    return normalized;
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
    // Expert skills stay in the package (and later the expert session dir).
    // Do not copy them into the user installed-skills root / 已安装 bucket.
    const declaredSkills = await listExpertPackageSkillDeclarations(destination);
    return {
      ok: true,
      path: destination,
      packageName: safePackage,
      marketplace,
      skills: declaredSkills,
      declaredSkills,
      installedSkills: [],
      missingSkills: [],
    };
  },

  uninstallExpertPackage: async (event, args) => {
    const input = args[0] ?? {};
    const marketplace = validateExpertMarketplaceName(input.marketplace ?? "my-experts");
    const safePackage = validateExpertPackageName(input.packageName ?? input.id);
    const destinationRoot = onmyagentMarketplaceRoot(marketplace);
    const destination = path.join(destinationRoot, safePackage);
    const packageExists = existsSync(destination);
    const removedSkills = [];
    if (packageExists) {
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

  deleteExpertPackage: async (event, args) => {
    const input = args[0] ?? {};
    const operationId = String(input.operationId ?? "").trim();
    const agentId = String(input.agentId ?? "").trim();
    const safePackage = validateExpertPackageName(input.packageName ?? input.id);
    if (!operationId || operationId.length > 160) throw new Error("operationId is required");
    if (!agentId || agentId.length > 160) throw new Error("agentId is required");
    const marketplace = String(input.marketplace ?? "").trim();
    if (marketplace !== "my-experts" && marketplace !== "experts") {
      throw new Error("Built-in expert packages cannot be deleted");
    }
    const journalPath = String(expertDeleteJournalPath ?? "").trim();
    if (!journalPath) throw new Error("Expert delete journal is unavailable");
    const isNonEmpty = (value, max = 512) =>
      typeof value === "string" && value.trim().length > 0 && value.length <= max;
    const isStepState = (value) =>
      value === "pending" || value === "completed" || value === "skipped" || value === "failed";
    const isResultState = (value) => value === "partial" || value === "completed";
    const isDeleteJournalEntry = (entry) => {
      if (!entry || typeof entry !== "object" || entry.version !== 1 ||
        !isNonEmpty(entry.operationId, 160) || !isNonEmpty(entry.agentId, 160) ||
        !isNonEmpty(entry.packageName, 160) || !isResultState(entry.state) ||
        !entry.result || typeof entry.result !== "object" ||
        entry.result.ok !== true || entry.result.operationId !== entry.operationId ||
        entry.result.packageName !== entry.packageName ||
        !isResultState(entry.result.state) || entry.result.state !== entry.state ||
        !Array.isArray(entry.result.steps) || !Array.isArray(entry.result.removedSkills)) return false;
      if (entry.result.agentId !== undefined && entry.result.agentId !== entry.agentId) return false;
      if (entry.result.removedSkills.some((skill) => !isNonEmpty(skill, 160))) return false;
      const targets = new Set();
      for (const step of entry.result.steps) {
        if (!step || typeof step !== "object" ||
          !["my-experts", "experts", "registry", "skills"].includes(step.target) ||
          targets.has(step.target) || !isStepState(step.state) ||
          (step.code !== undefined && !isNonEmpty(step.code, 160))) return false;
        targets.add(step.target);
      }
      return targets.size === 4;
    };
    const readJournal = async () => {
      try {
        const parsed = JSON.parse(await readFile(journalPath, "utf8"));
        const seen = new Set();
        if (!Array.isArray(parsed) || parsed.some((entry) => {
          if (!isDeleteJournalEntry(entry) || seen.has(entry.operationId)) return true;
          seen.add(entry.operationId);
          return false;
        })) throw new Error("Expert delete journal is corrupt");
        return parsed;
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        if (error instanceof SyntaxError) throw new Error("Expert delete journal is corrupt");
        throw error;
      }
    };
    const persistJournal = async (entries) => {
      await mkdir(path.dirname(journalPath), { recursive: true });
      const temporary = `${journalPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        await writeFile(temporary, `${JSON.stringify(entries.slice(-32), null, 2)}\n`, "utf8");
        await rename(temporary, journalPath);
      } finally {
        await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
      }
    };
    const journal = await readJournal();
    const conflicting = journal.find((entry) =>
      entry.operationId === operationId &&
      (entry.agentId !== agentId || entry.packageName !== safePackage),
    );
    if (conflicting) throw new Error("Expert delete operation belongs to another package");
    const previous = journal.find((entry) =>
      entry?.version === 1 && entry.operationId === operationId && entry.packageName === safePackage && entry.agentId === agentId,
    );
    if (previous?.state === "completed") return previous.result;
    const result = previous?.result ?? {
      ok: true,
      operationId,
      agentId,
      packageName: safePackage,
      state: "partial",
      steps: [
        { target: "my-experts", state: "pending" },
        { target: "experts", state: "pending" },
        { target: "registry", state: "pending" },
        { target: "skills", state: "pending" },
      ],
      removedSkills: [],
    };
    const record = { version: 1, operationId, agentId, packageName: safePackage, state: "partial", result };
    const checkpoint = async () => persistJournal(journal.filter((entry) => entry !== previous).concat(record));
    await checkpoint();

    const update = (target, state, code) => {
      const step = result.steps.find((entry) => entry.target === target);
      if (!step) return;
      step.state = state;
      if (code) step.code = code;
      else delete step.code;
    };
    const customRoot = onmyagentMarketplaceRoot("my-experts");
    const customPackageDir = path.join(customRoot, safePackage);
    const customStep = result.steps.find((entry) => entry.target === "my-experts");
    if (customStep?.state === "pending" || customStep?.state === "failed") {
      if (marketplace !== "my-experts") {
        update("my-experts", "skipped", "not_targeted");
      } else {
        try {
          if (!existsSync(customPackageDir)) {
            update("my-experts", "skipped", "package_missing");
          } else {
            await rm(customPackageDir, { recursive: true, force: true });
            update("my-experts", "completed");
          }
        } catch {
          update("my-experts", "failed", "package_delete_failed");
        }
      }
      await checkpoint();
    }

    const installPackageDir = path.join(onmyagentMarketplaceRoot("experts"), safePackage);
    const expertsStep = result.steps.find((entry) => entry.target === "experts");
    if (expertsStep?.state === "pending" || expertsStep?.state === "failed") {
      if (marketplace !== "experts") {
        update("experts", "skipped", "not_targeted");
      } else {
        try {
          if (!existsSync(installPackageDir)) {
            update("experts", "skipped", "marketplace_missing");
          } else {
            await rm(installPackageDir, { recursive: true, force: true });
            update("experts", "completed");
          }
        } catch {
          update("experts", "failed", "package_delete_failed");
        }
      }
      await checkpoint();
    }
    const targetedStep = marketplace === "experts" ? expertsStep : customStep;
    const packageBlocked = targetedStep?.state === "failed" || targetedStep?.state === "pending";
    const registryStep = result.steps.find((entry) => entry.target === "registry");
    if (!packageBlocked && (registryStep?.state === "pending" || registryStep?.state === "failed")) {
      try {
        const registryPath = typeof userAgentRegistryPath === "function" ? userAgentRegistryPath() : "";
        if (!registryPath) {
          update("registry", "skipped", "registry_missing");
        } else {
          let registry;
          try {
            registry = JSON.parse(await readFile(registryPath, "utf8"));
          } catch (error) {
            if (error?.code === "ENOENT") {
              update("registry", "skipped", "registry_missing");
            } else {
              throw new Error("Expert registry is corrupt");
            }
          }
          if (registry) {
            if (!Array.isArray(registry.agents)) throw new Error("Expert registry is corrupt");
            const matching = registry.agents.filter((entry) => entry && entry.id === agentId);
            if (matching.some((entry) => entry.builtin === true)) {
              update("registry", "failed", "builtin_protected");
            } else if (matching.length === 0) {
              update("registry", "skipped", "registry_missing");
            } else {
              const next = {
                ...registry,
                updatedAt: new Date().toISOString(),
                agents: registry.agents.filter((entry) => !(entry && entry.id === agentId)),
              };
              const registryTmp = `${registryPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
              await mkdir(path.dirname(registryPath), { recursive: true });
              try {
                await writeFile(registryTmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
                await rename(registryTmp, registryPath);
              } finally {
                await rm(registryTmp, { recursive: true, force: true }).catch(() => undefined);
              }
              update("registry", "completed");
            }
          }
        }
      } catch {
        update("registry", "failed", "registry_delete_failed");
      }
      await checkpoint();
    }
    const skillsStep = result.steps.find((entry) => entry.target === "skills");
    if (!packageBlocked && (skillsStep?.state === "pending" || skillsStep?.state === "failed")) {
      update("skills", "completed", result.removedSkills.length > 0 ? undefined : "no_owned_skills");
    }
    const failed = result.steps.some((step) => step.state === "failed");
    const pending = result.steps.some((step) => step.state === "pending");
    result.state = failed || pending ? "partial" : "completed";
    record.state = result.state;
    await checkpoint();
    return result;
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

  importExpertPackage: async (event, args) => {
    const payload = args[0] ?? {};
    return importExpertPackageFromSource({
      sourcePath: payload.sourcePath,
      overwrite: payload.overwrite === true,
      asCopy: payload.asCopy === true,
      marketplaceRoot: onmyagentMarketplaceRoot("my-experts"),
      validateExpertPackageName,
      pathExists,
      mkdir,
      rm,
      cp,
      extractZipToDir,
      listDeclaredSkills: listExpertPackageSkillDeclarations,
    });
  },

  exportExpertPackage: async (event, args) => {
    const payload = args[0] ?? {};
    return exportExpertPackageToZip({
      packageName: payload.packageName,
      destPath: payload.destPath,
      marketplaceRoot: onmyagentMarketplaceRoot("my-experts"),
      validateExpertPackageName,
      pathExists,
      mkdir,
      createZipFromDir,
    });
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
