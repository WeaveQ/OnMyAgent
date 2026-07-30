/**
 * Copy core preinstall bundled skills into the user skills root (idempotent).
 */
import { existsSync } from "node:fs";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  CORE_PREINSTALL_SKILLS,
  shouldInstallCoreSkill,
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
  const skipped = [];
  const errors = [];

  await mkdir(userRoot, { recursive: true });

  for (const entry of core) {
    const destination = path.join(userRoot, entry.skillName);
    const exists = await pathExists(destination);
    if (
      !shouldInstallCoreSkill({
        packageName: entry.packageName,
        skillName: entry.skillName,
        destinationExists: exists,
      })
    ) {
      skipped.push(entry.skillName);
      continue;
    }

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

    try {
      await copyDir(sourceDir, destination);
      installed.push(entry.skillName);
    } catch (error) {
      errors.push(
        `${entry.skillName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    installed,
    skipped,
    errors,
  };
}
