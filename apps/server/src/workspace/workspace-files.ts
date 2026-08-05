import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function opencodeConfigPath(workspaceRoot: string): string {
  const jsoncPath = join(workspaceRoot, "opencode.jsonc");
  const jsonPath = join(workspaceRoot, "opencode.json");
  const hiddenJsoncPath = join(workspaceRoot, ".opencode", "opencode.jsonc");
  const hiddenJsonPath = join(workspaceRoot, ".opencode", "opencode.json");
  if (existsSync(jsoncPath)) return jsoncPath;
  if (existsSync(jsonPath)) return jsonPath;
  if (existsSync(hiddenJsoncPath)) return hiddenJsoncPath;
  if (existsSync(hiddenJsonPath)) return hiddenJsonPath;
  return jsoncPath;
}

export function onmyagentConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "onmyagent.json");
}

/**
 * Phase-2 profile skills root (see docs/design/2026-08-02-config-consistency.md).
 */
export function profileSkillsDir(home = homedir()): string {
  return join(home, ".onmyagent", "profiles", "local", "config", "skills");
}

/** Pre-migration user skills root (never deleted by migration). */
export function legacyOnmyagentSkillsDir(home = homedir()): string {
  return join(home, ".onmyagent", "skills");
}

function dirNonEmpty(dir: string): boolean {
  try {
    if (!existsSync(dir)) return false;
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function readLocalMigrationComplete(home = homedir()): boolean {
  try {
    const manifestPath = join(
      home,
      ".onmyagent",
      "profiles",
      "local",
      "config",
      "manifest.json",
    );
    if (!existsSync(manifestPath)) return false;
    const raw = readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as { migration?: { status?: string } };
    return parsed?.migration?.status === "complete";
  } catch {
    return false;
  }
}

/**
 * Resolve write/primary skills root for a home directory (Phase-2 dual-read).
 */
export function resolveGlobalSkillsDir(home = homedir()): string {
  const profile = profileSkillsDir(home);
  const legacy = legacyOnmyagentSkillsDir(home);
  if (readLocalMigrationComplete(home)) return profile;
  if (dirNonEmpty(profile)) return profile;
  return legacy;
}

/**
 * OnMyAgent user-installed skills root (write + primary list target).
 * Dual-read with Phase-2 profile path; env override for tests.
 */
export function globalSkillsDir(): string {
  const envOverride = process.env.OPENCODE_GLOBAL_SKILLS_DIR;
  if (envOverride && envOverride.trim().length > 0) {
    return envOverride;
  }
  return resolveGlobalSkillsDir(homedir());
}

/**
 * All OnMyAgent skill roots to list (profile + legacy when both exist).
 * Dedup by skill name happens in listSkills.
 */
export function resolveGlobalSkillsDirs(home = homedir()): string[] {
  const profile = profileSkillsDir(home);
  const legacy = legacyOnmyagentSkillsDir(home);
  const primary = resolveGlobalSkillsDir(home);
  const dirs: string[] = [];
  const push = (dir: string) => {
    if (!dirs.includes(dir)) dirs.push(dir);
  };
  push(primary);
  if (primary === profile && dirNonEmpty(legacy)) push(legacy);
  else if (primary === legacy && dirNonEmpty(profile)) push(profile);
  return dirs;
}

export function globalSkillsDirs(): string[] {
  const envOverride = process.env.OPENCODE_GLOBAL_SKILLS_DIR;
  if (envOverride && envOverride.trim().length > 0) {
    return [envOverride];
  }
  return resolveGlobalSkillsDirs(homedir());
}

export function legacyOpencodeSkillsDir(): string {
  return join(homedir(), ".config", "opencode", "skills");
}

export function legacyClaudeSkillsDir(): string {
  return join(homedir(), ".claude", "skills");
}

export function legacyAgentsSkillsDir(): string {
  return join(homedir(), ".agents", "skills");
}

export function legacyAgentSkillsDir(): string {
  return join(homedir(), ".agent", "skills");
}

export function bundledSkillsDir(): string | null {
  const value = process.env.ONMYAGENT_BUNDLED_SKILLS_DIR?.trim();
  return value && existsSync(value) ? value : null;
}

export function bundledArtifactPluginsDir(): string | null {
  const value = process.env.ONMYAGENT_BUNDLED_PLUGINS_DIR?.trim();
  return value && existsSync(value) ? value : null;
}

export function projectCommandsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "commands");
}

export function projectPluginsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "plugins");
}
