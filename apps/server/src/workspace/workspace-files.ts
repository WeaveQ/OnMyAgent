import { existsSync } from "node:fs";
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
 * User-installed skills root (market install + core preinstall).
 * Phase-2: profiles/local/config/skills — write target for 已安装/内置.
 */
export function profileSkillsDir(home = homedir()): string {
  return join(home, ".onmyagent", "profiles", "local", "config", "skills");
}

/** Legacy user skills path (scanned for 本地 tab only; not write target). */
export function legacyOnmyagentSkillsDir(home = homedir()): string {
  return join(home, ".onmyagent", "skills");
}

/**
 * Resolve write skills root for a home directory (profile only).
 */
export function resolveGlobalSkillsDir(home = homedir()): string {
  return profileSkillsDir(home);
}

/**
 * OnMyAgent profile skills root (write + 已安装/内置 list).
 * Env override for tests only.
 */
export function globalSkillsDir(): string {
  const envOverride = process.env.OPENCODE_GLOBAL_SKILLS_DIR;
  if (envOverride && envOverride.trim().length > 0) {
    return envOverride;
  }
  return resolveGlobalSkillsDir(homedir());
}

export function resolveGlobalSkillsDirs(home = homedir()): string[] {
  return [resolveGlobalSkillsDir(home)];
}

export function globalSkillsDirs(): string[] {
  return [globalSkillsDir()];
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
