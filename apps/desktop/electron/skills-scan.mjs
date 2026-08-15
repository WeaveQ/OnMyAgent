/**
 * Skills filesystem scan helpers for desktop main.
 * Global roots are cached (lazy first listLocalSkills); invalidate after install/uninstall.
 */
import os from "node:os";
import path from "node:path";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";

import {
  extractDescription,
  extractFrontmatterMap,
  extractTrigger,
  pickUsableSkillDescription,
} from "./desktop-main-helpers.mjs";
import { validateSkillName } from "./desktop-workspace-ids.mjs";

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath) {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   getRealHomeDir?: () => string,
 *   onmyagentUserSkillsRoot?: () => string,
 *   legacyOnmyagentUserSkillsRoot?: () => string,
 *   globalOpencodeRoot?: () => string,
 *   bundledSkillsRootPath?: () => string | null,
 *   packageSourceCandidates?: (packageName: string) => string[],
 *   refreshSkillLinks?: () => Promise<unknown>,
 *   companySkillsRoot?: () => string | null | undefined,
 * }} [options]
 */
export function createSkillsScan(options = {}) {
  const getRealHomeDir = options.getRealHomeDir;
  const onmyagentUserSkillsRoot = options.onmyagentUserSkillsRoot;
  const legacyOnmyagentUserSkillsRoot = options.legacyOnmyagentUserSkillsRoot;
  const globalOpencodeRoot = options.globalOpencodeRoot;
  const bundledSkillsRootPath = options.bundledSkillsRootPath;
  const packageSourceCandidates = options.packageSourceCandidates;
  const refreshSkillLinks = options.refreshSkillLinks;
  const companySkillsRoot = options.companySkillsRoot;

  if (typeof getRealHomeDir !== "function") {
    throw new Error("createSkillsScan requires getRealHomeDir");
  }
  if (typeof onmyagentUserSkillsRoot !== "function") {
    throw new Error("createSkillsScan requires onmyagentUserSkillsRoot");
  }
  if (typeof legacyOnmyagentUserSkillsRoot !== "function") {
    throw new Error("createSkillsScan requires legacyOnmyagentUserSkillsRoot");
  }
  if (typeof globalOpencodeRoot !== "function") {
    throw new Error("createSkillsScan requires globalOpencodeRoot");
  }
  if (typeof bundledSkillsRootPath !== "function") {
    throw new Error("createSkillsScan requires bundledSkillsRootPath");
  }

  /** Cached global skill roots — filesystem walk is lazy (first listLocalSkills). */
  let globalSkillRootsCache = null;
  let globalSkillRootsInflight = null;
  let defaultBuiltinSkillsEnsured = false;

  /**
   * Project-local skill roots (shown under 本地 tab, not install target).
   */
  async function collectProjectSkillRoots(projectDir) {
    const roots = [];
    let current = path.resolve(projectDir);

    while (true) {
      const opencodeSkills = path.join(current, ".opencode", "skills");
      const legacySkills = path.join(current, ".opencode", "skill");
      const claudeSkills = path.join(current, ".claude", "skills");

      if (await isDirectory(opencodeSkills)) roots.push(opencodeSkills);
      if (await isDirectory(legacySkills)) roots.push(legacySkills);
      if (await isDirectory(claudeSkills)) roots.push(claudeSkills);

      if (await pathExists(path.join(current, ".git"))) {
        break;
      }

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return roots;
  }

  /**
   * Global roots for listLocalSkills:
   * - Profile user root → 已安装 / 内置 (UI classifies by package name)
   * - Legacy + third-party homes → 本地 tab
   * Bundled-skills is install source only (never listed as discovered).
   */
  async function collectGlobalSkillRoots() {
    if (globalSkillRootsCache) return globalSkillRootsCache;
    if (globalSkillRootsInflight) return globalSkillRootsInflight;

    globalSkillRootsInflight = (async () => {
      const roots = [];
      const sandboxHome = os.homedir();
      const realHome = getRealHomeDir();
      const bundledRoot = bundledSkillsRootPath();

      const candidates = [
        onmyagentUserSkillsRoot(),
        legacyOnmyagentUserSkillsRoot(),
        // Org skills mirrored after company login (profiles/company/.../skills/installed)
        typeof companySkillsRoot === "function" ? companySkillsRoot() : null,
        path.join(sandboxHome, ".agent", "skills"),
        path.join(sandboxHome, ".codex", "skills"),
        path.join(sandboxHome, ".cursor", "skills"),
        path.join(sandboxHome, ".windsurf", "skills"),
        path.join(sandboxHome, ".onmyagent", "skills"),
        path.join(sandboxHome, "onmyagent", "skills"),
        path.join(globalOpencodeRoot(), "skills"),
      ].filter((p) => typeof p === "string" && p.trim());

      if (sandboxHome !== realHome) {
        candidates.push(
          path.join(realHome, ".config", "opencode", "skills"),
          path.join(realHome, ".agent", "skills"),
          path.join(realHome, ".codex", "skills"),
          path.join(realHome, ".cursor", "skills"),
          path.join(realHome, ".windsurf", "skills"),
          path.join(realHome, ".onmyagent", "skills"),
          path.join(realHome, "onmyagent", "skills"),
        );
      }

      // Do NOT push bundledRoot — install source only.
      void bundledRoot;

      for (const candidate of candidates) {
        if (await isDirectory(candidate)) {
          roots.push(candidate);
        }
      }

      globalSkillRootsCache = roots;
      return roots;
    })().finally(() => {
      globalSkillRootsInflight = null;
    });

    return globalSkillRootsInflight;
  }

  /** Invalidate after install/uninstall so the next list re-scans roots. */
  function invalidateGlobalSkillRootsCache() {
    globalSkillRootsCache = null;
    globalSkillRootsInflight = null;
  }

  async function collectSkillRoots(projectDir) {
    const roots = [
      ...(await collectProjectSkillRoots(projectDir)),
      ...(await collectGlobalSkillRoots()),
    ];
    return roots.filter((value, index) => roots.indexOf(value) === index);
  }

  async function findSkillDirsInRoot(root) {
    const found = [];
    if (!(await isDirectory(root))) return found;

    const entries = await readdir(root, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        if (!(await isDirectory(path.join(root, entry.name)))) continue;
      } else if (!entry.isDirectory()) {
        continue;
      }
      const direct = path.join(root, entry.name);
      if (await pathExists(path.join(direct, "SKILL.md"))) {
        found.push(direct);
        continue;
      }

      const nestedEntries = await readdir(direct, { withFileTypes: true }).catch(
        () => [],
      );
      for (const nested of nestedEntries) {
        if (nested.isSymbolicLink()) {
          if (!(await isDirectory(path.join(direct, nested.name)))) continue;
        } else if (!nested.isDirectory()) {
          continue;
        }
        const nestedDir = path.join(direct, nested.name);
        if (await pathExists(path.join(nestedDir, "SKILL.md"))) {
          found.push(nestedDir);
        }
      }
    }

    return found;
  }

  async function ensureDefaultBuiltinSkillsOnce() {
    if (defaultBuiltinSkillsEnsured) {
      return { ok: true, installed: [], skipped: [], errors: [] };
    }
    defaultBuiltinSkillsEnsured = true;
    try {
      const { ensureDefaultBuiltinSkills } = await import(
        "./ensure-default-builtin-skills.mjs"
      );
      const result = await ensureDefaultBuiltinSkills({
        bundledRoot: bundledSkillsRootPath(),
        userSkillsRoot: onmyagentUserSkillsRoot(),
        packageSourceCandidates: (packageName) => {
          if (typeof packageSourceCandidates === "function") {
            return packageSourceCandidates(packageName);
          }
          return [];
        },
      });
      if (result.installed.length > 0) {
        if (typeof refreshSkillLinks === "function") {
          await refreshSkillLinks().catch(() => undefined);
        }
        invalidateGlobalSkillRootsCache();
        console.info(
          "[skills] core preinstall:",
          result.installed.join(", "),
        );
      }
      if (result.errors.length > 0) {
        console.warn("[skills] core preinstall issues:", result.errors.join("; "));
      }
      return result;
    } catch (error) {
      console.warn("[skills] ensureDefaultBuiltinSkills failed", error);
      return {
        ok: false,
        installed: [],
        skipped: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async function listLocalSkills(projectDir) {
    if (!String(projectDir ?? "").trim()) {
      throw new Error("projectDir is required");
    }

    await ensureDefaultBuiltinSkillsOnce();

    const LOCALE_KEYS = [
      "display_name",
      "display_name_zh",
      "display_name_en",
      "description",
      "description_zh",
      "description_en",
    ];
    const seen = new Set();
    const out = [];
    for (const root of await collectSkillRoots(projectDir)) {
      for (const skillDir of await findSkillDirsInRoot(root)) {
        const name = path.basename(skillDir);
        if (seen.has(name)) {
          continue;
        }
        seen.add(name);
        let raw = "";
        try {
          raw = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
        } catch {
          raw = "";
        }
        const localeMap = extractFrontmatterMap(raw, LOCALE_KEYS);
        out.push({
          name,
          path: skillDir,
          description: pickUsableSkillDescription(
            localeMap.description_zh,
            localeMap.description_en,
            localeMap.description,
            extractDescription(raw),
          ),
          trigger: extractTrigger(raw) ?? undefined,
          root,
          readonly: bundledSkillsRootPath() === root,
          // Prefer explicit zh; fall back to generic display_name (often Chinese).
          displayNameZh:
            localeMap.display_name_zh || localeMap.display_name || undefined,
          displayNameEn: localeMap.display_name_en || undefined,
          descriptionZh: pickUsableSkillDescription(localeMap.description_zh),
          descriptionEn: pickUsableSkillDescription(
            localeMap.description_en,
            localeMap.description,
          ),
        });
      }
    }

    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function listBuiltinSkillCatalog() {
    await ensureDefaultBuiltinSkillsOnce();
    const { buildBuiltinSkillCatalogEntries } = await import(
      "./builtin-skills-policy.mjs"
    );
    const bundledRoot = bundledSkillsRootPath();
    const packageNames = [];
    if (bundledRoot && (await isDirectory(bundledRoot))) {
      const entries = await readdir(bundledRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        const skillMd = path.join(bundledRoot, entry.name, "SKILL.md");
        if (await pathExists(skillMd)) packageNames.push(entry.name);
      }
    }
    packageNames.sort((a, b) => a.localeCompare(b));

    const userRoot = onmyagentUserSkillsRoot();
    const installed = [];
    if (await isDirectory(userRoot)) {
      const entries = await readdir(userRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const skillMd = path.join(userRoot, entry.name, "SKILL.md");
        if (await pathExists(skillMd)) installed.push(entry.name);
      }
    }

    const base = buildBuiltinSkillCatalogEntries({
      packageNames,
      installedSkillNames: installed,
    });

    const LOCALE_KEYS = [
      "display_name_zh",
      "display_name_en",
      "description",
      "description_zh",
      "description_en",
    ];
    const enriched = [];
    for (const entry of base) {
      let description;
      let displayNameZh;
      let displayNameEn;
      if (bundledRoot) {
        try {
          const raw = await readFile(
            path.join(bundledRoot, entry.packageName, "SKILL.md"),
            "utf8",
          );
          const localeMap = extractFrontmatterMap(raw, LOCALE_KEYS);
          description = pickUsableSkillDescription(
            localeMap.description_zh,
            localeMap.description_en,
            localeMap.description,
            extractDescription(raw),
          );
          displayNameZh = localeMap.display_name_zh;
          displayNameEn = localeMap.display_name_en;
        } catch {
          /* ignore missing read */
        }
      }
      enriched.push({
        ...entry,
        description,
        displayNameZh,
        displayNameEn,
      });
    }
    return { skills: enriched };
  }

  async function findSkillFile(projectDir, name) {
    const safeName = validateSkillName(name);
    for (const root of await collectSkillRoots(projectDir)) {
      const direct = path.join(root, safeName, "SKILL.md");
      if (await pathExists(direct)) return direct;

      const entries = await readdir(root, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(root, entry.name, safeName, "SKILL.md");
        if (await pathExists(nested)) return nested;
      }
    }
    return null;
  }

  async function ensureProjectSkillRoot(_projectDir) {
    await mkdir(onmyagentUserSkillsRoot(), { recursive: true });
    return onmyagentUserSkillsRoot();
  }

  return {
    collectProjectSkillRoots,
    collectGlobalSkillRoots,
    invalidateGlobalSkillRootsCache,
    collectSkillRoots,
    findSkillDirsInRoot,
    ensureDefaultBuiltinSkillsOnce,
    listLocalSkills,
    listBuiltinSkillCatalog,
    findSkillFile,
    ensureProjectSkillRoot,
  };
}
