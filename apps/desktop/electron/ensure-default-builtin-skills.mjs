/**
 * Copy core preinstall bundled skills into the user skills root (idempotent).
 * Existing core installs also re-sync SKILL.md so display name/description stay current.
 */
import { existsSync } from "node:fs";
import { cp, copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  CORE_PREINSTALL_SKILLS,
  shouldInstallCoreSkill,
  shouldRefreshCoreSkillMarkdown,
  shouldRefreshCoreSkillPackage,
} from "./builtin-skills-policy.mjs";

/**
 * @param {{
 *   bundledRoot: string | null | undefined,
 *   userSkillsRoot: string,
 *   packageSourceCandidates?: (packageName: string) => string[],
 *   coreSkills?: readonly { packageName: string, skillName: string }[],
 *   pathExists?: (p: string) => Promise<boolean>,
 *   copyDir?: (src: string, dest: string) => Promise<void>,
 * }} input
 */
/**
 * Runtime helper: coerce firstExisting PathLike roots to string before install.
 * @param {() => unknown} getBundledRoot
 * @param {() => unknown} getUserSkillsRoot
 */
export async function ensureDefaultBuiltinSkillsFromRoots(
  getBundledRoot,
  getUserSkillsRoot,
) {
  const bundledRoot = getBundledRoot();
  return ensureDefaultBuiltinSkills({
    bundledRoot: bundledRoot == null ? null : String(bundledRoot),
    userSkillsRoot: String(getUserSkillsRoot() ?? ""),
  });
}

export async function ensureDefaultBuiltinSkills(input) {
  const userRoot = String(input.userSkillsRoot ?? "").trim();
  if (!userRoot) {
    return { ok: false, installed: [], skipped: [], errors: ["missing userSkillsRoot"] };
  }

  const pathExists =
    input.pathExists ??
    (async (target) => {
      try {
        await stat(target);
        return true;
      } catch {
        return false;
      }
    });

  const copyDir =
    input.copyDir ??
    (async (src, dest) => {
      await rm(dest, { recursive: true, force: true });
      await cp(src, dest, { recursive: true });
    });

  const core = input.coreSkills ?? CORE_PREINSTALL_SKILLS;
  const installed = [];
  const refreshed = [];
  const skipped = [];
  const errors = [];

  await mkdir(userRoot, { recursive: true });

  for (const entry of core) {
    const destination = path.join(userRoot, entry.skillName);
    const exists = await pathExists(destination);

    let sourceDir = null;
    if (typeof input.packageSourceCandidates === "function") {
      const candidates = input.packageSourceCandidates(entry.packageName);
      sourceDir = candidates.find((candidate) => existsSync(candidate)) ?? null;
    } else if (input.bundledRoot) {
      const candidate = path.join(input.bundledRoot, entry.packageName);
      if (existsSync(candidate)) sourceDir = candidate;
    }

    if (!sourceDir) {
      errors.push(`source missing: ${entry.packageName}`);
      continue;
    }

    // Fresh install of missing core packages.
    if (
      shouldInstallCoreSkill({
        packageName: entry.packageName,
        skillName: entry.skillName,
        destinationExists: exists,
      })
    ) {
      try {
        await copyDir(sourceDir, destination);
        installed.push(entry.skillName);
      } catch (error) {
        errors.push(
          `${entry.skillName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      continue;
    }

    // Product-owned core skills: refresh SKILL.md so card titles/descriptions
    // pick up bundled frontmatter (fixes stale ">-" / empty descriptions).
    if (
      shouldRefreshCoreSkillPackage({
        packageName: entry.packageName,
        skillName: entry.skillName,
        destinationExists: exists,
      })
    ) {
      try {
        await copyDir(sourceDir, destination);
        refreshed.push(entry.skillName);
      } catch (error) {
        errors.push(
          `${entry.skillName} refresh: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      continue;
    }

    if (
      shouldRefreshCoreSkillMarkdown({
        packageName: entry.packageName,
        skillName: entry.skillName,
        destinationExists: exists,
      })
    ) {
      const srcMd = path.join(sourceDir, "SKILL.md");
      const destMd = path.join(destination, "SKILL.md");
      if (existsSync(srcMd)) {
        try {
          await mkdir(destination, { recursive: true });
          await copyFile(srcMd, destMd);
          refreshed.push(entry.skillName);
        } catch (error) {
          errors.push(
            `${entry.skillName} refresh: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        continue;
      }
    }

    skipped.push(entry.skillName);
  }

  return {
    ok: errors.length === 0,
    installed,
    refreshed,
    skipped,
    errors,
  };
}
